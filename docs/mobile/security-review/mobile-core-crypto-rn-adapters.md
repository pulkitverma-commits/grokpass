# Security review: `mobile/core-crypto/rn-adapters` (task C3 + C1 review fixes)

Reviewer: security-reviewer, task S0 (second half). Reviewed commit `8cd58b4` against
`mobile/core-crypto/extract-core` (`git diff mobile/core-crypto/extract-core...mobile/core-crypto/rn-adapters`,
19 files). Date: 2026-10-31. Review branch: `mobile/security-reviewer/review-c3`.

Claim under review: React Native adapters for `packages/core` (`src/adapters/rn/`: SecureStore + SQLite
keystore, quick-crypto installer, env/lock/fileSource/Supabase wrapper), exported only through
`packages/core/src/rn.ts`; the storage port widened to carry raw ciphertext bytes; and the fixes to the C1
findings M1, M2, L1, L2, L3, L4 in `docs/mobile/security-review/mobile-core-crypto-extract-core.md`.

Method: line-by-line read of every file in the diff plus the shared sealing code
(`src/chat/keystore.ts`), the web adapters and `client.ts` upload/download paths; `git diff
mobile/integration -- lib/` (empty: the shims and the three web tests are byte-identical);
`npm test` at the root (5 files, **58/58**) and `vitest run` in `packages/core` (5 files, **50/50**,
`node:sqlite` present on Node 22.22 so the RN keystore suite ran, not skipped); `eslint .` in
`packages/core` (0 errors, 2 pre-existing `no-explicit-any` warnings); ESLint probe files placed in
`src/adapters/rn/`, `src/chat/` and `src/adapters/web/` (then deleted) to confirm the `no-restricted-globals`
scoping; read of `expo-secure-store` 58.0.2 native sources (`ios/SecureStoreModule.swift`,
`android/.../SecureStoreModule.kt`) in `apps/mobile/node_modules` for its null-vs-throw behaviour; read
of `apps/mobile/app.config.ts` for what the app injects.

## Verdict

**No open high or critical findings.** Three medium findings (M1 SecureStore `null` is treated as "never
provisioned" and overwrites the device key; M2 `createRnEnv` accepts any URL for the bearer-token route and
the app currently feeds it an env var; M3 the panic lock fails open on an unreadable flag and `set()` is
not durable before the process dies), six low. None blocks merging into `mobile/integration`. M1 and M2
should be fixed before `mobile-ui` wires the adapters into screens; M3 before the Panic Exit flow ships.
The C1 findings M1, M2, L1, L2, L3, L4 are **fixed** as described below (L3 only inside the core: the
app's config still makes the origin env-driven, see M2 here).

## What was verified (no finding)

1. **Wrapping key** (`src/adapters/rn/keystore.ts:95-118`). Generated with `crypto.getRandomValues(new
   Uint8Array(32))` (AES-256), stored as base64url (`toB64Url`) in expo-secure-store under `onepeek.wrap`
   with `{ keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }` on every `getItemAsync`,
   `setItemAsync` and `deleteItemAsync` (the constant is read from the injected module, so it is the real
   `SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY` at runtime; the test asserts the option object and that
   `requireAuthentication` is unset). Imported with `crypto.subtle.importKey('raw', raw, { name:
   'AES-GCM' }, false, ['encrypt','decrypt'])`: non-extractable; `raw.fill(0)` right after. The bytes are
   never returned, never logged (no `console.*` anywhere in `packages/core/src`; `no-console` is an
   error), never stored outside the closure; the only thing kept is the `Promise<CryptoKey>`. Caveat on the
   "never kept in a JS variable" comment: the base64url `string` (`stored`, and the `toB64Url(raw)`
   argument on first generation) is immutable and lives until GC; unavoidable with a string-valued
   SecureStore API and not a finding.
2. **Sealing format identical to the web.** Both adapters call the same `seal`/`unseal`/`isExpired` in
   `src/chat/keystore.ts`: 12-byte random IV, AES-256-GCM over `pack(value)` with AAD = the record key,
   `expiresAt` beside the record. The RN row is `(key TEXT PK, iv BLOB, ct BLOB, expires_at INTEGER)`;
   `fromRow` copies the BLOBs (`new Uint8Array(r.iv)`, `toArrayBuffer`) before `unseal`. `expires_at` is
   not inside the AAD on either platform (see L4 below; not a regression).
3. **wipe() order** (`keystore.ts:177-181`): cache dropped, `deleteItemAsync(WRAP_KEY_ID)` awaited, then
   `DELETE FROM sealed`. The test `wipe deletes the SecureStore key before any row is deleted` asserts
   the order on the shared call log. If the SQLite delete fails the rows remain as ciphertext under a key
   that no longer exists: `get()` returns `null` for each (verified by `rows captured before a wipe are
   unreadable afterwards`), `keys()` still lists them (see L2).
4. **Cache keyed by SecureStore module object** (`keystore.ts:83-91`): `WeakMap<SecureStoreLike, Map<entry,
   Promise<CryptoKey>>>`. The entry name is the constant `WRAP_KEY_ID`, so two stores cannot collide on
   different entries; two stores over different `dbName`s share one device key by design (one key per
   device). The web counterpart is keyed by the constant DB name. See L1 for the footgun when the app
   passes a wrapper object instead of the module.
5. **Re-read-on-decrypt-failure** (`keystore.ts:139-149`, web `keystore.ts:80-87`). It only re-reads the
   same SecureStore entry the store would read anyway; it cannot make the store "adopt" a key it would
   not otherwise use. An attacker who can write the SecureStore entry can also read it, i.e. has the
   device key already; tampering it makes every existing row unreadable (GCM tag fails, `get()` → `null`)
   and new rows get sealed under the attacker-known key, which is the same outcome as a compromised
   Keychain regardless of this code. An invalid base64url entry makes `importKey` throw (wrong length):
   `put()` rejects loudly, `get()` returns `null`, the cache entry is dropped so the next call retries.
   No silent adoption. The one real hazard in this path is the `null` case, M1 below.
6. **SQLite metadata at rest.** `onepeek-chat.db` holds plaintext record keys (`room:<uuid>:state`,
   `room:<uuid>:msg:<uuid>`, device/room-list keys), `expires_at`, row counts and ciphertext lengths. A
   device dump therefore reveals which rooms exist, how many messages each has, their ids, approximate
   message sizes and expiry times, but no content, names, keys or members. This is the same metadata the
   browser's IndexedDB exposes today (`keys()` is the lookup index on both) and is **acceptable** given
   `native-security` excludes the file from backups (`allowBackup: false` is already in
   `apps/mobile/app.config.ts:41`; the iOS `isExcludedFromBackup` attribute is still N3's job). Hashing
   keys would be a format change for a later version; noted, not required.
7. **Storage port widening** (`ports.ts:65-72`, `client.ts:409-411`). The core uploads the `Uint8Array`
   from `encryptBytes` (IV ‖ ciphertext ‖ tag) as is. `withBlobUploads` (`adapters/web/platform.ts:63-66`)
   rebuilds `new Blob([body], { type: options.contentType })` with `contentType:
   'application/octet-stream'`, which is exactly what `client.ts` used to build inline (`new Blob([blob],
   { type: 'application/octet-stream' })`). `lib/chat/client.ts` constructs the client through
   `createWebPlatform` → `withBlobUploads`, so `lib/chat/client.integration.test.ts` (unchanged) exercises
   the rebuild end to end: the fake bucket stores `new Uint8Array(await body.arrayBuffer())`, asserts no
   plaintext in the object, and the recipient decrypts it, which proves the bytes are the ciphertext
   byte for byte (a changed byte fails the GCM tag). Download: `BinaryBody.arrayBuffer()`; a browser
   `Blob` satisfies it unchanged.
8. **`bodyToArrayBuffer`** (`adapters/rn/platform.ts:118-158`). Order: `ArrayBuffer` / `Uint8Array` pass
   through; `arrayBuffer()` if present (its throw falls through); `FileReader.readAsArrayBuffer`; then
   `readAsDataURL` + `base64Decode`. Nothing can return truncated data silently *to the user*: the result
   is fed to `decryptBytes` and a short, padded-out or garbage buffer fails the GCM tag and surfaces as
   `ChatError('gone')`/decrypt failure. `base64Decode` strips non-alphabet characters (so padding and
   whitespace), never indexes `-1`, and a data URL without a comma decodes the whole string, which again
   fails the tag. The decoded length reveals nothing the server did not already know (ciphertext length).
   No plaintext ever passes through this function.
9. **RN env** (`platform.ts:24-47`). `origin()` is the injected `siteUrl` with trailing slashes
   stripped, used verbatim for `${origin}/chat/join#<token>` (test: the origin never appears in an RPC
   argument, the token only in `p_token`). `notify()` posts `{ room }` with `Authorization: Bearer
   <accessToken>` to `${apiBaseUrl}/api/chat/notify`, nothing else (tests assert the exact URL, headers
   and body, and that the client calls `env.notify` with exactly `(roomId, accessToken)`); best effort,
   never throws. Where those two URLs come from is M2.
10. **`installRnCrypto` / `assertSubtleSupport`** (`adapters/rn/crypto.ts`). Lazy `require` of
    `react-native-quick-crypto`, calls its own `install()`; nothing in `packages/core` implements AES, key
    generation, HKDF or signatures in JS, and nothing catches a missing `subtle` method to substitute a JS
    path: a missing method throws `TypeError` at the call site. `assertSubtleSupport` checks
    `getRandomValues`, `randomUUID` and nine `subtle` methods and names every missing one (tested). It is
    *not* called by `installRnCrypto` (see L5).
11. **C1 fixes.**
    - **M1 (web)**: `adapters/web/keystore.ts:45-64` module-level `Map<dbName, Promise<CryptoKey>>`;
      `get()` drops the cache and re-reads `meta.wrap` once on decrypt failure; `wipe()` deletes the
      shared cache entry. The new test `two instances in one page share one wrapping key and survive a
      wipe on either` **does** cover the first-use race: `beforeEach` wipes (cache empty), then
      `Promise.all([a.put, b.put])` runs both `wrappingKey(DB)` calls synchronously in the same tick before
      any `await` resolves, so the second call must find the first's promise or two keys would be
      generated; the `meta` store is asserted to hold exactly one `wrap`; then `a.wipe()` followed by
      `b.put` / `a.get` proves `b` re-reads rather than sealing under the destroyed key. The same test
      exists for RN (`two instances over the same SecureStore...`, asserting one `secure.set`).
    - **M2**: `createWebPlatform` and `createRnPlatform` both require `keystore` (type-level; RN also
      throws without a lock source).
    - **L1**: `eslint.config.mjs` restricts `window, navigator, localStorage, indexedDB, fetch, File,
      BroadcastChannel` in `src/chat/**` + `src/crypto.ts`, and `window, navigator, indexedDB,
      localStorage, File, Blob` in `src/adapters/rn/**`. Probe result: all fire, including in
      `*.test.ts` under `rn/`; nothing fires in `adapters/web/` (correct). Gaps in L6.
    - **L2/L3**: tests exist (see 9); the core-level requirement is met, the app-level one is M2.
    - **L4**: `ts-mls@^1.6.4` declared in `packages/core/package.json`.
12. **No RLS/RPC/storage policy, migration, deep-link, share-intent, URL-fragment or MLS state-handling
    changes** in this diff. `withRoomLock` coverage in `client.ts` is unchanged (the only edit is the
    upload body on line 411). Screenshot-protection copy untouched.

## Findings

### M1 (medium) — A `null` from SecureStore is read as "no key yet" and silently replaces the device key

- File: `src/adapters/rn/keystore.ts:100-106` (`if (stored) {...} else { raw = getRandomValues; await
  setItemAsync(...) }`), reached from `put()` and from `get()`'s retry (`:146-147`).
- `expo-secure-store` returns `null`, not an error, in several "the key exists but cannot be read right
  now" situations. Android (`SecureStoreModule.kt:136-168`, v58.0.2): Keystore entry missing → **deletes
  the item** and returns `null`; `KeyPermanentlyInvalidatedException` → `null`; `BadPaddingException` →
  deletes and returns `null`. iOS throws for every status except `errSecItemNotFound`, which is fine, but
  the adapter cannot tell the platforms apart.
- Failure scenario: on Android the Keystore key backing SecureStore is invalidated or missing (Keystore
  reset, vendor bug, app data transferred). The next `put()` (or any `get()` of an existing row) gets
  `null`, generates a fresh key and **overwrites** `onepeek.wrap`. Every sealed row (MLS group state for
  every room, the signing key, message history) is now permanently unreadable while `keys()` still lists
  it: `loadState` → `null` → `no_local_state` in every room; the ratchets have advanced so the device is
  out of all its groups and the other members never learn why. Nothing is logged, no error surfaces, and
  the user sees empty rooms. This is a durable self-wipe triggered by a transient platform condition, and
  it also means the copy-protection story ("a copied database is useless") has an unintended inverse: a
  device can lose its own data without anyone wiping it.
- Fix: distinguish "never provisioned" from "unreadable". Cheapest: before generating, check whether
  `sealed` has any rows (`SELECT 1 FROM sealed LIMIT 1`); if it does and SecureStore returned `null`,
  throw a typed error (`keystore_unavailable`) instead of generating, and let the app offer an explicit
  `wipe()` (which is the only path that may generate a replacement while rows exist). Alternatively keep a
  non-secret marker row (`meta(wrap_present=1)`) written in the same `put` that first stores the key. Add
  a test: SecureStore mock returns `null` for `onepeek.wrap` while `sealed` has rows → `put` rejects,
  `secure.set` is **not** called, `wipe()` then succeeds and a later `put` provisions a new key.

### M2 (medium) — `createRnEnv` accepts any `siteUrl`/`apiBaseUrl`, and the app currently feeds it an env var

- File: `src/adapters/rn/platform.ts:24-27` (`origin`, `notifyUrl` built from the options with no
  scheme or host check); `apps/mobile/app.config.ts:73` (`siteUrl: process.env.EXPO_PUBLIC_SITE_URL ??
  'https://onepeek.io'`); `docs/mobile/test-plan.md` §1.3 ("`origin()` is `Constants.expoConfig.extra.siteUrl`").
- The C1 review (L2, L3) asked for the mobile origin and notify host to be **constants, not build-time
  variables**. The adapter makes them injectable (correct for testability), but validates nothing, and
  the one existing app config already makes the origin env-driven with a default; `apiBaseUrl` will
  presumably follow the same pattern.
- Failure scenario: a dev or EAS build with `EXPO_PUBLIC_SITE_URL=https://tunnel.example` (or an
  `http://` value, or a typo) ships `notify()` posting the **Supabase session token** as a bearer to a
  third party on every send, and invite links whose fragment carries the invite token pointing at that
  host. Nothing in the core or tests catches it; `notify()` swallows every error so the leak is silent.
- Fix (two layers): (1) in `createRnEnv`, throw at construction unless both URLs parse, use `https:`, and
  the host is `onepeek.io` or a subdomain (an allowlist constant in the adapter; tests may pass
  `https://x` today and should move to `https://test.onepeek.io`); (2) requirement for `mobile-ui` /
  `native-security`: `siteUrl` and `apiBaseUrl` are string literals in the app entry (`https://onepeek.io`),
  not read from `expo-constants`/`process.env`, and `app.config.ts:73` drops the env override. Record in
  `docs/mobile/plan.md` so the test-plan line is corrected too.

### M3 (medium) — The panic lock fails open on an unreadable flag and is not durable before exit

- File: `src/adapters/rn/platform.ts:58-82` (`createRnLockStore`): `getItemAsync(LOCK_ID).catch(() => {
  /* stay unlocked */ })`; `set()` fires `void setItemAsync(...)` and returns.
- Failure scenario A (fail open): the flag is stored with SecureStore's default accessibility
  (`WHEN_UNLOCKED`, since no options are passed). A launch while the device is locked (background push,
  Android `receiver`, iOS prewarm) makes the Keychain read fail; the catch leaves `locked = false` and the
  instance never re-reads. When the user unlocks the phone and opens the app, a lock they set is gone.
  Failure scenario B (lost write): Panic Exit sets the flag and immediately backgrounds or kills the
  process; the un-awaited `setItemAsync` may not have landed, so the relaunch is unlocked. On the web the
  `localStorage` write was synchronous, so this is a regression relative to the browser behaviour the UI
  copy promises.
- The wrapping key is `THIS_DEVICE_ONLY`, so nothing is decryptable while the phone itself is locked; this
  is about the app-level cover after the phone is unlocked, which is what the user pressed Panic for.
- Fix: default to **locked** when the read fails (the app can call `clear()` after biometric unlock), or
  re-read on foreground; store the flag with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` like the key (also answers
  the backup question: a `WHEN_UNLOCKED` flag can ride an encrypted backup to a new device, where it would
  only make the app start locked over an empty keystore, harmless, but consistency is cheaper than
  reasoning about it); and make durability available to the UI: expose the write promise (`set(): Promise`
  or `persisted`) and have Panic Exit await it before exiting, or use expo-secure-store's synchronous
  `setItem` for the flag. Add tests for both scenarios.

### L1 (low) — The RN wrapping-key cache is only shared when the app passes the same module object

- File: `src/adapters/rn/keystore.ts:83` (`WeakMap<SecureStoreLike, ...>`).
- If `mobile-ui` wraps the module (`{ ...SecureStore }`, a per-screen adapter object, a mock in a
  storybook) and creates more than one store, the instances no longer share a cache and the C1 M1 race
  returns: both read `null`, both generate, the loser's rows are unreadable after the next launch.
- Fix: state the requirement in the function's doc comment ("pass the `expo-secure-store` module itself;
  one `createRnKeyStore` per app"), or key the cache on `WRAP_KEY_ID` alone (module-global, like the web
  adapter) and give tests an explicit `resetWrapCache()` export instead of relying on distinct mocks.

### L2 (low) — After an interrupted `wipe()`, `keys()` still advertises rooms whose rows are dead

- File: `src/adapters/rn/keystore.ts:177-181`; same shape on the web.
- Failure scenario: SecureStore delete succeeds, `DELETE FROM sealed` fails (disk full, process killed).
  The data is unreadable (good), but `myRooms`/room lists built from `keys()` show rooms whose `get()`
  returns `null`, and the metadata in 6 above outlives the burn. Also, the first `get()` after that
  provisions a brand-new key as a side effect of a read (benign, but surprising).
- Fix: on launch, if `onepeek.wrap` is absent and `sealed` is non-empty, run `DELETE FROM sealed` before
  anything else (a "finish the wipe" step), ideally alongside the M1 check since both need the same
  `SELECT 1 FROM sealed LIMIT 1`.

### L3 (low) — Narrow race between `forgetWrap()` and `deleteItemAsync` in `wipe()`

- File: `src/adapters/rn/keystore.ts:178-179`; web `keystore.ts:124-125`.
- A `put()` that calls `wrap()` between the cache drop and the SecureStore delete re-reads the **old**
  key, caches it, and seals under a key that is deleted a moment later; `get()` of that row then returns
  `null` and the retry path replaces the cache. Harmless for confidentiality (the record is simply lost),
  but it defeats the "every instance re-reads after a wipe" guarantee for that one write.
- Fix: call `forgetWrap()` again after `deleteItemAsync` resolves (and after `s.delete('wrap')` on the
  web). Two lines.

### L4 (low) — `expires_at` is outside the authenticated data (both platforms; not a regression)

- File: `src/chat/keystore.ts:35-38` (AAD = record key only); `src/adapters/rn/keystore.ts:130` stores
  `expires_at` as a plain column.
- An attacker with write access to the SQLite file (same privilege as reading it; rows stay ciphertext)
  can clear `expires_at` to keep a view-once or timed record alive past its expiry, or set it to force
  early deletion. Identical to the browser record format, and the server enforces its own expiry, so this
  is a local-only integrity gap.
- Fix (format v2, when there is a reason to bump): include `expiresAt` in the AAD (`key\0expiresAt`) and
  keep reading v1 rows. Note it in `docs/secret-chat/known-limitations.md`.

### L5 (low) — `installRnCrypto()` does not verify what it installed; `atob`/`btoa` are assumed

- File: `src/adapters/rn/crypto.ts:21-27`, `:36-47`; `src/crypto.ts:12,18` (`btoa`/`atob` used by
  `toB64Url`/`fromB64Url`, which the RN keystore now calls for the wrapping key).
- `assertSubtleSupport` is documented as "worth calling in development builds". If `installRnCrypto()` is
  skipped or ordered after a core import, Expo's `expo-crypto` polyfill (if present) supplies
  `getRandomValues`/`randomUUID` but no `subtle`; the first AES call throws, which is the right outcome
  but surfaces as an unhelpful `TypeError` deep in `seal()`. No JS fallback exists in the core, so the
  production rule holds; this is about making the failure loud and early. `atob`/`btoa` exist on Hermes
  only from RN 0.74; the keystore depends on them.
- Fix: call `assertSubtleSupport()` at the end of `installRnCrypto()` unconditionally (it costs nothing),
  and add `atob`/`btoa` to the checked list.

### L6 (low) — `no-restricted-globals` gaps

- File: `packages/core/eslint.config.mjs:32-49`.
- Confirmed firing (probe files): `window`, `Blob`, `navigator` in `src/adapters/rn/**` including tests;
  `fetch`, `window` in `src/chat/**`; nothing in `src/adapters/web/**`. Not caught: `globalThis.window`
  (any `globalThis.*` access, by design of the rule), `document`, `sessionStorage`, `FileReader`,
  `XMLHttpRequest` in `rn/`; `document`, `sessionStorage`, `Blob` in `chat/` (`Blob` is deliberately
  allowed there because `ports.ts` keeps it in the upload union).
- Fix: add `document`, `sessionStorage`, `XMLHttpRequest` to both lists; add a `no-restricted-syntax`
  selector for `MemberExpression[object.name='globalThis'][property.name=/^(window|document|localStorage|indexedDB)$/]`.
  `FileReader` is used via `globalThis.FileReader` on purpose in `platform.ts:131`; leave it.

## Tests: what they prove and what they cannot (for C2)

- **Would any test pass if sealing were skipped?** No. `stores only ciphertext at rest`, `the SQLite file
  holds only ciphertext...` (plaintext, hex, base64, base64url and the wrapping-key bytes all absent), `a
  copied database is unreadable without the device SecureStore entry` and `a record moved to another key
  fails to decrypt` each fail without AES-GCM with the key as AAD. The ordering, lock, env and fileSource
  tests are independent of sealing by design.
- **Gaps the Node mocks cannot close (C2 device checklist):**
  1. expo-sqlite BLOB round trip: `Uint8Array` bind in `runAsync`, and the type `getFirstAsync` returns
     for `iv`/`ct` (`fromRow` copies defensively but assumes array-like input).
  2. react-native-quick-crypto `importKey('raw', ..., false, ...)`: that the key is non-extractable
     (`exportKey` rejects) **and that it copies the input**: `raw.fill(0)` runs right after import; if
     quick-crypto kept a view on the buffer, every seal would use an all-zero key. Test on device: seal,
     zero, unseal, and compare against a vector sealed with a known key.
  3. expo-secure-store returning `null` vs throwing on a locked Keychain / invalidated Keystore (M1), and
     that `WHEN_UNLOCKED_THIS_DEVICE_ONLY` is actually set on the item (inspect the simulator Keychain).
  4. `atob`/`btoa`, `TextEncoder`/`TextDecoder`, `crypto.randomUUID` on Hermes (L5).
  5. RN `Blob`/`FileReader` behaviour for `bodyToArrayBuffer` on the supabase-js version the app pins
     (the fallback chain is only exercised with a fake `FileReader`).
  6. SecureStore value size: the 43-char key is far under the 2048-byte iOS warning threshold; confirm no
     truncation on Android `EncryptedSharedPreferences`.
- **Unit-level additions worth making now:** assert `iv.length === 12` and IV uniqueness across two
  `put`s of the same key; spy `crypto.subtle.importKey` to assert `extractable === false` (the web suite
  has the equivalent `exportKey` rejection test, the RN suite has none); the M1 and M3 scenarios above.
- **Test-isolation note (not a finding):** the web cache is keyed by DB name, not by the `indexedDB`
  object. `lib/chat/client.integration.test.ts` swaps `globalThis.indexedDB` per simulated browser and
  stays correct only because `vi.resetModules()` gives each browser its own `keystore.ts` module instance.
  Keep that `resetModules()`; a future test that reuses modules across browsers would share one key.

## Not findings, noted for the record

- Record keys, `expires_at` and ciphertext lengths in `onepeek-chat.db` are plaintext metadata (see 6);
  accepted with backup exclusion.
- `delPrefix` and `keys()` load every key and delete row by row without a transaction; a kill mid-way
  leaves a partial prefix delete, which the next `forgetRoom`/`sweep` repeats harmlessly.
- `createRnPlatform` passes its whole options object to `createRnEnv`; only `siteUrl`, `apiBaseUrl`,
  `deviceLabel`, `fetch` are read.
- `wrapRnSupabase` and `withBlobUploads` forward `auth`, `realtime`, `rpc`, `channel` by reference;
  nothing new is sent to Supabase (ciphertext bytes instead of a Blob of the same bytes).
- The `lib/` shims and `lib/chat/*.test.ts` are byte-identical to `mobile/integration`.

Verdict line: **No open high or critical findings; 3 medium (M1 SecureStore null → key overwrite, M2
unvalidated bearer/invite URLs + env-driven siteUrl in app config, M3 panic lock fail-open/non-durable),
6 low; merge to `mobile/integration` OK, fix M1–M3 before `mobile-ui` wiring.**
