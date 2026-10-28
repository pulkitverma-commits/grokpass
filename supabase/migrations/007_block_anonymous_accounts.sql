-- 007: keep Secret Chat guests out of account-only OnePeek features.
--
-- Secret Chat lets people join a chat without an account by signing in anonymously
-- (Supabase "anonymous sign-ins"). Anonymous users get the same `authenticated` role as
-- real accounts, so account features that only checked auth.uid() would accept them, and
-- per-account limits could be dodged by making new guest accounts. This re-creates
-- create_request (from 005, unchanged otherwise) with an anonymous check.
-- Server routes reject anonymous users in lib/server.ts#userFromRequest.
-- Rollback: re-run the create_request definition from 005_plans_billing.sql.

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
  -- Chat guests are anonymous Supabase users; account features need a real account.
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'login_required'; end if;
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

revoke all on function public.create_request(text, text, int, text, text) from public, anon;
grant execute on function public.create_request(text, text, int, text, text) to authenticated;
