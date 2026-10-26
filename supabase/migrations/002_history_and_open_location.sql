-- OnePass: secret history (per signed-in sender) + optional "where it was opened".
-- Safe to run more than once.

-- Senders can opt in, per secret, to see the approximate place it was opened.
alter table public.secrets add column if not exists share_location boolean not null default false;

-- History of secrets sent by signed-in users. Holds no ciphertext and no keys.
create table if not exists public.secret_log (
  id             text primary key,
  owner          uuid not null references auth.users(id) on delete cascade,
  kind           text not null check (kind in ('text', 'file')),
  size           bigint,
  recipient      text,
  share_location boolean not null default false,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  opened_at      timestamptz,
  open_city      text,
  open_region    text,
  open_country   text,
  open_lat       double precision,
  open_lon       double precision
);
create index if not exists secret_log_owner_created on public.secret_log (owner, created_at desc);
alter table public.secret_log enable row level security;
revoke all on public.secret_log from anon, authenticated;
grant select, delete on public.secret_log to authenticated;
drop policy if exists "owner reads own history" on public.secret_log;
create policy "owner reads own history" on public.secret_log for select to authenticated using (owner = auth.uid());
drop policy if exists "owner deletes own history" on public.secret_log;
create policy "owner deletes own history" on public.secret_log for delete to authenticated using (owner = auth.uid());

-- Peek now also says whether opening will share a location (so the viewer is told first).
drop function if exists public.peek_secret(text);
create function public.peek_secret(p_id text)
returns table (header text, kind text, expires_at timestamptz, share_location boolean)
language sql stable security definer set search_path = public as $$
  select s.header,
         case when s.file_path is null then 'text' else 'file' end,
         s.expires_at,
         s.share_location
  from secrets s
  where s.id = p_id and s.expires_at > now();
$$;

-- Open (burns) + records the open in the sender's history. Location is stored only
-- when the sender asked for it; it comes from the network (city-level), not GPS.
drop function if exists public.open_secret(text);
drop function if exists public.open_secret(text, text, text, text, double precision, double precision);
create function public.open_secret(
  p_id text,
  p_city text default null, p_region text default null, p_country text default null,
  p_lat double precision default null, p_lon double precision default null
) returns table (header text, body text, file_path text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r secrets%rowtype;
begin
  delete from secrets s where s.id = p_id and s.expires_at > now() returning s.* into r;
  if not found then return; end if;
  if r.file_path is not null then
    insert into secret_claims (file_path, expires_at)
    values (r.file_path, now() + interval '10 minutes')
    on conflict (file_path) do update set expires_at = excluded.expires_at;
  end if;
  update secret_log l set
    opened_at    = now(),
    open_city    = case when r.share_location then left(p_city, 120) end,
    open_region  = case when r.share_location then left(p_region, 120) end,
    open_country = case when r.share_location then left(p_country, 8) end,
    open_lat     = case when r.share_location and p_lat between -90 and 90 then round(p_lat::numeric, 2)::double precision end,
    open_lon     = case when r.share_location and p_lon between -180 and 180 then round(p_lon::numeric, 2)::double precision end
  where l.id = r.id and l.opened_at is null;
  return query select r.header, r.body, r.file_path;
end $$;

-- Create: optional recipient label + location opt-in; logs to history when signed in.
drop function if exists public.create_secret(text, text, text, int, text, text);
drop function if exists public.create_secret(text, text, text, int, text, text, text, boolean, bigint);
create function public.create_secret(
  p_header text, p_body text, p_file_path text, p_ttl_seconds int, p_client_id text, p_ref text default null,
  p_recipient text default null, p_share_location boolean default false, p_size bigint default null
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  v_id text;
  b bytea;
  i int;
  q secret_quota%rowtype;
  v_owner uuid := auth.uid();
  v_share boolean := coalesce(p_share_location, false) and auth.uid() is not null;
begin
  if p_header is null or length(p_header) > 4000 then raise exception 'invalid header'; end if;
  if (p_body is null) = (p_file_path is null) then raise exception 'provide either a body or a file'; end if;
  if p_body is not null and length(p_body) > 120000 then raise exception 'text too large'; end if;
  if p_file_path is not null and p_file_path !~ '^f/[A-Za-z0-9_-]{24,64}\.bin$' then raise exception 'invalid file path'; end if;
  if p_ttl_seconds not in (3600, 86400, 604800) then raise exception 'invalid expiry'; end if;

  q := ensure_quota(p_client_id, p_ref);
  select * into q from secret_quota where client_id = p_client_id for update;
  if q.plan <> 'plus' and q.used >= 10 + q.bonus then
    raise exception 'quota_exceeded';
  end if;

  loop
    b := gen_random_bytes(10);
    v_id := '';
    for i in 0..9 loop
      v_id := v_id || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1);
    end loop;
    begin
      insert into secrets (id, header, body, file_path, expires_at, share_location)
      values (v_id, p_header, p_body, p_file_path, now() + make_interval(secs => p_ttl_seconds), v_share);
      exit;
    exception when unique_violation then
    end;
  end loop;
  update secret_quota set used = used + 1 where client_id = p_client_id;

  if v_owner is not null then
    insert into secret_log (id, owner, kind, size, recipient, share_location, expires_at)
    values (v_id, v_owner, case when p_file_path is null then 'text' else 'file' end,
            case when p_size between 0 and 20000000 then p_size end,
            nullif(left(trim(p_recipient), 200), ''), v_share,
            now() + make_interval(secs => p_ttl_seconds));
  end if;
  return v_id;
end $$;

-- Lets the sender note who a secret went to (e.g. after emailing the link).
create or replace function public.set_secret_recipient(p_id text, p_recipient text)
returns void
language sql security definer set search_path = public as $$
  update secret_log set recipient = nullif(left(trim(p_recipient), 200), '')
  where id = p_id and owner = auth.uid();
$$;

revoke all on function public.peek_secret(text) from public;
revoke all on function public.open_secret(text, text, text, text, double precision, double precision) from public;
revoke all on function public.create_secret(text, text, text, int, text, text, text, boolean, bigint) from public;
revoke all on function public.set_secret_recipient(text, text) from public, anon;
grant execute on function public.peek_secret(text) to anon, authenticated;
grant execute on function public.open_secret(text, text, text, text, double precision, double precision) to anon, authenticated;
grant execute on function public.create_secret(text, text, text, int, text, text, text, boolean, bigint) to anon, authenticated;
grant execute on function public.set_secret_recipient(text, text) to authenticated;
