# Gate 2: secrets inside chat and sharing

Date: 2026-11-01. Branch: `mobile/integration` (34 commits after Gate 1 approval, 97 files, +9k lines).
Decision requested from the human: **approve Phase 2 as code-complete with device verification deferred** (the same
blocker as Gates 0 and 1: no Expo or Apple account, no Xcode or Android Studio on this Mac), and **confirm the Gate 2
wording** in `plan.md` §4, which the lead reconstructed because the build prompt file is no longer on this machine.

Security verdict: **no open high or critical findings** (`security-review/phase-2-close-out.md`). The four Phase 2 mediums and six lows are closed with tests; the close-out's one new medium (P3-1, share screen dismissed without deleting the shared copy) is fixed in the same branch with a test. Open lows (P3-2, P3-3, P3-5, P3-6 and the Phase 1 carry-overs) are listed in the close-out with owners and go into Phase 3.

## 1. Gate criteria and status

| Criterion (reconstructed) | Status | Evidence |
| --- | --- | --- |
| App ↔ website one-time secrets (text, Wi-Fi, file; views burn; expiry) | **Automated proof done; live run pending** | `packages/core/src/secrets.ts` is byte-for-byte the web's header, ciphertext, `create_secret` args and `/api/open` handling (81 unit tests). `packages/core/test/secrets.interop.test.ts`: 17 scenarios on PGlite with migrations 002–009, app → web and web → app, with a four-encoding sweep that the key, body, file name and Wi-Fi password never reach SQL, storage or request bodies. A run against the live project needs a device build. |
| Links open the app when installed, the website when not; fragment stays on device | **Code and audit done; device check pending** | `security/links.ts` strict parser; viewer and join read the full URL from `useLinkingURL` and never put the fragment in route params (README N6c audit with file:line of expo-router dropping the hash); `forgetLinkingURL()` clears the native initial-URL cache after the key is imported; AASA / assetlinks handlers from Phase 1. MANUAL-CHECKS S24–S25, flow 13, test-plan M18. |
| Share from Photos and Files into the app, both platforms | **Android implemented, iOS via package; device check pending** | Android: intent filters + local Kotlin module copying into `<cache>/share-intent/`, consumed once, swept. iOS: `expo-share-intent@9.0.0` wired (activation rules, App Group, files moved out of the container and swept; the hand-rolled extension is deleted). `app/share.tsx` → send to a chat or make a link. MANUAL-CHECKS S21–S23, S27; flows 14–15; test-plan P1–P3. |
| QR scanner: invites, secrets, safety numbers | **Done; camera check pending** | `app/scan.tsx` (`qr` barcodes only, torch, honest permission copy); dispatch via `lib/links.classify` with unit tests; flow 16 ×4 kinds. |
| Report chat sends ids only | **Done** | Migration 009 (`chat_reports`, service-role only), RPC `report_chat` (member check, reason enum, 20/day), route `POST /api/chat/report`; 13 PGlite + 6 route tests prove only `{ p_room, p_reason }` is forwarded and no content is stored. |
| No open high findings | See verdict line | `security-review/phase-2.md` (4 medium, 6 low, all fixed) and `phase-2-close-out.md` (verification). |

## 2. Commands and results (`mobile/integration`, Node 22.22, 2026-11-01)

```
npm run typecheck        → clean (web root, @onepeek/core, @onepeek/mobile)
npm run lint             → 0 errors
npm test                 → web vitest 142/142 (was 123 at Gate 1)
                           @onepeek/core vitest 322/322 (was 194)
                           @onepeek/mobile jest 397/397 (was 203)
npm run build            → next build: Compiled successfully (incl. /api/chat/report)
expo export --platform ios     → 2601 modules to Hermes bytecode (before the review fixes; not re-run, disk)
node apps/mobile/e2e/scripts/check-flows.mjs → 23 flows, flows OK
```

## 3. What was built

- **C4 core secrets** (`packages/core/src/secrets.ts`, `time.ts`, `apps/mobile/lib/secrets.ts`): create / peek / open /
  unlock-code, strict link parsing, quota client id in SecureStore, Supabase foreground token refresh.
- **U8 screens**: one-time secret composer (07) from the composer and the home entry, result sheet with masked link
  and QR, secret viewer (`app/s/[id]`) with lock-email unlock, hold-to-view, timer, content cleared on background,
  share target (10), QR scanner (11), block member (local), report chat.
- **N6 native**: Android share receive module and intent filters, iOS share via `expo-share-intent`, App Group
  entitlement, link parser, fragment audit, `forgetLinkingURL`.
- **B5 backend**: migration 009 and the report route. **Not applied to production.**
- **Q5 QA**: cross-platform secrets interop test and harness, sink-lint extensions (W3-3 closed), flows 12–16,
  test plan v1.3 with the Gate 2 map (§9).

## 4. Open items carried into Phase 3

1. Everything that needs a device: MANUAL-CHECKS S1–S27 and P1–P10, the Maestro runs, the C2 spike numbers, the
   first EAS compile of the two local modules and the share-intent plugin.
2. Low findings open by decision (see the Phase 2 close-out report): EXIF stripping (needs `expo-image-manipulator`),
   geofenced links handed to the browser, pending email in module memory, design 07's passcode option and camera capture.
3. A guarded one-time secret opened on iOS produces no sender alert (there is no room to alert into); the viewer copy
   should say so (test-plan P5).
4. Web parity items for the human: Secret reply quotes on the website (W2-1 / W3-1 class).
5. Staging Supabase project still recommended before 008 and 009 go to production.

## 5. What the human decides and does now

- Confirm the Gate 2 wording (plan §4) and approve Phase 2 with device verification deferred, or hold the gate.
- Everything still open from Gate 1 section 5 (accounts, migrations 008 and now 009, Vercel env, Supabase auth
  settings, E2E runner, push the branch, open the pull request). The branch cannot be pushed from here.
- Phase 3 is hardening and beta: device matrix, performance, accessibility, store listings and privacy labels,
  TestFlight / Play internal tracks. It needs the accounts above before any of its gates can be met.
