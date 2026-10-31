# Security review: `mobile/core-crypto/extract-core` (task C1)

Reviewer: security-reviewer, task S0 (first half). Reviewed commit `657516c` against `mobile/integration`
(`git diff mobile/integration...mobile/core-crypto/extract-core`, 18 files). Date: 2026-10-31.

Claim under review: lib/crypto.ts, lib/chat/mls.ts, lib/chat/client.ts and lib/chat/keystore.ts move into
`packages/core` behind the interfaces in `packages/core/src/chat/ports.ts`, with web adapters in
`packages/core/src/adapters/web/` and thin re-exports left in `lib/`, with **zero behaviour change for the
live website**.

Method: whitespace-insensitive diff of each original blob (on `mobile/integration`) against its copy in
`packages/core`; line-by-line read of the new ports, adapters and shims; grep for logging and error paths;
ran `vitest` at the root (5 files, 58 tests, green), `vitest` in `packages/core` (2 files, 19 tests, green),
`tsc --noEmit` for both (clean) and `eslint` in `packages/core` (0 errors, 2 `no-explicit-any` warnings).

## Verdict

**No open high or critical findings.** Two medium findings (both about the keystore becoming
instantiable), four low. None blocks the merge into `mobile/integration`; M1/M2 should be fixed before
C3 (the React Native adapters) builds on `createWebPlatform`-style composition.

## What was verified equivalent (no finding)

1. **client.ts** (`packages/core/src/chat/client.ts` vs the original `lib/chat/client.ts`): `diff -w` shows
   only (a) module functions becoming closures inside `createChatClient`, (b) `sb()`/`rpc()` reading
   `platform.supabase` instead of the `../supabase` singleton, (c) `crypto.randomUUID()` → `env.randomUUID()`,
   `window.location.origin` → `env.origin()`, inline `deviceLabel()` → `env.deviceLabel()`, inline
   `fetch('/api/chat/notify')` → `env.notify()`, `localStorage`/`BroadcastChannel` → `platform.lock`,
   `File` → `FileSource`, `Blob` return → `OpenedFile`, and (d) one `let state` → `const state` in
   `removeMember` (the variable was never reassigned). Specifically unchanged:
   - save-advanced-state-before-`chat_send` (`client.ts:357`, `:379`, `:425`, `:481`);
   - `withRoomLock` coverage: `send`, `sendFile`'s encrypt+send block, `admitPending`, `commitRemovals`,
     `removeMember`, `sendScreenshotAlert`, `sync`'s apply step and the `forgetRoom` on `not_a_member`;
     file upload still happens outside the lock and the state is re-loaded under it;
   - `sync`: `chat_fetch` outside the lock, `applyRows` inside, re-filter on `lastSeq`, `forgetRoom` on
     `not_a_member` and on `removedSelf` (`client.ts:496`–`:575`);
   - view-once: `viewed: true` stored after the claim RPC and before the download (`client.ts:451`), so
     an interrupted download still burns the local view;
   - `markOpened` idempotence (`client.ts:579`).
   No new path leaves MLS state saved with the message unsent or vice versa: the failure windows are the
   same as before (state saved, `chat_send` fails → ratchet step consumed, message not sent; by design).
2. **mls.ts** and **crypto.ts**: byte-identical apart from the header comments.
3. **Keystore sealing format** (`packages/core/src/chat/keystore.ts`): `{ iv: 12 random bytes, ct:
   AES-256-GCM(pack(value)) with AAD = record key, expiresAt? }`, stored under the record key in the
   `sealed` store of IndexedDB `onepeek-chat` v1; `isExpired` keeps the `<=` comparison; `get()` still
   deletes an expired record and returns `null` on decrypt failure. Existing browser data keeps working.
4. **wipe() order** (`adapters/web/keystore.ts:111`–`:115`): cache cleared, `meta.wrap` deleted, then
   `sealed.clear()`. Same as before.
5. **Ports carry nothing new off the device.** `ChatEnv.notify(roomId, accessToken)` (`ports.ts:81`)
   receives exactly what the old inline `fetch` sent (room id + Bearer session token) to the same
   same-origin route (`adapters/web/platform.ts:23`). `LockStore` carries a boolean. `KeyStore` receives
   plaintext MLS state and messages, as `lib/chat/keystore.ts` always did. The invite token is still only
   ever in the `#fragment` (`client.ts:229`) and is sent to the server only as the RPC argument the server
   hashes (`chat_peek_invite`, `chat_redeem_invite`), as before.
6. **Web shims**: `lib/chat/client.ts` re-exports every name the original exported with the same
   signature (`sendFile(roomId, File, ttl, viewOnce)`, `openFile(...) → Promise<Blob>`, `lock()` /
   `isLocked()` sync, `unlock()` async, `keystore` with `get/put/del/delPrefix/keys/sweep/wipe`), plus the
   additive `DeviceRecord` type and port types. `lib/chat/keystore.ts` keeps `get/put/del/delPrefix/
   keys/sweep/wipe` and adds the `keystore` object. The module-level `createWebKeyStore()` and
   `createChatClient(createWebPlatform(...))` touch no `window`/`navigator`/`indexedDB`/`localStorage`
   at import time (all globals are read lazily inside methods), so SSR import is safe. The destructured
   methods are closures and never use `this`. App call sites (`app/chat/page.tsx:20 keystore.sweep()`,
   `app/chat/settings/page.tsx:32,125 chat.keystore.get/wipe`, `app/chat/r/[id]/page.tsx:88`) resolve to
   the same single instance the client uses.
7. **Logging**: no `console.*` anywhere in `packages/core/src` or `lib/chat`; `packages/core/eslint.config.mjs`
   makes `no-console` an error. `ChatError` messages are the same strings as before; no new `ChatError`
   carries a token, key, code or plaintext. `notifyRoom` still swallows every error.
8. **Tests**: `lib/chat/client.integration.test.ts`, `lib/chat/mls.test.ts`, `lib/chat/keystore.test.ts`
   are byte-identical to `mobile/integration` (`git diff --stat` over the three files is empty) and pass
   through the shims, which means `createChatClient`, `createWebPlatform`, `webEnv.origin`/`deviceLabel`,
   `webLock`, `fileSource` and `toBlob` are all exercised end to end (sendFile/openFile, lock/unlock, burn).
   `packages/core/src/adapters/web/keystore.test.ts` runs the original keystore assertions against
   `createWebKeyStore()` directly (non-extractable key, ciphertext at rest, AAD binding, expiry, wipe).
   `packages/core/src/chat/mls.test.ts` is the original with `let`→`const` lint fixes only.

## Findings

### M1 (medium) — Wrapping-key cache is now per instance while the IndexedDB is shared

- File: `packages/core/src/adapters/web/keystore.ts:49-59` (`let wrapKey` inside `createWebKeyStore`),
  `:111-115` (`wipe` clears only its own cache).
- Before this branch the cache was a module singleton, so exactly one in-memory `CryptoKey` ever existed
  per page. Now every `createWebKeyStore()` call owns its own cache but all of them read and write the
  same `onepeek-chat` database.
- Failure scenario: two instances A and B in one page. (a) First use race: both find no `meta.wrap`, both
  `generateKey`, both `put`; the loser keeps sealing MLS state under a key that is no longer on disk.
  After reload every record it wrote is undecryptable, `get()` returns `null`, `loadState` is `null`, the
  device hits `no_local_state` and the room is lost for that device (the ratchet already advanced, so
  the other members never see those messages). (b) Panic Exit / Burn on A (`wipe`) leaves B holding the
  deleted key in memory; B's next `put` writes a record under a destroyed key (same outcome), and B can
  still decrypt anything it kept in memory until the page unloads (same as before for the one instance;
  not a disk-level weakening, so not rated higher). Today the web app creates exactly one instance
  (`lib/chat/keystore.ts` → handed to `lib/chat/client.ts`), so this is latent, not live.
- Fix: cache the wrapping-key promise at module level keyed by DB name (or memoize `createWebKeyStore`
  per DB name), and have `get()`'s catch path drop the cached key and re-read `meta.wrap` once before
  returning `null`. Add a test: two `createWebKeyStore()` instances, `put` on one, `get` on the other,
  then `wipe` on one and `put`/`get` on the other.

### M2 (medium) — `createWebPlatform` silently manufactures a second keystore

- File: `packages/core/src/adapters/web/platform.ts:58`
  (`keystore: opts.keystore ?? createWebKeyStore()`).
- Failure scenario: any caller that builds a platform without passing the app's `keystore` (a future UI
  component, a test, or C3 copying this pattern) gets a second instance over the same IndexedDB and walks
  straight into M1. The optionality buys nothing: the only web caller always passes `ks`.
- Fix: make `keystore` required in `createWebPlatform`'s options (or export a single `webKeyStore`
  constant from the adapter and use it everywhere). With M1 fixed this drops to low.

### L1 (low) — "Core touches no browser globals" is a comment, not a check

- File: `packages/core/tsconfig.json:4` (`"lib": ["es2022", "dom"]`), `packages/core/src/chat/ports.ts:1-4`.
- Failure scenario: a future edit to `packages/core/src/chat/client.ts` that reintroduces `window`,
  `localStorage`, `navigator`, `indexedDB`, `fetch` or `File` compiles and lints clean, and the phones
  find out at runtime; on a phone a stray `fetch` to a relative URL or `localStorage` access is where
  tokens end up in the wrong place.
- Fix: in `packages/core/eslint.config.mjs` add `no-restricted-globals` for `window`, `document`,
  `navigator`, `localStorage`, `sessionStorage`, `indexedDB`, `fetch`, `File`, `Blob`, `BroadcastChannel`
  scoped to `src/chat/**` and `src/crypto.ts` (the adapters directory keeps them). `Blob` is currently used
  in `client.ts` for the storage upload body and in `ports.ts`; either allow it explicitly or move the
  wrapping into the Supabase port.

### L2 (low) — `ChatEnv.notify` hands the session token to the platform; the RN adapter must pin the host

- File: `packages/core/src/chat/ports.ts:81`, `packages/core/src/adapters/web/platform.ts:23`.
- Not a regression: the web adapter posts to the same-origin `/api/chat/notify` exactly as before. But
  the port now makes "where the Bearer token goes" a platform decision. A C3 adapter that builds the URL
  from a configurable base (`EXPO_PUBLIC_API_URL` or similar) would send the Supabase access token to
  whatever that variable says.
- Fix: for C3, hard-code the OnePeek origin in the mobile adapter (no env-driven base URL for the notify
  route), and add a core-level test that `notify` is called with exactly `(roomId, accessToken)` and
  nothing else. Record this in `docs/mobile/plan.md` for the C3 agent.

### L3 (low) — `ChatEnv.origin()` decides where the invite link points

- File: `packages/core/src/chat/client.ts:229`.
- Not a regression (`window.location.origin` was already whatever the page was served from), and the
  token stays in the fragment. But the core now trusts an injected string to build a link that carries a
  bearer-like invite token; a wrong `origin()` on a phone (e.g. a dev tunnel URL left in) would send users
  to share links whose fragment a third-party page could read.
- Fix: C3's `origin()` returns the fixed production origin, not a build-time variable; add a unit test on
  `createInvite` that the link is `${origin}/chat/join#<token>` and the token appears in no RPC argument
  other than `p_token`.

### L4 (low) — `packages/core/package.json` declares no dependencies

- File: `packages/core/package.json`.
- `ts-mls`, `fake-indexeddb` and `vitest` resolve only through root hoisting. Harmless today; when
  `apps/mobile` depends on `@onepeek/core`, a different hoisting layout could pull a different `ts-mls`
  (and transitively `@hpke/core`) than the web app ships, which is exactly the unaudited-library surface
  `docs/secret-chat/known-limitations.md` §2 asks us to keep pinned.
- Fix: list `ts-mls` (same range as the root) under `dependencies` and the test tooling under
  `devDependencies` in `packages/core/package.json`.

## Not findings, noted for the record

- `lib/chat/client.ts` now constructs the client at import. Previously the module-level functions were
  stateless until called; now a `Map` of room locks and a device cache exist per module instance. The
  integration test's `vi.resetModules()` per simulated browser still yields independent clients, as the
  passing suite shows.
- `SupabaseLike` is structural; a test fake is accepted by design. Nothing in the core sends anything to
  the Supabase port that the old code did not (ciphertext, device ids, sequence numbers, the invite token
  and access code as RPC arguments, the session token to `realtime.setAuth`).
- Screenshot-protection copy in `docs/secret-chat/known-limitations.md` §1 is untouched by this branch.
- No RLS/RPC/storage policy or migration changes in this diff.
