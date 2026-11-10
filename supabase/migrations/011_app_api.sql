-- 011: an authenticated API for apps (TopShelf "Send Securely") and security fixes.
--
-- What this adds
--   * app_installs   — one row per app install. The install proves itself with a random secret
--                      it keeps in its keychain; only SHA-256(secret) is stored here.
--   * app_uploads    — storage paths handed out as signed upload URLs; unused ones are reaped.
--   * app_shares     — which install created which secret (by id only), with an idempotency key
--                      and SHA-256 of a per-share manage token that allows list/revoke without an
--                      account. Names, recipients and contents are never stored here.
--   * api_rate       — fixed-window counters for atomic rate limiting (api_rate_ok).
--   * secrets.pass_* — optional passphrase protection (split key, see pass_unlock).
--   * Shares created through the API are ordinary rows in public.secrets, so the existing viewer
--     (/s/<id>#key) and the atomic open_secret keep working unchanged.
--
-- Security fixes to existing behaviour
--   * reap_expired_secrets is no longer callable by anon/authenticated (same as 010_lock_cleanup;
--     repeated here so 011 is safe on databases where 010 was not yet applied).
--   * reap_orphan_uploads deletes encrypted uploads that never became a secret (web, mobile, app).
--   * unlock_check_code makes the email-code attempt counter atomic (parallel guesses could
--     exceed the 5-attempt limit when it was read-then-write in the route).
--
-- Every function here is SECURITY DEFINER with a fixed search_path and executable by
-- service_role only, except peek_pass (salt lookup, anon/authenticated). Rollback: 011_app_api_down.sql.

-- ---------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------
create table if not exists public.app_installs (
  id            text primary key,                 -- random, 22 chars
  secret_hash   text not null,                    -- hex SHA-256 of the install secret
  platform      text not null check (platform in ('macos', 'ios', 'web', 'other')),
  app_version   text check (app_version is null or length(app_version) <= 40),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz
);
alter table public.app_installs enable row level security;
revoke all on public.app_installs from anon, authenticated;

create table if not exists public.app_uploads (
  path        text primary key,                    -- f/<token>.bin in the secrets bucket
  install_id  text not null references public.app_installs (id) on delete cascade,
  max_bytes   bigint not null check (max_bytes > 0),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index if not exists app_uploads_install on public.app_uploads (install_id) where used_at is null;
alter table public.app_uploads enable row level security;
revoke all on public.app_uploads from anon, authenticated;

create table if not exists public.app_shares (
  id               text primary key,               -- = secrets.id (the row there may be gone)
  install_id       text not null references public.app_installs (id) on delete cascade,
  idempotency_key  text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  manage_hash      text not null,                  -- hex SHA-256 of the manage token
  kind             text not null check (kind in ('text', 'file')),
  max_views        int not null,
  passphrase       boolean not null default false,
  size             bigint,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  unique (install_id, idempotency_key)
);
create index if not exists app_shares_install on public.app_shares (install_id, created_at desc);
alter table public.app_shares enable row level security;
revoke all on public.app_shares from anon, authenticated;

create table if not exists public.api_rate (
  bucket        text not null,
  window_start  timestamptz not null,
  count         int not null default 0,
  primary key (bucket, window_start)
);
alter table public.api_rate enable row level security;
revoke all on public.api_rate from anon, authenticated;

-- Passphrase protection. The content key is HKDF(link part ‖ passphrase part, salt = server half):
-- the server keeps the salt for the passphrase KDF, SHA-256 of the passphrase-derived auth key,
-- and a random server half that it releases only after a correct passphrase. It never holds the
-- link part or the passphrase-derived wrap part, so it cannot decrypt. Deleting the row (revoke,
-- expiry, last view, too many wrong guesses) destroys the server half for good.
alter table public.secrets add column if not exists pass_salt        text;
alter table public.secrets add column if not exists pass_auth_hash   text;
alter table public.secrets add column if not exists pass_server_half text;
alter table public.secrets add column if not exists pass_attempts    int not null default 0;

-- ---------------------------------------------------------------------------------------
-- Rate limiting: one atomic upsert per call. True while the bucket is within its limit.
-- ---------------------------------------------------------------------------------------
create or replace function public.api_rate_ok(p_bucket text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count int;
begin
  if p_bucket is null or length(p_bucket) > 200 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate bucket';
  end if;
  insert into api_rate (bucket, window_start, count) values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set count = api_rate.count + 1
  returning count into v_count;
  return v_count <= p_limit;
end $$;

-- ---------------------------------------------------------------------------------------
-- Installs
-- ---------------------------------------------------------------------------------------
create or replace function public.app_register_install(p_secret_hash text, p_platform text, p_app_version text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_id text;
begin
  if p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid secret'; end if;
  loop
    v_id := onepeek_new_id(22);
    begin
      insert into app_installs (id, secret_hash, platform, app_version)
      values (v_id, p_secret_hash, coalesce(p_platform, 'other'), nullif(left(trim(p_app_version), 40), ''));
      exit;
    exception when unique_violation then
    end;
  end loop;
  return v_id;
end $$;

-- True for a live install whose secret matches; refreshes last_seen_at at most once a minute.
create or replace function public.app_auth(p_install text, p_secret_hash text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update app_installs set last_seen_at = now()
  where id = p_install and secret_hash = p_secret_hash and revoked_at is null
    and last_seen_at < now() - interval '1 minute';
  return exists (select 1 from app_installs where id = p_install and secret_hash = p_secret_hash and revoked_at is null);
end $$;

-- ---------------------------------------------------------------------------------------
-- Uploads: the route turns the returned path into a signed upload URL (valid 2 hours).
-- ---------------------------------------------------------------------------------------
create or replace function public.app_begin_upload(p_install text, p_max_bytes bigint)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_path text;
begin
  if p_max_bytes is null or p_max_bytes < 1 or p_max_bytes > 52428800 then raise exception 'invalid size'; end if;
  if (select count(*) from app_uploads where install_id = p_install and used_at is null and expires_at > now()) >= 20 then
    raise exception 'too_many_pending_uploads';
  end if;
  v_path := 'f/' || onepeek_new_id(32) || '.bin';
  insert into app_uploads (path, install_id, max_bytes, expires_at)
  values (v_path, p_install, p_max_bytes, now() + interval '2 hours');
  return v_path;
end $$;

-- ---------------------------------------------------------------------------------------
-- Create a share. Idempotent per (install, idempotency key): a retry returns the same id.
-- ---------------------------------------------------------------------------------------
create or replace function public.app_create_share(
  p_install text, p_idempotency_key text, p_manage_hash text,
  p_header text, p_body text, p_file_path text, p_size bigint,
  p_ttl_seconds int, p_max_views int,
  p_pass_salt text default null, p_pass_auth_hash text default null, p_pass_server_half text default null
) returns table (id text, expires_at timestamptz, replayed boolean)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_id text;
  v_expires timestamptz;
  v_up app_uploads%rowtype;
  v_obj_size bigint;
  v_pass boolean := p_pass_auth_hash is not null;
  existing app_shares%rowtype;
begin
  select * into existing from app_shares s where s.install_id = p_install and s.idempotency_key = p_idempotency_key;
  if found then
    if existing.manage_hash <> p_manage_hash then raise exception 'idempotency_conflict'; end if;
    return query select existing.id, existing.expires_at, true; return;
  end if;

  if p_manage_hash is null or p_manage_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid manage token'; end if;
  if p_header is null or length(p_header) > 4000 or p_header !~ '^[A-Za-z0-9_-]+$' then raise exception 'invalid header'; end if;
  if (p_body is null) = (p_file_path is null) then raise exception 'provide either a body or a file'; end if;
  if p_body is not null and (length(p_body) > 120000 or p_body !~ '^[A-Za-z0-9_-]+$') then raise exception 'invalid body'; end if;
  if p_ttl_seconds is null or p_ttl_seconds < 300 or p_ttl_seconds > 604800 then raise exception 'invalid expiry'; end if;
  if p_max_views is null or p_max_views not between 1 and 1000 then raise exception 'invalid views'; end if;
  if v_pass and (p_pass_auth_hash !~ '^[0-9a-f]{64}$' or p_pass_salt is null or p_pass_salt !~ '^[A-Za-z0-9_-]{22,43}$'
                 or p_pass_server_half is null or p_pass_server_half !~ '^[A-Za-z0-9_-]{43}$') then
    raise exception 'invalid passphrase parameters';
  end if;
  if not v_pass and (p_pass_salt is not null or p_pass_server_half is not null) then
    raise exception 'invalid passphrase parameters';
  end if;

  -- Monthly quota per install.
  if (select count(*) from app_shares s where s.install_id = p_install and s.created_at > now() - interval '30 days') >= 300 then
    raise exception 'quota_exceeded';
  end if;

  -- A file must be this install's own unused, unexpired upload, present in storage within its size cap.
  if p_file_path is not null then
    select * into v_up from app_uploads u where u.path = p_file_path for update;
    if not found or v_up.install_id <> p_install or v_up.used_at is not null or v_up.expires_at <= now() then
      raise exception 'invalid upload';
    end if;
    select coalesce((o.metadata->>'size')::bigint, -1) into v_obj_size
    from storage.objects o where o.bucket_id = 'secrets' and o.name = p_file_path;
    if not found then raise exception 'upload_missing'; end if;
    if v_obj_size > v_up.max_bytes then raise exception 'upload_too_large'; end if;
    update app_uploads u set used_at = now() where u.path = p_file_path;
  end if;

  v_expires := now() + make_interval(secs => p_ttl_seconds);
  loop
    v_id := onepeek_new_id(10);
    begin
      insert into secrets (id, header, body, file_path, expires_at, max_views,
                           pass_salt, pass_auth_hash, pass_server_half)
      values (v_id, p_header, p_body, p_file_path, v_expires, p_max_views,
              p_pass_salt, p_pass_auth_hash, p_pass_server_half);
      exit;
    exception when unique_violation then
    end;
  end loop;
  insert into app_shares (id, install_id, idempotency_key, manage_hash, kind, max_views, passphrase, size, expires_at)
  values (v_id, p_install, p_idempotency_key, p_manage_hash,
          case when p_file_path is null then 'text' else 'file' end, p_max_views, v_pass, p_size, v_expires);
  return query select v_id, v_expires, false;
end $$;

-- ---------------------------------------------------------------------------------------
-- My Shares: metadata only. Status: active | viewed | expired | revoked.
-- views_used is exact while the share is live; once fully used it equals max_views.
-- ---------------------------------------------------------------------------------------
create or replace function public.app_list_shares(p_install text, p_limit int default 100)
returns table (id text, kind text, created_at timestamptz, expires_at timestamptz, max_views int,
               views_used int, passphrase boolean, size bigint, status text, revoked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.kind, a.created_at, a.expires_at, a.max_views,
         case when s.id is not null then s.views_used
              when a.revoked_at is null and a.expires_at > now() then a.max_views
              else null end,
         a.passphrase, a.size,
         case when a.revoked_at is not null then 'revoked'
              when s.id is not null and s.expires_at > now() then case when s.views_used > 0 then 'viewed' else 'active' end
              when a.expires_at <= now() then 'expired'
              else 'viewed' end,
         a.revoked_at
  from app_shares a
  left join secrets s on s.id = a.id
  where a.install_id = p_install
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

-- ---------------------------------------------------------------------------------------
-- Revoke: needs the install AND the share's manage token. Deletes the secret (and with it any
-- passphrase server half) at once; returns the storage path for the route to delete now.
-- ---------------------------------------------------------------------------------------
create or replace function public.app_revoke_share(p_install text, p_id text, p_manage_hash text)
returns table (revoked boolean, file_path text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  a app_shares%rowtype;
  v_path text;
begin
  select * into a from app_shares s where s.id = p_id and s.install_id = p_install for update;
  if not found or a.manage_hash <> p_manage_hash then
    return query select false, null::text; return;
  end if;
  delete from secrets s where s.id = p_id returning s.file_path into v_path;
  delete from secret_unlocks u where u.id = p_id;
  if a.revoked_at is null then
    update app_shares s set revoked_at = now() where s.id = p_id;
  end if;
  return query select true, v_path;
end $$;

-- ---------------------------------------------------------------------------------------
-- Passphrase
-- ---------------------------------------------------------------------------------------
-- The viewer asks for the KDF salt (null when the share has no passphrase).
create or replace function public.peek_pass(p_id text)
returns text
language sql stable security definer set search_path = public as $$
  select s.pass_salt from secrets s where s.id = p_id and s.expires_at > now();
$$;

-- Checks SHA-256(auth key) under a row lock and returns (status, server_half):
--   ok      — a one-use open token (its hash) is stored; server_half is returned
--   wrong:N — attempt counted, N attempts left
--   locked  — the 5th wrong guess deleted the secret (and its server half)
--   gone    — no live passphrase share with this id
-- Returns a status rather than raising so the attempt counter commits (an exception would
-- roll it back and make brute-force limits useless).
create or replace function public.pass_unlock(p_id text, p_auth_hash text, p_token_hash text)
returns table (status text, server_half text)
language plpgsql security definer set search_path = public as $$
declare r secrets%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid token'; end if;
  select * into r from secrets s where s.id = p_id and s.expires_at > now() for update;
  if not found or r.pass_auth_hash is null then
    return query select 'gone'::text, null::text; return;
  end if;
  if p_auth_hash is distinct from r.pass_auth_hash then
    if r.pass_attempts + 1 >= 5 then
      delete from secrets s where s.id = r.id;
      delete from secret_unlocks u where u.id = r.id;
      if r.file_path is not null then
        insert into secret_claims (file_path, expires_at, temporary)
        values (r.file_path, now() + interval '10 minutes', false)
        on conflict (file_path) do update set expires_at = excluded.expires_at, temporary = false;
      end if;
      return query select 'locked'::text, null::text; return;
    end if;
    update secrets s set pass_attempts = s.pass_attempts + 1 where s.id = r.id;
    return query select 'wrong:' || (5 - (r.pass_attempts + 1)), null::text; return;
  end if;
  insert into secret_unlocks (id, token_hash, token_expires)
  values (r.id, p_token_hash, now() + interval '15 minutes')
  on conflict (id) do update set token_hash = excluded.token_hash, token_expires = excluded.token_expires;
  return query select 'ok'::text, r.pass_server_half;
end $$;

-- ---------------------------------------------------------------------------------------
-- Email-code check, atomic (replaces the read-then-write in /api/unlock/verify).
-- Returns 'ok' (token stored), 'wrong:<left>', 'too_many' or 'expired'.
-- ---------------------------------------------------------------------------------------
create or replace function public.unlock_check_code(p_id text, p_code_hash text, p_token_hash text)
returns text
language plpgsql security definer set search_path = public as $$
declare u secret_unlocks%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid token'; end if;
  select * into u from secret_unlocks s where s.id = p_id for update;
  if not found or u.code_hash is null or u.code_expires is null or u.code_expires < now() then return 'expired'; end if;
  if u.attempts >= 5 then return 'too_many'; end if;
  if p_code_hash is distinct from u.code_hash then
    update secret_unlocks s set attempts = s.attempts + 1,
           code_hash = case when s.attempts + 1 >= 5 then null else s.code_hash end
    where s.id = p_id;
    return case when u.attempts + 1 >= 5 then 'too_many' else 'wrong:' || (5 - (u.attempts + 1)) end;
  end if;
  update secret_unlocks s set code_hash = null, code_expires = null, attempts = 0,
         token_hash = p_token_hash, token_expires = now() + interval '15 minutes'
  where s.id = p_id;
  return 'ok';
end $$;

-- ---------------------------------------------------------------------------------------
-- Orphans: encrypted uploads that never became a secret. App uploads past their 2-hour window,
-- and any other secrets-bucket object over a day old that no secret, claim or upload refers to.
-- Returns paths for the (service-role) cleanup route to delete from storage.
-- ---------------------------------------------------------------------------------------
create or replace function public.reap_orphan_uploads()
returns setof text
language plpgsql security definer set search_path = public, storage as $$
declare p text;
begin
  for p in delete from app_uploads u where u.used_at is null and u.expires_at <= now() returning u.path loop
    if not exists (select 1 from secrets s where s.file_path = p) then return next p; end if;
  end loop;
  return query
    select o.name from storage.objects o
    where o.bucket_id = 'secrets' and o.name like 'f/%' and o.created_at < now() - interval '1 day'
      and not exists (select 1 from secrets s where s.file_path = o.name)
      and not exists (select 1 from secret_claims c where c.file_path = o.name)
      and not exists (select 1 from app_uploads u where u.path = o.name)
    limit 1000;
  delete from app_uploads u where u.used_at is not null and u.used_at < now() - interval '30 days';
  delete from api_rate r where r.window_start < now() - interval '2 days';
  return;
end $$;


-- ---------------------------------------------------------------------------------------
-- open_secret: identical to 004 except that a passphrase share also needs a one-use token
-- (from pass_unlock), and reports passphrase_required instead of recipient_locked.
-- ---------------------------------------------------------------------------------------
create or replace function public.open_secret(
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

  -- Recipient lock or passphrase: a fresh token from a verified one-time code or a verified
  -- passphrase (pass_unlock), used once.
  if r.lock_email is not null or r.pass_auth_hash is not null then
    update secret_unlocks u set token_hash = null, token_expires = null
    where u.id = r.id
      and u.token_hash = encode(digest(coalesce(p_unlock_token, ''), 'sha256'), 'hex')
      and u.token_expires > now();
    if not found then
      if r.pass_auth_hash is not null then raise exception 'passphrase_required'; end if;
      raise exception 'recipient_locked';
    end if;
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
-- Grants
-- ---------------------------------------------------------------------------------------
revoke all on function public.open_secret(text, text, text, text, double precision, double precision, text, int, text, text, text) from public, anon, authenticated;
grant execute on function public.open_secret(text, text, text, text, double precision, double precision, text, int, text, text, text) to service_role;

-- Was callable by anyone (the cleanup route used the anon key). Now only the server.
revoke all on function public.reap_expired_secrets() from public, anon, authenticated;
grant execute on function public.reap_expired_secrets() to service_role;

revoke all on function public.api_rate_ok(text, int, int) from public, anon, authenticated;
revoke all on function public.app_register_install(text, text, text) from public, anon, authenticated;
revoke all on function public.app_auth(text, text) from public, anon, authenticated;
revoke all on function public.app_begin_upload(text, bigint) from public, anon, authenticated;
revoke all on function public.app_create_share(text, text, text, text, text, text, bigint, int, int, text, text, text) from public, anon, authenticated;
revoke all on function public.app_list_shares(text, int) from public, anon, authenticated;
revoke all on function public.app_revoke_share(text, text, text) from public, anon, authenticated;
revoke all on function public.pass_unlock(text, text, text) from public, anon, authenticated;
revoke all on function public.unlock_check_code(text, text, text) from public, anon, authenticated;
revoke all on function public.reap_orphan_uploads() from public, anon, authenticated;
grant execute on function public.api_rate_ok(text, int, int), public.app_register_install(text, text, text),
  public.app_auth(text, text), public.app_begin_upload(text, bigint),
  public.app_create_share(text, text, text, text, text, text, bigint, int, int, text, text, text),
  public.app_list_shares(text, int), public.app_revoke_share(text, text, text),
  public.pass_unlock(text, text, text), public.unlock_check_code(text, text, text),
  public.reap_orphan_uploads() to service_role;

revoke all on function public.peek_pass(text) from public;
grant execute on function public.peek_pass(text) to anon, authenticated;

grant all on public.app_installs, public.app_uploads, public.app_shares, public.api_rate to service_role;
