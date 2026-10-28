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

## 2. Deploy

Merge `feature/onepeek-secret-chat` into `main`; Vercel deploys onepeek.io. Chat lives at
`/chat`, is not linked from the rest of the site yet, and is `noindex`.

## 3. Verify on onepeek.io

- Two different browsers (or one normal + one private window): create a Quick Chat in one,
  open the invite in the other, exchange messages both ways, watch a message disappear.
- Secret Chat: wrong access code is refused; after 5 wrong codes the invite is rate-limited.
- Settings: add a passkey, sign out, sign back in with the passkey.
- Burn a chat: the other browser shows "The owner burned this chat."
- As a guest, open `/dashboard`: it must show the signed-out view.

## Rollback

1. Revert the merge on `main` (Vercel redeploys the previous version).
2. Turn **anonymous sign-ins** off.
3. Empty the `chat-attachments` bucket (Storage), then run `supabase/migrations/006_secret_chat_down.sql`.
   This deletes all chat data. Existing OnePeek tables are untouched.
4. Leave 007 in place (it only adds a guest check), or re-run `create_request` from 005 to undo it.
