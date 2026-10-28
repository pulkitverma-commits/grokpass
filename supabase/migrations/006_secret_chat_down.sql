-- Rollback for 006_secret_chat.sql. Removes every Secret Chat object and ALL chat data.
-- Existing OnePeek tables are untouched. Empty the chat-attachments bucket through the
-- Storage API (or dashboard) first: Supabase blocks deleting storage objects from SQL.

do $$ begin perform cron.unschedule('chat-reap'); exception when others then null; end $$;
do $$ begin execute 'drop policy if exists "chat members receive" on realtime.messages'; exception when others then null; end $$;
drop policy if exists "chat upload" on storage.objects;
drop policy if exists "chat read" on storage.objects;
delete from storage.buckets where id = 'chat-attachments';

drop function if exists
  public.chat_register_device(bytea,text), public.chat_upload_key_packages(uuid,bytea[]), public.chat_list_devices(),
  public.chat_revoke_device(uuid), public.chat_create_room(uuid,text,int,text,int,text), public.chat_my_rooms(),
  public.chat_room_members(uuid), public.chat_set_timer(uuid,int,text), public.chat_create_invite(uuid,text,int,int,boolean),
  public.chat_revoke_invite(uuid), public.chat_list_invites(uuid), public.chat_peek_invite(text),
  public.chat_redeem_invite(text,uuid,bytea,text),
  public.chat_send(uuid,uuid,uuid,text,bigint,bytea,uuid,int,uuid[],uuid[]), public.chat_fetch(uuid,uuid,bigint,int),
  public.chat_mark_opened(uuid,uuid), public.chat_register_attachment(uuid,uuid,uuid,bigint,boolean,int),
  public.chat_claim_attachment(uuid), public.chat_attachment_readable(text), public.chat_attachment_writable(text),
  public.chat_leave(uuid,uuid), public.chat_burn(uuid), public.chat_reap(), public.chat_admin_stats(),
  public.chat_is_member(uuid), public.chat_my_device(uuid), public.chat_ping(uuid,text,jsonb),
  public.chat_rate_ok(text,text,int,interval), public.chat_log(text,uuid,uuid) cascade;

drop table if exists public.chat_deliveries, public.chat_messages, public.chat_attachments, public.chat_invites,
  public.chat_members, public.chat_key_packages, public.chat_rooms, public.chat_devices, public.chat_storage_trash,
  public.chat_security_events, public.chat_rate_limits, public.chat_admins cascade;
drop function if exists public.chat_trash_attachment() cascade;
