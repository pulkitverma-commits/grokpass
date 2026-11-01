# Gate 1: Secret Chat core

Date: 2026-11-01. Branch: `mobile/integration` (93 commits after Gate 0 approval, about 190 files, +25k lines).
Decision: **approved by the human on 2026-11-01 with device verification deferred.** The device checks run once the
accounts in section 5 exist; results are appended to section 1. Every gate criterion that a device can prove is still unproven: this Mac
has no Xcode, Android Studio, Java or emulator, and no Expo or Apple account exists yet (same blocker as Gate 0).

Security verdict: **no open high or critical findings** (`security-review/phase-1-close-out.md`). Every high and medium raised this phase (W1-1 high; W1-2, W1-3, W1-4, W2-1, W2-2, W3-1 medium) is fixed with a test that fails without the fix. Open lows are listed in the close-out report with owners and carried into Phase 2.

## 1. Gate criteria and status

| Criterion (from the build prompt) | Status | Evidence |
| --- | --- | --- |
| Phone ↔ browser end to end on the live project | **Blocked on device build** | Automated equivalent: `packages/core/test/interop.integration.test.ts` (20 scenarios, web client and phone-core client in one PGlite room, every scenario sweeps server, SQL log, phone storage for plaintext). Maestro flows 01–11 written against the real testIDs (`apps/mobile/e2e`, `check-flows.mjs` clean), not run. |
| Push with no content | **Tests done, live send pending keys** | `lib/alerts.native.test.ts` (37: exact APNs/FCM shapes, fixture sweep over every request as text/hex/base64/base64url, credentials never in errors, dead tokens, cap 10, chunked sends, http2 deadline), `supabase/tests/push-devices.test.ts` (17: owner-only RLS, grants select/delete only, one owner per token, cap, token shape, `search_path`, rollback), `app/api/chat/notify/route.test.ts` (web payload byte-identical). Real send needs the APNs key / FCM account in Vercel (section 5). |
| Black screenshots on Android | **Plugin written, device check pending** | `apps/mobile/plugins/withSecureWindow.js` (FLAG_SECURE in `MainActivity.onCreate`, Kotlin and Java, string-tested), app key re-asserted on every foreground, `allowScreenCaptureAsync` never called (review W1-4). MANUAL-CHECKS S1–S4. |
| Blanked recording on iOS | **Module written, device check pending** | Local Expo module `apps/mobile/modules/screen-state` (`UIScreen.isCaptured` + change events), provider covers content while captured or inactive; screenshot notification → `sendScreenshotAlert` through the core only. MANUAL-CHECKS S5–S7. Copy never claims iOS blocks screenshots. |
| Lock works | **Tests done, device check pending** | `SecurityProvider`: locked on cold start, 60 s auto-lock, Panic Exit persists before `chat.lock()`, lock-store reload on foreground, children unmounted while locked, unlock generation counter (W1-7). 32 jest tests; Locked screen (U3) as the cover. MANUAL-CHECKS S8–S14. |
| No open high findings | See verdict line | Three reviews this phase: `security-review/phase-1-wave-1.md` (1 high, 3 medium, 6 low: all fixed and verified), `phase-1-wave-2.md` (2 medium, 8 low: all fixed), `phase-1-close-out.md` (verification; 1 medium W3-1 and 4 low found, W3-1/W3-2/W3-4/W3-5 fixed after it, W3-3 to qa in Phase 2). |

## 2. Commands and results (`mobile/integration`, Node 22.22, 2026-11-01)

```
npm run typecheck        → clean (web root, @onepeek/core, @onepeek/mobile)
npm run lint             → 0 errors (53 grandfathered web warnings, 2 core)
npm test                 → web vitest 123/123 (was 58 at Gate 0)
                           @onepeek/core vitest 194/194 (was 87)
                           @onepeek/mobile jest 203/203 (25 suites; was 0)
npm run build            → next build: Compiled successfully
expo export --platform ios     → 2577 modules to Hermes bytecode (android 2461 at wave 1)
node apps/mobile/e2e/scripts/check-flows.mjs → 17 flows, 168 ids, flows OK
```

## 3. What was built (by task)

- **Core (C-series carry-overs + glue):** owner nickname announced (and re-announced after admits), `SyncResult.newAlerts`,
  N2 wipe-marker fix, sealed Supabase session storage (`onepeek-auth.db`, own SecureStore entry), `registerPushDevice` /
  `unregisterPushDevice`, `apps/mobile/lib/chat.ts` (client singleton, Apple / Google PKCE / device-bound email link /
  guest sign-in, `push` helper with the token sealed and unregistered before sign-out, `resetThisPhone`).
- **Screens (U1–U7):** theme and primitives, Welcome, Sign in, auth callback, Chats home, New chat with invite sheet
  (QR, masked link), Join (paste or Universal Link fragment), Locked, Conversation (hold-to-read, timers, replies,
  files, view-once viewer, watermark while held, screenshot notices), room menu (invites, safety number + QR, members,
  timer, rename, Panic, leave, burn), Settings (lock, notifications, devices, honest protection copy, sign out, reset).
- **Native (N1–N5):** FLAG_SECURE plugin and hook, backup-exclusion plugin and iOS module, biometric lock / auto-lock /
  Panic Exit, watermark, README and MANUAL-CHECKS.
- **Backend (B1–B4):** migration `008_mobile_push_tokens` (+down), APNs and FCM v1 senders, native fan-out from
  `/api/chat/notify`, AASA and assetlinks route handlers. **Not applied to production.**
- **QA (Q3, Q4):** leak-guard lint (telemetry, loggers, stringify-to-sink, fetch hosts, off-device sinks) with 93
  probe tests, static `console.` sweep, 17 Maestro flows with a local relay for two-device journeys, test plan v1.2
  with the Gate 1 map (§8) and device matrix (§4.1).
- **Release (R1):** `eas.json` (development, development-simulator, e2e, preview, production), icon and splash set,
  versioning policy, FCM client-config wiring, checklist section A6.

## 4. Open items carried into Phase 2

1. Device verification of every protection (MANUAL-CHECKS S1–S20, S11b) and the Maestro two-device run; the C2 spike
   numbers (`app/spike.tsx` still ships, behind sign-in; deleted after the run).
2. Low findings left open by decision (owner, see `phase-1-close-out.md` for the consolidated list): EXIF stripping via
   a re-encode library (Phase 3), pending email in module memory (cold start asks for a new link), push re-registration
   after sign-in, Supabase AppState-driven token refresh helper.
3. Web parity: the website's reply preview and sent-reply quote show Secret text the same way W2-1/W3-1 did on the phone; a one-line web fix with
   a web test is recommended (outside the mobile scope, human decides).
4. Passkeys are not offered in the app (no native library evaluated); Apple, Google, email link and guest are.
5. Staging Supabase project still recommended before any further migration.

## 5. What the human decides and does now

- Approve Phase 1 with device verification deferred, or hold the gate until a device build runs.
- Accounts (checklist Part A + A6): Expo account and `eas init`; EAS env vars; Apple Developer Program for iPhone builds.
- Apply migration 008 (rehearse on a throwaway project first; steps in `docs/secret-chat/deployment.md` §5), then set the
  Vercel env vars listed there (APNs key, FCM service account, Apple team id, Android certificate fingerprints).
- Supabase Auth: add `onepeek://auth` to Redirect URLs; enable the Apple and Google providers.
- E2E runner choice (GitHub Actions `macos-15` + `ubuntu` KVM recommended; Maestro Cloud only for the `single` set) and
  the `MAESTRO_EMAIL` inbox.
- Push `mobile/integration` (the stored token lacks the `workflow` scope) and open the Phase 1 pull request
  `mobile/integration` → `main` with this document linked; nothing is merged by an agent.
