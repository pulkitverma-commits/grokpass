-- OnePass: more accurate "where it was opened" + geofenced secrets.
--  * Viewers can share their device location (browser permission) instead of the network estimate.
--    We keep the area (neighbourhood/locality) and the accuracy radius.
--  * Senders can lock a secret to a place: it only opens within a radius (+5% tolerance).
--    The check runs in the database before the secret is released, so nothing is burned
--    when someone is outside the area.
-- Safe to run more than once. Works with the currently deployed app.

-- History: area + accuracy + source of the open location, and the geofence (for display).
alter table public.secret_log add column if not exists open_area       text;
alter table public.secret_log add column if not exists open_accuracy_m int;
alter table public.secret_log add column if not exists open_source     text;
alter table public.secret_log add column if not exists fence_radius_m  int;
alter table public.secret_log add column if not exists fence_label     text;
alter table public.secret_log add column if not exists fence_lat       double precision;
alter table public.secret_log add column if not exists fence_lon       double precision;

-- Geofence on the secret itself (needed to enforce it).
alter table public.secrets add column if not exists fence_lat      double precision;
alter table public.secrets add column if not exists fence_lon      double precision;
alter table public.secrets add column if not exists fence_radius_m int;
alter table public.secrets add column if not exists fence_label    text;

create or replace function public.distance_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)));
$$;

-- Peek: tells the viewer about location sharing and the geofence before they open.
drop function if exists public.peek_secret(text);
create function public.peek_secret(p_id text)
returns table (header text, kind text, expires_at timestamptz, share_location boolean, fence_radius_m int, fence_label text)
language sql stable security definer set search_path = public as $$
  select s.header,
         case when s.file_path is null then 'text' else 'file' end,
         s.expires_at,
         s.share_location,
         s.fence_radius_m,
         s.fence_label
  from secrets s
  where s.id = p_id and s.expires_at > now();
$$;

-- Open: enforces the geofence, then burns and records the open.
drop function if exists public.open_secret(text);
drop function if exists public.open_secret(text, text, text, text, double precision, double precision);
drop function if exists public.open_secret(text, text, text, text, double precision, double precision, text, int, text);
create function public.open_secret(
  p_id text,
  p_city text default null, p_region text default null, p_country text default null,
  p_lat double precision default null, p_lon double precision default null,
  p_area text default null, p_accuracy int default null, p_source text default 'network'
) returns table (header text, body text, file_path text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  r secrets%rowtype;
  v_device boolean := p_source = 'device';
  v_digits int := case when p_source = 'device' then 3 else 2 end;  -- ~110 m vs ~1 km grid
  v_dist double precision;
begin
  select * into r from secrets s where s.id = p_id and s.expires_at > now() for update;
  if not found then return; end if;

  if r.fence_radius_m is not null then
    if not v_device or p_lat is null or p_lon is null then
      raise exception 'geofence_location_required';
    end if;
    if p_accuracy is not null and p_accuracy > greatest(r.fence_radius_m, 150) then
      raise exception 'geofence_imprecise:%', p_accuracy;
    end if;
    v_dist := distance_m(r.fence_lat, r.fence_lon, p_lat, p_lon);
    if v_dist > r.fence_radius_m * 1.05 then   -- 5% tolerance
      raise exception 'geofence_outside:%', round(v_dist - r.fence_radius_m);
    end if;
  end if;

  delete from secrets s where s.id = r.id;
  if r.file_path is not null then
    insert into secret_claims (file_path, expires_at)
    values (r.file_path, now() + interval '10 minutes')
    on conflict (file_path) do update set expires_at = excluded.expires_at;
  end if;
  update secret_log l set
    opened_at       = now(),
    open_city       = case when r.share_location then left(p_city, 120) end,
    open_region     = case when r.share_location then left(p_region, 120) end,
    open_country    = case when r.share_location then left(p_country, 8) end,
    open_area       = case when r.share_location then left(p_area, 160) end,
    open_lat        = case when r.share_location and p_lat between -90 and 90 then round(p_lat::numeric, v_digits)::double precision end,
    open_lon        = case when r.share_location and p_lon between -180 and 180 then round(p_lon::numeric, v_digits)::double precision end,
    open_accuracy_m = case when r.share_location and p_lat is not null then
                        case when v_device then greatest(110, least(coalesce(p_accuracy, 500), 50000)) else 10000 end end,
    open_source     = case when r.share_location and p_lat is not null then case when v_device then 'device' else 'network' end end
  where l.id = r.id and l.opened_at is null;
  return query select r.header, r.body, r.file_path;
end $$;

-- Create: adds the optional geofence (centre, radius 50 m – 500 km, label).
drop function if exists public.create_secret(text, text, text, int, text, text, text, boolean, bigint);
drop function if exists public.create_secret(text, text, text, int, text, text, text, boolean, bigint, double precision, double precision, int, text);
create function public.create_secret(
  p_header text, p_body text, p_file_path text, p_ttl_seconds int, p_client_id text, p_ref text default null,
  p_recipient text default null, p_share_location boolean default false, p_size bigint default null,
  p_fence_lat double precision default null, p_fence_lon double precision default null,
  p_fence_radius int default null, p_fence_label text default null
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
  v_fenced boolean := p_fence_radius is not null;
begin
  if p_header is null or length(p_header) > 4000 then raise exception 'invalid header'; end if;
  if (p_body is null) = (p_file_path is null) then raise exception 'provide either a body or a file'; end if;
  if p_body is not null and length(p_body) > 120000 then raise exception 'text too large'; end if;
  if p_file_path is not null and p_file_path !~ '^f/[A-Za-z0-9_-]{24,64}\.bin$' then raise exception 'invalid file path'; end if;
  if p_ttl_seconds not in (3600, 86400, 604800) then raise exception 'invalid expiry'; end if;
  if v_fenced and (p_fence_lat is null or p_fence_lon is null or p_fence_lat not between -90 and 90
                   or p_fence_lon not between -180 and 180 or p_fence_radius not between 50 and 500000) then
    raise exception 'invalid geofence';
  end if;

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
      insert into secrets (id, header, body, file_path, expires_at, share_location, fence_lat, fence_lon, fence_radius_m, fence_label)
      values (v_id, p_header, p_body, p_file_path, now() + make_interval(secs => p_ttl_seconds), v_share,
              case when v_fenced then round(p_fence_lat::numeric, 5)::double precision end,
              case when v_fenced then round(p_fence_lon::numeric, 5)::double precision end,
              case when v_fenced then p_fence_radius end,
              case when v_fenced then nullif(left(trim(p_fence_label), 160), '') end);
      exit;
    exception when unique_violation then
    end;
  end loop;
  update secret_quota set used = used + 1 where client_id = p_client_id;

  if v_owner is not null then
    insert into secret_log (id, owner, kind, size, recipient, share_location, expires_at, fence_radius_m, fence_label, fence_lat, fence_lon)
    values (v_id, v_owner, case when p_file_path is null then 'text' else 'file' end,
            case when p_size between 0 and 20000000 then p_size end,
            nullif(left(trim(p_recipient), 200), ''), v_share,
            now() + make_interval(secs => p_ttl_seconds),
            case when v_fenced then p_fence_radius end,
            case when v_fenced then nullif(left(trim(p_fence_label), 160), '') end,
            case when v_fenced then round(p_fence_lat::numeric, 5)::double precision end,
            case when v_fenced then round(p_fence_lon::numeric, 5)::double precision end);
  end if;
  return v_id;
end $$;

revoke all on function public.distance_m(double precision, double precision, double precision, double precision) from public;
revoke all on function public.peek_secret(text) from public;
revoke all on function public.open_secret(text, text, text, text, double precision, double precision, text, int, text) from public;
revoke all on function public.create_secret(text, text, text, int, text, text, text, boolean, bigint, double precision, double precision, int, text) from public;
grant execute on function public.peek_secret(text) to anon, authenticated;
grant execute on function public.open_secret(text, text, text, text, double precision, double precision, text, int, text) to anon, authenticated;
grant execute on function public.create_secret(text, text, text, int, text, text, text, boolean, bigint, double precision, double precision, int, text) to anon, authenticated;
