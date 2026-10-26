-- OnePeek 004: more controls per secret, "Burn now", "Request a secret" and opened alerts.
--  * Views: a secret can allow 1–10 views. Custom expiry from 5 minutes up to 7 days (OnePass+: 30 days).
--  * Lock to a recipient: opens only after the viewer proves an email address with a one-time code.
--  * Time lock: opens only after a date/time, and/or only inside a daily window (e.g. 09:00–18:00).
--  * Country allow-list: opens only from listed countries (checked on the server from the network).
--  * Burn now: the sender can destroy a live secret from the dashboard.
--  * Requests: ask someone for a secret. It is encrypted to the requester's public key in the
--    responder's browser, so only the requester can read it.
--  * Alerts: per-user email and browser-push settings.
--  * Files and images up to 50 MB.
--  * Precise (device) locations are kept to ~11 m (4 decimals) instead of ~110 m.
--
-- IMPORTANT: from this migration on, opening a secret goes through the website's server
-- (it checks the country and the time lock). Add SUPABASE_SERVICE_ROLE_KEY to Vercel and
-- redeploy BEFORE running this file.
-- Safe to run more than once.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------------------
alter table public.secrets add column if not exists max_views         int not null default 1;
alter table public.secrets add column if not exists views_used        int not null default 0;
alter table public.secrets add column if not exists lock_email        text;
alter table public.secrets add column if not exists open_after        timestamptz;
alter table public.secrets add column if not exists window_start      smallint;
alter table public.secrets add column if not exists window_end        smallint;
alter table public.secrets add column if not exists window_tz         text;
alter table public.secrets add column if not exists allowed_countries text[];

alter table public.secret_log add column if not exists max_views         int not null default 1;
alter table public.secret_log add column if not exists views_used        int not null default 0;
alter table public.secret_log add column if not exists last_opened_at    timestamptz;
alter table public.secret_log add column if not exists burned_at         timestamptz;
alter table public.secret_log add column if not exists lock_email        text;
alter table public.secret_log add column if not exists open_after        timestamptz;
alter table public.secret_log add column if not exists window_start      smallint;
alter table public.secret_log add column if not exists window_end        smallint;
alter table public.secret_log add column if not exists window_tz         text;
alter table public.secret_log add column if not exists allowed_countries text[];
update public.secret_log set views_used = 1 where opened_at is not null and views_used = 0;

-- Files up to 50 MB (encrypted size). Supabase's project-wide upload limit must be at least 50 MB too.
update storage.buckets set file_size_limit = 52428800 where id = 'secrets';

-- Files of multi-view secrets can be read between views without being deleted.
alter table public.secret_claims add column if not exists temporary boolean not null default false;

-- One-time codes for "Lock to a recipient". Only the server (service role) touches this.
create table if not exists public.secret_unlocks (
  id            text primary key,
  code_hash     text,
  code_expires  timestamptz,
  attempts      int not null default 0,
  sends         int not null default 0,
  last_sent_at  timestamptz,
  token_hash    text,
  token_expires timestamptz
);
alter table public.secret_unlocks enable row level security;
revoke all on public.secret_unlocks from anon, authenticated;

-- Requests ("send me your password").
create table if not exists public.secret_requests (
  id           text primary key,
  owner        uuid not null references auth.users(id) on delete cascade,
  note         text not null,
  recipient    text,
  public_key   text not null,
  response     text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  responded_at timestamptz,
  opened_at    timestamptz
);
create index if not exists secret_requests_owner_created on public.secret_requests (owner, created_at desc);
alter table public.secret_requests enable row level security;
revoke all on public.secret_requests from anon, authenticated;
grant select (id, note, recipient, public_key, created_at, expires_at, responded_at, opened_at), delete on public.secret_requests to authenticated;
drop policy if exists "owner reads own requests" on public.secret_requests;
create policy "owner reads own requests" on public.secret_requests for select to authenticated using (owner = auth.uid());
drop policy if exists "owner deletes own requests" on public.secret_requests;
create policy "owner deletes own requests" on public.secret_requests for delete to authenticated using (owner = auth.uid());

-- Alert settings and browser-push subscriptions.
create table if not exists public.notify_prefs (
  owner      uuid primary key references auth.users(id) on delete cascade,
  email_on   boolean not null default true,
  push_on    boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notify_prefs enable row level security;
revoke all on public.notify_prefs from anon, authenticated;
grant select, insert, update on public.notify_prefs to authenticated;
drop policy if exists "owner manages prefs" on public.notify_prefs;
create policy "owner manages prefs" on public.notify_prefs for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  owner      uuid not null references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_owner on public.push_subscriptions (owner);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
drop policy if exists "owner manages push" on public.push_subscriptions;
create policy "owner manages push" on public.push_subscriptions for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

-- ---------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------
create or replace function public.onepeek_new_id(p_len int)
returns text language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  b bytea := gen_random_bytes(p_len);
  v text := '';
  i int;
begin
  for i in 0..p_len - 1 loop
    v := v || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1);
  end loop;
  return v;
end $$;
revoke all on function public.onepeek_new_id(int) from public, anon, authenticated;

-- "p•••@company.com": tells the viewer which address the sender chose without spelling it out.
create or replace function public.onepeek_mask_email(p_email text)
returns text language sql immutable as $$
  select case when p_email is null then null
              else left(split_part(p_email, '@', 1), 1) || '•••@' || split_part(p_email, '@', 2) end;
$$;

-- Read access for files: any live claim (temporary claims cover multi-view secrets).
create or replace function public.is_claimed_file(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from secret_claims c where c.file_path = p_name and c.expires_at > now());
$$;
-- Delete access: only once the secret is fully burned (never between views).
create or replace function public.is_burned_file(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from secret_claims c where c.file_path = p_name and c.expires_at > now() and not c.temporary);
$$;
revoke all on function public.is_burned_file(text) from public;
grant execute on function public.is_burned_file(text) to anon, authenticated;

drop policy if exists "onepass delete claimed" on storage.objects;
create policy "onepass delete claimed" on storage.objects for delete to anon, authenticated
  using (bucket_id = 'secrets' and public.is_burned_file(name));

-- ---------------------------------------------------------------------------------------
-- Peek (does not burn): everything the viewer needs to know before opening.
-- ---------------------------------------------------------------------------------------
drop function if exists public.peek_secret(text);
create function public.peek_secret(p_id text)
returns table (
  header text, kind text, expires_at timestamptz, share_location boolean,
  fence_radius_m int, fence_label text,
  max_views int, views_left int, lock_hint text,
  open_after timestamptz, window_start int, window_end int, window_tz text, allowed_countries text[]
)
language sql stable security definer set search_path = public as $$
  select s.header,
         case when s.file_path is null then 'text' else 'file' end,
         s.expires_at, s.share_location, s.fence_radius_m, s.fence_label,
         s.max_views, s.max_views - s.views_used,
         onepeek_mask_email(s.lock_email),
         s.open_after, s.window_start::int, s.window_end::int, s.window_tz, s.allowed_countries
  from secrets s
  where s.id = p_id and s.expires_at > now();
$$;

-- ---------------------------------------------------------------------------------------
-- Open: checks every lock, then counts a view (burning on the last one) and logs it.
-- Called only by the website's server (service role), which supplies the network country.
-- ---------------------------------------------------------------------------------------
drop function if exists public.open_secret(text);
drop function if exists public.open_secret(text, text, text, text, double precision, double precision);
drop function if exists public.open_secret(text, text, text, text, double precision, double precision, text, int, text);
drop function if exists public.open_secret(text, text, text, text, double precision, double precision, text, int, text, text, text);
create function public.open_secret(
  p_id text,
  p_city text default null, p_region text default null, p_country text default null,
  p_lat double precision default null, p_lon double precision default null,
  p_area text default null, p_accuracy int default null, p_source text default 'network',
  p_ip_country text default null, p_unlock_token text default null
) returns table (header text, body text, file_path text, views_left int, final boolean)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  r secrets%rowtype;
  v_device boolean := p_source = 'device';
  v_digits int := case when p_source = 'device' then 4 else 2 end;  -- ~11 m for device GPS, ~1 km for network
  v_dist double precision;
  v_local timestamp;
  v_min int;
  v_final boolean;
begin
  select * into r from secrets s where s.id = p_id and s.expires_at > now() for update;
  if not found then return; end if;

  -- Time lock
  if r.open_after is not null and now() < r.open_after then
    raise exception 'timelock_until:%', floor(extract(epoch from r.open_after))::bigint;
  end if;
  if r.window_start is not null and r.window_end is not null then
    v_local := now() at time zone coalesce(r.window_tz, 'UTC');
    v_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
    if (r.window_start < r.window_end and not (v_min >= r.window_start and v_min < r.window_end))
       or (r.window_start > r.window_end and not (v_min >= r.window_start or v_min < r.window_end)) then
      raise exception 'timelock_window';
    end if;
  end if;

  -- Country allow-list (network country, set by the server)
  if r.allowed_countries is not null and cardinality(r.allowed_countries) > 0 then
    if p_ip_country is null or not (upper(p_ip_country) = any (r.allowed_countries)) then
      raise exception 'country_blocked:%', coalesce(upper(left(p_ip_country, 2)), '');
    end if;
  end if;

  -- Geofence (device location, 5% tolerance)
  if r.fence_radius_m is not null then
    if not v_device or p_lat is null or p_lon is null then
      raise exception 'geofence_location_required';
    end if;
    if p_accuracy is not null and p_accuracy > greatest(r.fence_radius_m, 150) then
      raise exception 'geofence_imprecise:%', p_accuracy;
    end if;
    v_dist := distance_m(r.fence_lat, r.fence_lon, p_lat, p_lon);
    if v_dist > r.fence_radius_m * 1.05 then
      raise exception 'geofence_outside:%', round(v_dist - r.fence_radius_m);
    end if;
  end if;

  -- Recipient lock: a fresh token from a verified one-time code, used once.
  if r.lock_email is not null then
    update secret_unlocks u set token_hash = null, token_expires = null
    where u.id = r.id
      and u.token_hash = encode(digest(coalesce(p_unlock_token, ''), 'sha256'), 'hex')
      and u.token_expires > now();
    if not found then raise exception 'recipient_locked'; end if;
  end if;

  v_final := r.views_used + 1 >= r.max_views;
  if v_final then
    delete from secrets s where s.id = r.id;
    delete from secret_unlocks u where u.id = r.id;
    if r.file_path is not null then
      insert into secret_claims (file_path, expires_at, temporary)
      values (r.file_path, now() + interval '10 minutes', false)
      on conflict (file_path) do update set expires_at = excluded.expires_at, temporary = false;
    end if;
  else
    update secrets s set views_used = s.views_used + 1 where s.id = r.id;
    if r.file_path is not null then
      insert into secret_claims (file_path, expires_at, temporary)
      values (r.file_path, now() + interval '10 minutes', true)
      on conflict (file_path) do update set expires_at = excluded.expires_at;
    end if;
  end if;

  update secret_log l set
    opened_at       = coalesce(l.opened_at, now()),
    last_opened_at  = now(),
    views_used      = r.views_used + 1,
    open_city       = case when r.share_location then left(p_city, 120) end,
    open_region     = case when r.share_location then left(p_region, 120) end,
    open_country    = case when r.share_location then left(p_country, 8) end,
    open_area       = case when r.share_location then left(p_area, 160) end,
    open_lat        = case when r.share_location and p_lat between -90 and 90 then round(p_lat::numeric, v_digits)::double precision end,
    open_lon        = case when r.share_location and p_lon between -180 and 180 then round(p_lon::numeric, v_digits)::double precision end,
    open_accuracy_m = case when r.share_location and p_lat is not null then
                        case when v_device then greatest(15, least(coalesce(p_accuracy, 500), 50000)) else 10000 end end,
    open_source     = case when r.share_location and p_lat is not null then case when v_device then 'device' else 'network' end end
  where l.id = r.id;

  return query select r.header, r.body, r.file_path, greatest(0, r.max_views - r.views_used - 1), v_final;
end $$;

-- ---------------------------------------------------------------------------------------
-- Create
-- ---------------------------------------------------------------------------------------
drop function if exists public.create_secret(text, text, text, int, text, text, text, boolean, bigint, double precision, double precision, int, text);
drop function if exists public.create_secret(text, text, text, int, text, text, text, boolean, bigint, double precision, double precision, int, text, int, text, timestamptz, int, int, text, text[]);
create function public.create_secret(
  p_header text, p_body text, p_file_path text, p_ttl_seconds int, p_client_id text, p_ref text default null,
  p_recipient text default null, p_share_location boolean default false, p_size bigint default null,
  p_fence_lat double precision default null, p_fence_lon double precision default null,
  p_fence_radius int default null, p_fence_label text default null,
  p_max_views int default 1, p_lock_email text default null,
  p_open_after timestamptz default null, p_window_start int default null, p_window_end int default null,
  p_window_tz text default null, p_countries text[] default null
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id text;
  q secret_quota%rowtype;
  v_owner uuid := auth.uid();
  v_share boolean := coalesce(p_share_location, false) and auth.uid() is not null;
  v_fenced boolean := p_fence_radius is not null;
  v_views int := coalesce(p_max_views, 1);
  v_email text := nullif(lower(trim(p_lock_email)), '');
  v_after timestamptz := case when p_open_after > now() then p_open_after end;
  v_tz text := coalesce(nullif(trim(p_window_tz), ''), 'UTC');
  v_countries text[];
  v_expires timestamptz;
  v_max_ttl int;
begin
  if p_header is null or length(p_header) > 4000 then raise exception 'invalid header'; end if;
  if (p_body is null) = (p_file_path is null) then raise exception 'provide either a body or a file'; end if;
  if p_body is not null and length(p_body) > 120000 then raise exception 'text too large'; end if;
  if p_file_path is not null and p_file_path !~ '^f/[A-Za-z0-9_-]{24,64}\.bin$' then raise exception 'invalid file path'; end if;
  if v_fenced and (p_fence_lat is null or p_fence_lon is null or p_fence_lat not between -90 and 90
                   or p_fence_lon not between -180 and 180 or p_fence_radius not between 50 and 500000) then
    raise exception 'invalid geofence';
  end if;
  if v_views not between 1 and 10 then raise exception 'invalid views'; end if;
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'invalid recipient email';
  end if;
  if (p_window_start is null) <> (p_window_end is null)
     or (p_window_start is not null and (p_window_start not between 0 and 1439 or p_window_end not between 0 and 1439
                                         or p_window_start = p_window_end)) then
    raise exception 'invalid time window';
  end if;
  if p_window_start is not null then
    begin
      perform now() at time zone v_tz;
    exception when others then
      raise exception 'invalid time window';
    end;
  end if;
  if p_countries is not null and cardinality(p_countries) > 0 then
    select array_agg(distinct upper(c)) into v_countries from unnest(p_countries) c;
    if cardinality(v_countries) > 60 or exists (select 1 from unnest(v_countries) c where c !~ '^[A-Z]{2}$') then
      raise exception 'invalid countries';
    end if;
  end if;

  q := ensure_quota(p_client_id, p_ref);
  select * into q from secret_quota where client_id = p_client_id for update;
  if q.plan <> 'plus' and q.used >= 10 + q.bonus then
    raise exception 'quota_exceeded';
  end if;
  v_max_ttl := case when q.plan = 'plus' then 2592000 else 604800 end;
  if p_ttl_seconds is null or p_ttl_seconds < 300 then raise exception 'invalid expiry'; end if;
  if p_ttl_seconds > v_max_ttl then raise exception 'expiry_too_long:%', v_max_ttl; end if;
  v_expires := now() + make_interval(secs => p_ttl_seconds);
  if v_after is not null and v_after >= v_expires then raise exception 'open_after_past_expiry'; end if;

  loop
    v_id := onepeek_new_id(10);
    begin
      insert into secrets (id, header, body, file_path, expires_at, share_location,
                           fence_lat, fence_lon, fence_radius_m, fence_label,
                           max_views, lock_email, open_after, window_start, window_end, window_tz, allowed_countries)
      values (v_id, p_header, p_body, p_file_path, v_expires, v_share,
              case when v_fenced then round(p_fence_lat::numeric, 5)::double precision end,
              case when v_fenced then round(p_fence_lon::numeric, 5)::double precision end,
              case when v_fenced then p_fence_radius end,
              case when v_fenced then nullif(left(trim(p_fence_label), 160), '') end,
              v_views, v_email, v_after, p_window_start, p_window_end,
              case when p_window_start is not null then v_tz end, v_countries);
      exit;
    exception when unique_violation then
    end;
  end loop;
  update secret_quota set used = used + 1 where client_id = p_client_id;

  if v_owner is not null then
    insert into secret_log (id, owner, kind, size, recipient, share_location, expires_at,
                            fence_radius_m, fence_label, fence_lat, fence_lon,
                            max_views, lock_email, open_after, window_start, window_end, window_tz, allowed_countries)
    values (v_id, v_owner, case when p_file_path is null then 'text' else 'file' end,
            case when p_size between 0 and 60000000 then p_size end,
            coalesce(nullif(left(trim(p_recipient), 200), ''), v_email), v_share, v_expires,
            case when v_fenced then p_fence_radius end,
            case when v_fenced then nullif(left(trim(p_fence_label), 160), '') end,
            case when v_fenced then round(p_fence_lat::numeric, 5)::double precision end,
            case when v_fenced then round(p_fence_lon::numeric, 5)::double precision end,
            v_views, v_email, v_after, p_window_start, p_window_end,
            case when p_window_start is not null then v_tz end, v_countries);
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------
-- Burn now (sender only). Returns the encrypted file path so the browser can delete it at once.
-- ---------------------------------------------------------------------------------------
create or replace function public.burn_secret(p_id text)
returns table (burned boolean, file_path text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_path text;
begin
  if not exists (select 1 from secret_log l where l.id = p_id and l.owner = auth.uid()) then
    return query select false, null::text; return;
  end if;
  delete from secrets s where s.id = p_id returning s.file_path into v_path;
  if not found then
    return query select false, null::text; return;
  end if;
  delete from secret_unlocks u where u.id = p_id;
  if v_path is not null then
    insert into secret_claims (file_path, expires_at, temporary)
    values (v_path, now() + interval '10 minutes', false)
    on conflict (file_path) do update set expires_at = excluded.expires_at, temporary = false;
  end if;
  update secret_log l set burned_at = now() where l.id = p_id;
  return query select true, v_path;
end $$;

-- ---------------------------------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------------------------------
create or replace function public.create_request(
  p_note text, p_public_key text, p_ttl_seconds int, p_client_id text, p_recipient text default null
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id text;
  q secret_quota%rowtype;
  v_max_ttl int;
begin
  if auth.uid() is null then raise exception 'login_required'; end if;
  if p_note is null or length(trim(p_note)) = 0 or length(p_note) > 300 then raise exception 'invalid note'; end if;
  if p_public_key is null or p_public_key !~ '^[A-Za-z0-9_-]{80,120}$' then raise exception 'invalid key'; end if;

  q := ensure_quota(p_client_id, null);
  select * into q from secret_quota where client_id = p_client_id for update;
  if q.plan <> 'plus' and q.used >= 10 + q.bonus then raise exception 'quota_exceeded'; end if;
  v_max_ttl := case when q.plan = 'plus' then 2592000 else 604800 end;
  if p_ttl_seconds is null or p_ttl_seconds < 300 then raise exception 'invalid expiry'; end if;
  if p_ttl_seconds > v_max_ttl then raise exception 'expiry_too_long:%', v_max_ttl; end if;

  loop
    v_id := onepeek_new_id(10);
    begin
      insert into secret_requests (id, owner, note, recipient, public_key, expires_at)
      values (v_id, auth.uid(), trim(p_note), nullif(left(trim(p_recipient), 200), ''), p_public_key,
              now() + make_interval(secs => p_ttl_seconds));
      exit;
    exception when unique_violation then
    end;
  end loop;
  update secret_quota set used = used + 1 where client_id = p_client_id;
  return v_id;
end $$;

-- What the responder sees: the note, who is asking, and the key to encrypt to.
create or replace function public.peek_request(p_id text)
returns table (note text, requester text, public_key text, expires_at timestamptz, answered boolean)
language sql stable security definer set search_path = public as $$
  select r.note,
         coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email),
         r.public_key, r.expires_at, r.responded_at is not null
  from secret_requests r
  left join auth.users u on u.id = r.owner
  where r.id = p_id and r.expires_at > now();
$$;

-- Responder submits once (server only, so the requester can be alerted).
create or replace function public.respond_request(p_id text, p_response text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if p_response is null or length(p_response) > 160000 or p_response !~ '^[A-Za-z0-9_.-]+$' then
    raise exception 'invalid response';
  end if;
  update secret_requests set response = p_response, responded_at = now()
  where id = p_id and expires_at > now() and responded_at is null
  returning owner into v_owner;
  return v_owner;
end $$;

-- Requester reads the answer once; it is deleted as it is handed over.
create or replace function public.take_request_response(p_id text)
returns text
language plpgsql security definer set search_path = public as $$
declare v_resp text;
begin
  select response into v_resp from secret_requests
  where id = p_id and owner = auth.uid() and response is not null for update;
  if not found then return null; end if;
  update secret_requests set response = null, opened_at = now() where id = p_id;
  return v_resp;
end $$;

-- ---------------------------------------------------------------------------------------
-- Cleanup: expired secrets, finished multi-view grants, old codes and unanswered/unread answers.
-- ---------------------------------------------------------------------------------------
create or replace function public.reap_expired_secrets()
returns setof text
language plpgsql security definer set search_path = public as $$
declare p text;
begin
  for p in delete from secrets where expires_at <= now() and file_path is not null returning file_path loop
    insert into secret_claims (file_path, expires_at, temporary) values (p, now() + interval '10 minutes', false)
    on conflict (file_path) do update set expires_at = excluded.expires_at, temporary = false;
    return next p;
  end loop;
  delete from secrets where expires_at <= now();
  delete from secret_claims where temporary and expires_at <= now();
  delete from secret_unlocks u where not exists (select 1 from secrets s where s.id = u.id);
  update secret_requests set response = null where response is not null and expires_at <= now();
  delete from secret_claims where created_at < now() - interval '2 days';
  for p in update secret_claims set expires_at = now() + interval '10 minutes'
           where expires_at <= now() and not temporary returning file_path loop
    return next p;
  end loop;
  return;
end $$;

-- ---------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------
revoke all on function public.peek_secret(text) from public;
grant execute on function public.peek_secret(text) to anon, authenticated;

revoke all on function public.open_secret(text, text, text, text, double precision, double precision, text, int, text, text, text) from public, anon, authenticated;
grant execute on function public.open_secret(text, text, text, text, double precision, double precision, text, int, text, text, text) to service_role;

revoke all on function public.create_secret(text, text, text, int, text, text, text, boolean, bigint, double precision, double precision, int, text, int, text, timestamptz, int, int, text, text[]) from public;
grant execute on function public.create_secret(text, text, text, int, text, text, text, boolean, bigint, double precision, double precision, int, text, int, text, timestamptz, int, int, text, text[]) to anon, authenticated;

revoke all on function public.burn_secret(text) from public, anon;
grant execute on function public.burn_secret(text) to authenticated;

revoke all on function public.create_request(text, text, int, text, text) from public, anon;
grant execute on function public.create_request(text, text, int, text, text) to authenticated;
revoke all on function public.peek_request(text) from public;
grant execute on function public.peek_request(text) to anon, authenticated;
revoke all on function public.respond_request(text, text) from public, anon, authenticated;
grant execute on function public.respond_request(text, text) to service_role;
revoke all on function public.take_request_response(text) from public, anon;
grant execute on function public.take_request_response(text) to authenticated;

revoke all on function public.reap_expired_secrets() from public;
grant execute on function public.reap_expired_secrets() to anon, authenticated;

grant all on public.secret_unlocks, public.secret_requests, public.notify_prefs, public.push_subscriptions to service_role;
grant select on public.secret_log to service_role;
