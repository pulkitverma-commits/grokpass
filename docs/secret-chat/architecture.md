# OnePeek Secret Chat — Audit & Architecture Plan

Status: **plan, nothing implemented yet** (branch `feature/onepeek-secret-chat`, 2026-10-28).

## 1. Audit of the existing OnePeek app

| Area | What exists today | Reuse for chat |
|---|---|---|
| Framework | Next.js 14 App Router, React 18, TypeScript strict, no Tailwind (one large `app/globals.css`) | Yes. Chat lives under `app/chat/**` with its own `chat.css` |
| Hosting | Vercel project `grokpass` (team FRAME), domains `onepeek.io`, `www.onepeek.io`. Push to `main` deploys production. Previews are behind Vercel SSO | Yes. Previews become staging |
| Database | Supabase project `xndotbjwzbkknewyuqvf` (the "Grokpass" org). Schema is applied by hand in the SQL editor (`supabase/schema.sql` + `migrations/002–005`), with no migration runner | Same project for production. Staging needs its own project (see §6) |
| Auth | Supabase Auth: email + password, magic link, Google, Microsoft (azure). The client keeps its session in localStorage via `@supabase/supabase-js` (not `@supabase/ssr` cookies). Server routes read `Authorization: Bearer` (`lib/server.ts#userFromRequest`) | Yes, as the account layer. Passkeys get added on top |
| Crypto | `lib/crypto.ts`: Web Crypto AES-256-GCM, key in the URL `#fragment`, ECDH P-256 + HKDF for "requests" | Primitives only (AES-GCM for attachments, base64url). **Not** a messaging protocol |
| Expiry | `reap_expired_secrets()` + daily Vercel cron `/api/cleanup` | Pattern reused. Chat needs minute-level reaping (see §5) |
| Billing | Razorpay, `subscriptions`, `effective_plan()` | Later: plan-gate Business Rooms |
| Push/email | Web Push (VAPID), Mandrill | Discreet "new message" pushes with no content |
| Tests / lint / CI | **None.** No test runner, no ESLint, no CI workflow | Must add: Vitest + Playwright + `tsc` |
| Security headers | **None.** No CSP, HSTS or `Referrer-Policy` in `next.config.js` | Must add, scoped carefully so existing pages keep working |

### Risks and issues found in the existing code (unrelated to chat, worth fixing)
1. `/api/cleanup` is unauthenticated, runs with the **anon** key, and `reap_expired_secrets` must therefore be executable by `anon`. Anyone can trigger reaping. Impact is low (it only deletes expired rows), but it should check `CRON_SECRET` and use the service role.
2. Preview deployments have `NEXT_PUBLIC_SUPABASE_URL` pointing at **production** but no anon/service keys, so previews are broken today. If keys were ever added for preview, previews would write to the production DB.
3. No CSP while third-party scripts and styles load (Google Fonts, map tiles). An XSS on any page could read `#fragment` keys.
4. Production deploys straight from `main` with no checks.

## 2. Product surface (kept deliberately small)

Routes under `/chat` (primary nav: **Chats · New Chat · Settings**):

- `/chat`: active rooms list (local list, decrypted on device)
- `/chat/new`: pick Quick / Secret / Business, set the timer, create, then share
- `/chat/j/[invite]`: join (access code if required, nickname, then join)
- `/chat/r/[roomId]`: conversation
- `/chat/r/[roomId]/settings`: room details, members, verify, invites, Burn
- `/chat/settings`: passkeys, devices and sessions, lock, panic shortcut
- `/chat/admin`: role-gated health dashboard (aggregates only)

## 3. Cryptography decision

**Requirement:** vetted protocol, forward secrecy, post-compromise security, groups with membership changes, runs in the browser, no home-made crypto.

| Option | Browser | Groups | Status | Verdict |
|---|---|---|---|---|
| libsignal (official) | No supported browser build (Node/Rust/mobile targets) | Sender keys, server-assisted | Maintained by Signal, but not for web | **Rejected** for web |
| libsignal-protocol-javascript | Yes | 1:1 only | Archived and unmaintained | **Rejected** |
| **MLS (RFC 9420)** via `ts-mls` | Yes (pure TS, `@hpke/core`) | Native: add, remove, update and commit epochs | Active. **Not independently audited, to my knowledge** | **Selected for v1** |
| MLS via `mls-rs` (AWS, Rust → WASM) | Needs a WASM build we would maintain | Native | More scrutiny (AWS, vendored by Firefox) | Upgrade path behind the same adapter |

Decision: **MLS (RFC 9420), ciphersuite `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`**, wrapped in `lib/chat/mls/adapter.ts` so the implementation can be swapped. MLS gives forward secrecy and post-compromise security per epoch, authenticated membership, member removal that locks the removed member out of future epochs, and per-room key isolation. We will **not** call this "Signal Protocol", and `known-limitations.md` will say that `ts-mls` is unaudited.

How the pieces map:
- **Account passkey** (WebAuthn): proves who you are to OnePeek. Never used as an encryption key.
- **Device credential**: an MLS signature key pair generated per device. The private key is a non-extractable Web Crypto key where the algorithm allows it. Otherwise it is wrapped by a non-extractable AES key and kept in IndexedDB. We don't claim hardware backing.
- **KeyPackages**: device-uploaded public bundles (the MLS equivalent of prekeys), consumed once.
- **Room access code**: an extra gate. 128-bit random by default, or a 6–8 digit human code. Stored as an Argon2id hash, rate-limited. Never key material.
- **Invite token**: 256-bit random. Only its SHA-256 is stored. It sits in the URL fragment so it never reaches logs or referrers, and is POSTed to the server once.
- **Safety number**: a hash of both members' signature public keys, shown as 60 digits and a QR code. Changes trigger a warning.
- **Attachments**: a random AES-256-GCM file key per file. The ciphertext goes to a private bucket. The key, name and MIME type travel only inside an MLS application message.

Guests: an invite creates an anonymous Supabase session (`signInAnonymously`) plus a fresh device credential. The guest is a real MLS member, scoped to that one room by RLS.

## 4. Data model (Supabase, migration `006_secret_chat.sql`)

Consolidated from the suggested 16 entities. Everything has RLS enabled, deny by default, and writes go through `security definer` RPCs.

- `chat_devices` (id, owner→auth.users, label, signature_pub, created_at, last_seen, revoked_at)
- `chat_passkeys` (credential_id, owner, public_key, counter, transports, created_at, last_used). Only needed if Supabase Auth's native passkey support isn't enabled on the project, which still needs checking
- `chat_key_packages` (id, device_id, key_package bytea, created_at, consumed_at): claimed atomically, one-time
- `chat_rooms` (id, kind quick|secret|business, owner, state active|burned|expired, default_ttl_s, expiry_mode on_send|on_open, max_unopened_s, access_code_hash, created_at, expires_at, burned_at, epoch)
- `chat_members` (room_id, device_id, user_id, role owner|member, nickname_ct, joined_at, removed_at). The nickname is encrypted to the group
- `chat_invites` (id, room_id, token_hash, expires_at, max_uses, uses, requires_approval, revoked_at, created_by)
- `chat_messages` (id uuid client-generated for idempotency, room_id, sender_device, epoch, seq bigint, kind app|commit|welcome, ciphertext bytea, created_at, hard_expires_at)
- `chat_deliveries` (message_id, device_id, delivered_at, opened_at, expires_at). Per-recipient expiry. `opened_at` is set once (`where opened_at is null`), so duplicate reads can't extend expiry
- `chat_attachments` (id, room_id, object_path, size, created_at, expires_at, view_once, revoked_at)
- `chat_security_events` (id, kind, room_id null, device_id null, created_at). No IPs or content, 30-day retention
- `chat_rate_limits` (bucket, key_hash, window_start, count)

## 5. Expiry, enforced on the server
- The server sets `hard_expires_at = least(created_at + max_unopened (7d), room.expires_at)`.
- On open, the `mark_opened(message_id)` RPC sets `opened_at = now()` once and `expires_at = opened_at + ttl` for that recipient. When every recipient's row is expired, the ciphertext row is deleted.
- Reads filter on `now()` in SQL, so client clocks are never trusted. Clients also delete the decrypted copy from memory and IndexedDB when the countdown ends.
- Reaping uses **pg_cron every minute** (`chat_reap()`), plus the Vercel cron as a backstop for storage objects. Both are idempotent.
- Backups: Supabase daily backups and PITR keep ciphertext for up to the retention window (7 days on Pro). It stays undecryptable without device keys, and the docs say this plainly.

## 6. Real-time delivery
Supabase Realtime **Broadcast on private channels** (`room:<id>`), authorized by RLS on `realtime.messages`, carries only "new message id" pings. Clients then fetch ciphertext through RLS. Ordering uses a server-assigned per-room `seq` (sequence or advisory lock in `send_message`). Idempotency comes from the client UUID primary key. Reconnects fetch `seq > last_seen`, and multi-tab sync uses `BroadcastChannel`.

## 7. Environments and blockers
- **Supabase access (blocker):** the "Grokpass" org isn't connected to this session's Supabase connector, and there is no Docker for a local Supabase. Staging needs a **separate Supabase project**, which requires your approval, then Vercel Preview env vars pointing at it. Destructive tests will never run against production.
- **Production release:** only on your explicit go-ahead. The migration is additive (new `chat_*` tables only) and has a rollback script.

## 8. Build order and test gates
1. Tooling: Vitest, Playwright, ESLint, `tsc` in CI, security headers (report-only CSP first)
2. Migration 006, RLS, RPCs, plus SQL tests (RLS and cross-account)
3. Passkeys (SimpleWebAuthn), devices, sessions, revocation
4. MLS adapter + IndexedDB keystore. Tests: round trip, tamper rejection, replay, member removal
5. Rooms, invites, access codes, guest join, rate limits
6. Messaging + Realtime + timers + reaper
7. UI: list, composer, countdowns, Panic Exit, Burn Chat
8. Attachments and view-once
9. Admin dashboard, threat model, remaining docs
10. Playwright with two real browser contexts against staging, then preview deploy and verification
