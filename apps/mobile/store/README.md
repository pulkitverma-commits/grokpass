# apps/mobile/store

Phase 3 puts the store submission material here. Nothing in this folder is uploaded by an agent; the human
submits. Owner: `release`.

Planned contents:

- `listings/`: App Store and Google Play titles, subtitles, descriptions, keywords, what's new, support and
  privacy URLs, in English first.
- `privacy-labels.md`: Apple App Privacy answers. Collected: account email and user id, device push token,
  approximate location only if a feature uses it. Not collected: message and file content (end-to-end
  encrypted, the server cannot read it).
- `data-safety.md`: Google Play Data safety form answers, same facts as the Apple labels.
- `export-compliance.md`: draft answers for the encryption questionnaires (end-to-end encryption, MLS,
  AES-GCM, X25519/Ed25519). **Drafts, flagged for a human adviser** before anything is submitted.
  `ITSAppUsesNonExemptEncryption` is already `true` in `app.config.ts`.
- `reviewer-notes.md`: explains hold-to-read, the screenshot protections, and a demo flow with a review
  account (credentials are given in the store console only, never in the repo).
- `screenshots/`: store screenshots, once a real build exists.

## Honest-copy rule

Store copy, listings and reviewer notes must match what the app really does, per platform:

- Never claim iOS blocks screenshots. iOS cannot block them.
- Say: the app **detects screenshots and notifies the room**; on iOS it **blanks the content while the
  screen is being recorded or mirrored**; on **Android it blocks screenshots** (`FLAG_SECURE`).
- Never promise that a recipient cannot photograph the screen with another device.
- Key storage wording is copied from the `native-security` documentation, not paraphrased up.
