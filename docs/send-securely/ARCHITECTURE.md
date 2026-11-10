# Architecture

```
 TopShelf (macOS app, Swift)                        OnePeek (Next.js on Vercel + Supabase "onepass")
 ─────────────────────────────                      ───────────────────────────────────────────────
 compose: files | text | screenshot | clipboard
 encrypt locally (CryptoKit AES-256-GCM)
 keychain: install credential, manage tokens,
           link fragments
        │ 1 POST /api/v1/installs  (once)  ─────────▶ app_register_install  → app_installs (hash only)
        │ 2 POST /api/v1/uploads   (files) ─────────▶ app_begin_upload      → app_uploads
        │      ◀── signed upload URL (2 h)                                     + Storage signed URL
        │ 3 PUT ciphertext ─────────────────────────▶ Storage bucket "secrets" (private, f/<id>.bin)
        │ 4 POST /api/v1/shares (idempotent) ───────▶ app_create_share      → secrets + app_shares
        │ 5 GET  /api/v1/shares   (My Shares) ──────▶ app_list_shares       (metadata only)
        │ 6 DELETE /api/v1/shares/:id ──────────────▶ app_revoke_share      → secret deleted, file removed
        ▼
 link = https://onepeek.io/s/<id>#<key>   (or #p1.<linkPart> with a passphrase)

 Recipient browser (existing viewer, /s/[id])
   peek_secret (anon)  → encrypted header, decrypt with key from #fragment
   [passphrase] peek_pass → salt; PBKDF2 in browser; POST /api/v1/pass/unlock → token + server half
   POST /api/open (server, service role) → open_secret: atomic view count / burn, claim for file
   Storage download under RLS (only while a claim is live) → decrypt in browser
 Daily cron /api/cleanup (CRON_SECRET) → reap_expired_secrets + reap_orphan_uploads → Storage delete
```

## Why this shape

* **Reuse.** OnePeek already had sound client-side encryption with the key in the URL fragment
  and an atomic `open_secret` (row lock, view counting, burn on last view). App shares are plain
  rows in `public.secrets`, so the viewer and the open path are unchanged and battle-tested.
* **A real API for apps.** The mobile and web clients call database functions directly with the
  anon key; that's not a stable contract for a third-party client. `/api/v1` is versioned, uses
  the service role server-side only, and is the only thing TopShelf talks to.
* **No accounts in TopShelf.** TopShelf has no user accounts, so identity is per install
  (a random secret in the Mac's Keychain) and per share (a manage token). A TopShelf user gets no
  access to OnePeek accounts or any other install's shares.

## Database objects (migration 011)

| Object | Purpose | Notable columns |
|---|---|---|
| `app_installs` | one row per app install | `secret_hash` (SHA-256), `platform`, `app_version`, `revoked_at` |
| `app_uploads` | signed upload reservations | `path`, `install_id`, `max_bytes`, `expires_at` (2 h), `used_at` |
| `app_shares` | which install created which secret | `idempotency_key` (unique per install), `manage_hash`, `kind`, `max_views`, `passphrase`, `size`, `expires_at`, `revoked_at` |
| `api_rate` | fixed-window counters | `bucket`, `window_start`, `count` |
| `secrets.pass_*` | passphrase shares | `pass_salt`, `pass_auth_hash`, `pass_server_half`, `pass_attempts` |

All tables have RLS on with every privilege revoked from `anon`/`authenticated`; all functions are
`SECURITY DEFINER` with a fixed `search_path` and executable by `service_role` only, except
`peek_pass` (returns a KDF salt or null). IDs come from `gen_random_bytes` (install IDs ≈127 bits,
upload paths ≈185 bits, share IDs as before).

## What each side stores

| Data | TopShelf (Mac) | OnePeek server |
|---|---|---|
| Content | — (draft in memory until sent) | AES-GCM ciphertext only, until opened/expired/revoked |
| Content key / link fragment | Keychain (`link.<id>`), so "Copy link" works later | never |
| Passphrase | never stored | never |
| File name, MIME, size | name in local My Shares list | inside the encrypted header; plaintext `size` column |
| Install secret | Keychain | SHA-256 only |
| Manage token | Keychain (`manage.<id>`) | SHA-256 only |
| Timing, view counts, expiry, status | cached in My Shares | `app_shares`, `secrets` |
| Recipient IP | — | per-IP rate-limit counters (bucket names contain the IP, kept ≤ 2 days); Vercel request logs |
