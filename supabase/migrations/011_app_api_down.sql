-- Rollback of 011_app_api.sql. Restores 004's open_secret and reaper grants; drops the app API.
-- Shares created through the API stay in public.secrets as ordinary secrets (their passphrase
-- columns are dropped, so passphrase shares become unopenable — revoke or let them expire first).

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
revoke all on function public.open_secret(text, text, text, text, double precision, double precision, text, int, text, text, text) from public, anon, authenticated;
grant execute on function public.open_secret(text, text, text, text, double precision, double precision, text, int, text, text, text) to service_role;
grant execute on function public.reap_expired_secrets() to anon, authenticated;

drop function if exists public.reap_orphan_uploads();
drop function if exists public.unlock_check_code(text, text, text);
drop function if exists public.pass_unlock(text, text, text);
drop function if exists public.peek_pass(text);
drop function if exists public.app_revoke_share(text, text, text);
drop function if exists public.app_list_shares(text, int);
drop function if exists public.app_create_share(text, text, text, text, text, text, bigint, int, int, text, text, text);
drop function if exists public.app_begin_upload(text, bigint);
drop function if exists public.app_auth(text, text);
drop function if exists public.app_register_install(text, text, text);
drop function if exists public.api_rate_ok(text, int, int);
drop table if exists public.app_shares;
drop table if exists public.app_uploads;
drop table if exists public.app_installs;
drop table if exists public.api_rate;
alter table public.secrets drop column if exists pass_salt, drop column if exists pass_auth_hash,
  drop column if exists pass_server_half, drop column if exists pass_attempts;
