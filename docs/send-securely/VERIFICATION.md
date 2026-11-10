# Verification report — 2026-11-10

Scope: OnePeek production (`onepeek.io`, Supabase `onepass`) and TopShelf build `897eb1c` on an
M4 iMac (macOS 27.0.1). No mock responses were used as evidence of integration.

## Automated tests

| Suite | Result | Covers |
|---|---|---|
| OnePeek `vitest` (web + Supabase on PGlite) | 179/179 pass | incl. 20 new migration tests on the full production schema history: permissions for anon/authenticated, install auth, idempotency, view-once and multi-view, expiry, cross-install isolation, revoke with manage token, upload ownership/size/reuse, pending-upload cap, orphan reaping, passphrase token single use, 5-guess destruction, partial passphrase params, atomic email-code limit, rate limiter, migration down/up |
| OnePeek `packages/core` passphrase tests | 4/4 pass | KDF vectors (PBKDF2 cross-checked with Python), wrong passphrase/link part/server half, tamper detection, NFC |
| TopShelf `swift test` | 309/309 pass | incl. 11 new: same vectors as OnePeek, unique nonces, tamper detection, header shape, file-name sanitising (path traversal, bidi override, reserved names), MIME sanitising, executable warning, invitation text, settings migration |
| Migration 011 on production's exact state (schema + 002–007) | pass | apply, roll back, re-apply |

## Production end-to-end (no mocks)

`tests/integration/send-securely.e2e.ts` against `https://onepeek.io` — **38/38 pass**, including:
share-page security headers; 401 without/with wrong credentials; cleanup cron refuses callers;
browsers can no longer run the reaper; text share opened and decrypted as the viewer does;
view-once; My Shares status; cross-install invisibility; idempotent retry and conflicting replay;
**8 simultaneous opens of a view-once share → exactly 1 success**; 3-view share opens 3 times;
revoke denied to another install and to a wrong token, allowed with the right one; revoked link
dead; signed upload of a 300 KB encrypted file, no download before open, identical bytes after;
slot reuse refused; tampered ciphertext rejected; passphrase share: salt, refusal without token,
wrong guess counted, right one releases the server half, decrypts; **7 parallel wrong guesses →
share destroyed, correct passphrase no longer works**; script payload and over-long expiry refused.

TopShelf's real Swift client and crypto against production, opened with OnePeek's JS viewer code:
**11/11 pass** — text (Unicode) and a 250 KB file decrypt to identical bytes, sanitised file name
(`../e2e report.pdf` → `e2e report.pdf`), passphrase share unlocks with the passphrase TopShelf set,
view-once holds, revoke works, list returns live statuses.

Installed TopShelf app: Send Securely appears pinned in the notch, in Settings and Quick Actions;
the module's upload → "Your secure share is ready." path ran on production through the real UI.

All test installs, shares and files were removed from production afterwards.

## Not verified

* Mobile and cross-browser rendering of the passphrase step on the viewer (desktop Chromium/Safari
  paths unchanged; the new form reuses existing viewer styles).
* TopShelf UI flows driven step by step: screenshot capture + redaction editor, clipboard import of
  images/files, drag-and-drop, multi-file ZIP, cancel mid-upload, retry after a network failure,
  VoiceOver. They compile and use the same pipeline that was verified, but were not exercised.
* Upload of files near the 50 MB cap and on slow/unstable networks (no resumable upload: a failed
  upload is retried whole; unused slots are reaped).
* Rate limits beyond the open/unlock paths (limits are in the database and unit-tested, but their
  thresholds were not load-tested).
* The Vercel cron run with `CRON_SECRET` (next scheduled run 03:17 UTC).
* Supabase backup retention for deleted ciphertext (plan-dependent; see SECURITY.md).
