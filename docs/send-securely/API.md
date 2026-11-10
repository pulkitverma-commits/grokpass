# OnePeek app API v1

Base URL: `https://onepeek.io`. JSON in and out; every response is `Cache-Control: no-store`.
Errors: `{ "error": { "code": "…", "message": "…" } }` with an HTTP status; `429` includes
`Retry-After`. Codes are stable; messages are human-readable and never echo input.

Authenticated calls send `Authorization: OnePeek-Install <installId>.<secret>`, where `secret` is
43 base64url characters (32 random bytes) the app generated and keeps in its keychain.

## POST /api/v1/installs — register an install
Body: `{ "secretHash": "<hex SHA-256 of the secret's UTF-8 string>", "platform": "macos", "appVersion": "1.1" }`
→ `201 { "installId": "<22 chars>" }`. Limit: 10/h per IP. The secret itself is never sent here.

## POST /api/v1/uploads — reserve a file upload (auth)
Body: `{ "size": <ciphertext bytes> }` (29 … 52 428 800)
→ `201 { "path": "f/<32>.bin", "uploadUrl": "https://…", "expiresInSeconds": 7200, "maxBytes": n }`.
Then `PUT uploadUrl` with the ciphertext and `Content-Type: application/octet-stream`.
Errors: `file_too_large` 413, `too_many_pending_uploads` 429, `storage_unavailable` 503.

## POST /api/v1/shares — create a share (auth, idempotent)
```json
{
  "idempotencyKey": "16–64 base64url chars, unique per draft",
  "manageHash": "hex SHA-256 of a random manage token the app keeps",
  "header": "base64url(nonce ‖ AES-GCM(header JSON))",
  "body": "base64url(…)  — text shares", "filePath": "f/….bin — file shares",
  "size": 12345, "ttlSeconds": 300…604800, "maxViews": 1…1000,
  "passphrase": { "salt": "b64url ≥16 B", "authHash": "hex SHA-256(authKey)", "serverHalf": "b64url 32 B" }
}
```
→ `201 { "id", "url": "https://onepeek.io/s/<id>", "expiresAt", "replayed": false }`; a retry with
the same `idempotencyKey` and `manageHash` → `200` with the same id and `replayed: true`.
The URL carries no key: append `#<key>` or `#p1.<linkPart>` client-side.
Errors: `idempotency_conflict` 409, `quota_exceeded` 429, `invalid_expiry`/`invalid_views`/
`invalid_request`/`invalid_passphrase_parameters` 400, `upload_missing`/`invalid_upload` 409,
`upload_too_large` 413.

## GET /api/v1/shares — this install's shares (auth)
→ `200 { "shares": [ { "id", "url", "kind": "text|file", "status": "active|viewed|expired|revoked",
"createdAt", "expiresAt", "revokedAt", "maxViews", "viewsUsed", "passphrase", "size" } ] }` (≤ 200, newest first).

## DELETE /api/v1/shares/:id — revoke (auth + manage token)
Header `X-Manage-Token: <43 chars>` (never in the URL) → `200 { "revoked": true, "fileDeleted": bool }`;
`404 not_found` for an unknown id, another install's share or a wrong token (indistinguishable).

## POST /api/v1/pass/unlock — passphrase check (public, used by the viewer)
Body: `{ "id", "authKey": "<b64url 32 B>" }` → `200 { "token", "serverHalf" }`;
`403 wrong_passphrase { attemptsLeft }`, `410 locked` (share deleted), `404 not_found`, `429`.
The token is passed to `POST /api/open` as `unlockToken` (one use, 15 minutes).

## Existing endpoints used by the recipient
`peek_secret`, `peek_pass` (Supabase RPC, anon), `POST /api/open` (now also returns 403
`passphrase_required`), Storage download under RLS.
