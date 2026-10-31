# OnePeek mobile: test plan v1

Owner: `qa`. Status: v1.1. v1 written 2026-10-31 for task Q2 (`plan.md` §2) and merged; v1.1 (same day,
tasks Q3/Q4) records what was built: §1.6 the leak guard as landed, §3 the Maestro flows as written, §8 the
Gate 1 criteria map, and the §1.3 siteUrl correction from the S0 close-out (N4).
Covers tasks Q1 (interop), Q3 (Maestro), Q4 (unit tests, log lint), Q5 (cross-platform secrets) and the
Phase 3 device matrix. The automated parts reuse the web harness in `lib/chat/client.integration.test.ts`
and the SQL tests in `supabase/tests/secret-chat.test.ts`; nothing here invents a second way of testing.

## 0. Ground rules

1. **Automated tests never touch the live Supabase project.** There is no staging project
   (`plan.md` §0, §8 Q1). Everything automated runs on PGlite with the real migrations
   (`supabase/tests/supabase-stubs.sql` + `006_secret_chat.sql` + `007` + every later migration) and a
   fake `SupabaseLike` that calls the SQL functions as the signed-in user, exactly as today. The fake
   never speaks HTTP. A test that reads `EXPO_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL` is wrong.
2. **Manual device checks run on production with throwaway rooms.** Every room is created with
   `lifetime: 3600` (1 hour), a name starting with `qa-`, and is burned by its owner at the end of the
   session. No agent applies a migration to production (`plan.md` §7). No real personal data goes into a
   throwaway room: use the fixture strings in §1.1.
3. **Honest copy.** Tests assert what each platform does, not what we wish it did. iOS does not block
   screenshots; it tells the app one was taken. Android with `FLAG_SECURE` does block them. The
   wording of a check's expected result is what `release` may put in the store listing, nothing more.
4. **A flaky test is a failing test** (§6). It is quarantined within the hour and the PR that owns it
   does not merge until it is fixed or deleted.
5. **No plaintext in any log.** The strings in §1.1 are chosen so a grep over any log, dump or
   payload finds them. Every security assertion is a negative `toContain` on a serialised artefact,
   the style already used in `client.integration.test.ts` (`JSON.stringify(lastSql)` must not contain
   the body, the file name or the key).

## 1. Unit tests

### 1.1 Fixture strings (shared by every test in this plan)

Defined once in `packages/core/test/fixtures.ts` and imported everywhere, so every "never appears"
assertion greps for the same things:

| Name | Value | Stands in for |
| --- | --- | --- |
| `BODY` | `The launch code is 4471` | message text |
| `BODY2` | `Got it` | reply text |
| `FILE_NAME` | `passport.txt` | attachment file name |
| `FILE_BODY` | `passport scan: P1234567` | attachment content |
| `ACCESS_CODE` | `blue-river-42` | room access code |
| `NICK` | `Sam Okonkwo` | nickname (travels encrypted); 11 bytes, so its hex cannot occur by chance in ciphertext (a 3-byte `Sam` had a ~1% false-positive rate per dump) |
| `ROOM_NAME` | `qa-launch` | room name (local only) |

Each test also captures at run time: the invite token (`link.split('#')[1]`), the file key
(`sent.file.key`), the attachment object path, every MLS signing private key (`ensureDevice().signing.signKey`),
and the wrapping key bytes the RN keystore mock holds (`SecureStore` entry `onepeek.wrap`, base64url).
The helper `forbidden(label, value)` returns the value's text, hex, base64url and base64 forms (byte
values: the three encodings only); `expectClean(artefact: string, list, where)` asserts none of them
occur and names what leaked where. The artefacts checked (as built in Q1) are:

- **the SQL log**: every fake client's RPCs (name + arguments) serialised with `JSON.stringify`, with
  `p_token` and `p_access_code` redacted only on the RPCs where they are the input to be hashed
  (`chat_create_invite`, `chat_peek_invite`, `chat_redeem_invite`; `chat_create_room`,
  `chat_redeem_invite`) and an assertion that they appear on no other RPC;
- **the DB dump**: every `public.chat_*` table found in `pg_tables` plus `realtime.messages`, each row
  as `row::text` (bytea renders as `\x` hex, so the hex forms are what match);
- **the stored objects**: every uploaded object as latin1 and as hex;
- **the device dump** (mobile only): every row of the in-memory SQLite `sealed` table (key, hex iv,
  hex ct) plus the SecureStore mock's values. `console` is not captured here; the core never logs
  (`no-console: error`), and the log lint is Q4 (§1.6).

### 1.2 `packages/core` (owner: `core-crypto`; `qa` co-owns)

The moved tests must pass unchanged, then new ones are added. After C1:

| File | Moved from | Change allowed |
| --- | --- | --- |
| `packages/core/src/crypto.test.ts` | new | covers `lib/crypto.ts` helpers (`toB64Url`, `fromB64Url`, AES-GCM round trip, key import); today these have no direct test |
| `packages/core/src/chat/mls.test.ts` | `lib/chat/mls.test.ts` (10 tests) | import paths only |
| `packages/core/src/adapters/web/keystore.test.ts` | `lib/chat/keystore.test.ts` (8 tests) | import paths only |
| `lib/chat/client.integration.test.ts` | stays at the root | it exercises the re-exports, which is the point of the zero-diff rule |

New tests in `packages/core`:

**`ports.contract.test.ts`**: one describe block per interface in `ports.ts`, run against every
adapter (web with `fake-indexeddb`, RN with the mocks from §1.3). Same test body, different factory:

- `KeyStore`: `put/get` round trip of bytes and bigints; `get` of an expired record returns `null` and
  deletes it; `delPrefix('room:X:')` leaves `room:Y:` alone; `keys(prefix)` sorted; `sweep()` returns
  the count removed; `wipe()` then `get` returns `null` for every key that existed; a record copied
  under another key fails to decrypt (associated-data binding).
- **`wipe()` ordering** (the C3 "done when"): the mock records the sequence of calls. The assertion is
  that the wrapping key is deleted (web: `meta.wrap` removed; RN: `SecureStore.deleteItemAsync('onepeek.wrap')`)
  **before** the first `delete from sealed` / `sealed.clear()`. Then: reinsert the sealed rows captured
  before the wipe into a fresh store and assert `get` returns `null` for all of them. That proves the
  rows are unreadable regardless of whether the delete completed.
- `Lock`: `lock()` then `isLocked()` is `true` from a second instance built on the same storage
  (web: another module instance over the same `localStorage`; RN: another instance over the same
  SecureStore mock), `unlock()` clears it.
- `Env`: `origin()` is used verbatim in invite links; `randomUUID()` matches the UUID regex;
  `deviceLabel()` contains no email, no user id and at most 40 characters; `notifyUrl()` is absolute on RN.
- `FileSource`: `bytes()` for an empty source throws `empty_file` in `sendFile`; a 50 MiB source is
  refused with `too_large` before any RPC (`lastSql` is empty); `openFile` returns `{ bytes, mime }`
  and the web wrapper's `Blob` has the same `type`.
- `SupabaseLike`: a compile-time test (`expectTypeOf`) that the real `SupabaseClient` is assignable to
  it, so the interface cannot drift wider than the client.

**`client.security.test.ts`** (core-level, platform-neutral, uses the PGlite harness):

- after `send(BODY)`, `expectClean(sqlLog)` and `expectClean(dbDump)`;
- after `sendFile(FILE_NAME, FILE_BODY)`, the uploaded object bytes, the SQL log and the DB dump are
  clean, and `sent.file.key` appears in none of them;
- after `redeemInvite(token, NICK, ACCESS_CODE)`: `chat_invites.token_hash` is not the token's hex;
  `chat_rooms.access_code_hash` matches `^\$2a\$10\$` and does not contain `blue-river`; the DB dump
  does not contain `Sam` as text or hex (today asserted against `key_package`; extend to every table);
- `sendScreenshotAlert`: SQL log does not contain `screenshot`;
- `members()` nickname comes from the encrypted `nick` control message: the server-side
  `chat_room_members` RPC result (captured in `lastSql`) has no `nickname` field;
- `burn()` followed by `keystore.keys('room:<id>:')` is `[]` on the owner and, after `sync`, on every
  member; the ciphertext rows are gone; `realtime.messages` has one `burned` event;
- `removeMember` + `sync` on the removed device returns `removed: true` and its room keys are gone;
- a `ChatError` message never contains a body, token or key: iterate every `code` the client throws
  (`access_code_wrong`, `view_once_sent`, `gone`, `empty_file`, `not_owner`, `rate_limited`,
  `invite_invalid`) and assert `expectClean(err.message)`.

### 1.3 RN adapters, `packages/core/src/adapters/rn` (owner: `core-crypto`, C3)

Names below follow the ports as C1/C3 built them (`packages/core/src/chat/ports.ts`): the env port is
`ChatEnv { origin(), deviceLabel(), randomUUID(), notify(roomId, accessToken) }` (no `notifyUrl()`;
the RN env is built with `createRnEnv({ siteUrl, apiBaseUrl, deviceLabel, fetch? })` and posts to
`<apiBaseUrl>/api/chat/notify`), and the panic flag is `LockStore { set(), get(), clear() }`
(the client's `lock()/isLocked()/unlock()` call it). The expo modules are injected
(`createRnKeyStore({ secureStore, sqlite, dbName })`, `createRnPlatform({ ..., secureStore })`),
never imported by the core.

Mocks live in `packages/core/test/rn-mocks.ts` and are the only place `expo-*` shapes are built by hand:

- `createSecureStoreMock(log)`: a `Map<string,string>` with `getItemAsync/setItemAsync/deleteItemAsync`,
  recording the options passed to every `setItemAsync` (`setOptions`). Assert the wrapping key
  (`WRAP_KEY_ID`, `onepeek.wrap`) is stored with exactly `{ keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY }`
  (no `requireAuthentication`, since the lock is the app's, not the item's). The lock flag is
  `LOCK_ID` (`onepeek.lock`), beside it.
- `createSqliteMock(log)`: backed by `node:sqlite` `DatabaseSync(':memory:')` (Node 22.13+, no new
  dependency; tests `skip` when it is missing). Exposes the `execAsync/runAsync/getFirstAsync/getAllAsync`
  subset the adapter uses; `dump()` returns the `sealed` rows, `insert()` puts rows back.
- `crypto`: `globalThis.crypto` from Node (`webcrypto`). This stands in for `react-native-quick-crypto`
  **only for logic**; it does not prove quick-crypto works on Hermes. That proof is C2's `spike.md`.
  Tests never call `installRnCrypto()`.
- `createFetchRecorder(fail?)`: `env.notify(roomId, token)` must `POST` to `<apiBaseUrl>/api/chat/notify`
  with body `{ room }` and `Authorization: Bearer <token>`, nothing else, and never throw.
- Both mocks append to one `log` so ordering can be asserted (wrapping key deleted before any row).

Adapter tests (as landed in C3; file names are the adapter's, `<adapter>.test.ts`):

- `keystore.test.ts`: the §1.2 contract; plus "the SQLite file holds only ciphertext": after
  `put('room:1:state', { secret: BODY })` the dump of `sealed` contains neither `BODY` nor its hex nor
  its base64url; the wrapping key bytes (read from the SecureStore mock) do not appear in SQLite;
  after `wipe()` the SecureStore mock has no `onepeek.wrap` and `sealed` is empty; the order assertion
  from §1.2.
- `keystore.test.ts` "a copied database is unreadable without the device's SecureStore": serialise
  the SQLite rows, build a second adapter over the same rows and an **empty** SecureStore; every
  `get` is `null`.
- `platform.test.ts` (lock): `set()` flips the flag synchronously (kept in memory so the UI can cover
  the screen before SecureStore resolves) and persists it; a new `createRnLockStore(sameMock)` reads
  it back once `ready` resolves (simulated process restart); `clear()` deletes it.
- `platform.test.ts` (env): `origin()` is the `siteUrl` the app passes as a **string literal**
  (`'https://onepeek.io'`; `apps/mobile/app.config.ts` pins the same literal, no env override) and the
  core validates at construction (`checkOnePeekUrl`, S0b M2: absolute, `https:`, host `onepeek.io` or
  `www.onepeek.io`, no port, credentials, path, query or fragment; `http://localhost` / `127.0.0.1` only
  with `allowInsecureDev: true`). Neither `EXPO_PUBLIC_*` nor `expoConfig.extra` can redirect it; the
  worst an OTA or `extra` change can do is flip apex ↔ www. Used verbatim in invite links and never sent
  to the server;
  `deviceLabel()` is the injected model name truncated to 40 chars, never the user-typed device name;
  `randomUUID()` is v4; `notify()` as above.
- `platform.test.ts` (files): `fileSource(picked)` reads from `read()` lazily (not at pick time); size
  comes from the picker metadata and the core checks it against `MAX_ATTACHMENT_BYTES` before reading.

### 1.4 `apps/mobile/security` (owner: `native-security`, N1 to N5)

Tested with `vitest` and the `react-native` preset mocked; native modules are mocked per test.

- `autoLock.test.ts`: state machine only. `active → background` starts a 60 s timer (fake timers);
  `background → active` at 59 s does not lock; at 60 s locks; a lock while backgrounded is kept until
  biometric success; `panicExit()` locks at once and sets `cover = true` synchronously; the lock calls
  `core.lock()` exactly once.
- `biometric.test.ts`: `LocalAuthentication.authenticateAsync` is called with
  `disableDeviceFallback: false` and a `promptMessage` that is a fixed string (no room name); a
  cancelled prompt leaves the app locked; three failures do not wipe anything (we lock, we do not burn).
- `screenshot.test.ts` (iOS path): on `ScreenCapture.addScreenshotListener` firing while route is
  `/room/[id]`, `core.sendScreenshotAlert(id, ttl)` is called once with the room id and the room's
  current ttl, and nothing else is passed; when the route is not a room, nothing is sent; the local
  notice text is the web's wording (`app/chat` copy) and is read from one constant.
- `capture.test.ts` (iOS path): `UIScreen.isCaptured` true → cover shown; false → cover removed; a
  cover shown by capture is not removed by the app-switcher logic and vice versa (two independent
  reasons, one view).
- `secureFlag.test.ts` (Android path): the hook calls `preventScreenCaptureAsync` on mount of every
  route under `/room`, `/secret` and `/join` and `allowScreenCaptureAsync` on unmount; the Chats list
  does not set it (a black app switcher thumbnail for the list is acceptable, a black screenshot of
  the list is not required; decision for the lead).
- `backup.test.ts`: the config plugin output (run `expo config --type introspect` in the test) contains
  `android.allowBackup === false`, a `dataExtractionRules` file excluding `database/` and
  `shared_prefs/`, and the iOS plugin marks the SQLite path with `isExcludedFromBackup` (tested through
  the module's JS wrapper mock being called with the exact db path on first open).
- `watermark.test.ts`: overlay text is `"<nickname> · <device code> · <HH:mm>"`, same format string as
  the web; the device code is the first 6 characters of the safety-number-bearing device id, never the
  user id.

### 1.5 Push payloads (owner: `backend`, B2 and B4; `qa` writes the assertions)

In `lib/alerts.test.ts` and `app/api/chat/notify/route.test.ts`, with APNs/FCM/web-push transports
mocked to capture what would be sent:

- **Fixed strings only.** For every transport, the captured payload, serialised, equals the fixed
  template with nothing interpolated except the identifiers the client needs to route:
  `title === 'OnePeek'`, `body === 'You have a new message in a private chat.'`. `expectClean(payload)`
  with a context that includes the sender's user id, every member's nickname, `BODY`, `FILE_NAME`.
- **Room identifier.** Today the web payload carries `url: /chat/r/<room>` and `tag: chat-<room>`.
  The plan's B4 says "no room". The test is written with a `ROOM_IN_PAYLOAD` switch: `false` asserts
  the payload contains no UUID at all; `true` asserts the only UUID present is the room id (as an
  opaque route, never the sender). The lead decides the value (§7, open question 1). APNs: assert
  `mutable-content` is not set and `alert` has no `subtitle`; FCM: `notification` has no `image`,
  `data` has no keys beyond the allowed set.
- **Opt-out.** A recipient with `notify_prefs.push_on = false` receives nothing on any transport.
- **Throttle.** The fifth notify in a minute for the same room and sender returns `throttled: true`
  and sends nothing.
- **Dead tokens.** APNs `410`/`BadDeviceToken` and FCM `UNREGISTERED` delete the `push_devices` row;
  the web `404/410` behaviour is unchanged (regression).
- **Migration 008** (`supabase/tests/push-devices.test.ts`, PGlite, owner `backend`): owner can insert
  and read only their own `push_devices` rows; another user reads none; `anon` is denied; the service
  role reads all. The `register_push_device` RPC lives in the same file and must assert: (a) it runs as
  the caller and writes `owner = auth.uid()` whatever `owner` the arguments carry (a forged owner is
  ignored or rejected, never stored); (b) `anon` (no session) gets `permission denied`; (c) a guest
  (anonymous auth user) **may** register, since guests receive messages; (d) re-registering the same
  `(platform, token)` updates `last_seen` instead of inserting a second row; (e) registering a token
  that another owner holds moves it to the caller (a phone changes account) and the old row is gone;
  (f) the token column is written as given and the test dumps the table as `row::text` to prove nothing
  else (no user agent, no device name, no room) is stored; (g) `platform` is constrained to
  `ios | android | web` and anything else is rejected; (h) RLS: after registration the owner's `select`
  returns the row, another user's returns zero rows, direct `insert`/`update` by a non-owner is denied.
- **Native payload sweep** (`lib/alerts.native.test.ts`, owner `backend`, reviewed by `qa` in wave 2).
  The APNs and FCM senders are called with mocked transports that capture the exact bytes that would
  leave the server. The test must: (1) build a context of forbidden strings from the fixtures in §1.1
  (`BODY`, `BODY2`, `FILE_NAME`, `FILE_BODY`, `ACCESS_CODE`, `NICK`, `ROOM_NAME`) plus the sender's user
  id, every recipient's user id, every member nickname, the invite token and the attachment key, each in
  text, hex, base64 and base64url (`forbidden()` from `packages/core/test/fixtures.ts`); (2) serialise
  every captured request (URL, headers, body) and `expectClean` it; (3) assert the APNs body is exactly
  `{ aps: { alert: { title: 'OnePeek', body: 'You have a new message in a private chat.' }, sound: 'default' }, room: <id> }`
  (`room` only when `ROOM_IN_PAYLOAD`; it may also be mirrored as `aps.thread-id`) with no
  `mutable-content`, no `subtitle`, no `category` that names a room, and the FCM v1 message has
  `notification.title`/`body` equal to the same two strings, no `image`, and `data` keys limited to
  `{ room }` when `ROOM_IN_PAYLOAD` (the lead set it to `true` on 2026-10-31, log.md); (4) assert the
  only UUID in either payload is the room id (regex over the serialised payload, count == 1 when
  `ROOM_IN_PAYLOAD`, 0 otherwise) so a sender or recipient id can never ride along; (5) the APNs
  `apns-topic` header is `io.onepeek.app` and `apns-push-type` is `alert`; the FCM target is
  `https://fcm.googleapis.com/v1/projects/<project>/messages:send` (no other host appears in any URL);
  (6) a recipient with `notify_prefs.push_on = false` produces zero requests on every transport;
  (7) APNs `410`/`BadDeviceToken` and FCM `UNREGISTERED` delete the `push_devices` row, and the web
  `404/410` path is unchanged (regression); (8) the credentials (`APNS_*`, `FCM_SERVICE_ACCOUNT_JSON`)
  never appear in a thrown error message or in the captured payload (add them to the forbidden list).

### 1.6 Leak guard (Q4, as built 2026-10-31)

The rule set lives in `packages/core/eslint.config.mjs` and, as a kept-in-sync copy, in
`apps/mobile/eslint.config.mjs` (the app's lint must not import the core's tooling). Everything is an
**error**; `npm run lint` is at 0 errors with the existing code. What is caught, by `no-restricted-syntax`
selectors (esquery; regexes use `\x2f` for `/`):

| Pattern | Example that fails | Scope |
| --- | --- | --- |
| console | `console.log(x)`, `if (__DEV__) console.warn(x)` | all files (`no-console`, pre-existing) |
| telemetry call | `Sentry.captureMessage(x)`, `Sentry.Native.captureException(e)`, `crashlytics().log(x)`, `analytics.track(...)`, `posthog.capture(...)`, also `Bugsnag`, `datadog`, `mixpanel`, `amplitude`, any method, case-insensitive | all files |
| telemetry import | `import … from '@sentry/*'`, `@bugsnag/*`, `@datadog/*`, `mixpanel*`, `@amplitude/*`, `posthog*`, `@react-native-firebase/crashlytics|analytics`, `@segment/*`, `expo-analytics`; also `require(...)` of the same | all files |
| ad-hoc logger | `logger.info(x)`, `log.warn(x)` and the other logging verbs (`log info warn error debug trace fatal verbose silly notice critical`) on an identifier named `log` or `logger`. `log.push(...)` on an array is not matched | all files |
| stringify to a sink | `JSON.stringify(<ident>)` or `JSON.stringify(<obj>.<prop>)` where the identifier/property is one of `message body plaintext token accessCode code secret key nick fileName name`, passed to any sink above, to `log(...)`/`logger(...)` or to `console.*` | all files |
| fetch host | `fetch('<literal>')`, `globalThis.fetch('<literal>')` or an expression-free template literal whose URL is not `https://onepeek.io/…`, `https://*.onepeek.io/…` or `https://<project>.supabase.co/…`: another host, a look-alike (`onepeek.io.evil.example`), plain `http:`, or a relative path | `apps/mobile/**`, `packages/core/src/adapters/rn/**` (the web adapter keeps its relative `/api/chat/notify`) |

The approved path is `packages/core/src/log.ts`: `log(event, fields?)` is a **no-op** in every build
(OnePeek ships no telemetry) and `redact(value)` is what a screen passes its fields through so that, if a
sink is ever wired in there (lead + security-reviewer decision), nothing sensitive can reach it:
sensitive keys (`SENSITIVE_KEY`: message, body, plain, text, token, access, code, secret, key, nick,
file, name, password, email, link, url, session, jwt, state; case-insensitive, anywhere in the key) become
`[redacted]`, strings are capped at 32 chars, byte buffers become `[bytes:n]`, errors keep only `name`
and the trailing `[a-z_]+` code, depth stops at 4. Screens import it as `@onepeek/core/src/log` (same
style as `_layout.tsx` imports `src/rn`; re-export from `index.ts` is `core-crypto`'s call).
`packages/core/src/log.test.ts` (8 tests) covers each rule.

`packages/core/test/leak-guard.test.ts` (53 tests, ~0.7 s) runs ESLint programmatically with both
configs: 23 probe files (one per forbidden pattern) are written to the scratchpad, read back and linted
under a virtual path inside the package (`src/chat/…`, `src/adapters/rn/…`, `app/…`), each must be
reported with the matching message and nothing else at error level; a clean file (`log` + `redact`,
`fetch` to onepeek.io/supabase.co/computed URL, `JSON.stringify({ roomId })`) must pass both; the fetch
rule must stay scoped (web adapter's relative fetch passes); `log.push` must not be mistaken for a
logger. The temp dir is removed in `afterAll`. The same file holds the **static sweep**: walks
`apps/mobile/**/*.{ts,tsx}` (minus `node_modules`, `ios`, `android`, `.expo`, `e2e`, `__tests__`,
`*.test.*`) and `packages/core/src/**/*.ts` (minus tests) and fails on any line matching `console\.` or
`__DEV__\s*&&\s*console`, grep-style (comments included: a shipped file does not mention the console
with a dot after it). Ran 3× on 2026-10-31, 61/61 each time, no flake.

Not covered (by design, named so nobody assumes otherwise): string concatenation or template literals
of a secret into a sink (`log('x ' + token)`) is not matched beyond `JSON.stringify`; a sink imported
under another name (`import { captureMessage as cm }`) is caught by the import rule, not the call rule;
`fetch` with a computed URL is the adapter's responsibility (`checkOnePeekUrl`).

## 2. Interop test design (Q1)

File: `packages/core/test/interop.integration.test.ts` (built in Q1 on `mobile/qa/interop-test`). It
runs in `packages/core`'s own vitest (`include` gained `test/**/*.test.ts`) and therefore in the root
`npm test`, which runs every workspace's `test` script; the root vitest config itself is unchanged.
Per-test timeout 60 s like the web test. Built on C1 (core extracted) and C3's adapters as landed.

### 2.1 Harness (as built)

`packages/core/test/harness.ts` is the harness of `lib/chat/client.integration.test.ts` **duplicated**,
not extracted: moving it to `supabase/tests/harness.ts` would have changed the web test's module-level
`lastSql` handling, and the zero-diff rule for that file wins. The two copies can be unified when the
lead approves touching the web test. Differences from the web copy:

- `bootDb()`: PGlite + pgcrypto, the stubs, then the chat migrations in order: `006` and every later
  migration except `*_down.sql` and `007` (it redefines `create_request` from `005`, whose tables are
  not in this schema; 002 to 005 cannot be applied without a `001` that does not exist in the repo).
  `008+` will therefore be covered automatically. `window.location.origin = 'https://onepeek.test'`
  is set after PGlite starts.
- `fakeSupabase(user, sql)`: as the web copy, plus every RPC is pushed both to the client's own `sql`
  log and to the shared `allSql`, so a test can tell which device sent what; the session token is
  `tok-<first 8 of user id>` so the notify assertion can check which device's token was used;
  `auth.passkey.list` calls are counted; `signInWithPasskey` is present (the port requires it).
- `objects`: the shared `Map` standing in for the bucket, with the `chat_attachment_writable/readable`
  checks; uploads accept the `Uint8Array` the core sends or the `Blob` the web adapter wraps it in.
- `dumpDb()`: every `public.chat_*` table plus `realtime.messages`, rows as text.

Two device factories in the test, both returning the same `ChatClient` from `createChatClient`:

```ts
const owner = await device('web', 'owner');            // web adapters, own fake-indexeddb
const guest = await device('phone', 'guest', true);    // RN adapters over §1.3 mocks, guest session
```

`device('web')` does `vi.resetModules()` and re-imports `adapters/web/keystore` so each browser has its
own wrapping-key cache (module state in a real tab), swaps in a fresh `IDBFactory`, and builds
`createWebPlatform({ supabase: fake, keystore })`; its `run(fn)` puts that `indexedDB` back before every
call. `device('phone')` builds `createRnKeyStore({ secureStore, sqlite, dbName: ':memory:' })` and
`createRnPlatform({ supabase: fake, keystore, secureStore, siteUrl: 'https://onepeek.io',
apiBaseUrl: 'https://onepeek.io', deviceLabel: 'iPhone 15', fetch: recorder })` with Node's WebCrypto
(no `installRnCrypto`). On both, `platform.env.notify` is replaced by a `vi.fn` spy (call-through on
the phone, recording only on the web, whose real `notify` posts to a relative URL that has no server
here). `sealedDump(phone)` / `secureDump(phone)` are the device dump.

### 2.2 Scenarios and assertions

Every scenario runs twice with roles swapped (`describe.each([['web owner, phone guest'], ['phone
owner, web guest']])`). Assertions listed once; "both" means asserted on each side. Every scenario ends
with `sweep(devices, extraSecrets, tokens)`, the §1.1 `expectClean` over the SQL log, the DB dump, the
stored objects and each phone's SQLite and SecureStore, plus: the wrapping key's SecureStore options,
that SecureStore holds only `onepeek.wrap` and `onepeek.lock`, that every `env.notify` call was exactly
`(roomId, that device's token)`, and that on the phone each call became one `POST {room}` with that
bearer. Adjustments made while building are marked **(built)**.

**A. Room, invite, access code, admit**
1. Owner `createRoom({ kind:'secret', ttl:30, mode:'on_open', lifetime:3600, accessCode, name })`.
2. `createInvite` link matches `^<origin>/chat/join#[A-Za-z0-9_-]{40,}$` where `<origin>` is the
   platform's own: `https://onepeek.test` (the web `window`) or `https://onepeek.io` (the phone's
   injected `siteUrl`, never read from a global) **(built)**.
3. Member `peekInvite(token)` → `{ needs_code: true, kind: 'secret' }`.
4. Wrong code → rejects `{ code: 'access_code_wrong' }`; the SQL log contains the wrong code only as
   an RPC argument to `chat_redeem_invite` (it is hashed server-side) and the DB dump never.
5. Right code → `joined === roomId`; member `sync` → `joined: false` until owner `admitPending` → `1`;
   then `joined: true`; `myRooms()` lists the room on both, with `ROOM_NAME` on the owner **(built)**.
6. `expectClean(sqlLog)`, `expectClean(dbDump)` with the invite token in context, except for the
   `chat_create_invite`, `chat_peek_invite` and `chat_redeem_invite` `p_token` arguments where the
   token is the input (assert it is present only there, `token_hash` is not its hex, and every
   `access_code_hash` matches `^\$2a\$10\$`). This is the `sweep` every scenario ends with.

**B. Text, both directions**
7. Owner `send(BODY, 30)`. SQL log and DB dump clean. Member `sync` → `newMessages: 1`;
   `messages()[0].body === BODY`, `expiresAt === null` (unopened), `mine === false`.
8. Member `markOpened` → `expiresAt - now <= 31_000`.
9. Member `send(BODY2, 30)`; owner `sync`; owner sees `[[true, BODY], [false, BODY2]]`.
10. `expectClean(sealedDump(phone))` with `BODY`, `BODY2`, the MLS signing private key and the
    wrapping key bytes in context, and the phone holds exactly two sealed `room:<id>:msg:` rows. This
    is the new assertion the web test cannot make: the phone's SQLite holds only sealed blobs.
11. Epoch agreement: `mls.epoch(ownerState) === mls.epoch(memberState)` after both synced. Also
    **(built)**: `env.notify` was called exactly once per side, with `(roomId, that side's token)`.

**C. File**
12. Owner `sendFile(FileSource(FILE_NAME, FILE_BODY), 300, false)`; `sent.file.name === FILE_NAME`.
13. SQL log, stored object bytes (`latin1` and hex) and DB dump contain neither `passport` nor
    `sent.file.key` (checked as the key's bytes: hex, base64url, base64).
14. Member `sync`, `openFile` → bytes decode to `FILE_BODY`, `mime === 'text/plain'`; then the member
    sends a file back and the owner decrypts it (both directions) **(built)**.
15. A third user who is not a member: `chat_attachment_readable(objectPath)` is `false`.
16. `FileSource.bytes()` is called exactly once per send (no second read during the
    encrypt-then-upload path); asserted on whichever platform sends, the rule lives in the core.

**D. View-once file**
17. Owner `sendFile(..., 300, true)`; owner `openFile` → rejects `view_once_sent`.
18. Member `openFile` once → content; `messages()` shows `viewed: true`; second `openFile` → `gone`;
    replaying `{ ...msg, viewed: false }` → `gone` (server-side claim).
19. After the first open `openFile` is refused locally before any RPC (`allSql` unchanged by the
    second attempt, on both platforms); on the phone the sealed message row still exists; the replay
    with `viewed: false` makes exactly one `chat_claim_attachment` call and is refused by the server.

**E. Removal commit**
20. Three devices: owner, `m1` (the guest platform, the one removed) and `m2` (the owner's platform),
    then swapped, so both platforms get removed once. Owner `removeMember(m1)`.
21. `m1.sync` → `removed: true`; `m1.keystore.keys('room:<id>:')` is `[]` on both, and on the phone
    `sealed` has no `room:<id>:` rows; `m1.myRooms()` no longer lists the room **(built)**.
22. Owner `send('only m2 now…')`; `m2.sync` sees it; `m1`'s own `chat_fetch` is refused by the server
    (`not_a_member`) and, independently, `mls.receive` of the ciphertext captured from the SQL log
    with `m1`'s pre-removal state (saved before the commit) rejects.

**F. Burn**
23. Member `burn` → `not_owner`. Owner `burn`: owner's room keys gone; `chat_messages` for the room is
    `0`; member `sync` → `removed: true` and its keys gone; `myRooms()` on both no longer lists it;
    `realtime.messages` has one `burned` event for `room:<id>`; the phone's `sealed` has no
    `room:<id>:` rows and still contains the rows of a second room the phone created beforehand
    (burn is per room, not a wipe).

**G. Screenshot alert**
24. Member `sendScreenshotAlert(roomId, 30)` → `{ alert: 'screenshot' }`; SQL log does not contain
    `screenshot`; owner `sync` sees `{ alert: 'screenshot', mine: false, body: '' }` with
    `expiresAt !== null`. **Documented (built):** the client today counts the notice in
    `newMessages` (`sync` returns `1` for it), so a UI badge built on `newMessages` will light up for
    a screenshot notice; the test pins `1` and `mobile-ui` must subtract alerts itself or ask
    `core-crypto` for a separate counter. An alert triggers no `env.notify` (no push).

**H. Nickname**
25. Member joined as `NICK`; after the admit commit and one `sync` on each side, owner
    `members().find(role==='member').nickname === NICK`; the DB dump has no `NICK` as text, hex or
    base64 in any table; the rows the `chat_room_members` RPC returns (called directly on the fake,
    since the log keeps arguments, not results) have no `nick`/`name`/`label` field.
26. **Finding (built):** the owner never sends a `nick` control message (not on `createRoom`, not on
    first `sync`), so the member side sees `nickname: null` for the owner on both platforms. The test
    pins that behaviour; `core-crypto` decides whether the owner should announce a nickname.

**I. Concurrency (ported)**
27. The web test's "sending while a sync is running" scenario with one side mobile: both sides end
    with `['a1','a2','a3','b1','b2','b3']`, the pre-assigned id is kept, and the epochs agree. The
    pre-assigned id is random per run (one PGlite database serves both role runs) **(built)**.

**J. Panic lock**
28. Phone `lock()` → `isLocked()` true at once and `onepeek.lock = '1'` in SecureStore; a new
    `createRnLockStore` over the same SecureStore mock reads it back after `ready` (restart);
    `unlock()` clears it and, on a guest session, never calls `auth.passkey.list`; rooms are intact
    (`myRooms()` contains the room and the sealed `room:<id>:state` row is still there).

### 2.3 Reporting line for Q1

`npm test --workspace packages/core -- test/interop.integration.test.ts` prints vitest's summary; the
root `npm test` runs it through the workspace. Q1 is done when the line reads `Test Files 1 passed,
Tests 20 passed` (2 role runs × scenarios A to J; the 28 numbered assertions above are all present,
spread over those 20 tests, and the sweep adds the same security checks to every one of them), and
`lib/chat/client.integration.test.ts` still reads `8 passed`.

Status 2026-10-31 (branch `mobile/qa/interop-test`): `20 passed`, five consecutive runs, no flake;
root `58 passed` unchanged; `packages/core` `70 passed` (50 + 20). Needs Node 22.13+ for `node:sqlite`
(the interop block is skipped, not failed, without it).

## 3. Maestro E2E flows (Q3, as written 2026-10-31)

The flows exist in `apps/mobile/e2e/` and are documented there (`README.md`); this section keeps the
design decisions and the list. **Written and statically checked, not run**: no Xcode, Android Studio,
Java or Maestro on this Mac and no device build yet. The check (`node apps/mobile/e2e/scripts/check-flows.mjs`)
parses every YAML, requires every `id:` to exist in `apps/mobile/e2e/TESTIDS.md`, forbids
`takeScreenshot`/`startRecording`, and lists the steps that depend on proposed ids as **dry**.

### 3.1 Setup facts (changes from v1)

- **testIDs**: the binding list moved from this file to `apps/mobile/e2e/TESTIDS.md` (single source of
  truth, lead's contract of 2026-10-31: 31 wave-1 ids, 10 wave-2 ids, plus 13 **proposed** ids the flows
  need and the lead has not accepted yet). The v1 table in this section is superseded; `mobile-ui` builds
  against `TESTIDS.md` only.
- **Second participant**: v1 planned a Node "companion" running the web core. Replaced, on the lead's
  instruction, by **two flows per two-device journey** (`<nn>-<journey>.yaml` on device A,
  `<nn>-<journey>.peer.yaml` or `04-let-in.yaml` on device B) sharing `MAESTRO_*` env and sequenced by
  `scripts/run-two-device.sh`. The room link crosses from A to B through a local in-memory **relay**
  (`e2e/relay/server.mjs`, `127.0.0.1:4311`, prints nothing): `copyTextFrom: id: invite.link` →
  `runScript relay-put.js`; B `runScript relay-get.js` → `openLink`. The link carries the invite token,
  so the run script never echoes it, the relay never writes it, and flow 08 burns the room.
- **Simulator-only triggers** that Maestro cannot express go through the relay too: a system
  screenshot (iOS Simulator "Save Screen" ⌘S, the one simulator action that fires
  `UIApplicationUserDidTakeScreenshotNotification`; Android `input keyevent KEYCODE_SYSRQ`) and the
  biometric match (`simctl … BiometricKit_Sim.fingerTouch.match`, `adb emu finger touch 1`). Both are
  deleted/cleaned at once; see README "What is never kept".
- **Links**: simulators do not verify Universal/App Links; `relay-get.js` rewrites
  `https://onepeek.io/…` to `onepeek://…` unless `MAESTRO_UNIVERSAL_LINKS=1` (physical devices; M9).
- **Where to run**: deferred to the lead; README writes up (A) GitHub Actions `macos-15` for iOS and
  `ubuntu` + KVM for Android with two simulators each, and (B) Maestro Cloud, which can run only the
  `single` set: one device per flow, no cross-flow ordering, and it keeps a screenshot of every step
  on their servers, which 05/06 (a revealed message, a view-once image) make unacceptable.
- **Dev build**: EAS `development` profile pointed at production, throwaway rooms (§0.2), as in v1.

### 3.2 Flow rules

- Never capture content: no `takeScreenshot`/`startRecording` (enforced); assertions on ids; message
  text asserted only **absent** (before and after hold-to-read); the revealed state is never asserted on
  text. Fixture strings only (§1.1). Rooms: 1-hour timer, `qa-launch`, burned by 08.
- Tags: `ios`, `android` on every flow; `single` (one device: 01, 02, 03, 09); `two-device` +
  `device-a`/`device-b` (03 to 08). `maestro test apps/mobile/e2e --include-tags single` for one device;
  `MAESTRO_DEVICE_A=… MAESTRO_DEVICE_B=… apps/mobile/e2e/scripts/run-two-device.sh` for two.
- `msg.<id>` is matched as the regex `msg\..+` with an `index`; `chats.room` is one id for every row,
  picked by index. `invite.link` must render the full link (README "Rendering requirements").

### 3.3 Flows

| # | Files | Journey | Runnable when |
| --- | --- | --- | --- |
| 01 | `01-welcome-guest.yaml` | Welcome → Get started → Continue as guest → Chats home | wave-1 screens |
| 02 | `02-signin-email.yaml` | Welcome → Sign in → email → "check your inbox"; stops there (link in a mailbox: manual M1); `MAESTRO_EMAIL` must be a team inbox, production sends a real mail | wave-1 screens |
| 03 | `03-create-secret-room.yaml` | New chat → Secret → name, nick, code, timer → create → invite sheet → copy → done; publishes the link | wave-1; timer option tapped by label until `new.timer.1h` |
| 04 | `04-join-with-code.yaml` (B) + `04-let-in.yaml` (A) | B: open link → code → nick → submit → waits; A: Chats home shows Let in → tap → open room | wave-1 |
| 05 | `05-message-roundtrip.yaml` (A) + `.peer.yaml` (B) | A types and sends; B: bubble visible, body **not** visible, hold-to-read, release, body not visible again, reply | wave-2 (`room.composer`, `room.send`, `msg.<id>`) |
| 06 | `06-file-view-once.yaml` (A) + `.peer.yaml` (B) | A attaches a photo as view-once; B opens once, second open refused, still refused after relaunch | **dry**: proposed `attach.*`, `viewer.*`; system picker labels need a device run |
| 07 | `07-screenshot-notice.peer.yaml` (B, first) + `07-screenshot-notice.yaml` (A) | system screenshot on B → notice row on A. Android: black image with `FLAG_SECURE`; the app learns of it only on Android 14+ (older Android: manual M2) | **dry**: proposed `room.notice`; iOS ⌘S trigger to confirm on first run |
| 08 | `08-burn.yaml` (A) + `.peer.yaml` (B) | menu → burn → confirm → room gone on both, still gone after relaunch; also the run's clean-up | wave-2 (`room.menu`, `room.burn`, `room.burn.confirm`) |
| 09 | `09-panic-lock.yaml` | panic → `locked.screen` (Chats and room **not** visible) → relaunch still locked → unlock only with `MAESTRO_BIOMETRIC=sim` (CI default `skip` ends on the locked screen) | wave-2 (`panic`, `locked.*`) |

Sub-flows: `_common/guest-home.yaml`, `_common/back-to-chats.yaml` (Android `back` / iOS edge swipe;
`room.back` proposed), `_common/open-room.yaml`. Count: 9 journeys, 14 top-level flow files, 3 sub-flows,
17 YAML files; expected at Gate 1: 14 flows × 2 platforms = 28 runs, 02 allowed to end at the sent state,
06 and 07 counted as dry until their ids land. v1's 03-lock-unlock (60 s auto-lock), 13-settings,
14-timer and 15-safety-number are not v1 journeys in the lead's list and stay manual (M6, M13) or Phase 3.

## 4. Manual security checks

Run on physical devices (simulators cannot show most of these). Each check is done on **every** device
in the matrix (§5) once per release candidate and recorded in `docs/mobile/gates/<phase>.md` as
`M<n> <device> PASS|FAIL <date> <evidence file>`. Evidence is a photo of the device taken with
another phone (never a screenshot of the device itself, for the obvious reason), or a terminal log.
Rooms are throwaway (§0).

| # | Check | Steps | Expected: Android | Expected: iOS |
| --- | --- | --- | --- | --- |
| M1 | Sign-in methods | Passkey, Apple (iOS), Google, email link; each then `locked.root` on relaunch | all four reach `chats.root`; email link opens the app via App Link | same; Apple sign-in sheet is native; passkey uses the system sheet |
| M2 | Screenshot in a room | hold a received Secret bubble, press the hardware screenshot combo | toast "Can't take screenshot due to security policy" (wording varies by OEM); no image in Photos; **no alert is sent** (nothing happened) | the screenshot **is taken** and shows what was on screen; within 5 s the other device shows the "may have taken a screenshot" notice; the SQL side shows ciphertext only. Store copy must say exactly this |
| M3 | Screen recording | start the system recorder, open a room, hold a bubble, stop | recording shows black for every chat screen; the Chats list is black too if N1 covers it (lead decision, §1.4) | recording shows the `app.cover` view (logo on `#0A0C0F`) for the whole time the app is captured; audio is irrelevant; the moment recording stops, content returns without re-auth |
| M4 | Screen mirroring / AirPlay | mirror to a TV or Mac | black (same as M3) | `app.cover` shown while mirrored |
| M5 | App switcher | open a room, swipe to the switcher | the thumbnail is black or shows the cover | the thumbnail shows `app.cover`, never a bubble |
| M6 | Auto-lock after 60 s | open a room, background the app, wait 65 s, return | `locked.root`; biometric prompt; after success the same room is shown without a reload | same; also check the 59 s case does **not** lock |
| M7 | Panic Exit | in a room, Settings → Panic Exit (or the gesture mobile-ui ships) | cover within one frame, `locked.root`; a force-quit and relaunch is still locked; nothing deleted | same |
| M8 | Push on the lock screen | lock the device; from the other side send `BODY` | banner says "OnePeek" / "You have a new message in a private chat." and nothing else; expanding it shows no more; tapping it opens the app **locked** (M6 state), then the room after unlock | same; with the notification preview set to "Always" the body is still only the fixed string |
| M9 | Links | tap an invite link in another app (Messages, Mail) | App Link opens the app directly (no chooser) when `assetlinks.json` verifies; `join.root` shows | Universal Link opens the app; the `#token` fragment is never sent to the server (check the Vercel log for `/chat/join` requests: path only) |
| M10 | Backup exclusion, iOS | Finder → back up to this Mac, unencrypted; then `sqlite3 ~/Library/Application\ Support/MobileSync/Backup/<udid>/Manifest.db "select relativePath from Files where domain='AppDomain-io.onepeek.app'"` | n/a | the app's SQLite database file and `-wal`/`-shm` are **absent**; Keychain items are not in an unencrypted backup by definition; document any file that is present |
| M11 | Backup exclusion, Android | `adb backup -f qa.ab io.onepeek.app` on a debug build (Android 11 and below); `adb shell bmgr backupnow io.onepeek.app` then `adb shell bmgr list sets`; on Android 12+ confirm `dumpsys backup` lists the package as not eligible | `qa.ab` is header-only (~1 KB) or the command reports the app opted out; `bmgr` shows no data set for the package; no `databases/` content anywhere in the archive | n/a |
| M12 | Device loss simulation | copy the app sandbox off a rooted test device / jailbroken test iPhone (or the simulator's data directory) to another install | the copied SQLite holds only ciphertext; without the Keystore-held wrapping key nothing decrypts (the §1.3 test shows this in code; here it is confirmed on the real store) | same with the Keychain |
| M13 | Watermark | hold a bubble in a Secret room; photograph the screen | faint `<nick> · <device code> · <time>` over the content, readable in the photo | same |
| M14 | Guest session loss | guest joins, force-quit, relaunch | the room is still there (the guest session is persisted in SecureStore) | same |
| M15 | Burned room on a locked phone | owner burns while the member's phone is locked | on unlock the room is gone and the SQLite has no `room:<id>:` rows (verify on the debug device via `adb shell run-as`) | verify via Xcode device container download on the test device |

What we do not test because it is not true: "iOS blocks screenshots", "the server cannot see who is
in a room" (it sees user ids and device ids), "push delivery is invisible" (`known-limitations.md` 7).

## 5. Phase 3: device matrix, performance, offline, accessibility

### 5.1 Device matrix

| Device | OS | Why |
| --- | --- | --- |
| iPhone 16 or 17 (current) | latest iOS | the reference device |
| iPhone SE (2nd gen) or iPhone 11 | the minimum iOS the SDK 58 build declares (read the deployment target after `expo prebuild`; if the device cannot run it, the oldest that can) | small screen, A13, no Face ID on the SE → Touch ID path |
| Budget Android (about ₹10k: Redmi / Realme / Samsung M-series, 3 to 4 GB RAM) | Android 10 or 11 as shipped | OEM background killers, slow storage, the `FLAG_SECURE` toast wording |
| Mid-range Android (Samsung A-series, One UI) | Android 13 or 14 | the most common Indian retail device class |
| Flagship Android (Pixel 8/9) | Android 15 or 16 | stock Android; Google Play Protect; `adb` debugging reference |

Each device gets the full §4 list and the §3 flows run manually once where Maestro has no device.

### 5.2 Performance budgets

Measured on a **development build with the perf logger on**, Wi-Fi, device rebooted, 5 runs, median
reported, worst run noted. The perf logger (`apps/mobile/perf.ts`) prints `perf <name> <ms>` only in
`__DEV__` and is covered by §1.6's rule (it logs names and numbers, nothing else).

| Budget | Target, flagship / current iPhone | Target, budget Android / older iPhone | How measured |
| --- | --- | --- | --- |
| Cold start to `locked.root` (or `chats.root` if unlocked) | ≤ 1.5 s | ≤ 3.0 s | Android `adb shell am start -W -n io.onepeek.app/.MainActivity` → `TotalTime`; iOS `perf startup` from `process` start (`ProcessInfo` via a tiny native module or the splash plugin's timestamp) to first `chats.root` layout |
| Unlock (biometric prompt dismissed → room list interactive) | ≤ 300 ms | ≤ 600 ms | `perf unlock` |
| `sync` of 200 text messages (fresh member, one batch) | ≤ 1.0 s | ≤ 2.0 s (the C2 spike's hard limit) | companion sends 200 messages before the member is admitted; `perf sync.200` |
| Encrypt + upload a 49.9 MiB file (`MAX_ATTACHMENT_BYTES`) | encrypt ≤ 2 s; total ≤ 30 s on Wi-Fi | encrypt ≤ 6 s; total ≤ 60 s | `perf file.encrypt`, `perf file.upload`; peak memory via `adb shell dumpsys meminfo io.onepeek.app` / Xcode gauge ≤ baseline + 150 MB; no OOM |
| Download + decrypt the same file | ≤ 20 s | ≤ 45 s | `perf file.open` |
| Group operations: admit 1 member / remove 1 member / burn | ≤ 500 ms each | ≤ 1.5 s | `perf admit`, `perf remove`, `perf burn` |
| Hold-to-read reveal | first frame ≤ 100 ms | ≤ 150 ms | `perf hold` |
| JS bundle size (release) | ≤ 6 MB Hermes bytecode | — | `eas build` artefact |

A budget miss on the budget device is a Gate 3 finding, not a pass with a note.

### 5.3 Offline and reconnect scenarios

Each is a Maestro flow where the simulator supports it (airplane mode via `adb shell cmd connectivity
airplane-mode enable`; iOS simulator has no airplane mode, so iOS is manual) and a manual check on
devices otherwise.

| # | Scenario | Expected |
| --- | --- | --- |
| O1 | Send while offline | the bubble shows a "waiting" state; no `chat_send` RPC until online; on reconnect it is sent **once** (same id, the server dedupes) and the state shows sent |
| O2 | Receive after 10 minutes offline | one `sync` fetches everything after `lastSeq`; order correct; no duplicate bubbles |
| O3 | Expiry while offline | messages that expired on the server while offline are gone after `sync`, including their sealed rows |
| O4 | Admit while the member is offline | the pending member's next `sync` returns `joined: true` without a second invite |
| O5 | Burn while offline | the member's next `sync` returns `removed: true`; local rows gone; the room list no longer shows it; no error toast with a room name |
| O6 | Realtime drop | kill the realtime connection (toggle Wi-Fi); within 30 s of reconnect a message sent by the companion appears without the user pulling to refresh |
| O7 | App killed mid-upload | the file is not shown as sent; on relaunch there is no half-registered attachment visible; the server-side `chat_attachments` row (if created) is reaped by `chat_reap` later |
| O8 | Clock skew | set the device clock 10 minutes ahead; timers display from server `expires_at`, and a message does not vanish early |
| O9 | Low storage | fill the device to < 100 MB free; the app opens, shows a clear error on send file, never corrupts the SQLite (reopen works) |

### 5.4 Accessibility

| # | Check | Expected |
| --- | --- | --- |
| A1 | VoiceOver / TalkBack through flow 05 to 10 | every `testID` element has an `accessibilityLabel` that is a verb or a noun (not "button"); bubbles read "<nick>, <time>, hold to read" in Secret rooms and the body in other rooms; the notice reads as a notice |
| A2 | Hold-to-read with a screen reader | a double-tap-and-hold reveals; the body is read while held; nothing is read when released |
| A3 | Dynamic type at the largest accessibility size (iOS "AX5", Android font scale 2.0 + display size largest) | no clipped text in any §3.2 screen; the composer still shows `composer.send`; bubbles wrap; the 60-digit safety number wraps in groups |
| A4 | Reduce motion | the hold reveal and the cover have no animation that violates it |
| A5 | Contrast | `#C8F135` on `#0A0C0F` and the own-bubble gradient text pass 4.5:1 for body text (compute from the final theme tokens) |
| A6 | Touch targets | every interactive element ≥ 44 × 44 pt (Maestro cannot measure; use Xcode Accessibility Inspector / Android Accessibility Scanner once per screen) |
| A7 | Screen reader and security | with VoiceOver on, a screenshot still sends the alert; `FLAG_SECURE` still applies; the cover view announces "OnePeek is hidden" |

## 6. Flakiness policy, commands and reporting

### 6.1 Policy

- A test that fails once and passes on rerun **is failing**. It is marked `it.skip` with a comment
  `// FLAKY <date> <issue link>` within one hour by whoever saw it, the skip is counted and reported
  as a failure in the gate document, and the owning agent fixes or deletes it before their PR merges.
- No `retry` in vitest config; no `retries` in Maestro flows beyond Maestro's default element wait.
  Timing is controlled with fake timers (unit) or server state (interop), never with `sleep`.
- A test depending on wall-clock ordering, `Math.random`, or network is rewritten. The only clock in
  the interop test is PGlite's `now()`, moved with `update ... set expires_at = now() - interval ...`
  as the SQL tests do.
- CI runs the suite once. A green CI with a quarantined test is reported as `N passed, M quarantined`,
  never as "green".

### 6.2 Commands (exact; Node from `~/Sites/newspop/.node/bin` on this Mac)

```sh
export PATH=/Users/pulkitverma/Sites/newspop/.node/bin:$PATH

# Unit + interop (root fans out to every workspace)
npm run typecheck
npm run lint
npm test                                               # root + packages/core + apps/mobile
npm test -w packages/core                              # core only
npm test -w apps/mobile                                # security + adapters-in-app tests
npx vitest run packages/core/test/interop.integration.test.ts
npx vitest run lib/chat/client.integration.test.ts     # web regression, must stay 8 passed
npm test -w packages/core -- test/leak-guard.test.ts src/log.test.ts   # leak guard, run 3× before a report
node apps/mobile/e2e/scripts/check-flows.mjs            # Maestro flows: YAML, ids vs TESTIDS.md, no screenshots

# Maestro (a machine with simulators; see apps/mobile/e2e/README.md "Where to run")
maestro test apps/mobile/e2e --include-tags single --include-tags ios     --format junit --output apps/mobile/e2e/results/ios.xml
maestro test apps/mobile/e2e --include-tags single --include-tags android --format junit --output apps/mobile/e2e/results/android.xml
MAESTRO_DEVICE_A=<udid> MAESTRO_DEVICE_B=<udid> apps/mobile/e2e/scripts/run-two-device.sh   # 14 flows, A/B alternating

# Device perf
adb shell am start -W -n io.onepeek.app/.MainActivity
adb logcat -s ReactNativeJS | grep '^perf '
```

### 6.3 Reporting format (every agent, every report and gate document)

One block per suite, copied from the tool's own summary, with the command above it:

```
$ npm test
 Test Files  9 passed (9)
      Tests  112 passed | 0 skipped (112)
   Duration  18.4s
quarantined: 0

$ maestro test apps/mobile/e2e/flows --include-tags ios
 15 flows: 15 passed, 0 failed, 0 skipped   (iPhone 16 simulator, iOS 26.0, build dev-<eas id>)
```

Rules: numbers, not adjectives ("all green" is not a report); a skipped or quarantined test is listed
by file and reason; a manual check is `M<n> <device> PASS|FAIL <date> <evidence>`; a perf number is
`<name> median <ms> worst <ms> (<device>, <build>)`; a failure includes the first assertion message
verbatim and the fixture string it leaked, if any.

## 7. Open questions for the lead

1. **Room id in push.** The web payload already carries the room UUID in `url` and `tag`
   (`app/api/chat/notify/route.ts`). B4 says the mobile payload has "no room". Decide
   `ROOM_IN_PAYLOAD` (§1.5): dropping it means the app opens on the Chats list after a tap, keeping it
   means the push service sees which room is active. Recommendation: drop it; the app is locked on tap
   anyway (M8) and the list is one tap away. **Answered 2026-10-31 (log.md): `ROOM_IN_PAYLOAD=true`**, the
   room id travels as an opaque routing key; §1.5 is written against that.
2. **`FLAG_SECURE` on the Chats list.** N1 says "chat and secret screens". The list shows room names
   and nick names (local data). Recommendation: cover the list too; it costs nothing and simplifies
   M3/M5.
3. **Harness extraction.** Moving the PGlite boot and `fakeSupabase` into `supabase/tests/harness.ts`
   touches the web test file (imports only). Approve, or Q1 duplicates the 90 lines.
4. **Owner nickname.** The web test only asserts the member's nickname reaches the owner. If the
   owner's nickname is not sent on create, mobile `members()` shows `null` for the owner (§2.2 H26).
   `core-crypto` to confirm; otherwise it is a Phase 1 fix.
5. **Simulators.** Answered 2026-10-31: flows written regardless; where to run is still open. Both options
   are written up in `apps/mobile/e2e/README.md`; qa's recommendation is GitHub Actions (`macos-15` for
   iOS, `ubuntu` + KVM for Android) because Maestro Cloud cannot run the two-device journeys and keeps
   per-step screenshots off-site.
6. **`node:sqlite` for the SQLite mock.** Needs Node ≥ 22.13; CI's Node version must match. The
   alternative is `better-sqlite3` (native build, slower install). Recommendation: `node:sqlite`.
7. **Older iPhone.** Confirm the minimum iOS after the first prebuild so the second iPhone in §5.1 is
   bought or borrowed early.
8. **Proposed testIDs.** 13 ids the flows need are not in the contract (`TESTIDS.md` "Proposed"):
   `signin.sent`, `join.waiting`, `join.error`, `new.timer.1h` (+ `.30s/.5m/.1d`), `room.back`,
   `attach.photo/.file/.viewOnce/.send`, `viewer.screen/.close/.gone`, `room.notice`. Accept, rename or
   reject; 06 and 07 stay dry until then.
9. **`log` export.** `packages/core/src/log.ts` is not re-exported from `src/index.ts` (core-crypto's
   file). Screens import `@onepeek/core/src/log`; say if you want it on the package root.
10. **`MAESTRO_EMAIL`.** Flow 02 sends a real magic link from production; the default
   `qa-maestro@onepeek.io` must be an inbox the team controls, or the lead names one.

## 8. Phase 1: Gate 1 criteria map

Gate 1 (`plan.md` §3): phone ↔ browser end to end on the live project, push with no content, black
screenshots on Android, blanked recording on iOS, lock works, no open high findings. For each criterion:
what proves it, who owns the proof, and where it stands on 2026-10-31. "pending device build" means the
proof exists or is specified but needs the EAS development build (blocked on the Expo/Apple accounts).

| Gate 1 criterion | Automated proof | Manual proof | Owner | Status 2026-10-31 |
| --- | --- | --- | --- | --- |
| Phone ↔ browser end to end on the live project | `packages/core/test/interop.integration.test.ts` (20 scenarios, roles swapped, every artefact swept; PGlite, not the live project, by rule §0.1) | one throwaway room on production: phone dev build + browser, create → join → text both ways → file → view-once → burn; evidence per §6.3 in `gates/phase-1.md` | qa (test), lead (live run) | test green (87/87 core); live run **pending device build** |
| Push with no content | `lib/alerts.native.test.ts` forbidden-strings sweep (§1.5, spec written, backend writes it, qa reviews in wave 2); `supabase/tests/push-devices.test.ts` RLS + `register_push_device` (§1.5) | M8: banner shows only `OnePeek` / `You have a new message in a private chat.`, expanding shows nothing more, tap opens the app locked | backend (tests), qa (review, M8) | tests **pending backend B1/B2/B4**; M8 pending device build + APNs/FCM keys |
| Black screenshots on Android | `apps/mobile/security` tests (§1.4 `secureFlag.test.ts`: `preventScreenCaptureAsync` on every `/room`, `/secret`, `/join` route, and the Chats list per the lead's answer); Maestro 07 asserts the notice side only, and only on Android 14+ | M2 Android: hardware screenshot in a room → OEM toast, no image in Photos; M5 switcher thumbnail black | native-security (N1, tests), qa (M2, M5) | **pending N1 + device build**; note: Maestro cannot verify that an image is black; M2 is the proof |
| Blanked recording on iOS | `capture.test.ts` (§1.4: `UIScreen.isCaptured` true → cover shown; cover reasons independent) | M3 iOS: system recorder shows the cover for the whole capture; M4 mirroring | native-security (N2, tests), qa (M3, M4) | **pending N2 + device build** (simulators cannot record the screen the way a device does) |
| Lock works | `autoLock.test.ts`, `biometric.test.ts` (§1.4); core `platform.test.ts` M3 fail-closed lock (landed, 87/87); Maestro 09 (panic → locked, relaunch still locked; unlock with `MAESTRO_BIOMETRIC=sim`) | M6 60 s auto-lock (and the 59 s non-lock), M7 Panic Exit | native-security (N4), qa (09, M6, M7) | core part landed; app tests **pending N4**; 09 written, **pending device build** |
| No open high findings | — | security-reviewer's Phase 1 report in `docs/mobile/security-review/`; every PR reviewed before merge (S1) | security-reviewer | S0 closed with no open high/critical (log.md 2026-10-31); S1 ongoing |
| Leak guard (not a gate line, but the rule-1 proof the gate relies on) | `packages/core/test/leak-guard.test.ts` 53/53 ×3, `npm run lint` 0 errors, static sweep clean (§1.6) | — | qa | **landed** 2026-10-31 |
| Maestro journeys 01-09 | `check-flows.mjs` static check: 14 flows, 54 ids, 7 dry steps on proposed ids | run on two simulators per README; 02 ends at the sent state by design | qa (flows), lead (runner decision, §7.5) | **written, not run**; pending runner decision, wave-2 ids, proposed ids (§7.8) |

Reporting at the gate follows §6.3: counts from the tools, dry steps listed by id, manual checks as
`M<n> <device> PASS|FAIL <date> <evidence>`.
