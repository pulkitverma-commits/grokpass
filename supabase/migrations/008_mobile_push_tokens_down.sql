-- Rollback for 008_mobile_push_tokens.sql. Removes the native push token table (with its token
-- unique constraint, token shape check and owner index) and its two RPCs, and every registered
-- token. Nothing from 002–007 is touched; the browser push table push_subscriptions stays.
drop function if exists public.register_push_device(text, text), public.unregister_push_device(text);
drop policy if exists "owner manages push devices" on public.push_devices;
drop table if exists public.push_devices cascade;
