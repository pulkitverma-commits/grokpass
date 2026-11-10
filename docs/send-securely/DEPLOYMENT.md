# Deployment

## Environment variables (Vercel project `grokpass`)

| Name | Targets | Purpose |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Production (+ Preview to test API previews) | Server-only; the app API needs it. Never `NEXT_PUBLIC_`. |
| `CRON_SECRET` | Production, Preview | Required by `/api/cleanup` and `/api/chat/cleanup`; without it they refuse every call. Set (≥16 chars, sensitive). |
| `APP_MAX_UPLOAD_BYTES` | optional | Lower the per-file cap (default and maximum 52 428 800). |
| `NEXT_PUBLIC_SITE_URL` | Production | Origin used in share URLs (`https://onepeek.io`). |

No new secrets are needed by TopShelf; it holds only its own install credential.

## Order (as done on 2026-11-10)

1. Apply `supabase/migrations/011_app_api.sql` to the `onepass` database **before** deploying the
   code: the new routes and the `/api/open` rate limit call its functions and fail closed without
   them. It is additive; it also revokes `reap_expired_secrets` from browsers (same as 010).
   `npx supabase db query --remote=<ref> --file supabase/migrations/011_app_api.sql --yes`
2. Ensure `CRON_SECRET` is set (Vercel cron sends it automatically).
3. Deploy (push `main`). Check: `POST /api/v1/installs {}` → 400; `/s/x` sends `referrer-policy: no-referrer`.
4. Run the end-to-end check (no mocks, creates and cleans up its own test data):
   `BASE_URL=https://onepeek.io SUPABASE_URL=… SUPABASE_ANON_KEY=… npx tsx tests/integration/send-securely.e2e.ts`
   then delete installs with `app_version = 'e2e'` and their secrets/files.

Production note: on `onepass` the contents of 011 were applied on 2026-11-10 (under its earlier
name 010_app_api). Migrations 008 and 009 (mobile push devices, chat reports) were **not yet
applied** there at that time and are independent of 011.

## Rollback

1. Revert the code (redeploy the previous production deployment in Vercel).
2. Then run `supabase/migrations/011_app_api_down.sql`. It restores 004's `open_secret`, re-grants
   the reaper to browsers (only needed with the old cleanup route) and drops the app tables and
   passphrase columns. Revoke or let passphrase shares expire first — they become unopenable.
   Ordinary secrets created through the API stay and keep working.

## Production checklist

- [x] Migration applied and verified (privileges, functions, columns)
- [x] `CRON_SECRET` set for Production and Preview
- [x] Deployed; headers and routes verified on onepeek.io
- [x] End-to-end check passed on production (38/38) and test data removed
- [x] TopShelf client verified against production (Swift → JS round trip) and test data removed
- [ ] Enforce a script-src CSP on `/s/*` (currently report-only site-wide)
- [ ] Decide whether to apply 008/009 (mobile) to production
