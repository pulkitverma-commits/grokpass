-- 008: native push tokens for the OnePeek mobile app (iOS APNs / Android FCM).
--
-- The app registers its raw device token here; the server (lib/alerts.ts, service role) reads
-- the owner's tokens and sends a fixed-string push that carries only the room id as an opaque
-- routing key. Tokens are stored as given: they are device-scoped, revocable by the platform and
-- useless without the APNs key / FCM service account, which live in Vercel env only.
--
-- Rules, enforced here:
--   * RLS on, default deny for anon. Owners see and manage only their own rows (owner = auth.uid()).
--     The service role bypasses RLS as usual.
--   * Writes go through security-definer RPCs that validate platform and token shape. Chat guests
--     (anonymous Supabase users) may register: push is a Secret Chat feature, like chat_register_device
--     in 006, not an account feature (compare 007, which blocks guests from secret requests).
--   * A token belongs to one owner (security review W1-2): `unique (token)`. Re-registering a token
--     from another account moves the row to that account, so a shared or sold phone stops receiving
--     the previous account's pushes the moment the new account registers.
--   * Tokens look like what the platforms issue (W1-3): 32-512 chars of `[A-Za-z0-9:_-]` (APNs: 64 hex;
--     FCM: ~150-200 chars of that alphabet). Anything else is `bad_token`. (Written as a length check
--     plus `^[A-Za-z0-9:_-]+$` because Postgres caps regex repetition bounds at 255.)
--   * At most 10 tokens per owner (W1-3): after each registration the caller's rows beyond the 10
--     most recently seen are deleted, so one account cannot turn a notify into an unbounded fan-out.
--   * `authenticated` holds only select and delete on the table (W2-5); insert and update are
--     refused by the grant, so the cap and the one-owner rule cannot be sidestepped via PostgREST.
--   * Both RPCs run with `search_path = ''` and schema-qualified names (Supabase's recommended form).
-- Additive only: one new table, two new functions. Rollback: 008_mobile_push_tokens_down.sql.

create table if not exists public.push_devices (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references auth.users(id) on delete cascade,
  platform   text not null check (platform in ('ios', 'android')),
  token      text not null check (char_length(token) between 32 and 512 and token ~ '^[A-Za-z0-9:_-]+$'),
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  unique (token)
);
create index if not exists push_devices_owner on public.push_devices (owner);

alter table public.push_devices enable row level security;
revoke all on public.push_devices from anon, authenticated;
-- Writes only through the RPCs (W2-5): a direct insert/update would sidestep the 10-row cap and the
-- takeover rule. Owners may still read and delete their own rows (RLS below).
grant select, delete on public.push_devices to authenticated;
grant all on public.push_devices to service_role;
drop policy if exists "owner manages push devices" on public.push_devices;
create policy "owner manages push devices" on public.push_devices for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

-- Upsert the caller's token. Re-registering the same token refreshes last_seen (and platform,
-- should a token ever move between builds); registering a token another account holds takes it
-- over. Then the caller is trimmed to their 10 most recently seen tokens.
create or replace function public.register_push_device(p_platform text, p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then raise exception 'not_signed_in'; end if;
  if p_platform is null or p_platform not in ('ios', 'android') then raise exception 'bad_platform'; end if;
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 512 or p_token !~ '^[A-Za-z0-9:_-]+$' then
    raise exception 'bad_token';
  end if;
  insert into public.push_devices (owner, platform, token) values (v_owner, p_platform, p_token)
  on conflict (token) do update set owner = v_owner, platform = excluded.platform, last_seen = now();
  delete from public.push_devices d
  where d.owner = v_owner
    and d.id not in (
      select k.id from public.push_devices k
      where k.owner = v_owner
      order by k.last_seen desc, k.created_at desc, k.id desc
      limit 10
    );
end $$;

-- Remove the caller's token (sign-out, notifications turned off). Other owners' rows are never touched.
create or replace function public.unregister_push_device(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  delete from public.push_devices where owner = auth.uid() and token = p_token;
end $$;

revoke all on function public.register_push_device(text, text) from public, anon;
grant execute on function public.register_push_device(text, text) to authenticated;
revoke all on function public.unregister_push_device(text) from public, anon;
grant execute on function public.unregister_push_device(text) to authenticated;
