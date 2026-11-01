-- 009: report a Secret Chat room (ids only).
--
-- A member of a room can flag it for human review. The server has no message text, nicknames,
-- device ids or file names to store, and this table stores none of them either: only the room id,
-- the reporter's user id and one of four fixed reasons. A human reviewer with the service role
-- reads the rows; they have no access to any content (the server never had it).
--
-- Rules, enforced here:
--   * RLS on; no grants at all to anon/authenticated on the table. Reporters never read their
--     reports back (nothing to show, and no channel to probe who reported whom). Service role only.
--   * The only write path is the security-definer RPC report_chat(p_room, p_reason). The caller
--     must be a *current* member of the room, by the exact predicate 006 uses everywhere
--     (public.chat_is_member: active member, non-revoked device, active unexpired room);
--     anyone else, signed in or not, gets `not_a_member`. Anon cannot even execute the RPC.
--   * reason in ('spam','abuse','illegal','other'), checked by the table and the RPC (`bad_reason`).
--   * One row per (room, reporter): reporting again updates reason and created_at.
--   * At most 20 distinct rooms reported per reporter per rolling day (`too_many_reports`).
--   * The RPC runs with `search_path = ''` and schema-qualified names (as 008 does).
-- Additive only: one new table, one new function. Rollback: 009_chat_reports_down.sql.

create table if not exists public.chat_reports (
  id         uuid primary key default gen_random_uuid(),
  room       uuid not null,
  reporter   uuid not null references auth.users(id) on delete cascade,
  reason     text not null check (reason in ('spam', 'abuse', 'illegal', 'other')),
  created_at timestamptz not null default now(),
  unique (room, reporter)
);
create index if not exists chat_reports_reporter_day on public.chat_reports (reporter, created_at);

alter table public.chat_reports enable row level security;
revoke all on public.chat_reports from public, anon, authenticated;
grant all on public.chat_reports to service_role;
-- No policies on purpose: with RLS on and no grants, anon/authenticated reach nothing directly.

create or replace function public.report_chat(p_room uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_reporter uuid := auth.uid();
  v_recent int;
begin
  if v_reporter is null then raise exception 'not_signed_in'; end if;
  if p_room is null or not public.chat_is_member(p_room) then raise exception 'not_a_member'; end if;
  if p_reason is null or p_reason not in ('spam', 'abuse', 'illegal', 'other') then raise exception 'bad_reason'; end if;
  -- Cap: 20 other rooms reported in the last 24 h. Re-reporting the same room is an update, not a 21st.
  select count(*) into v_recent from public.chat_reports r
  where r.reporter = v_reporter and r.room <> p_room and r.created_at > now() - interval '1 day';
  if v_recent >= 20 then raise exception 'too_many_reports'; end if;
  insert into public.chat_reports (room, reporter, reason) values (p_room, v_reporter, p_reason)
  on conflict (room, reporter) do update set reason = excluded.reason, created_at = now();
end $$;

revoke all on function public.report_chat(uuid, text) from public, anon;
grant execute on function public.report_chat(uuid, text) to authenticated;
