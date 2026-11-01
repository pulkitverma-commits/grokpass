# Gate 3: hardening and beta

Date: 2026-11-01. Branch: `mobile/integration` (22 commits after Gate 2 approval, 78 files, +5k lines).

Decision requested from the human: **approve Phase 3 as "complete except the device matrix"**, or hold the gate until
a device build runs. The original prompt's Gate 3 text is gone from this Mac; plan §5 lists the Phase 3 work. Every
remaining Gate 3 criterion needs a device build, which needs the accounts and free disk.

Security verdict: **no open high or critical findings.** F-1 (sign-out kept the chat keys) is fixed. F-2 (safety
numbers trusted server-listed keys) is fixed in the shared core by the human's decision of 2026-11-01, after four review
passes (`security-review/f2-tree-keys.md`): safety numbers and verification now use the keys inside the encrypted group;
invite links carry the owner's key in the fragment (`#<token>.1<pin>`, never sent to the server) and joiners refuse any
Welcome or commit not from that owner; devices the server does not list are shown and counted; only the owner's device
may change the group, and a member's rogue change is skipped without freezing the room. Honest rooms keep byte-identical
safety numbers, so verified pairs on the live website see no change. Remaining lows are in §4.

## 1. Phase 3 items and status

| Item (plan §5) | Status | Evidence |
| --- | --- | --- |
| Security-reviewer full report | **Done** | `security-review/phase-3-full-report.md`: threat model, architecture walk, 22 claims with proof, parity table with the web, beta readiness. F-1 and F-2 fixed; F-3 (sender attribution is the server's word, ts-mls API limit) and F-5 (no heap zeroisation on Hermes) recorded honestly. |
| Device matrix (2 iPhones incl. one older, 3 Android across price ranges) | **Specified; 0 of 5 run** | test-plan §10: iPhone 16, iPhone 11 on iOS 17, Redmi 13C, Galaxy A35, Pixel 8/9; per-device pass criteria for S1–S27, P1–P10, flows; run order; results template. Build floors read from the SDK: iOS 16.4, Android minSdk 24 (tested floor Android 10). |
| Performance (cold start, 200-message sync, 50 MB file) | **Core proof done; device numbers pending** | `packages/core/test/perf.sync.test.ts` (200 messages, one state write per page), sync hardening (multi-page sync). Device targets in test-plan §11. |
| Offline / reconnect | **Core proof done; device rows pending** | `offline.integration.test.ts` and `sync.batch.test.ts`: stable `network` error, no partial state, no duplicates, channel reopened with backoff after errors. |
| VoiceOver / TalkBack / dynamic type | **Static proof done; device pass pending** | `check-a11y.mjs` (only the Phase 0 spike screen lacks labels), labels with sender and time on hidden messages, held text announced once, destructive buttons 7.06:1 contrast. Checklist in test-plan §12. |
| Store listings, privacy labels / Data safety | **Drafted** | `apps/mobile/store/app-store/*`, `apps/mobile/store/play/*`; honest copy rules in `store/README.md`. |
| Export compliance | **Drafted for an adviser** | `store/app-store/export-compliance.md`; every answer marked "draft for a human adviser, not legal advice". |
| Reviewer notes | **Drafted** | `store/app-store/review-notes.md` (guest path, hold-to-read, screenshot behaviour per platform, demo counterpart on onepeek.io). |
| TestFlight and Play internal tracks | **Runbook ready; blocked on accounts** | `docs/mobile/release/beta-runbook.md`. |

## 2. Commands and results (`mobile/integration`, Node 22.22, 2026-11-01)

```
npm run typecheck        → clean (web root, @onepeek/core, @onepeek/mobile)
npm run lint             → 0 errors
npm test                 → web vitest 150/150 (was 142 at Gate 2)
                           @onepeek/core vitest 383/383 (was 322)
                           @onepeek/mobile jest 460/460, 41 suites (was 396), run with --no-cache
next build / expo export → not re-run this phase: the disk had under 700 MB free; typecheck covers the web changes,
                           and the three web-visible core changes each have a web test
```

## 3. What changed this phase

- **Fixes from the full report:** sign-out wipes the chat keystore and rebuilds the client (F-1); the room screen
  never shows stored messages for a room the current account is not in; verify wording no longer claims nobody is
  intercepting (F-2 wording); QR codes behind "Show QR code", hidden after 30 s or on leaving the app (F-4); `/reset`
  reachable only from the app itself (F-7); one notify per send (F-9).
- **Phase 2 lows closed:** hand-off TTL and relock clearing (P3-2), per-share directories so overlapping shares never
  delete each other (P3-3), substring link routing from the share sheet (P3-5), per-share byte budget (P3-6), email
  links survive a cold start (W1-1 residual).
- **Core sync hardening:** state and `lastSeq` written once per page, never ahead; backlogs drained in one sync;
  realtime reconnects; stable `network` error code.
- **Release:** microphone permission removed; store and compliance material; beta runbook; privacy-policy additions.
- **Accessibility:** labels, announcements, contrast.

## 4. Open lows and follow-ups (owners)

- F-2 follow-ups: token-only invite links (all links made before this build) still trust the server's listing for who
  the owner is; they show a persistent notice, and a sunset of 2027-02-01 is proposed (human to confirm). A server-side
  restriction so only the owner's device may post Welcome and commit rows (new migration, live behaviour) is
  recommended and is a human decision. `changedGroup` for non-owner members is recorded but not shown. Old pre-F-2
  web clients can diverge from upgraded ones after a rogue member's commit. The public `/secret-chat` page should mirror
  known-limitations item 15 (web owner).

- F-3 sender attribution (core-crypto; upstream ts-mls), F-5 heap zeroisation (informational), F-6 anonymous user per
  invite peek (backend), F-8 pin the Supabase project ref per profile (core-crypto), F-10 exact dependency pins
  (lead), F-11 leak-guard is name-based (qa), F-12 adding `expo-updates` must trigger a review (lead).
- W1-8: the Phase 0 spike screen ships behind sign-in until the device spike runs (lead deletes it after).
- W2-4: EXIF not stripped from photos (needs `expo-image-manipulator`; disk). `KeyStore.putMany` for an atomic state
  write (core-crypto). `friendlyError` "You're offline" case and a reconnecting hint (mobile-ui, web owner).
- Web parity items for the web owner: Secret reply quotes on the website.
- Account-deletion page on onepeek.io (Apple 5.1.1(v), Play policy) and the privacy-policy additions (web owner).

## 5. What the human decides and does now

- The Gate 3 decision above; the 2027-02-01 sunset for token-only invite links; whether to add the owner-only `chat_send`
  migration.
- **Disk:** the Mac has well under 1 GB free (Claude desktop data ~16 GB, Chrome cache ~1 GB). No build can run here.
- Accounts and server steps still open since Gate 1: Expo and Apple accounts, migrations 008 and 009 (rehearse first),
  Vercel push variables, Supabase redirect URL and providers, E2E runner, push the branch and open the pull request.
- Adviser questions (export classification, privacy labels, data protection) in `store/app-store/export-compliance.md`
  and the full report §6.
