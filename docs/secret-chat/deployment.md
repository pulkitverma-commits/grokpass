# Secret Chat — Production rollout

There is no staging database: by decision (2026-10-28) Secret Chat goes straight to the
production Supabase project `xndotbjwzbkknewyuqvf` ("Grokpass" org). The database changes
are additive (new `chat_*` objects only) and were tested by replaying the full schema
history (`schema.sql`, 002–007) in Postgres via PGlite: `supabase/tests/production-history.test.ts`.

## 1. Supabase dashboard (production project)

Do these in order.

1. **SQL editor → run `supabase/migrations/007_block_anonymous_accounts.sql`.**
   Run it *before* enabling anonymous sign-ins: it stops guest (anonymous) users from
   using account-only features such as secret requests.
2. **SQL editor → run `supabase/migrations/006_secret_chat.sql`.**
   It also enables `pg_cron` and schedules `chat-reap` every minute. If the output shows
   `pg_cron unavailable`, enable **Database → Extensions → pg_cron** and run the file again
   (it is safe to re-run).
3. **Authentication → Sign In / Providers → Allow anonymous sign-ins: on.**
   This is what lets invited guests join without an account. Leave CAPTCHA settings as they are.
4. **Authentication → Passkeys → Enable passkey authentication.**
   - Relying Party Display Name: `OnePeek`
   - Relying Party ID: `onepeek.io` (do not change it later: that invalidates every passkey)
   - Relying Party Origins: `https://onepeek.io,https://www.onepeek.io`

Check afterwards (SQL editor):

```sql
select count(*) from pg_tables where schemaname = 'public' and tablename like 'chat_%';  -- 12
select jobname, schedule from cron.job where jobname = 'chat-reap';                       -- * * * * *
```

5. **Make yourself a chat admin** (optional, for /chat/admin):
   `insert into public.chat_admins(user_id) select id from auth.users where email = 'you@example.com';`

## 2. Vercel

- `CRON_SECRET` (Production): a long random string. Vercel sends it to `/api/chat/cleanup`, which
  then refuses any other caller. Without it the route still works but anyone can trigger it (harmless:
  it only deletes already-expired data).
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`: already set; they power new-message notifications.

## 3. Deploy

Merge `feature/onepeek-secret-chat` into `main`; Vercel deploys onepeek.io. Chat lives at
`/chat` (noindex) and is introduced on the public page `/secret-chat`, linked from the header,
footer and homepage.

## 4. Verify on onepeek.io

- Two different browsers (or one normal + one private window): create a Quick Chat in one,
  open the invite in the other, exchange messages both ways, watch a message disappear.
- Secret Chat: wrong access code is refused; after 5 wrong codes the invite is rate-limited.
- Settings: add a passkey, sign out, sign back in with the passkey.
- Burn a chat: the other browser shows "The owner burned this chat."
- As a guest, open `/dashboard`: it must show the signed-out view.
- Send a file, and a view-once file: the second browser opens it once; a second open is refused.
- Chat → Settings → New message notifications: turn on in one browser, send from the other.

## Rollback

1. Revert the merge on `main` (Vercel redeploys the previous version).
2. Turn **anonymous sign-ins** off.
3. Empty the `chat-attachments` bucket (Storage), then run `supabase/migrations/006_secret_chat_down.sql`.
   This deletes all chat data. Existing OnePeek tables are untouched.
4. Leave 007 in place (it only adds a guest check), or re-run `create_request` from 005 to undo it.

## 5. Mobile app (Phase 1): push tokens and app links

Everything here is additive; the website keeps working with none of it in place.

### Migration 008 (`supabase/migrations/008_mobile_push_tokens.sql`)

Adds `public.push_devices` (owner, platform, token, created_at, last_seen; RLS owner-only) and two
RPCs the app calls: `register_push_device(p_platform text, p_token text)` and
`unregister_push_device(p_token text)`, both `authenticated` only. The table itself grants `authenticated` only `select, delete` (writes go
through the RPCs, so the 10-token cap and one-owner rule hold). Chat guests (anonymous users) may
register, like `chat_register_device`; `007` is unaffected. Tested in PGlite
(`supabase/tests/push-devices.test.ts`, up/down/up) and in the schema-history replay.

1. Prefer a dry run on a throwaway Supabase project first: `supabase db push` against it, or paste the file
   into its SQL editor. There is no staging database, so this is the only rehearsal.
2. Production: **SQL editor → run `008_mobile_push_tokens.sql`** (safe to re-run), or `supabase db push`
   from a checkout linked to the project. Check:

```sql
select count(*) from pg_tables where schemaname = 'public' and tablename = 'push_devices';  -- 1
select proname from pg_proc where proname in ('register_push_device', 'unregister_push_device');  -- 2 rows
```

Rollback: run `008_mobile_push_tokens_down.sql`. It drops the table (all registered tokens) and the
two RPCs, nothing else.

Security review wave 1 (`docs/mobile/security-review/phase-1-wave-1.md`), folded into 008 before it is applied anywhere:

- **W1-2** — a token belongs to one owner: `unique (token)`; `register_push_device` from another account takes the row over (`on conflict (token) do update set owner = auth.uid(), …`), so a shared or handed-on phone stops getting the previous account's pushes as soon as the new account registers.
- **W1-3** — tokens must be 32–512 chars of `[A-Za-z0-9:_-]` (else `bad_token`, also a table check); each owner is trimmed to their 10 most recently seen tokens after every registration; `pushToNative` reads at most 10 (`order last_seen desc limit 10`) and sends 10 requests at a time instead of all at once. Both RPCs run with `search_path = ''` and schema-qualified names.
- **W1-5** — `nodeHttp2Request` always settles: `close`/`timeout` on the stream and the session reject (or resolve with the status already seen), the session has an idle timeout, and a 15 s hard deadline rejects and destroys the session, so one slow APNs stream can no longer hang `/api/chat/notify`.

### Vercel env (server only, never in the app or `apps/mobile`)

| Variable | What | Where it comes from |
|---|---|---|
| `APNS_KEY_ID` | 10-character key id | Apple Developer → Keys → the APNs key |
| `APNS_TEAM_ID` | 10-character team id | Apple Developer → Membership |
| `APNS_PRIVATE_KEY` | contents of the `.p8` file; newlines may be pasted as `\n` | downloaded once when the key is created |
| `APNS_BUNDLE_ID` | `io.onepeek.app` (default if unset) | app bundle id |
| `APNS_USE_SANDBOX` | `1` for development builds, unset/`0` for TestFlight and App Store | — |
| `FCM_SERVICE_ACCOUNT_JSON` | the whole service-account JSON on one line | Firebase console → Project settings → Service accounts → Generate new private key |
| `APPLE_TEAM_ID` | same team id, used by the AASA file | — |
| `ANDROID_SHA256_CERT_FINGERPRINTS` | comma-separated `AA:BB:…` SHA-256 fingerprints: the upload key **and** the Play App Signing key | Play Console → App integrity; `keytool -list -v` for the upload key |

Without `APNS_*`/`FCM_*` the native senders are no-ops and `/api/chat/notify` keeps sending browser
push exactly as before. Without `APPLE_TEAM_ID`/`ANDROID_SHA256_CERT_FINGERPRINTS` the two
`.well-known` files return 404 on purpose, so a half-configured deploy fails app verification instead of
silently serving an empty file.

The push payloads are fixed strings (`OnePeek` / `You have a new message in a private chat.`) plus the room id as an
opaque routing key. Nothing else ever goes to Apple or Google (`lib/alerts.native.test.ts`,
`app/api/chat/notify/route.test.ts`).

### Verify after deploy

- `https://onepeek.io/.well-known/apple-app-site-association` → `200`, `content-type: application/json`,
  no redirect, `applinks.details[0].appIDs = ["<TEAM>.io.onepeek.app"]`, components for `/s/*` and `/chat/join`.
  Apple's checker: `https://app-site-association.cdn-apple.com/a/v1/onepeek.io`.
- `https://onepeek.io/.well-known/assetlinks.json` → `200`, one statement for `io.onepeek.app` with every
  fingerprint. Google's checker:
  `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://onepeek.io&relation=delegate_permission/common.handle_all_urls`.
- Push: with a development build and `APNS_USE_SANDBOX=1`, send from the website to a room the phone is
  in; the banner reads "OnePeek / You have a new message in a private chat." and nothing else.
