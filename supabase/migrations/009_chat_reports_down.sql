-- Rollback for 009_chat_reports.sql. Removes the report table (and every report in it) and its
-- RPC. Nothing from 002–008 is touched: chat_is_member and the chat_* tables stay as 006 left them.
drop function if exists public.report_chat(uuid, text);
drop table if exists public.chat_reports cascade;
