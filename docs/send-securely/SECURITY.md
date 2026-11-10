# Security model

## Encryption

* **Content:** AES-256-GCM (CryptoKit on the Mac, WebCrypto in the viewer). A fresh random
  32-byte key per share and a fresh random 12-byte nonce per encryption. Wire format:
  `nonce ‖ ciphertext ‖ tag`, base64url without padding — byte-compatible with OnePeek's existing
  `packages/core/src/crypto.ts` (verified by shared test vectors and a production round trip).
* **What is encrypted:** the content and a header (`{v, type, name, mime, size, timer}`), so the
  file name and type are not visible to OnePeek. The server also records the plaintext size of
  file shares for My Shares; text length is visible from ciphertext length.
* **Key distribution:** the key is the URL fragment (`#…`). Browsers never send fragments to
  servers; the viewer strips it from the address bar after opening. Anyone holding the full link
  can open the share (within its view and time limits). There is no per-recipient key wrapping.
* **Passphrase shares** (`#p1.<linkPart>`):
  `P = PBKDF2-SHA256(passphrase NFC, salt 16 B, 600 000)` → `authKey = P[0..32)`, `wrapKey = P[32..64)`;
  content key `K = HKDF-SHA256(ikm = linkPart ‖ wrapKey, salt = serverHalf, info = "onepeek-pass-v1")`.
  OnePeek stores `salt`, `SHA-256(authKey)` and a random `serverHalf`; it releases `serverHalf`
  (and a one-use open token) only for a correct `authKey`, counting attempts under a row lock
  (5 wrong → the share and its server half are deleted). Consequences:
  * a leaked link alone cannot be brute-forced offline — guesses must go through OnePeek;
  * OnePeek alone cannot decrypt (no `linkPart`, no `wrapKey`, no passphrase);
  * revocation, expiry or exhaustion destroys `serverHalf`, so even a copy of the ciphertext
    plus the link and passphrase can no longer be decrypted afterwards.

## What OnePeek can and cannot do

| OnePeek **can** | OnePeek **cannot** |
|---|---|
| See when a share was created, its expiry, view limit and views used, its size, whether it has a passphrase, and which install created it | Read the content, file name or MIME type |
| See the IP address of anyone calling the API or opening a share (rate limiting, Vercel logs) | Obtain the content key (it is never sent) |
| Refuse, rate-limit, revoke or delete shares | Learn a passphrase (only SHA-256 of a 600 000-round PBKDF2 output) |
| Serve a modified viewer page to recipients (as with any web-delivered E2EE) | Decrypt passphrase shares even with the link and DB contents, without the passphrase |

The last row on the left is the inherent limit of browser-delivered end-to-end encryption: the
recipient trusts the JavaScript onepeek.io serves at the moment they open the link. Security
headers (HSTS, framing protection, report-only CSP site-wide, strict CSP on /chat) reduce
injection risk; a script-src CSP for `/s/*` is a recommended follow-up.

## Access controls

* **View limits** (1, 2–10, or "until expiry" = 1000) and **expiry** (5 min – 7 days) are enforced
  in `open_secret` under `SELECT … FOR UPDATE`: concurrent opens of a view-once share yield exactly
  one success (verified on production with 8 simultaneous requests).
* **Revoke** requires the install credential *and* the share's manage token; it deletes the secret
  row immediately and removes the stored file. Revocation cannot recall content already opened,
  downloaded, copied or photographed.
* **Download permissions:** OnePeek's existing viewer offers "no copy / no save" hints only;
  browsers cannot prevent screenshots or copying, and Send Securely does not claim they can.
* **Recipient authentication:** OnePeek's email-locked secrets exist for web users; Send Securely
  v1 does not expose recipient-only access. Shares are bearer links (plus optional passphrase).

## Abuse protection

Atomic per-bucket rate limits (`api_rate_ok`, fail closed): install registration 10/h per IP,
auth attempts 600/min per IP, uploads 60/h and creates 120/h per install, opens 120/10 min per
IP, passphrase unlocks 30/10 min per IP plus 5 per share, email-code send 6/day per secret and
20/h per IP, email-code verify 30/10 min per IP plus 5 per code. Quota: 300 shares per install
per 30 days; 20 pending uploads per install; 50 MB per file.

## Deletion lifecycle and its limits

* On the last view, revoke, 5th wrong passphrase or expiry, the `secrets` row is deleted at once
  (with any passphrase server half). Files: deleted by the viewer after the last view, by the
  revoke route immediately, otherwise by the daily cron within ~24 h; unused upload slots after 2 h
  (+ cron), and any bucket object no secret refers to after 1 day.
* Not covered: Supabase's own backups and point-in-time recovery (retained per the project's
  plan), CDN or browser caches on the recipient's device, and anything the recipient saved.
  Ciphertext in backups remains undecryptable without the key in the link.

## Malware scanning

Content is encrypted before upload, so OnePeek cannot scan it without breaking end-to-end
encryption. Mitigations: TopShelf warns before sending executable types; file names are sanitised
(no paths, control or bidi characters); OnePeek forces `application/octet-stream` storage and the
viewer only previews images inline. Recipients should open files only from senders they trust.

## Data minimisation

TopShelf sends no analytics or telemetry for Send Securely. Names stay on the Mac. Server logs
from these routes contain only error codes; request bodies, tokens and ciphertext are never logged.
