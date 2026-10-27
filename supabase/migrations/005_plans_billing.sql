-- OnePeek 005: plans and billing.
--  * Free, Plus (₹99/month) and Pro (₹249/month). Monthly secret limits: 10 (plus referral bonus), 250, 1,000.
--  * Subscriptions are paid with Razorpay. Only the website's server (service role) writes them,
--    after checking Razorpay's signature.
--  * Plan features (files, location, advanced controls, link revocation, longer expiry) are only
--    enforced once billing_settings.enforce_plans is switched on, so nobody loses features before
--    they can actually upgrade:  update public.billing_settings set enforce_plans = true;
--  * Counts reset every calendar month (UTC).
-- Safe to run more than once. Works with the currently deployed site.

create table if not exists public.billing_settings (
  id            int primary key default 1 check (id = 1),
  enforce_plans boolean not null default false
);
insert into public.billing_settings (id) values (1) on conflict (id) do nothing;
alter table public.billing_settings enable row level security;
revoke all on public.billing_settings from anon, authenticated;

create table if not exists public.subscriptions (
  owner                    uuid primary key references auth.users(id) on delete cascade,
  plan                     text not null default 'free' check (plan in ('free', 'plus', 'pro')),
  status                   text not null default 'created',
  razorpay_subscription_id text unique,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  updated_at               timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;
drop policy if exists "owner reads own subscription" on public.subscriptions;
create policy "owner reads own subscription" on public.subscriptions for select to authenticated using (owner = auth.uid());
grant all on public.subscriptions, public.billing_settings to service_role;

alter table public.secret_quota add column if not exists period_start date;

-- ---------------------------------------------------------------------------------------
-- Plan helpers
-- ---------------------------------------------------------------------------------------
-- The paid plan of a signed-in user (a few days' grace after a period ends), else the browser's plan.
create or replace function public.effective_plan(p_owner uuid, p_client_plan text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.plan from subscriptions s
      where p_owner is not null and s.owner = p_owner and s.plan in ('plus', 'pro')
        and s.status in ('active', 'authenticated', 'pending')
        and (s.current_period_end is null or s.current_period_end > now() - interval '3 days')),
    case when p_client_plan in ('plus', 'pro') then p_client_plan else 'free' end);
$$;
revoke all on function public.effective_plan(uuid, text) from public, anon, authenticated;

create or replace function public.plan_secret_limit(p_plan text, p_bonus int)
returns int language sql immutable as $$
  select case p_plan when 'pro' then 1000 when 'plus' then 250 else 10 + coalesce(p_bonus, 0) end;
$$;

-- Secrets (and requests) used this calendar month: per account when signed in, else per browser.
create or replace function public.month_usage(p_client_id text, p_owner uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', now())::date; v int;
begin
  if p_owner is not null then
    return (select count(*) from secret_log l where l.owner = p_owner and l.created_at >= v_month)
         + (select count(*) from secret_requests r where r.owner = p_owner and r.created_at >= v_month);
  end if;
  update secret_quota set used = 0, period_start = v_month
  where client_id = p_client_id and (period_start is null or period_start < v_month);
  select used into v from secret_quota where client_id = p_client_id;
  return coalesce(v, 0);
end $$;
revoke all on function public.month_usage(text, uuid) from public, anon, authenticated;

-- What the site shows: used this month, the monthly limit, the plan, referral details.
create or replace function public.get_quota(p_client_id text, p_ref text default null)
returns table (used int, quota int, plan text, ref_code text, referred int)
language plpgsql security definer set search_path = public as $$
declare q secret_quota%rowtype; v_plan text;
begin
  q := ensure_quota(p_client_id, p_ref);
  v_plan := effective_plan(auth.uid(), q.plan);
  return query select month_usage(p_client_id, auth.uid()),
    plan_secret_limit(v_plan, q.bonus),
    v_plan, q.ref_code,
    (select count(*)::int from secret_quota r where r.referred_by = q.ref_code);
end $$;
revoke all on function public.get_quota(text, text) from public;
grant execute on function public.get_quota(text, text) to anon, authenticated;

-- Is plan enforcement on? (The pricing page uses this to show the right copy.)
create or replace function public.plans_enforced()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select enforce_plans from billing_settings where id = 1), false);
$$;
grant execute on function public.plans_enforced() to anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- Create (same as 004, with plan limits)
-- ---------------------------------------------------------------------------------------
create or replace function public.create_secret(
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
  v_plan text;
  v_enforce boolean := false;
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
  v_plan := effective_plan(v_owner, q.plan);
  if month_usage(p_client_id, v_owner) >= plan_secret_limit(v_plan, q.bonus) then
    raise exception 'quota_exceeded';
  end if;
  select coalesce(b.enforce_plans, false) into v_enforce from billing_settings b where b.id = 1;
  v_max_ttl := case when v_plan in ('plus', 'pro') then 2592000 when v_enforce then 86400 else 604800 end;
  -- Plan features (only once paid plans are switched on).
  if v_enforce then
    if v_plan = 'free' and (p_file_path is not null or v_share or v_fenced) then raise exception 'plan_required:plus'; end if;
    if v_plan <> 'pro' and (v_views > 1 or v_email is not null or v_after is not null or p_window_start is not null
                            or (v_countries is not null and cardinality(v_countries) > 0)) then
      raise exception 'plan_required:pro';
    end if;
  end if;
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

-- Requests (same as 004, with plan limits)
create or replace function public.create_request(
  p_note text, p_public_key text, p_ttl_seconds int, p_client_id text, p_recipient text default null
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id text;
  q secret_quota%rowtype;
  v_max_ttl int;
  v_plan text;
begin
  if auth.uid() is null then raise exception 'login_required'; end if;
  if p_note is null or length(trim(p_note)) = 0 or length(p_note) > 300 then raise exception 'invalid note'; end if;
  if p_public_key is null or p_public_key !~ '^[A-Za-z0-9_-]{80,120}$' then raise exception 'invalid key'; end if;

  q := ensure_quota(p_client_id, null);
  select * into q from secret_quota where client_id = p_client_id for update;
  v_plan := effective_plan(auth.uid(), q.plan);
  if month_usage(p_client_id, auth.uid()) >= plan_secret_limit(v_plan, q.bonus) then raise exception 'quota_exceeded'; end if;
  v_max_ttl := case when v_plan in ('plus', 'pro') then 2592000 else 604800 end;
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

-- Burn now: says why when nothing was burned, and fixes history rows whose secret is already gone.
-- (Pro only once plans are enforced.)
drop function if exists public.burn_secret(text);
create function public.burn_secret(p_id text)
returns table (burned boolean, file_path text, reason text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_path text; v_log secret_log%rowtype;
begin
  if auth.uid() is null then
    return query select false, null::text, 'not_signed_in'::text; return;
  end if;
  select * into v_log from secret_log l where l.id = p_id and l.owner = auth.uid();
  if not found then
    return query select false, null::text, 'not_found'::text; return;
  end if;
  if exists (select 1 from billing_settings b where b.id = 1 and b.enforce_plans) and effective_plan(auth.uid(), 'free') <> 'pro' then
    raise exception 'plan_required:pro';
  end if;
  delete from secrets s where s.id = p_id returning s.file_path into v_path;
  if not found then
    -- The secret is already gone (opened, expired or removed). Make the history say so.
    if v_log.opened_at is null and v_log.burned_at is null and v_log.expires_at > now() then
      update secret_log l set burned_at = now() where l.id = p_id;
    end if;
    return query select false, null::text, 'already_gone'::text; return;
  end if;
  delete from secret_unlocks u where u.id = p_id;
  if v_path is not null then
    insert into secret_claims (file_path, expires_at, temporary)
    values (v_path, now() + interval '10 minutes', false)
    on conflict (file_path) do update set expires_at = excluded.expires_at, temporary = false;
  end if;
  update secret_log l set burned_at = now() where l.id = p_id;
  return query select true, v_path, 'burned'::text;
end $$;

-- ---------------------------------------------------------------------------------------
-- Grants (unchanged signatures)
-- ---------------------------------------------------------------------------------------
revoke all on function public.create_secret(text, text, text, int, text, text, text, boolean, bigint, double precision, double precision, int, text, int, text, timestamptz, int, int, text, text[]) from public;
grant execute on function public.create_secret(text, text, text, int, text, text, text, boolean, bigint, double precision, double precision, int, text, int, text, timestamptz, int, int, text, text[]) to anon, authenticated;
revoke all on function public.create_request(text, text, int, text, text) from public, anon;
grant execute on function public.create_request(text, text, int, text, text) to authenticated;
revoke all on function public.burn_secret(text) from public, anon;
grant execute on function public.burn_secret(text) to authenticated;
