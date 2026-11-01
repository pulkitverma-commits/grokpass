# apps/mobile/store

Store submission material for OnePeek 1.0, prepared in Phase 3. **Nothing in this folder is uploaded by an
agent; the human submits** (`docs/mobile/release/beta-runbook.md` says how). Owner: `release`. Written
2026-11-01 against `mobile/integration` after Gate 2; every claim is traced to code in the file that makes it.

## Index

### App Store (`app-store/`)

| File | What it is | Paste into |
| --- | --- | --- |
| [`app-store/listing.md`](app-store/listing.md) | Name, subtitle, promotional text, description, keywords, URLs, categories, what's new, age-rating answers | App Store Connect → App Information and 1.0 version page |
| [`app-store/privacy-labels.md`](app-store/privacy-labels.md) | App Privacy answers per data type with the reason for each; the two judgement calls (ciphertext "not collected", push token as Device ID) flagged; account-deletion requirement | App Store Connect → App Privacy |
| [`app-store/review-notes.md`](app-store/review-notes.md) | Reviewer notes: optional sign-in and the guest path, device lock, hold-to-read, screenshot behaviour per platform and why FLAG_SECURE, demo flow with a counterpart on onepeek.io, one-time links, permissions, UGC controls; Play variant at the end | App Store Connect → App Review Information; Play → App access |
| [`app-store/export-compliance.md`](app-store/export-compliance.md) | Encryption questionnaire answers, EAR self-classification (5D992.c, §740.17(b)(1)), BIS annual report, France. **Every answer is a draft for a human adviser, not legal advice** | App Store Connect → App Encryption Documentation, after the adviser signs off |
| [`app-store/screenshots.md`](app-store/screenshots.md) | Required sizes (6.9"/6.7"/6.1"; iPad not applicable), shot list, the no-real-secret-content rule, how to capture without a simulator; Play graphics specs | `screenshots/` (empty until a build exists) |

### Google Play (`play/`)

| File | What it is | Paste into |
| --- | --- | --- |
| [`play/listing.md`](play/listing.md) | Title, short and full description, category, contact, graphics specs, release notes, App content pointers | Play Console → Main store listing, Store settings |
| [`play/data-safety.md`](play/data-safety.md) | Data safety answers per type and purpose, encryption in transit, deletion path, no third-party sharing beyond the push transport; the E2EE exemption flagged for the adviser | Play Console → App content → Data safety |
| [`play/content-rating.md`](play/content-rating.md) | IARC questionnaire answers and the expected outcome | Play Console → App content → Content rating |
| [`play/permissions.md`](play/permissions.md) | Every Android permission the build declares, who adds it, the user-facing reason; **`RECORD_AUDIO` from two plugin defaults is unused and should be removed by the lead** (one-line fix given) | Play Console → App bundle explorer → Permissions (reconcile) |
| [`play/target-audience.md`](play/target-audience.md) | 18+ target audience and why | Play Console → App content → Target audience |

### Related documents outside this folder

| File | What it is |
| --- | --- |
| [`docs/mobile/release/beta-runbook.md`](../../../docs/mobile/release/beta-runbook.md) | Step by step for the human: pre-upload checks, iOS production build → TestFlight → testers → external beta, Play AAB → internal testing (service account, `releaseStatus: draft`), numbering, failures, rollback, costs |
| [`docs/mobile/release/privacy-policy-additions.md`](../../../docs/mobile/release/privacy-policy-additions.md) | Paragraphs the onepeek.io privacy policy needs for the app (chats, account, devices, push token, quota id, reports, location case, local storage, no analytics or crash reporting, permissions, deletion) and the account-deletion page both stores require |
| [`docs/mobile/release/accounts-checklist.md`](../../../docs/mobile/release/accounts-checklist.md) | Accounts and credentials the human creates; Part C has the Phase 3 items (store records, review room, adviser, deletion page, D-U-N-S) |
| [`docs/mobile/release/versioning.md`](../../../docs/mobile/release/versioning.md) | Version / build numbers, channels, OTA policy |
| [`apps/mobile/eas.json`](../eas.json) | Build and submit profiles; `submit.production` holds two public placeholders (`ascAppId`, `appleTeamId`) the human fills in a commit |
| [`apps/mobile/security/README.md`](../security/README.md) | What each protection really does per platform; the store copy quotes it |

## Honest-copy rule

Store copy, listings and reviewer notes must match what the app really does, per platform:

- Never claim iOS blocks screenshots. iOS cannot block them.
- Say: the app **detects screenshots and notifies the room**; on iOS it **blanks the content while the
  screen is being recorded or mirrored**; on **Android it blocks screenshots** (`FLAG_SECURE`).
- Never promise that a recipient cannot photograph the screen with another device.
- Never say "audited" (ts-mls has not been), "unhackable" or "military grade".
- Key storage wording is copied from `apps/mobile/security/README.md`, not paraphrased up.
- Privacy forms say **not collected** for end-to-end encrypted content, with the reasoning written down and
  flagged for the adviser; they never say OnePeek "stores your messages" without "encrypted, unreadable".

## Open items the store material depends on (owners outside `release`)

1. **Account deletion path** (web owner / lead): Apple 5.1.1(v) and Play policy; "email us" is not enough.
2. ~~`RECORD_AUDIO` / microphone usage string~~: done (lead, `app.config.ts` plugin options; verified absent in `expo config --type introspect`).
3. ~~Location notice in the app's secret viewer~~: done (mobile-ui): the viewer shows a notice and a
   "shares location" badge before Open when the sender asked to see where it is opened.
4. **Review account model** (human): the app has no password login; the guest path is the review path,
   or an email-code sign-in is added.
5. **Adviser sign-off** on export compliance and the two privacy-label judgement calls.
6. **Welcome screen line** "Hold to read. Screenshots blocked or flagged." (mobile-ui) is true as a
   two-platform sentence; if Apple reads it as "blocked on iOS", change to "Screenshots blocked on
   Android, flagged on iPhone".
