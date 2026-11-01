# OnePeek mobile apps: Phases 0–3 (`mobile/integration` → `main`)

Title: **OnePeek iOS and Android apps (Phases 0–3) and the shared core they run on**

## Summary

This branch adds the OnePeek mobile apps (Expo, React Native) and moves the Secret Chat crypto, MLS and chat client
into a shared package (`packages/core`) that both the website and the apps use. All four phase gates were approved
by the human (Gate 0 to Gate 3, 2026-10-31 to 2026-11-01), each with device verification deferred.

**Nothing has run on a real phone yet.** This Mac had no Xcode, Android Studio or emulator, and no Expo or Apple
account existed. The device checks are specified (`docs/mobile/test-plan.md` §10, `apps/mobile/security/MANUAL-CHECKS.md`)
and are the next step once accounts exist.

## Changes to the live website (read these first)

- **Shared core.** `lib/crypto.ts` and `lib/chat/*` are thin re-exports of `packages/core`. The extraction was
  behaviour-neutral (the original web tests are unchanged and pass).
- **Safety numbers (F-2 fix).** Safety numbers, "mark verified" and "key changed" now use the keys inside the
  encrypted group, not the server's listing. In honest rooms the numbers are byte-identical, so verified pairs see
  no change. New messages: `member_key_mismatch`, `invite_owner_mismatch`.
- **Invite links.** New links are `#<token>.1<pin>`: the pin carries the owner's device id and a hash of its key,
  in the fragment, never sent to the server. Old token-only links still work and show a notice in the room.
- **Sync.** Backlogs larger than one page arrive in one sync; the realtime channel reconnects after errors; network
  failures surface as code `network` (page text unchanged).
- **Push.** `/api/chat/notify` also sends native pushes (no-op until the APNs/FCM variables are set). The web push
  payload is byte-identical.
- **New routes.** `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json` (404 until their env vars
  are set), `POST /api/chat/report`.
- Room page: unlisted devices, device count, mismatch and unpinned notices; screenshot alerts refresh the list.

Each web-visible change has a web test (`lib/chat/client.integration.test.ts`, route tests).

## Database (NOT applied anywhere)

- `008_mobile_push_tokens.sql` (+ `_down`): `push_devices`, owner-only RLS, `register_push_device` /
  `unregister_push_device`, one owner per token, 10 per owner.
- `009_chat_reports.sql` (+ `_down`): `chat_reports` (service role only), `report_chat` (members only, ids and a
  reason, 20 a day).

Apply after merge, rehearsing on a throwaway project first: `docs/secret-chat/deployment.md` §5.

## Environment (Vercel, after merge)

`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `APNS_USE_SANDBOX`, `FCM_SERVICE_ACCOUNT_JSON`,
`APPLE_TEAM_ID`, `ANDROID_SHA256_CERT_FINGERPRINTS`. Supabase Auth: add `onepeek://auth` to Redirect URLs; enable
Apple and Google.

## Tests

| Suite | `main` | This branch |
| --- | --- | --- |
| Web (vitest) | 58 | 150 |
| Core (vitest) | – | 383 |
| Mobile (jest) | – | 460 |

`npm run typecheck` clean, `npm run lint` 0 errors. CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests, the
web build and a tracked-secret check. The web build was last run locally before the Phase 3 changes (disk); CI runs it.

## Security

Ten review reports in `docs/mobile/security-review/`. Every high and medium finding is fixed with a test; the final
verdict is no open high or critical. Remaining lows and open human decisions are in `docs/mobile/gates/phase-3.md` §4–5.

## Where to look

- Plan, rules and status: `docs/mobile/plan.md`; every decision: `docs/mobile/log.md`; gates: `docs/mobile/gates/`.
- Store and compliance drafts: `apps/mobile/store/`, `docs/mobile/release/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
