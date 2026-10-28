-- 008: only the server may run secret cleanup.
--
-- /api/cleanup used to call reap_expired_secrets() with the public anon key, so the function
-- had to be executable by anyone. The route now requires Vercel's CRON_SECRET and runs with
-- the service role, so the public grants can go.
-- Apply AFTER the new /api/cleanup is deployed (otherwise the old route can't run it).
-- Rollback: grant execute on function public.reap_expired_secrets() to anon, authenticated;

revoke execute on function public.reap_expired_secrets() from public, anon, authenticated;
grant execute on function public.reap_expired_secrets() to service_role;
