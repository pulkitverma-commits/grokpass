# Security review: `mobile/core-crypto/review-fixes-2` (fixes for S0b M1–M3, L1–L6)

Reviewer: security-reviewer, task S0 verification. Reviewed commits `1b021e1` (the fixes, merged into
`mobile/integration` as `86609bf`) and `024ffbd` (interop test follow-up) against the findings in
`docs/mobile/security-review/mobile-core-crypto-rn-adapters.md`. Date: 2026-10-31. Review branch:
`mobile/security-reviewer/verify-s0b`.

Method: `git show 1b021e1` / `git show 024ffbd`; full read of the resulting
`packages/core/src/adapters/rn/{keystore,platform,crypto,index}.ts`, `adapters/web/keystore.ts`,
`chat/keystore.ts`, `eslint.config.mjs`, the three RN test files, `test/rn-mocks.ts` and
`test/interop.integration.test.ts`; `apps/mobile/app/{_layout,index,spike}.tsx` and `app.config.ts`;
`expo-secure-store` 58.0.2 in `apps/mobile/node_modules` (`build/SecureStore.js`,
`ios/SecureStoreModule.swift`, `android/.../SecureStoreModule.kt`, `encryptors/AESEncryptor.kt`); the web
`app/chat/join/page.tsx` and `app/api/chat/notify/route.ts`. Runs: `vitest run` in `packages/core`
**87/87** (6 files; `node:sqlite` present on Node 22.22, so the RN suites ran), root `npm test` **58/58**
(5 files) then the core 87 again via the workspace script, `eslint .` in `packages/core` 0 errors (the same
2 pre-existing `no-explicit-any` warnings), ESLint probe files for L6 (placed in `src/adapters/rn/`,
`src/chat/`, `src/adapters/web/`, then deleted; the worktree is clean).

## Verdict

**S0 closed: no open high or critical findings.** All nine S0b findings are fixed in the core; two have a
documentation remainder (M2 test-plan line, L4 known-limitations note). The fixes introduce **one new
medium** (N1: the Phase 0 spike screen wipes the device-wide wrapping key, and more generally two
`createRnKeyStore` instances over different database files under the same SecureStore entry defeat the
M1 guard) and **three new low** (N2 stale `wiping` marker, N3 no re-read path on the fail-closed lock,
N4 `keystore_unavailable` recovery is not in the plan for `mobile-ui`). None blocks Gate 0; N1 is a
one-line change in `app/spike.tsx` and should land before any screen opens `onepeek-chat.db`.

## Status of the S0b findings

| # | Status | Evidence (test that fails without the fix) |
|---|--------|--------------------------------------------|
| M1 | **fixed** | `keystore.ts:120-140, 164-177`: `wrappingKey` calls `onMissing()` before generating; `onMissingKey` runs `SELECT 1 FROM sealed LIMIT 1` and throws `ChatError('…: keystore_unavailable')` when rows exist and no `wiping` marker is set. `get()` awaits `wrap()` outside the decrypt-retry `try` (`:194`) so the error propagates instead of reading as "this row is undecryptable". Tests `M1: key missing but rows present → keystore_unavailable, rows kept, no key written; wipe() recovers` (asserts no `secure.set`, row still present, `wipe()` then `put` provisions exactly once), `M1: the decrypt-failure retry path cannot provision either`, `a copied database is unreadable on another device: keystore_unavailable, never a silent new key` (`otherSecure.items.size === 0`). `ChatError.code` is derived from the trailing `[a-z_]+` of the message (`client.ts:61`), so `code === 'keystore_unavailable'` holds. |
| M2 | **fixed** (core); app config pinned; **doc remainder** | `platform.ts:40-57`: `checkOnePeekUrl` requires an absolute URL, `https:` to `onepeek.io` or `www.onepeek.io` with no explicit port (443 only), no credentials, pathname `/` or empty, no query/fragment; `http://localhost` / `127.0.0.1` only with `allowInsecureDev: true`; `apiBaseUrl` defaults to the validated `siteUrl`; error text names the option, not the value. Tests `M2: accepts https://onepeek.io and https://www.onepeek.io…`, `M2: rejects at construction anything that is not https to onepeek.io` (15 cases incl. suffix trick, host-in-path, subdomain, port, credentials, path, query, fragment, `javascript:`), `M2: allowInsecureDev admits http://localhost and 127.0.0.1 only…`. `apps/mobile/app.config.ts:73-75` now hard-codes `siteUrl: 'https://onepeek.io'` (env override dropped) with a comment citing S0b M2. Remainder: `docs/mobile/test-plan.md:158-159` still says the app passes `Constants.expoConfig.extra.siteUrl`; the S0b fix asked for a string literal in the app entry and the test-plan line corrected. The app does not yet call `createRnEnv` anywhere, so this is `mobile-ui`'s wiring; with the allowlist in the core an OTA or `extra` change can at most flip apex ↔ www. |
| M3 | **fixed** | `platform.ts:104-135`: `locked = true` until `apply()` runs; sync `getItem` read in the constructor when present (`try/catch` → stay locked), else `getItemAsync(...).then(apply, stay locked)`; `set()` flips memory first, then `setItem` (sync) with async fallback, `pending` exposed; flag stored `{ keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY }`. Tests `M3: reports locked until the flag has been read, and stays locked when the read throws` (async and sync variants), `M3: with a synchronous SecureStore the flag is on disk before set() returns`, `M3: without the sync API, pending resolves once the write has landed and the flag is THIS_DEVICE_ONLY`, `M3: a failing sync write falls back to the async one, and pending never rejects`. See (c) below for the native confirmation. |
| L1 | **fixed** | `keystore.ts:107`: `const wrapKeys = new Map<string, Promise<CryptoKey>>()` keyed on the entry name, module-global; `resetWrapCache()` exported for tests. Test `two instances share one wrapping key, however the module object is passed, and survive a wipe on either` passes `{ ...secure.module }` (a spread copy) to the second instance and asserts one `secure.set`. See N1 for the flip side of a global cache. |
| L2 | **fixed** (with N2) | `wipe()` writes `meta.wiping = '1'` before `deleteItemAsync`, clears it after `DELETE FROM sealed`; `onMissingKey` finishes an interrupted wipe when the marker is set. Tests `L2: key deleted but the row delete failed → the next launch finishes the wipe and provisions` (uses `sqlite.failOnce`), `L2: without the wiping marker, missing key + rows is NOT treated as a wipe`, and `wipe makes everything unreadable and removes it` asserts `meta` is empty afterwards. |
| L3 | **fixed** (RN and web) | `keystore.ts:238` second `forgetWrap()` after the SecureStore delete; `web/keystore.ts:128` second `wrapKeys.delete(DB)` after `s.delete('wrap')`. Test `L3: a put() racing the SecureStore delete inside wipe() cannot leave the old key cached` parks `deleteItemAsync` via `hooks.beforeDelete`, runs a `put` that re-caches the old key, and asserts the next `put` provisions a new key (one `secure.set`) and the row reads back. No web test for the second drop; two lines, read-verified. |
| L4 | **fixed** (comment); **doc remainder** | `chat/keystore.ts:34-42` documents that `expiresAt` is outside the AAD and names the v2 shape. `docs/secret-chat/known-limitations.md` has no entry for it (grep `expires`/`AAD` empty); the S0b fix asked for one. Low; add a line when that file is next touched. |
| L5 | **fixed** | `crypto.ts:22-27`: `installRnCrypto` calls `load().install()` then `assertRuntimeSupport()` and only then sets `installed = true`; `assertRuntimeSupport` checks `atob`, `btoa`, `TextEncoder`, `TextDecoder` plus the full crypto list in one error. Tests `assertRuntimeSupport (L5) > lists the missing base64 / text codecs and crypto pieces in one error`, `installRnCrypto (L5) > verifies what the installer left behind and does not count a failed install as installed` (a broken installer is retried; a good one is idempotent). `_layout.tsx:8` calls it at module level; no module in `packages/core/src` touches `crypto` at top level (grep for top-level `crypto.` empty), so import hoisting does not defeat the ordering. |
| L6 | **fixed** | `eslint.config.mjs:30,43`: `document`, `sessionStorage`, `XMLHttpRequest` in both restricted lists; `:50-63` `no-restricted-syntax` for `globalThis.(window|document|localStorage|sessionStorage|indexedDB|XMLHttpRequest)` in `src/chat/**`, `src/crypto.ts`, `src/adapters/rn/**`. Probe result: all five constructs fire in `rn/` and in `chat/` (10 errors), `globalThis.FileReader` and `globalThis.fetch` pass (deliberate), nothing fires in `adapters/web/`. |

Nothing regressed: the 50 pre-existing core tests and the 58 root tests pass unchanged; the 20 interop
scenarios pass with the per-device entry name (see (e)).

## Questions asked of this review

### (a) Can `keystore_unavailable` fire on a healthy device and lock the user out?

`onMissingKey` runs only when `getItemAsync` resolves `null`. Reading the 58.0.2 native sources:

- **iOS** (`SecureStoreModule.swift:77-96, 160-185`): `searchKeyChain` returns `nil` only for
  `errSecItemNotFound`; every other status, including `errSecInteractionNotAllowed` (device locked,
  before first unlock, prewarm), **throws** `KeyChainException`. A throw rejects the `wrappingKey`
  promise, `p.catch` evicts it from the cache (`keystore.ts:138`), and the caller sees the raw error, not
  `keystore_unavailable`; the next call retries. So a locked iPhone cannot trigger M1's path. A restore to
  a new device drops the `ThisDeviceOnly` item → genuine `null` → the restored `onepeek-chat.db` rows
  (if the N3 backup exclusion were missing) are unreadable in any case; refusing is the right answer and
  `allowBackup`/N3 keep the file out of backups anyway.
- **Android** (`SecureStoreModule.kt:88-176`): `null` is returned when (1) the SharedPreferences entry is
  absent, (2) the entry exists but the Keystore alias is gone (reinstall; **the entry is deleted** first),
  (3) `KeyPermanentlyInvalidatedException` (only for auth-bound keys; the wrapping key is stored with
  `requireAuthentication` unset, `AESEncryptor.kt:64` → `setUserAuthenticationRequired(false)`, so not
  reachable), (4) `BadPaddingException` (key regenerated under the entry; entry deleted, `null`). Keystore
  daemon or transient failures surface as `GeneralSecurityException` → `DecryptException` → **throw**, not
  `null`. SharedPreferences live in credential-encrypted storage, so the app does not run before first
  unlock (not direct-boot aware). Every `null` path on Android is therefore permanent: the bytes behind
  the entry are gone and the rows were already undecryptable.

Conclusion: on a healthy device `null` means "never provisioned" or "the key is really gone"; it is not
transient on either platform in this version. The fix converts a silent self-wipe into a loud refusal
with no loss that was not already final. Recovery: only `wipe()` re-provisions; this is stated in the
module header (`keystore.ts:20-27`) and the `createRnKeyStore` doc comment, but nowhere in
`docs/mobile/plan.md` or the test plan does `mobile-ui` get told to catch `ChatError.code ===
'keystore_unavailable'` and offer "Reset this phone's chats" (N4). Also note the only other way to clear
the state is reinstalling the app, which deletes both the Keystore alias and the file.

### (b) The `meta.wiping` marker

- **Attacker with a copied database plus marker on a fresh install**: the fresh install has no key →
  `onMissingKey` → rows exist → marker set → `DELETE FROM sealed`, then provision. Wipe semantics; the
  rows were unreadable without the source device's SecureStore entry. Fine, as the task notes.
- **Can a marker make a live device discard real data?** The marker is consulted only when SecureStore
  returned `null`. With a healthy key (`stored` truthy, `keystore.ts:126`) the marker is never read, so an
  attacker who can write the SQLite file but not the Keychain/Keystore cannot trigger a wipe; and if the key
  is gone the rows are already dead, so finishing the wipe loses nothing readable. No real-data loss path.
- **Stale marker (N2, low)**: `wipe()` clears the marker in a separate statement after `DELETE FROM
  sealed` (`:239-240`). If the process dies between the two, the table is empty and `wiping = '1'`
  stays. On the next launch `onMissingKey` sees no rows and returns without clearing it (`:168`). Months
  later, after rows accumulate under the new key, a genuine Android key loss would be treated as "finish
  the wipe" and delete rows silently instead of raising `keystore_unavailable`. The data is equally
  unreadable either way, so this only downgrades the M1 signal from loud to silent in a rare double
  failure. Fix: clear the marker whenever `onMissingKey` finds no rows, or run the two deletes in one
  statement/transaction (`DELETE FROM sealed; DELETE FROM meta WHERE k='wiping'` via `execAsync`).

### (c) M3 lock: `get()` is true until read; sync `getItem`/`setItem` in expo-secure-store 58

Confirmed in `apps/mobile/node_modules/expo-secure-store/build/SecureStore.js:114-137`: `setItem` →
`ExpoSecureStore.setValueWithKeySync`, `getItem` → `ExpoSecureStore.getValueWithKeySync`; both native
modules define them (`SecureStoreModule.swift:23,35` as `Function(...)`, `SecureStoreModule.kt:46,53`
as `Function(...) { runBlocking { ... } }`), so in the real app the constructor's `typeof
secureStore.getItem === 'function'` branch runs: the flag is read synchronously and `get()` is accurate
before `createRnPlatform` returns (no "true until read" window in production; the async branch is only
for mocks or older module shapes). There is no synchronous delete in 58 (`deleteItemAsync` only), so
`clear()` is async by design; a lost clear re-locks on relaunch, i.e. fails closed.

When the device is locked: iOS `getValueWithKeySync` hits `errSecInteractionNotAllowed` and **throws**
(`KeyChainException`), which the constructor catches → `locked` stays `true`. Android cannot run before
first unlock (CE storage); after that the Keystore key has no auth requirement, so reads succeed. For
`set()`: `setValueWithKeySync` is `SecItemAdd`/`SecItemUpdate` on iOS and `runBlocking { encrypt + commit }`
on Android; Panic Exit happens with the app in the foreground (device unlocked), so the sync write lands
before `set()` returns, which is what the UI copy promises. Caveat (N3): there is no `reload()`; a store
that started locked because the Keychain was unavailable stays locked until the app calls `clear()` after
its own unlock gate, which `mobile-ui` must know (a background launch while locked will show the lock
screen on the next foreground even if Panic was never pressed; acceptable fail-closed behaviour, but it
needs to be in the plan).

### (d) M2: `www.onepeek.io` vs `onepeek.io`

Both are in `ALLOWED_HOSTS`; the app passes the apex only (`app.config.ts:75`) and `apiBaseUrl` defaults
to it, so in the shipped configuration neither the bearer nor the links ever use `www`. Consistency with
the web: `app/chat/join/page.tsx` reads `window.location.hash` and works on whichever host serves the Next
app; the web's `origin()` is `window.location.origin` (`adapters/web/platform.ts:16`), so a browser on
`www` mints `www` links and the phone's Universal Links / App Links accept both hosts
(`app.config.ts:23, 48-51`). If Vercel redirects `www` → apex (no redirect is in the repo; it would be
dashboard-level), browsers carry the `#token` fragment across a redirect whose `Location` has none, so
join links stay valid; a redirected `POST /api/chat/notify` would only degrade to a 405/GET on the same
operator's host (no token leak, and `notify()` is best effort). Allowing `www` therefore widens nothing;
dropping it to the apex alone would be marginally tighter but would break links minted by a web user on
`www`. Fine as is.

### (e) Interop test: `wrapKeyId` per simulated phone (`024ffbd`)

Necessary consequence of L1: with a process-global cache per entry name, two simulated phones in one
Node process would otherwise share one wrapping key and the second phone's `put` would never touch its
own SecureStore mock. The change keeps every assertion: `secureDump` still asserts no fixture, token,
code or signing key appears in SecureStore values; `wrapKeyBytes(d)` reads the per-device entry so the
"wrapping key bytes appear nowhere in SQL, DB dump, objects or SQLite" sweep still has a real key to look
for; the "SecureStore holds only wrap + lock" check became `k === d.wrapKeyId || k === LOCK_ID`, same
strength. The entry name now embeds the device's user id, which is not a secret. What the interop no
longer exercises is the default `WRAP_KEY_ID` name, which `keystore.test.ts` covers (`secure.items.has
(WRAP_KEY_ID)`, `secure.setOptions.get(WRAP_KEY_ID)`). No weakening. Note that `wrapKeyId` is a public
option in the production API (`index.ts:4-6` exports `RnKeyStoreOptions`); its doc says "the app leaves it
alone", which is fine, but see N1 for why the spike should in fact use it.

### (f) The app: `_layout.tsx` and `spike.tsx`

`_layout.tsx` calls `installRnCrypto()` at module scope before rendering; with L5 a missing primitive now
throws at launch with a full list. `index.tsx` links to the spike only under `__DEV__`. `spike.tsx` opens
`createRnKeyStore({ secureStore: SecureStore, sqlite: SQLite, dbName: 'onepeek-spike.db' })`: it never
opens `onepeek-chat.db`, so it cannot read or write chat rows, and it calls `ks.wipe()` after its two
round trips, which deletes its rows and marker. **But** it uses the default `WRAP_KEY_ID`, so its
`wipe()` deletes the device-wide `onepeek.wrap` entry: see N1.

## New findings

### N1 (medium) — The spike's `wipe()` destroys the device-wide wrapping key; two databases under one entry defeat the M1 guard

- File: `apps/mobile/app/spike.tsx:79, 89` (`createRnKeyStore({..., dbName: 'onepeek-spike.db'})` with the
  default entry, then `ks.wipe()`); root cause in `packages/core/src/adapters/rn/keystore.ts:107,
  147-153, 164-177, 232-241`: the key is per SecureStore entry (one per device by design), the `sealed`
  row check and the `wiping` marker are per database file, and `onMissingKey` closes over whichever
  instance first populated the cache.
- Failure scenario 1 (today's code): a developer with chat rows in `onepeek-chat.db` opens the dev-only
  spike. `ks.wipe()` deletes `onepeek.wrap`. The chat store's cache is also cleared (shared Map), its next
  `get`/`put` reads `null`, finds rows, finds **no** marker in its own `meta` table (the marker went to
  `onepeek-spike.db`) and throws `keystore_unavailable` for every room until the user wipes. Every room's
  MLS state is gone. Before the M1 fix the same action silently re-provisioned; now it is loud, but the
  loss is identical.
- Failure scenario 2 (the general form): any second `createRnKeyStore` over another `dbName` with the
  same entry (a future "archive" or "drafts" database, a storybook, a second spike) can re-provision a
  key while the main database has rows: its `onMissingKey` checks *its own* empty table, returns, and
  `wrappingKey` generates a replacement. This is M1 reintroduced through the back door, and the L1 change
  to a global cache makes it process-wide.
- Mitigation today: the spike is `__DEV__` only, no screen opens `onepeek-chat.db` yet, and the spike is
  scheduled for deletion after Gate 0. So no user data is at risk now; this is about the invariant.
- Fix: (1) `spike.tsx`: pass `wrapKeyId: 'onepeek.wrap.spike'` (and keep the `wipe()`), one line, before
  `mobile-ui` opens the real database; or delete the spike at Gate 0 as planned and record that. (2) In
  `keystore.ts`, state the rule in the `createRnKeyStore` doc comment: one database per SecureStore
  entry; a second `dbName` under the same entry must pass its own `wrapKeyId`. Optionally enforce it:
  keep a module-level `Map<entryName, dbName>` and throw if a second distinct `dbName` registers under
  the same entry (tests that simulate relaunch over `sameFile` keep the same name, so they pass).

### N2 (low) — A `wiping` marker can outlive the wipe and later turn a `keystore_unavailable` into a silent delete

- File: `packages/core/src/adapters/rn/keystore.ts:239-240` (two separate statements), `:166-168`
  (`onMissingKey` returns early without clearing the marker when the table is empty).
- Scenario and impact: as described in (b). Data lost is data already unreadable; only the user-facing
  signal is lost. Fix: clear the marker in the no-rows branch of `onMissingKey`, or do both deletes in
  one `execAsync` / transaction. Add a test: `failOnce` on `DELETE FROM meta…` during `wipe()`, relaunch,
  `put` → marker gone.

### N3 (low) — The fail-closed lock has no re-read; a lock that started closed stays closed until `clear()`

- File: `packages/core/src/adapters/rn/platform.ts:104-135`.
- Scenario: iOS launches the app while the phone is locked (push, prewarm); the sync Keychain read throws,
  `locked = true`. The user later unlocks the phone and foregrounds the app: `get()` still says locked
  although no flag is stored. The S0b fix suggested "default to locked (the app can call `clear()` after
  biometric unlock) **or re-read on foreground**"; only the first half exists, and nothing tells
  `mobile-ui` that a locked start is expected after a cold background launch. Fail-closed is the right
  default; the gap is the missing `reload(): Promise<void>` and the missing plan line. Fix: add
  `reload()` that re-reads the flag (honouring `touched`), and have the root layout call it on
  `AppState` → `active`; document in `docs/mobile/plan.md` under the Panic Exit task.

### N4 (low) — `keystore_unavailable` recovery is not specified for `mobile-ui`

- File: `docs/mobile/plan.md`, `docs/mobile/test-plan.md` (no mention of `keystore_unavailable` or of
  `wipe()` as the recovery; grep empty), `docs/mobile/test-plan.md:158-159` (stale: says the app passes
  `Constants.expoConfig.extra.siteUrl`), `docs/secret-chat/known-limitations.md` (no L4 note).
- Scenario: the error is thrown from `ensureDevice()` (`client.ts:119,137`) and `loadState()`
  (`client.ts:159`), i.e. from every client entry point, as a `ChatError` whose message is an internal
  string. Without a screen that catches `code === 'keystore_unavailable'` and offers "Reset chats on this
  phone" (→ `keystore.wipe()`), the user sees a generic error forever. Fix: one line in the plan for the
  Chats screen / error boundary, correct the test-plan line, add the L4 limitation line.

## Not findings, noted for the record

- `ready()` caches a rejected schema promise forever if the first `CREATE TABLE` fails (pre-existing,
  not introduced here); a relaunch recovers. Could become `schema = null` on rejection.
- `ALLOWED_HOSTS` is `readonly` only at the type level; an OTA bundle could mutate it, but an OTA bundle
  could replace the function as well. The real control is that crypto/key handling never ships OTA
  (`app.config.ts:16-18`).
- `checkOnePeekUrl` accepts upper-case hosts (`new URL` lower-cases them) and rejects a trailing-dot host;
  both correct.
- `extra.siteUrl` is still in `expoConfig.extra` rather than a literal at the call site; with the core
  allowlist the worst an `extra` change can do is apex ↔ www. Covered by the M2 row and N4.
- The `meta` table is plaintext metadata; `wiping = '1'` reveals only that a wipe was interrupted.

## Verdict line

**S0 closed: no open high or critical findings.** S0b M1, M3, L1, L2, L3, L5, L6 fixed; M2 fixed in the
core and pinned in `app.config.ts` (test-plan line still stale); L4 fixed as a code comment (known-
limitations line missing). New: N1 medium (spike wipes the shared wrapping key; one `dbName` per entry
rule), N2–N4 low. Core 87/87, root 58/58, ESLint clean.
