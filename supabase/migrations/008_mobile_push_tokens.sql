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
--   * Writes go through security-definer RPCs that validate platform and token length. Chat guests
--     (anonymous Supabase users) may register: push is a Secret Chat feature, like chat_register_device
--     in 006, not an account feature (compare 007, which blocks guests from secret requests).
-- Additive only: one new table, two new functions. Rollback: 008_mobile_push_tokens_down.sql.

create table if not exists public.push_devices (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references auth.users(id) on delete cascade,
  platform   text not null check (platform in ('ios', 'android')),
  token      text not null check (char_length(token) between 1 and 4096),
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  unique (owner, token)
);
create index if not exists push_devices_owner on public.push_devices (owner);

alter table public.push_devices enable row level security;
revoke all on public.push_devices from anon, authenticated;
grant select, insert, update, delete on public.push_devices to authenticated;
grant all on public.push_devices to service_role;
drop policy if exists "owner manages push devices" on public.push_devices;
create policy "owner manages push devices" on public.push_devices for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

-- Upsert the caller's token. Re-registering the same token refreshes last_seen (and platform,
-- should a token ever move between builds).
create or replace function public.register_push_device(p_platform text, p_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if p_platform is null or p_platform not in ('ios', 'android') then raise exception 'bad_platform'; end if;
  if p_token is null or char_length(p_token) < 1 or char_length(p_token) > 4096 then raise exception 'bad_token'; end if;
  insert into push_devices (owner, platform, token) values (auth.uid(), p_platform, p_token)
  on conflict (owner, token) do update set last_seen = now(), platform = excluded.platform;
end $$;

-- Remove the caller's token (sign-out, notifications turned off). Other owners' rows are never touched.
create or replace function public.unregister_push_device(p_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  delete from push_devices where owner = auth.uid() and token = p_token;
end $$;

revoke all on function public.register_push_device(text, text) from public, anon;
grant execute on function public.register_push_device(text, text) to authenticated;
revoke all on function public.unregister_push_device(text) from public, anon;
grant execute on function public.unregister_push_device(text) to authenticated;
