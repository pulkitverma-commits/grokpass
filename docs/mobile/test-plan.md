# OnePeek mobile: test plan v1

Owner: `qa`. Status: v1.3 (2026-11-01, Phase 2, task Q5 + carry-over W3-3): §1.6 the W3-3 sink rules and the
"name-based, not taint" statement, §2.4 the cross-platform secrets interop test as built, §3.3 flows 12–16, §4 M18
and §4.2 the Phase 2 device checks (share receive, Universal Links; native-security's S21+ referenced), §6.2 the new
commands, §9 the Gate 2 criteria map. v1.2. v1 written 2026-10-31 for task Q2 (`plan.md` §2) and merged; v1.1 (same day,
tasks Q3/Q4) records what was built: §1.6 the leak guard as landed, §3 the Maestro flows as written, §8 the
Gate 1 criteria map, and the §1.3 siteUrl correction from the S0 close-out (N4). v1.2 (same day, Phase 1
wave 2): §1.5 the qa review of backend's push tests (pass/gap per item), §1.6 the W1-10 rules, §3 the flows
reconciled with the merged screens plus 10 and 11, §4 the native-security device checks S1–S20 folded in
with owners, §6.2 the jest timeout and the Expo config check before the first push test, §8 the W1 fixes'
tests.
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
- **Migration 008** (`supabase/tests/push-devices.test.ts`, PGlite, owner `backend`; **exists, 12 tests**,
  qa reviews it against this list in wave 2): owner can insert
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
  `notification.title`/`body` equal to the same two strings (lead confirmed: the native body is
  `You have a new message in a private chat.`, identical to the web), no `image`, and `data` keys limited to
  `{ room }` when `ROOM_IN_PAYLOAD` (the lead set it to `true` on 2026-10-31, log.md); (4) assert the
  only UUID in either payload is the room id (regex over the serialised payload, count == 1 when
  `ROOM_IN_PAYLOAD`, 0 otherwise) so a sender or recipient id can never ride along; (5) the APNs
  `apns-topic` header is `io.onepeek.app` and `apns-push-type` is `alert`; the FCM target is
  `https://fcm.googleapis.com/v1/projects/<project>/messages:send` (no other host appears in any URL);
  (6) a recipient with `notify_prefs.push_on = false` produces zero requests on every transport;
  (7) APNs `410`/`BadDeviceToken` and FCM `UNREGISTERED` delete the `push_devices` row, and the web
  `404/410` path is unchanged (regression); (8) the credentials (`APNS_*`, `FCM_SERVICE_ACCOUNT_JSON`)
  never appear in a thrown error message or in the captured payload (add them to the forbidden list).

**qa review of the two files, wave 2 (2026-10-31, read in full, not run in isolation; both pass in the
root `npm test`: web 108/108).** Pass means the test exists and asserts what the item asks; gap names the
exact missing assertion for backend to close.

`supabase/tests/push-devices.test.ts` (14 tests, PGlite, 006 + 007 + 008, up/down/up):

| item | result | where / what is missing |
| --- | --- | --- |
| (a) owner = `auth.uid()`, forged owner impossible | **pass** | the RPC takes `(p_platform, p_token)`, no owner argument; "lets an owner register and see only their own row" asserts `owner = ALICE`; a direct `insert … owner = ALICE` as BOB is refused by RLS ("keeps other users from…") |
| (b) anon denied | **pass** | "denies anon the table and both RPCs" (`permission denied` on select and both RPCs) |
| (c) guest may register | **pass** | "lets a chat guest (anonymous user) register" |
| (d) same token re-registered → one row, `last_seen` bumped | **pass with a gap** | "re-registering the same token updates last_seen and platform" re-registers with a *different* platform (`ios` → `android`). The literal case, same `(platform, token)` twice, is only implied by the W1-3 test's row count. **Gap:** add `register(ALICE,'ios',TOKEN_A)` twice and assert one row with a later `last_seen` **CLOSED** by "registering the same (platform, token) twice keeps one row (same id, created_at) and advances last_seen (§1.5 d)" |
| (e) token held by another owner moves to the caller, old row gone | **pass** | "a token belongs to one owner… (W1-2)": one row, Bob's; Alice's unregister touches nothing; service role sees one row; direct insert of a held token hits the unique constraint |
| (f) token stored as given; nothing else stored (`row::text` dump) | **gap** | token equality is asserted (`TOKEN_A`), but no test dumps a row as `row::text` / `row_to_json` or lists `information_schema.columns` for `push_devices`. **Gap:** assert the column set is exactly `{id, owner, platform, token, created_at, last_seen}` (whatever 008 defines) and that `row::text` of a registered row contains nothing but those values: no device label, user agent, room id or email **CLOSED** by "stores exactly id, owner, platform, token, created_at, last_seen: no label, user agent, room or email (§1.5 f)" (information_schema column set, `row_to_json` keys, `row::text` field count and leak strings, session claims ignored) |
| (g) `platform` constrained | **pass, plan corrected** | 008 allows `ios | android` only (`bad_platform` for `web`, asserted); the plan's `web` was wrong (web push lives in `push_subscriptions`). Only `web` is tried as the bad value; good enough, the check is the same `in` test |
| (h) RLS after registration | **pass** | owner select = 1 row, other user = 0 rows, non-owner `insert` rejected (`row-level security`), non-owner `update`/`delete`/`unregister` leave the row untouched |
| extra | **pass** | W1-3 cap of 10 per owner (oldest dropped, other owners untouched), token shape `[A-Za-z0-9:_-]{32,512}` incl. an FCM-shaped token and the table check constraint, `search_path = ''` on both RPCs, service-role read, cascade on user delete, down/up leaves 006 intact |

`lib/alerts.native.test.ts` (25 tests, mocked HTTP/2 and fetch, throwaway EC/RSA keys):

| item | result | where / what is missing |
| --- | --- | --- |
| (1) forbidden-strings context from the §1.1 fixtures via `forbidden()` (text, hex, base64, base64url) | **gap** | the file uses its own 7-string `FORBIDDEN` list (a decoy body, nickname, file name, code, invite token, room name, sender uuid) in text form only; it does not import `packages/core/test/fixtures.ts`. Since `apnsPayload`/`fcmMessage` take `{ room }` only and the shapes are `toEqual`-exact, no other byte can ride along, so this is a *consistency* gap, not a leak. **Gap:** import `BODY, BODY2, FILE_NAME, FILE_BODY, ACCESS_CODE, NICK, OWNER_NICK, ROOM_NAME` and `forbidden()`/`expectClean()` from `../packages/core/test/fixtures` and sweep with them (plus the item 8 credentials) **CLOSED** by "fixture sweep over every captured request" (4 tests: APNs, FCM, `pushToNative`, and a canary proving the sweep flags BODY in all four encodings, a key id, a PEM and the client email) |
| (2) every captured request (URL, headers, body) swept | **pass with a gap** | APNs: body and headers swept, `authority`/`path` asserted exactly; FCM: body swept, the send URL and the `authorization` header asserted exactly but not swept. **Gap:** `expectClean(JSON.stringify(call))` over every `http2Request`/`fetch` call in one helper **CLOSED** by the same `sweep()` helper: `JSON.stringify` of every `http2Request` and `fetch` call (URL, headers, body, including the FCM token exchange) against `forbidden()` forms of the fixtures |
| (3) exact APNs and FCM shapes | **pass** | "APNs payload is exactly the fixed shape plus the room id" (`aps.alert.title/body`, `sound`, `thread-id` mirror, `room`); FCM `notification.title/body`, `data: { room }`, `android.notification.tag = chat-<room>`, no `apns` block; `toEqual` excludes `mutable-content`, `subtitle`, `category`, `image` by construction |
| (4) the only UUID is the room id | **pass, plan corrected** | asserted as "every UUID in the serialised payload equals `ROOM`" rather than `count == 1`: the id appears twice on purpose (`room` + `thread-id`, `data.room` + `tag`). The plan's `count == 1` is replaced by "all UUIDs equal the room id" |
| (5) `apns-topic`, `apns-push-type`, FCM URL | **pass** | `io.onepeek.app`, `alert`, `https://fcm.googleapis.com/v1/projects/onepeek-test/messages:send`; the only other host is `https://oauth2.googleapis.com/token` (the token exchange, asserted exactly); sandbox host under `APNS_USE_SANDBOX=1` |
| (6) opt-out → zero requests | **pass (route level)** | not in this file: `app/api/chat/notify/route.test.ts` "sends web and native pushes to the other active members, skipping the sender and opted-out users" covers `notify_prefs.push_on = false` for both `pushTo` and `pushToNative`; the throttle is "still throttles via chat_rate_ok before sending anything" |
| (7) dead tokens | **pass** | APNs `410` / `BadDeviceToken` / `Unregistered` dead, `503` kept; FCM `UNREGISTERED` / `NOT_FOUND` dead, `429` kept; `pushToNative` deletes dead rows for that owner only; web `404/410` regression ("pushTo is unchanged") |
| (8) credentials never in a payload or an error | **gap** | `APNS_KEY_ID`, `APNS_TEAM_ID`, the EC and RSA PEMs and the FCM `client_email` are not in `FORBIDDEN`; no test makes a transport throw and inspects the error message. **Gap:** add the five values to the forbidden list, sweep every captured request with them, and add one test where `http2Request` / `fetch` rejects and the surfaced error (`sendApns` swallows to "kept", so assert on the rejection reason through a spy, or on `nodeHttp2Request`'s rejection message) contains none of them **CLOSED** by "credentials never in an error" (8 tests): APNs 500, APNs transport throwing an error stuffed with the key, FCM 500, FCM exchange 500 and fetch rejecting, `pushToNative` with both failing, `nodeHttp2Request` rejection messages, a malformed key, `bad_room` message; returned value, thrown error and console output swept for `APNS_KEY_ID`, `APNS_TEAM_ID`, both PEMs (and DER body, env-escaped form) and the FCM `client_email`/`private_key`. The provider JWTs legitimately encode key id, team id and client_email, so the `authorization` header and `assertion` are swept for key material and message content, and everything else for all credentials |
| extra | **pass** | ES256 provider JWT (`kid`, `iss`, `iat`, signature verified, cached 50 min), RS256 assertion (scope, aud, 1 h, verified, cached), W1-3 concurrency of 10 on both transports and read cap of 10, W1-5 `nodeHttp2Request` settles on close/timeout/deadline/connect throw and only once, no-op without env |

**Update (backend, test-gaps pass): all 4 gaps closed, no leak and no behaviour change found.** (`alerts.native.test.ts` 25 → 37 tests, `push-devices.test.ts` 15 → 17.) Original net:

Net: 4 gaps, all additive assertions, none a leak today: (d) same-platform re-register, (f) `row::text` /
column-set dump, (1)+(2) fixtures-based sweep over every captured request, (8) credentials in the forbidden
list plus an error-path test. Backend closes them in its next pass; §8 keeps "push with no content" at
"tests landed, review gaps closed" (closed 2026-10-31, backend `test-gaps` pass).

### 1.6 Leak guard (Q4, as built 2026-10-31; W1-10 additions same day; W3-3 additions 2026-11-01)

**What this guard is, stated plainly so nobody reads it as a guarantee: a name-based lint tripwire, not taint
analysis.** Every selector below fires on the *lexical shape* of a call and the *name* of its argument (`token`,
`m.body`, `` `…${accessCode}` ``, `{ message: plaintext }`). It does not follow a value: `const text = m.body;
Clipboard.setStringAsync(text)` passes, so does `Share.share({ message: render() })`, a URL built from a token two lines
earlier, a spread or computed property, `globalThis.WebSocket`, a module alias (`import * as C from 'expo-clipboard'`),
string concatenation, `xhr.send(body)`. The proof that nothing leaks is never this lint; it is the tests that sweep the
rendered tree (`room.test.tsx` `treeText()`, now a deny-list walk after W3-4), the captured requests and the SQL log
(`interop.integration.test.ts`, `secrets.interop.test.ts`, `alerts.native.test.ts`), and the security reviewer reading
every PR that adds an off-device call. **What a reviewer must still read by hand** on every PR that touches a screen or
adapter: (1) every `Clipboard`/`Share`/`Sharing`/`Linking`/`WebBrowser`/`MediaLibrary`/`Notifications` call and what the
variable handed to it *holds*, not what it is called; (2) every `fetch` with a computed URL (the host rule only covers
literals; `checkOnePeekUrl` in the adapter is the runtime check); (3) every `<Image source>` / `WebView` / `Video` with a
remote URI; (4) every write to disk (`File`, `FileSystem`, SQLite outside the keystore) and where it lives (`Paths.cache`
is swept on launch; nothing else is); (5) every `Alert`, toast, `accessibilityLabel`, `title` and notification body
that is not a fixed string; (6) every new third-party dependency, for telemetry the import rule does not list.


The rule set lives in `packages/core/eslint.config.mjs` and, as a kept-in-sync copy, in
`apps/mobile/eslint.config.mjs` (the app's lint must not import the core's tooling). Everything is an
**error**; `npm run lint` is at 0 errors with the existing code. What is caught, by `no-restricted-syntax`
selectors (esquery; regexes use `\x2f` for `/`):

| Pattern | Example that fails | Scope |
| --- | --- | --- |
| console | `console.log(x)`, `if (__DEV__) console.warn(x)` | all files (`no-console`, pre-existing) |
| telemetry call | `Sentry.captureMessage(x)`, `Sentry.Native.captureException(e)`, `crashlytics().log(x)`, `analytics.track(...)`, `posthog.capture(...)`, also `Bugsnag`, `datadog`, `mixpanel`, `amplitude`, any method, case-insensitive | all files |
| telemetry import | `import … from '@sentry/*'`, `@bugsnag/*`, `@datadog/*`, `mixpanel*`, `@amplitude/*`, `posthog*`, `@react-native-firebase/crashlytics|analytics`, `@segment/*`, `expo-analytics`, `expo-insights`, `expo-updates` (both phone home with device data; W1-10); also `require(...)` of the same | all files |
| ad-hoc logger | `logger.info(x)`, `log.warn(x)` and the other logging verbs (`log info warn error debug trace fatal verbose silly notice critical`) on an identifier named `log` or `logger`. `log.push(...)` on an array is not matched | all files |
| stringify to a sink | `JSON.stringify(<ident>)` or `JSON.stringify(<obj>.<prop>)` where the identifier/property is one of `message body plaintext token accessCode code secret key nick fileName name`, passed to any sink above, to `log(...)`/`logger(...)` or to `console.*` | all files |
| off-device sink (W1-10) | `Clipboard.setString*/setUrl*/setImage*`, `Share.share/open`, `Linking.openURL/sendIntent/openSettings`, `WebBrowser.open*Async`, `Alert.alert/prompt`, `new WebSocket(...)`, `new XMLHttpRequest(...)` when an **argument** is a secret-named identifier (`token`), member (`m.body`), a template expression (`` `…${accessCode}` ``) or an object-property value (`{ message: plaintext }`), same `SENSITIVE` list. The call itself is allowed: `Clipboard.setStringAsync(link)`, `Share.share({ message: link, url: link })`, `WebBrowser.openBrowserAsync('https://onepeek.io/terms')`, `openAuthSessionAsync(url, redirect)` and a fixed `Alert.alert` (InviteSheet, Welcome, sign-in, Settings) lint clean | all files |
| off-device sink, W3-3 additions | the same argument shapes for `Sharing.share/shareAsync` (expo-sharing, what `lib/files.ts` `shareBytes` uses), `Notifications.scheduleNotificationAsync/presentNotificationAsync`, `MediaLibrary.saveToLibraryAsync/createAssetAsync/createAlbumAsync/addAssetsToAlbumAsync`, and **any** `.write(…)`, `.writeAsStringAsync(…)`, `.writeAsync(…)`, `.writeAsStringSync(…)` call (`new File(Paths.cache, n).write(plaintext)`, `t.write(m.body)`, `FileSystem.writeAsStringAsync(uri, body)`); plus one nested object level for `{ content: { body } }` / `{ content: { title: m.nick } }` / `` { content: { body: `${nick}…` } } ``. `Sharing.shareAsync(uri, { mimeType })`, `MediaLibrary.saveToLibraryAsync(uri)`, `f.write(bytes)` lint clean | all files |
| notification copy (W3-3) | `Notifications.scheduleNotificationAsync|presentNotificationAsync({ content: { title|subtitle|body: <anything but a string literal> } })`: lock-screen text is fixed copy, whatever the variable is called (`body: text` fails even though `text` is not on the list). Route with `content.data = { roomId }` | all files |
| backed-up directory (W3-3) | `Paths.document`, `FileSystem.documentDirectory` anywhere: Documents is in the iOS backup set and Android auto-backup; temporaries go under `Paths.cache` (swept on launch) and nothing else is written | all files |
| remote image URL (W3-3) | `<Image|ImageBackground|ExpoImage|FastImage source|src={{ uri|url: <secret-named identifier, member or template expression> }}>`: the host receives it. `<Image source={{ uri }}>` with the viewer's local `uri` lints clean | `apps/mobile/**` (JSX; the core has no .tsx) |
| fetch host | `fetch('<literal>')`, `globalThis.fetch('<literal>')` or an expression-free template literal whose URL is not `https://onepeek.io/…`, `https://*.onepeek.io/…` or `https://<project>.supabase.co/…`: another host, a look-alike (`onepeek.io.evil.example`), plain `http:`, or a relative path | `apps/mobile/**`, `packages/core/src/adapters/rn/**` (the web adapter keeps its relative `/api/chat/notify`) |

The approved path is `packages/core/src/log.ts`: `log(event, fields?)` is a **no-op** in every build
(OnePeek ships no telemetry) and `redact(value)` is what a screen passes its fields through so that, if a
sink is ever wired in there (lead + security-reviewer decision), nothing sensitive can reach it:
sensitive keys (`SENSITIVE_KEY`: message, body, plain, text, token, access, code, secret, key, nick,
file, name, password, email, link, url, session, jwt, state; case-insensitive, anywhere in the key) become
`[redacted]` **whatever the value's type** (W3-3 proof: `{ code: 447101 }` → `[redacted]`), strings are capped at
32 chars **except inside arrays, where every string and number is redacted whole at any depth** (W1-10:
`redact({ ids: [token] })` used to keep the token's first 32 characters because `ids` is not a sensitive key; W3-3:
`{ ids: [447101] }` kept the number the same way), a bare string or number at the top level is redacted whole, byte
buffers become `[bytes:n]`, errors keep only `name` and the trailing `[a-z_]+` code, depth stops at 4. **Not
covered, by design:** a secret held as a number under a neutral key (`{ value: 447101 }`) is kept; the redactor is
name-based like the lint. Screens import it from the package root (`log`, `redact` are exported from `index.ts`
since Q4 merged) or as `@onepeek/core/src/log`. `packages/core/src/log.test.ts` (10 tests) covers each rule.

`packages/core/test/leak-guard.test.ts` (113 tests, ~1 s) runs ESLint programmatically with both
configs: 55 probe files (one per forbidden pattern; 16 added for W1-10: the two imports and a `require`,
clipboard identifier/member, share object-property identifier/member, `Linking.openURL` template with an
identifier/member, `WebBrowser` identifier and auth-session member, `Alert` identifier/member, `new
WebSocket` identifier/template; 16 added for W3-3: `Sharing` identifier/member, notification `content.body`
identifier / `content.title` member / body template / neutral-named body, `MediaLibrary` identifier/member,
`File#write` identifier/member, `FileSystem.writeAsStringAsync`, `Paths.document`, `FileSystem.documentDirectory`,
and three JSX `<Image source={{ uri }}>` probes linted by the app config only, since the core has no `.tsx`) are
written to the scratchpad, read back and linted
under a virtual path inside the package (`src/chat/…`, `src/adapters/rn/…`, `app/…`), each must be
reported with the matching message and nothing else at error level; a clean file (`log` + `redact`,
`fetch` to onepeek.io/supabase.co/computed URL, `JSON.stringify({ roomId })`) must pass both; the fetch
rule must stay scoped (web adapter's relative fetch passes); `log.push` must not be mistaken for a
logger; the off-device rule is about the argument, not the call (`Linking.openURL(href)`, `Alert.alert('Chat
' + roomId)`, `new WebSocket(href)` pass; the clean file also carries the InviteSheet/Welcome/sign-in
shapes). The temp dir is removed in `afterAll`. The same file holds the **static sweep**: walks
`apps/mobile/**/*.{ts,tsx}` (minus `node_modules`, `ios`, `android`, `.expo`, `e2e`, `__tests__`,
`*.test.*`) and `packages/core/src/**/*.ts` (minus tests) and fails on any line matching `console\.` or
`__DEV__\s*&&\s*console`, grep-style (comments included: a shipped file does not mention the console
with a dot after it). Ran 3× on 2026-10-31 (wave 1), 61/61 each time; ran 3× after the W1-10 additions
(leak-guard + log, `npm test -w packages/core -- test/leak-guard.test.ts src/log.test.ts`), 93/93 each
time, no flake. `npm run lint` stays at 0 errors with the merged wave-2 screens. W3-3 (2026-11-01): leak-guard 113 +
log 10 = 123/123, ran 3×, no flake; `npm run lint` 0 errors with the Phase 1 app (`lib/files.ts` `Sharing.shareAsync(uri,
…)` and `f.write(bytes)`, `FileViewer` `<Image source={{ uri }}>` all pass, as intended: neutral names, local URIs).

Not covered (by design, named so nobody assumes otherwise): string concatenation of a secret into a
sink (`log('x ' + token)`, `Clipboard.setStringAsync('code: ' + code)`) is not matched (template literals
are, for the off-device sinks; `JSON.stringify` is, for the logging sinks); a value renamed first
(`const s = token; Share.share({ message: s })`) or reached through a non-sensitive name (`row.value`,
`fields[0]`) is not matched, the rule is lexical and `SENSITIVE` is a fixed list (`message body plaintext
token accessCode code secret key nick fileName name`); a sink imported under another name (`import {
captureMessage as cm }`) is caught by the import rule, not the call rule, and a module alias
(`import * as C from 'expo-clipboard'; C.setStringAsync(token)`) is not caught at all, the object name must
be `Clipboard`/`Share`/`Linking`/`WebBrowser`/`Alert`; `fetch` with a computed URL is the adapter's
responsibility (`checkOnePeekUrl`); `Image source={{ uri }}` with a remote URI, `expo-file-system`
uploads/downloads, `expo-sharing` (`shareBytes` in `lib/files.ts`, used by the viewer on purpose),
`expo-mail-composer`/`expo-sms`, `Intent` extras and iOS user-activity/Spotlight APIs are not sinks the
lint knows (W3-3 closed `Sharing`, `MediaLibrary`, `Notifications`, file writes, `Paths.document` and `Image
source` by name; `expo-mail-composer`/`expo-sms`, `Intent` extras, Spotlight/user-activity, `WebView`/`Video` sources
stay unlisted); `XMLHttpRequest` is banned as a global in the core (`no-restricted-globals`) but in the app only a
secret-named constructor argument is flagged, `xhr.send(body)` is not. The rule set is a net under the reviewer, not
a replacement: every PR that adds an off-device call is read by security-reviewer (the list at the top of this
section is what to read).

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
    `expiresAt !== null`. **Fixed (core-crypto, Phase 1, merged into `mobile/integration`):** `sync()`
    now returns `newAlerts` separately; a screenshot notice counts in `newAlerts`, not `newMessages`.
    The test asserts `newAlerts === 1` and `newMessages === 0` for the alert, so an unread badge built on
    `newMessages` stays honest. An alert triggers no `env.notify` (no push).

**H. Nickname**
25. Member joined as `NICK`; after the admit commit and one `sync` on each side, owner
    `members().find(role==='member').nickname === NICK`; the DB dump has no `NICK` as text, hex or
    base64 in any table; the rows the `chat_room_members` RPC returns (called directly on the fake,
    since the log keeps arguments, not results) have no `nick`/`name`/`label` field.
26. **Fixed (core-crypto, Phase 1, merged):** the owner announces its nickname on `createRoom` and
    re-announces after each admit, so members see the owner's nick. The test asserts the owner's
    `nickname` on both sides (web ↔ phone), and `OWNER_NICK` is in the forbidden-strings sweep: it must
    not appear as text, hex or base64 in the SQL log, the DB dump, the stored objects or the phone's
    SQLite/SecureStore.

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

### 2.4 Cross-platform one-time secrets (Q5, as built 2026-11-01)

`packages/core/test/secrets.interop.test.ts` with `packages/core/test/secrets-harness.ts`. **17 tests, ran 3×, no
flake, ~1 s after a ~5 s boot.** Core 275 (after C4) → 322 with W3-3's 30 probes and these 17.

**Harness.** Unlike the chat harness (006+), this boots the *whole* production schema the way
`supabase/tests/production-history.test.ts` does: `supabase-stubs.sql`, `schema.sql`, then every forward migration
002…009 in order, so `create_secret` (005), `peek_secret` and `open_secret` (004) run with their real plan, quota,
geofence and lock code. The Supabase stand-in runs `rpc()` as `anon` for the website's anonymous client (no session,
no `secret_log` row) or as `authenticated` with a uid for a signed-in phone, with PostgREST's named-argument form;
`storage.from('secrets')` applies the bucket's real predicates (upload name regex `^f/[A-Za-z0-9_-]{24,64}\.bin$`,
`is_claimed_file` for download, `is_burned_file` for remove). **`/api/open` is exercised at the RPC it calls, not
through the Next handler**: `openRoute(body)` mirrors `app/api/open/route.ts` (id regex, `open_secret` as
`service_role` with the route's exact argument names `p_id, p_lat, p_lon, p_source, p_area, p_city, p_region,
p_country, p_ip_country, p_unlock_token`, 404 `gone` on no row, 403 on a lock error, the `header/body/file_path/
views_left/final/viewer_place` response). The handler itself imports `@/lib/server|alerts|geo` through the root vitest
alias, which the core's vitest config does not define (not qa's file). A **source-contract test** reads `route.ts` and
asserts the RPC call, every argument name, the response keys, the 404 and that no decrypt/importKey/fragment code is
in it, so a drift in the route fails here. Every RPC, every `/api/open` body and response is recorded.

**Sides.** The *website* is its own code path lifted step for step from `app/page.tsx` `createSecret()` (key, header
JSON `{ v, type, name, mime, size, timer, guard, tpl, noCopy, noSave }`, `encryptJson/encryptText/encryptBytes`, upload,
`create_secret` args, link `${origin}/s/${id}#${keyB64}`) and `app/s/[id]/page.tsx` (fragment → `importKey`,
`peek_secret`, header decrypt; `/api/open`, body decrypt or download + `decryptBytes`, `remove` on the final view).
The *phone* is `packages/core/src/secrets.ts` (`createSecret`, `peekSecret`, `openSecret`, `parseSecretLink`,
`SecretError`) over `SecretsDeps = { supabase, fetch, apiBase, origin, tz, clientId }`, with a `fetch` that accepts
only `POST https://onepeek.io/api/open` and hands the body to the route mirror.

**Scenarios (web path, 10):** `open_secret` executable by `service_role` only (`has_function_privilege` + a refused
anon/authenticated RPC), `create_secret`/`peek_secret` by anon and authenticated; text create → peek (does not burn,
`views_left` 1) → open (`final`, `views_left` 0, response is ciphertext) → row gone, peek gone, second open 404;
`guard/timer/noCopy/noSave` round-trip in the header; Wi-Fi (`tpl: 'wifi'`, ssid/password/security/hidden); file
(bytes equal, header name/mime/size, download refused before the open, ciphertext removed after the final view);
3 views (`views_left` 2/1/0, `final` only on the last, peek counts down, a viewer's `remove` refused between views,
ciphertext gone after the last); expiry (`expires_at` moved into the past → peek none, open 404, row still there as
ciphertext until the reaper; `p_ttl_seconds` 60 → `invalid expiry`); wrong key (another key cannot decrypt the
header and does not burn; a wrong-length key is refused before any RPC); the route source contract; the sweep
canary (plants body, file name, Wi-Fi password, key in text/hex/base64/base64url and expects the sweep to fire; the
artefacts are non-empty); every `/api/open` body carries only `id|precise|unlockToken`, every `create_secret`
carries base64url ciphertext only. **App ↔ web (7):** app → web text (link `^https://onepeek.io/s/[A-Za-z0-9]{10}#
[A-Za-z0-9_-]{43}$`, flags round-trip, second web open gone, one `create_secret` under the phone's session, one
`secret_log` row for the owner), app → web Wi-Fi, app → web file (one `bytes()` read, upload length = plaintext + 12
+ 16, unreadable before the open, removed after, `secret_log.kind='file'` with the size); web → app text (`peekSecret`
→ `openSecret` → `gone` on the second open and after expiry, `bad_key` before any RPC, every phone request body only
the id); web → app Wi-Fi + a 2-view file (both views equal bytes, ciphertext kept between views, third `gone`); app →
app once; the phone refuses what the website refuses (`invalid_expiry`, `empty`) before any RPC.

**Sweep (every scenario):** the key (base64url and raw bytes as hex/base64), the plaintext body, file name, file
bytes and Wi-Fi password/ssid never appear in the SQL log (all RPC args), the DB dump (every public table plus the
stored objects as hex), the `/api/open` request bodies or responses, in text, hex, base64 or base64url. The ids are
asserted *present* so the sweep is known to look at the right places.

**Not covered here (and where it is):** recipient-locked links (`/api/unlock/*`), geofence and time locks, country
allow-lists: `packages/core/src/secrets.test.ts` (core-crypto, 34 tests with a `createWorld()` fake) covers the error
mapping; the SQL side is `supabase/tests/*`. The real Next handler runs only in the web suite. Running the phone
side on Hermes with `react-native-quick-crypto` is a device check (Gate 2 live run, §9).

## 3. Maestro E2E flows (Q3, as written 2026-10-31)

The flows exist in `apps/mobile/e2e/` and are documented there (`README.md`); this section keeps the
design decisions and the list. **Written and statically checked, not run**: no Xcode, Android Studio,
Java or Maestro on this Mac and no device build yet. The check (`node apps/mobile/e2e/scripts/check-flows.mjs`)
parses every YAML, requires every `id:` to exist in `apps/mobile/e2e/TESTIDS.md`, forbids
`takeScreenshot`/`startRecording`, and lists the steps that depend on proposed ids as **dry**.

### 3.1 Setup facts (changes from v1)

- **testIDs**: the binding list moved from this file to `apps/mobile/e2e/TESTIDS.md` (single source of
  truth). Wave 2 (2026-10-31): reconciled with the code after mobile-ui wave 2 merged, 168 ids under
  `contract` (grep over `app/`, `components/`, `security/`), 1 `proposed` (`verify.qr`, optional). The 13
  ids proposed in wave 1 all landed, three under another name (`signin.sent` → `signin.emailSent`,
  `join.waiting` → `room.waiting`, `new.timer.1h` → `new.timer.3600`). `check-flows.mjs` now matches a
  literal flow id against template ids (`new.timer.<s>`, `msg.<id>`). Panic Exit is a **single tap**
  (`panic` in Settings, `room.panic` in the room menu, no `panic.confirm*`), as the lead decided.
- **E2E build (W1-9)**: `invite.link` is masked (`…#••••••`) in every build except one that sets
  `EXPO_PUBLIC_E2E=1`; flow 03 needs the full link. `eas.json` needs an `e2e` profile (extends
  `development`, `env: { EXPO_PUBLIC_E2E: "1" }`, iOS `simulator: true`); `release` owns the file (§7.11).
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
- `msg.<id>` / `file.<id>` / `timer.<id>` are matched as the regex `msg\..+` etc. with an `index`;
  `chats.room` is one id for every row, picked by index. `invite.link` renders the full link only on the
  E2E build (README / TESTIDS.md "Rendering requirements"); switches are asserted with `checked:`, disabled
  controls with `enabled: false`. Positive text assertions are on fixed UI copy only; the push token is never
  rendered or asserted; the safety number (11) is the one value besides the link that crosses the relay.

### 3.3 Flows

| # | Files | Journey | Runnable when |
| --- | --- | --- | --- |
| 01 | `01-welcome-guest.yaml` | Welcome → Get started → Continue as guest → Chats home | wave-1 screens |
| 02 | `02-signin-email.yaml` | Welcome → Sign in → email → "check your inbox"; stops there (link in a mailbox: manual M1); `MAESTRO_EMAIL` must be a team inbox, production sends a real mail | wave-1 screens |
| 03 | `03-create-secret-room.yaml` | New chat → Secret → `new.timer.3600` (asserted `checked`) → code, name, nick → create → `invite.sheet` → copy (`invite.toast`) → done → room → `room.back` to Chats (the room screen would auto-admit; 04-let-in needs the explicit row); publishes the link | E2E build (masked link otherwise: the flow's `assertTrue` stops it) |
| 04 | `04-join-with-code.yaml` (B) + `04-let-in.yaml` (A) | B: open link → wrong code → `join.error` → right code → nick → submit → `room.screen` with `room.waiting`, send disabled; A: `chats.pending` + `chats.letIn` → tap → open room | device build |
| 05 | `05-message-roundtrip.yaml` (A) + `.peer.yaml` (B) | A: `room.timer` → `room.timer.60` → pill reads "1m" → types, sends; B: `room.waiting` gone, bubble shows "Hold to read", body **not** visible, hold, body still not asserted, `timer.<id>` shows, reply | device build |
| 11 | `11-verify-safety-number.yaml` (A) + `.peer.yaml` (B) | A: menu → `room.menu.verify` → `verify.number` (60 digits, copied to the relay) → `verify.mark` → `verify.member` "Verified" → close sheet; B: same, and asserts its digits equal A's | device build |
| 06 | `06-file-view-once.yaml` (A) + `.peer.yaml` (B) | A: `attach.sheet`, `attach.viewOnce` `checked` (never tapped), `attach.send` disabled until `attach.picked`, system picker by label, send; own `file.<id>` disabled. B: `file.<id>` → `viewer.screen` with `viewer.hold`, no `viewer.share`, `viewer.done`; row `enabled: false`, tap opens nothing, still disabled after relaunch | device build; picker label `Photo.*` confirmed on the first run |
| 07 | `07-screenshot-notice.peer.yaml` (B, first) + `07-screenshot-notice.yaml` (A) | system screenshot on B → `room.notice` on A with the web wording, no new `msg.<id>`. Android: black image with `FLAG_SECURE`; the app learns of it only on Android 14+ (older Android: manual S1/M2) | device build; iOS ⌘S trigger to confirm on first run |
| 08 | `08-burn.yaml` (A) + `.peer.yaml` (B) | A: menu (`room.panic` present) → `room.burn` → `confirm.cancel` → burn → `room.burn.confirm` → Chats, no room, still none after relaunch; B: `room.ended` → `room.back` → no room, still none after relaunch | device build |
| 10 | `10-settings-notifications.yaml` | Settings → `settings.notify` off → tap → OS prompt (`launchApp permissions` + "Allow" fallback) → `checked: true`, no `settings.notifyError` → relaunch keeps it → off again. The token is never rendered or asserted | a device that can mint a push token (tag `push`; `MAESTRO_PUSH=1` in the run script, `--exclude-tags push` otherwise) |
| 09 | `09-panic-lock.yaml` | Chats → `chats.settings` → `panic` (one tap) → `locked.screen` + "Locked by Panic Exit", Settings/Chats/room **not** visible → relaunch still locked → unlock only with `MAESTRO_BIOMETRIC=sim` (CI default `skip` ends on the locked screen) | device build |
| 12 (Phase 2) | `12-secret-link-in-app.yaml` (A) + `.peer.yaml` (B) | A: `room.secret` → `secret.sheet` → `secret.mode.link`, `secret.views.1` checked, `secret.guard` checked → text → `secret.create` → `link.<id>` card, text **not** in the tree. B: tap card → `viewer.screen` with `viewer.peek`, no `viewer.revealed` → `viewer.open` → `viewer.revealed` behind `viewer.hold` (never held), no `viewer.share` → `viewer.done` → tap again → `viewer.gone`, no `viewer.open`; relaunch → still `viewer.gone` | U8 ids (dry today), device build |
| 13 (Phase 2) | `13-secret-link-from-browser.yaml` | `chats.secret` → `secret.screen` → text, `secret.expires.3600`, `secret.views.1`, `secret.timer.60`, guard checked → `secret.create` → `secret.link` + `secret.qr` → `copyTextFrom` (E2E build only; `assertTrue` stops a masked link) → relay → `openLink` (https → `onepeek://` on simulators, `MAESTRO_UNIVERSAL_LINKS=1` on devices) → `viewer.peek` → open → `viewer.revealed` + `viewer.timer` + `viewer.hold` → done → `openLink` again → `viewer.gone`. Manual half M18 | U8 ids, E2E build; N6 link handling |
| 14 (Phase 2) | `14-share-from-photos.yaml` (A) | **DEVICE**: Photos → first photo → Share → OnePeek → `share.screen`, `share.item` (kind + size, no name), `share.viewOnce` checked → `share.toChat` → `share.room` 0 → `share.send` → `room.screen` → own `file.<id>` disabled | U8 ids, N6 share extension/intent in the build, seeded photo |
| 15 (Phase 2) | `15-share-from-files.yaml` | **DEVICE**: Files → `e2e-note.txt` → Share → OnePeek → `share.cancel` → Chats, nothing created → again → `share.link` → `secret.screen` → 1 h, view once → `secret.create` → `secret.link|copy|share|qr`, file name never visible → `secret.done` | U8 ids, N6, seeded file |
| 16 (Phase 2) | `16-scan-qr.yaml` ×4 (`MAESTRO_QR_KIND`) | `chats.scan` → `scan.screen` (camera permission: `launchApp permissions` + `scan.allow` fallback) → `scan.camera`, `scan.paste`; a second device shows `invite.qr` / `secret.qr` / `verify.qr` / a foreign QR: invite → `join.screen` + `join.code`; secret → `viewer.peek`; verify → `verify.number` + `verify.mark` + "They match"; foreign → `scan.foreign`, scanner stays, no payload text, `scan.close` → Chats | U8 ids, a camera (physical iOS; Android emulator virtual scene), a device showing the code |

Sub-flows: `_common/guest-home.yaml`, `_common/back-to-chats.yaml` (`room.back` in a room, else Android
`back` / iOS edge swipe, twice), `_common/open-room.yaml`. Count at Gate 1: 11 journeys, 17 top-level flow files, 3
sub-flows, 20 YAML files, 0 dry steps (`check-flows.mjs`: `17 flows, 168 ids in TESTIDS.md (1 proposed)`,
`flows OK`). **Phase 2 (2026-11-01):** 16 journeys, 23 top-level flows, 26 YAML files; `check-flows.mjs`: `23 flows,
226 ids in TESTIDS.md (59 proposed)`, **35 dry steps** (every `secret.*`, `link.<id>`, `viewer.peek|open|revealed|
timer`, `share.*`, `chats.scan`/`scan.*` step), `flows OK`; the proposed ids are listed in `TESTIDS.md` "Phase 2
proposed" for mobile-ui to reconcile against U8/N6 as the screens land, and the dry steps become runnable the moment
an id is marked `contract`. Tags added: `phase-2`, `share` (14, 15), `camera` (16); CI without devices runs with
`--exclude-tags push,share,camera`. The run script takes `MAESTRO_PHASE2=1` (12, 12.peer after 06) and
`MAESTRO_SHARE=1` (14). Gate 1 text continues: expected at Gate 1: 17 flows × 2 platforms = 34 runs, 02 allowed to end at the sent state, 10
skipped by tag where no push token can be minted and reported as skipped with the reason. The run script
sequence is 01 A, 01 B, 03, 04, 04-let-in, 05, 05.peer, 11, 11.peer, 06, 06.peer, 07.peer, 07, 08, 08.peer,
[10 with `MAESTRO_PUSH=1`], 09 (last: it leaves A locked). v1's 03-lock-unlock (60 s auto-lock) stays
manual (S10/S11); the former 14-timer and 15-safety-number journeys are now inside 05 and 11.

## 4. Manual security checks

Run on physical devices (simulators cannot show most of these). Each check is done on **every** device
in the matrix (§5) once per release candidate and recorded in `docs/mobile/gates/<phase>.md` as
`M<n> <device> PASS|FAIL <date> <evidence file>`. Evidence is a photo of the device taken with
another phone (never a screenshot of the device itself, for the obvious reason), or a terminal log.
Rooms are throwaway (§0).

| # | Check | Steps | Expected: Android | Expected: iOS |
| --- | --- | --- | --- | --- |
| M1 | Sign-in methods | Apple (iOS), Google, email link (passkeys are hidden for Gate 1); each then `locked.screen` on relaunch | all reach `chats.screen`; the email link opens the app via App Link **and is refused unless it was requested on this phone within 1 h** (W1-1: tap a link requested from another device → "ask for a new link", never a session) | same; Apple sign-in sheet is native |
| M2 | Screenshot in a room | hold a received Secret bubble, press the hardware screenshot combo | toast "Can't take screenshot due to security policy" (wording varies by OEM); no image in Photos; **no alert is sent** (nothing happened) | the screenshot **is taken** and shows what was on screen; within 5 s the other device shows the "may have taken a screenshot" notice; the SQL side shows ciphertext only. Store copy must say exactly this |
| M3 | Screen recording | start the system recorder, open a room, hold a bubble, stop | recording shows black for every screen (N1 is app-wide, lead decision) | recording shows the `app.cover` view (logo on `#0A0C0F`) for the whole time the app is captured; audio is irrelevant; the moment recording stops, content returns without re-auth |
| M4 | Screen mirroring / AirPlay | mirror to a TV or Mac | black (same as M3) | `app.cover` shown while mirrored |
| M5 | App switcher | open a room, swipe to the switcher | the thumbnail is black or shows the cover | the thumbnail shows `app.cover`, never a bubble |
| M6 | Auto-lock after 60 s | open a room, background the app, wait 65 s, return | `locked.screen`; biometric prompt; after success the same room is shown without a reload | same; also check the 59 s case does **not** lock |
| M7 | Panic Exit | in a room: menu → Panic Exit (`room.panic`), or Settings → Panic Exit (`panic`); **one tap, no confirmation** | cover within one frame, `locked.screen` with "Locked by Panic Exit"; a force-quit and relaunch is still locked; nothing deleted | same |
| M8 | Push on the lock screen | lock the device; from the other side send `BODY` | banner says "OnePeek" / "You have a new message in a private chat." and nothing else; expanding it shows no more; tapping it opens the app **locked** (M6 state), then the room after unlock | same; with the notification preview set to "Always" the body is still only the fixed string |
| M9 | Links | tap an invite link in another app (Messages, Mail) | App Link opens the app directly (no chooser) when `assetlinks.json` verifies; `join.screen` shows | Universal Link opens the app; the `#token` fragment is never sent to the server (check the Vercel log for `/chat/join` requests: path only) |
| M16 | Invite link on screen (W1-9) | create a room, open the invite sheet on a store/preview build | `invite.link` shows `…#••••••`, the QR and Copy/Share carry the full link; the E2E build (`EXPO_PUBLIC_E2E=1`) is the only one that shows it in full and is never distributed | same |
| M17 | Push token lifecycle (W1-2) | Settings → Notifications on; sign out; sign in as another account on the same phone; send a message to the first account's room from another device | no notification reaches the phone for the first account (its row was unregistered on sign-out; the token now belongs to the second account's row if it registered) | same |
| M10 | Backup exclusion, iOS | Finder → back up to this Mac, unencrypted; then `sqlite3 ~/Library/Application\ Support/MobileSync/Backup/<udid>/Manifest.db "select relativePath from Files where domain='AppDomain-io.onepeek.app'"` | n/a | the app's SQLite database file and `-wal`/`-shm` are **absent**; Keychain items are not in an unencrypted backup by definition; document any file that is present |
| M11 | Backup exclusion, Android | `adb backup -f qa.ab io.onepeek.app` on a debug build (Android 11 and below); `adb shell bmgr backupnow io.onepeek.app` then `adb shell bmgr list sets`; on Android 12+ confirm `dumpsys backup` lists the package as not eligible | `qa.ab` is header-only (~1 KB) or the command reports the app opted out; `bmgr` shows no data set for the package; no `databases/` content anywhere in the archive | n/a |
| M12 | Device loss simulation | copy the app sandbox off a rooted test device / jailbroken test iPhone (or the simulator's data directory) to another install | the copied SQLite holds only ciphertext; without the Keystore-held wrapping key nothing decrypts (the §1.3 test shows this in code; here it is confirmed on the real store) | same with the Keychain |
| M13 | Watermark | hold a bubble in a Secret room; photograph the screen | faint `<nick> · <device code> · <time>` over the content, readable in the photo | same |
| M14 | Guest session loss | guest joins, force-quit, relaunch | the room is still there (the guest session is persisted in SecureStore) | same |
| M15 | Burned room on a locked phone | owner burns while the member's phone is locked | on unlock the room is gone and the SQLite has no `room:<id>:` rows (verify on the debug device via `adb shell run-as`) | verify via Xcode device container download on the test device |
| M18 (Phase 2) | Secret link without and with the app | make a onepeek.io secret link (website or app); send it to a phone **without** OnePeek (Messages/Mail), tap; then install the app (or use a second phone with it), send the same kind of link, tap; then the same link a second time | without the app: the browser opens `onepeek.io/s/<id>` and the website viewer peeks (no chooser, nothing else involved); with the app and `assetlinks.json` verified: the app opens directly on `viewer.peek`, no disambiguation sheet (if the sheet appears, verification failed: record it); Vercel log for `/s/<id>`: path only, never the fragment; the second tap shows "already opened" in whichever opened it | without the app: Safari opens the website viewer; with the app and the AASA live: the app opens on `viewer.peek`, Safari never shows; long-press the link → "Open in OnePeek" offered; fragment never in the Vercel log; second tap → already opened |

What we do not test because it is not true: "iOS blocks screenshots", "the server cannot see who is
in a room" (it sees user ids and device ids), "push delivery is invisible" (`known-limitations.md` 7).

### 4.1 Native protections: device checks S1–S20 (from `apps/mobile/security/MANUAL-CHECKS.md`)

native-security's list, folded in as the device-matrix checks for N1–N5 and the W1-4/W1-7 fixes. Each is
run on every device in §5.1 once per release candidate and recorded as `S<n> <device> PASS|FAIL <date>
<evidence>`; the steps and per-platform expectations are in `MANUAL-CHECKS.md` (kept there, one source).
Owner = who runs it and signs the gate line; qa reviews every result; a FAIL is a security-reviewer finding.
Overlaps with the M table are noted so each pair is run once and recorded under both numbers.

| # | Protection | Owner | Platform | Overlaps | What a FAIL means |
| --- | --- | --- | --- | --- | --- |
| S1 | N1 `FLAG_SECURE` in a room: hardware screenshot refused, nothing in Photos, no alert on Android ≤ 13 (record 14+ behaviour) | native-security | Android | M2 | the window flag is not set in `onCreate` |
| S2 | N1 everywhere, incl. after leaving a room, after force-stop/relaunch into the background, with a permission dialog up | native-security | Android | — | **W1-4 regression** if a screenshot succeeds on Chats after leaving a room: record the Android version and launch path |
| S3 | N1 recording / cast shows black for the whole app | native-security | Android | M3, M4 | flag not app-wide |
| S4 | N1/N2 app switcher thumbnail blank (Android) / cover (iOS), also after leaving a room | native-security | both | M5 | cover not shown on inactive |
| S5 | N2 iOS screenshot **is taken**, other side shows the notice within 5 s, taker sees its own notice, SQL log ciphertext only | qa | iOS | M2 (iOS column), flow 07 | screenshot listener or `sendScreenshotAlert` broken; a *black* iOS screenshot is a best-effort observation, record the iOS version, it changes no copy |
| S6 | N2 recording / AirPlay shows the cover from the moment capture starts; stopping removes it without relocking | native-security | iOS | M3, M4 | `isCaptured` not observed |
| S7 | N2 inactive cover (Control Centre, call, switcher), removed on return within 60 s without a prompt | native-security | both | — | AppState handling |
| S8 | N4 cold start → Locked screen; no chat content in the accessibility tree behind it | qa | both | flow 09 (relaunch half) | children mounted while locked |
| S9 | N4 unlock: biometric success / cancel / fallback to passcode | qa | both | — | `disableDeviceFallback` or the cancel path |
| S10 | N4 auto-lock 59 s: no prompt | qa | both | M6 | timer too short |
| S11 | N4 auto-lock 61 s: Locked, rooms intact after unlock | qa | both | M6 | timer too long or data wiped |
| S11b | N4 stale unlock (**W1-7**): prompt left open across a 65 s background trip; answering the old sheet must not unlock, a fresh Unlock must | native-security | iOS (Android cancels the prompt) | — | the unlock generation counter is not checked on resolve |
| S12 | N4 Panic Exit from a room, then force-quit and relaunch: still locked, nothing deleted | qa | both | M7, flow 09 | lock store not persisted synchronously |
| S13 | N4 panic flag written from outside while backgrounded → locked on foreground (reload on active) | native-security | both (debug build) | — | lock store not reloaded on active |
| S14 | N4 insecure device (no screen lock): warning shown, Unlock opens without a prompt, re-adding a PIN restores it | native-security | both | — | `probeDeviceAuth` wrong |
| S15 | N3 iOS unencrypted backup has no `onepeek-chat.db` / `-wal` / `-shm` | release | iOS | M10 | `isExcludedFromBackup` not applied |
| S16 | N3 iOS device transfer: no chats, `keystore_unavailable` or clean, "Reset chats on this phone" offered | release | iOS | M12 | wrapping key not `ThisDeviceOnly` |
| S17 | N3 Android `adb backup` header-only / opted out, `bmgr` no data set, `dumpsys` not eligible | release | Android | M11 | backup rules plugin |
| S18 | N3 Android "Copy data" to a new phone: no OnePeek data | release | Android | M12 | data-extraction rules |
| S19 | N5 watermark readable in a photo while held, does not intercept taps | qa | both | M13 | overlay or `pointerEvents` |
| S20 | A11y: with VoiceOver/TalkBack the alert is still sent, cover announced "OnePeek is hidden", watermark not read | qa | both | A7 | accessibility props |

Not tested because it is not true (unchanged from `MANUAL-CHECKS.md`): "iOS blocks screenshots", "a camera
is stopped", "a rooted or jailbroken phone keeps the flags".

### 4.2 Phase 2 device checks: share receive, secret viewer, Universal Links (owners as marked)

native-security (N6) is writing the share extension / share intent, FLAG_SECURE on the secret viewer and the
Universal Link / App Link handling with the fragment read on the device, and extends `MANUAL-CHECKS.md` with **S21+**
in parallel; those numbers are theirs and are referenced here, not duplicated. What qa runs on top, once per release
candidate on every device in §5.1, recorded as `P<n> <device> PASS|FAIL <date> <evidence>`:

| # | Check | Steps | Expected | Owner | Overlaps |
| --- | --- | --- | --- | --- | --- |
| P1 | Share receive: photo | Photos → share one photo → OnePeek (flow 14 by hand) | the share target shows kind and size, **not** the file name; view-once on by default; send → bubble in the room; **the picked copy is deleted** after send and after cancel (iOS: `Containers/Shared/AppGroup/<id>/` and the app's `Library/Caches` empty of it; Android: `cache/` empty) | qa | S21+ (N6: extension memory, FLAG_SECURE on the extension UI), W2-2 (`deletePicked`) |
| P2 | Share receive: document and oversize | Files → `e2e-note.txt` → OnePeek → cancel; again → make a link; then a 60 MB file | cancel discards (nothing in storage, no RPC); link made with the file name only inside the encrypted header (the SQL `secrets.header` is ciphertext; `secret_log.kind='file'`, `size` only); oversize → `share.error`, the copy deleted | qa | flow 15 |
| P3 | Share receive while locked | lock the app (Panic Exit); share a photo from Photos | the share target is **behind the lock**: `locked.screen` first, the received item only after unlock; a cancelled unlock discards the copy | qa | S12, N4 |
| P4 | Share sheet does not leak into the switcher | share → OnePeek → background mid-way → app switcher | the thumbnail shows the cover, not the shared image (iOS extension and app both) | native-security | S4, S21+ |
| P5 | Secret viewer under capture | open a guarded secret from a link; take a screenshot while held; start a recording | Android: screenshot refused (FLAG_SECURE on the viewer), nothing in Photos; iOS: screenshot taken (honest copy), the sender's device gets **no** alert (one-time links have no room to alert into: known limitation, copy must say so); recording shows the cover | native-security (FLAG_SECURE), qa (copy) | S1, S3, S6 |
| P6 | Universal Link / App Link with the app | M18 "with the app" half on each device and OS version in §5.1 | app opens directly on `viewer.peek`; the fragment is never sent (Vercel log for `/s/<id>`: path only; `/api/open` body: id only) | qa | M18, M9 |
| P7 | Link without the app | M18 "without the app" half | website viewer; no OnePeek chooser | qa | M18 |
| P8 | Link from the camera | 16 by hand with a real QR on a second phone (`invite.qr`, `secret.qr`, `verify.qr`, a Wi-Fi QR) | routed as in flow 16; the foreign payload is never displayed; the camera permission denial state offers "Paste a link instead" and never a system-settings deep link with data in it | qa | flow 16 |
| P9 | Quick-crypto parity on Hermes | app → web and web → app once each on the real project with throwaway secrets (text, Wi-Fi, a 5 MB image), each device | identical to §2.4: opens once, bytes equal, second open "already opened"; the SQL log / Vercel log carry ciphertext and ids only | qa (run), lead (live project) | §2.4 (logic), C2 (Hermes) |
| P10 | Report and block (B5/U8) | report a chat; block a member | the report request body is exactly `{ p_room, p_reason }` (proxy the phone through mitmproxy on a test device, or read the route test): no message, no nick; the blocked member's messages stop rendering and the block survives a relaunch | qa | `supabase/tests/chat-reports.test.ts`, route tests (backend) |

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
npx vitest run packages/core/test/secrets.interop.test.ts --root packages/core   # Q5: secrets app <-> web (17), run 3x before a report
npx vitest run lib/chat/client.integration.test.ts     # web regression, must stay 8 passed
npm test -w packages/core -- test/leak-guard.test.ts src/log.test.ts   # leak guard, run 3× before a report
node apps/mobile/e2e/scripts/check-flows.mjs            # Maestro flows: YAML, ids vs TESTIDS.md, no screenshots; lists the dry steps
npx vitest run lib/alerts.native.test.ts supabase/tests/push-devices.test.ts app/api/chat/notify/route.test.ts   # push (§1.5)

# Maestro (a machine with simulators; see apps/mobile/e2e/README.md "Where to run")
maestro test apps/mobile/e2e --include-tags single --include-tags ios     --format junit --output apps/mobile/e2e/results/ios.xml
maestro test apps/mobile/e2e --include-tags single --include-tags android --format junit --output apps/mobile/e2e/results/android.xml
MAESTRO_DEVICE_A=<udid> MAESTRO_DEVICE_B=<udid> apps/mobile/e2e/scripts/run-two-device.sh   # 16 flows, A/B alternating; MAESTRO_PUSH=1 adds 10
maestro test apps/mobile/e2e --include-tags single --exclude-tags push   # when the device cannot mint a push token
maestro test apps/mobile/e2e --include-tags single --exclude-tags push,share,camera   # CI simulators: no Photos/Files seeding, no camera
MAESTRO_PHASE2=1 MAESTRO_DEVICE_A=<udid> MAESTRO_DEVICE_B=<udid> apps/mobile/e2e/scripts/run-two-device.sh   # + 12/12.peer; MAESTRO_SHARE=1 adds 14
for k in invite secret verify foreign; do maestro test apps/mobile/e2e/flows/16-scan-qr.yaml -e MAESTRO_QR_KIND=$k; done   # a device showing each code

# Device perf
adb shell am start -W -n io.onepeek.app/.MainActivity
adb logcat -s ReactNativeJS | grep '^perf '
```

Notes on the commands:

- **Jest timeout (`apps/mobile`).** The first transform of `ts-mls` / `@hpke` on a cold cache once pushed the
  chats suite past jest's 5 s default (one run, not reproduced warm). The lead set `testTimeout: 20000` in
  `apps/mobile/jest.config.js`. By §6.1 that was a failing run until the cause was understood: the cause is
  transform time, not the test, so the raised timeout is the fix and not a quarantine. If a mobile suite ever
  exceeds 20 s, treat it as failing, not as "slow".
- **Expo config check before the first push test (lead, carried from wave 2).** `app.config.ts` lists the
  `expo-notifications` plugin, but nothing yet proves the iOS build carries the `aps-environment`
  entitlement (`development` for the dev build, `production` for TestFlight/App Store) or that the Android
  build has `google-services.json` (`GOOGLE_SERVICES_JSON` EAS secret) wired through `googleServicesFile`.
  Before 10 or M8 runs: `npx expo config --type introspect` on the EAS build's commit and check
  `ios.entitlements["aps-environment"]` and `android.googleServicesFile`; without them
  `getDevicePushTokenAsync` rejects and 10 ends on `settings.notifyError`, which is a build problem, not a
  product one, and is reported as such. `APNS_USE_SANDBOX=1` on the server side must match a
  `development` entitlement.

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
4. **Owner nickname.** Answered: fixed by `core-crypto` in Phase 1 (§2.2 #26); owner nick announced on
   create and re-announced after each admit.
5. **Simulators.** Answered 2026-10-31: flows written regardless; where to run is still open. Both options
   are written up in `apps/mobile/e2e/README.md`; qa's recommendation is GitHub Actions (`macos-15` for
   iOS, `ubuntu` + KVM for Android) because Maestro Cloud cannot run the two-device journeys and keeps
   per-step screenshots off-site.
6. **`node:sqlite` for the SQLite mock.** Needs Node ≥ 22.13; CI's Node version must match. The
   alternative is `better-sqlite3` (native build, slower install). Recommendation: `node:sqlite`.
7. **Older iPhone.** Confirm the minimum iOS after the first prebuild so the second iPhone in §5.1 is
   bought or borrowed early.
8. **Proposed testIDs.** Answered 2026-10-31: all 13 accepted and built by mobile-ui wave 2 (three under
   another name, §3.1). `TESTIDS.md` is reconciled with the code; 0 dry steps. One new optional proposal:
   `verify.qr`.
9. **`log` export.** Answered: `log`/`redact` are exported from the package root since Q4 merged.
10. **`MAESTRO_EMAIL`.** Flow 02 sends a real magic link from production; the default
   `qa-maestro@onepeek.io` must be an inbox the team controls, or the lead names one.
11. **`eas.json` `e2e` profile (release).** Flow 03 needs `EXPO_PUBLIC_E2E=1` (W1-9). Proposed:
   `"e2e": { "extends": "development", "env": { "EXPO_PUBLIC_E2E": "1" }, "ios": { "simulator": true } }`,
   plus a note in `release/versioning.md` that the profile is never distributed to testers. qa does not
   touch `eas.json`.
12. **Push-capable runner for 10.** An iOS simulator needs Apple Silicon + Xcode 14+ for a device token; an
   Android emulator needs a Google Play image. If the chosen runner has neither, 10 is excluded by tag and
   M8/M17 carry the proof on physical devices.
13. **Backend review gaps (§1.5).** Closed 2026-10-31 (d, f, 1+2, 8). Was: four additive assertions; not a
   blocker for the gate's "no content" line (the shapes are exact), a blocker for calling §1.5 complete.
14. **Gate 2 wording (lead).** `plan.md` §4 says "Gate 2 as in the prompt" and the prompt text is not in the repo; §9
   maps the Phase 2 deliverables from `log.md` instead. Paste the criteria into `plan.md` §4 so §9 can be checked
   line for line.
15. **`/api/open` handler in the core suite (lead).** `secrets.interop.test.ts` mirrors `route.ts` at the RPC and
   pins the route's source; the handler itself would run here with one line in `packages/core/vitest.config.ts`
   (`resolve.alias['@'] = <repo root>`) plus `vi.mock` of `@/lib/alerts` and `@vercel/functions`. Not qa's file;
   worth doing if the route grows.
16. **Share-path reuse of `deletePicked` (mobile-ui, U8 review).** Flows 14/15 and P1–P3 assume the share target
   copies into `Paths.cache` and deletes with `deletePicked`/`clearPickerCaches` (W2-2). If N6 lands the received
   item somewhere else (an iOS App Group container), the W2-2 tests do not cover it and P1 is the only proof.

## 8. Phase 1: Gate 1 criteria map

Gate 1 (`plan.md` §3): phone ↔ browser end to end on the live project, push with no content, black
screenshots on Android, blanked recording on iOS, lock works, no open high findings. For each criterion:
what proves it, who owns the proof, and where it stands on 2026-10-31. "pending device build" means the
proof exists or is specified but needs the EAS development build (blocked on the Expo/Apple accounts).

| Gate 1 criterion | Automated proof | Manual proof | Owner | Status 2026-10-31 |
| --- | --- | --- | --- | --- |
| Phone ↔ browser end to end on the live project | `packages/core/test/interop.integration.test.ts` (20 scenarios, roles swapped, every artefact swept; PGlite, not the live project, by rule §0.1) | one throwaway room on production: phone dev build + browser, create → join → text both ways → file → view-once → burn; evidence per §6.3 in `gates/phase-1.md` | qa (test), lead (live run) | test green (87/87 core); live run **pending device build** |
| Push with no content | `lib/alerts.native.test.ts` (25: exact APNs/FCM shapes, forbidden-strings sweep, dead tokens, W1-3 cap and concurrency, W1-5 http2 deadline, web regression); `supabase/tests/push-devices.test.ts` (14: RLS, both RPCs, W1-2 one owner per token, W1-3 cap 10 + token shape, `search_path`, rollback); `app/api/chat/notify/route.test.ts` (opt-out, throttle, fan-out); app side `apps/mobile/lib/__tests__/chat.test.ts` (W1-2 `push.register/unregister/current`, sealed token, unregister before sign-out/reset) and `packages/core/src/chat/client.push.test.ts` | M8: banner shows only `OnePeek` / `You have a new message in a private chat.`, expanding shows nothing more, tap opens the app locked; M17 token lifecycle; flow 10 | backend (tests), qa (review, M8, M17, 10) | tests landed and reviewed (§1.5): **all four review gaps closed** (d, f, 1+2, 8; `push-devices.test.ts` 17, `alerts.native.test.ts` 37); M8/M17/10 pending device build + APNs/FCM keys + the Expo config check (§6.2) |
| Black screenshots on Android | `apps/mobile/security/__tests__/secureScreen.test.tsx` (app-wide `withSecureWindow` plugin + `useSecureScreen`; **W1-4**: unmount never calls `allowScreenCaptureAsync`, a rejected prevent is never followed by an allow) and `SecurityProvider.test.tsx` (**W1-4**: app key asserted on mount and re-asserted on every active transition, MissingActivity retried once); Maestro 07 asserts the notice side only, and only on Android 14+ | S1, S2 (the W1-4 regression check: screenshot on Chats *after* leaving a room), S3; M2, M5 | native-security (N1, tests, S1–S3), qa (M2, M5) | tests landed (mobile jest 172/172); device checks **pending device build**; Maestro cannot verify that an image is black, S1/M2 is the proof |
| Blanked recording on iOS | `SecurityProvider.test.tsx` (`isCaptured` true → cover shown; cover reasons independent); `screenshot.test.tsx` (alert sent once with room id and ttl) | S5, S6, S7; M3 iOS, M4 | native-security (N2, tests, S6, S7), qa (S5, M3, M4) | tests landed; **pending device build** (simulators cannot record the screen the way a device does) |
| Lock works | `SecurityProvider.test.tsx` (cold start locked, 60 s auto-lock, panic → lock store + `chat.lock()`, lock-store reload on active; **W1-7**: an unlock in flight across a 61 s trip, `lockNow` or panic during an unlock, is stale and keeps the app locked); `components/__tests__/locked.test.tsx` (Locked screen copy, Panic state, insecure-device warning); core `platform.test.ts` M3 fail-closed lock; Maestro 09 (Settings → single-tap panic → locked, relaunch still locked; unlock with `MAESTRO_BIOMETRIC=sim`) | S8–S14 incl. S11b (W1-7 on a device); M6, M7 | native-security (N4, tests, S11b, S13, S14), qa (09, S8–S12, M6, M7) | tests landed; 09 written, **pending device build** |
| Sign-in cannot be hijacked by a crafted link (W1-1, high, fixed) | `apps/mobile/lib/__tests__/chat.test.ts`: a `token_hash` link is refused unless an email link was requested on this phone within 1 h; the session email is compared after `verifyOtp` and a mismatch signs out again (login CSRF); the raw URL reaches only the parser; implicit-flow fragments and provider errors are refused; the pending address is forgotten on sign-out/reset | M1 (tap a link requested from another device: asks for a new link) | core-crypto (fix + tests), qa (M1) | tests landed; M1 **pending device build** |
| Supabase host pinned (W1-6) | `chat.test.ts` W1-6 block: anything but `https://<ref>.supabase.co` (suffix trick, path, trailing slash, http) gets no client; `packages/core/src/adapters/rn/platform.test.ts` M2 `checkOnePeekUrl` | — | core-crypto | landed |
| No open high findings | — | security-reviewer's Phase 1 report in `docs/mobile/security-review/`; every PR reviewed before merge (S1) | security-reviewer | S0 closed with no open high/critical (log.md 2026-10-31); S1 ongoing |
| Leak guard (not a gate line, but the rule-1 proof the gate relies on) | `packages/core/test/leak-guard.test.ts` 84 + `src/log.test.ts` 9 = 93/93 ×3 (W1-10: `expo-insights`/`expo-updates` imports, off-device sinks with a secret-named argument, `redact()` of strings in arrays), `npm run lint` 0 errors with the wave-2 screens, static sweep clean (§1.6) | — | qa | **landed** 2026-10-31, W1-10 closed |
| Maestro journeys 01–11 | `check-flows.mjs` static check: 17 flows, 168 ids, 0 dry steps (1 optional proposed id unused) | run on two simulators per README; 02 ends at the sent state by design; 10 only on a push-capable device | qa (flows), lead (runner decision, §7.5), release (`e2e` EAS profile, §7.11) | **written, not run**; pending the `e2e` build profile (W1-9), runner decision |

Reporting at the gate follows §6.3: counts from the tools, dry steps listed by id, manual checks as
`M<n>` / `S<n>` `<device> PASS|FAIL <date> <evidence>`. Counts on 2026-10-31 after wave 2 (`npm test` from
the root): web 108/108, core 194/194, mobile jest 172/172; `npm run typecheck` clean; `npm run lint` 0
errors (55 grandfathered warnings).

## 9. Phase 2: Gate 2 criteria map

`plan.md` §4 says "Gate 2 as in the prompt" and the prompt's wording is not recorded in the repo (open question
§7); the criteria below are the Phase 2 deliverables as the lead fixed them in `log.md` (2026-11-01): C4 secrets in
the core on the web's contract, U8 send-as-secret sheet / share target / QR scanner / block / report, N6 share
extension + intent, FLAG_SECURE on the secret viewer, Universal Links with the fragment on the device, B5 report
endpoint with ids only, Q5 cross-platform secrets and link/share flows, plus the standing rules (no content off the
device except as ciphertext, no open high/critical). Status on 2026-11-01 after the C4 + B5 merge.

| Gate 2 criterion | Automated proof | Manual proof | Owner | Status 2026-11-01 |
| --- | --- | --- | --- | --- |
| A secret made on a phone opens on the website, and one made on the website opens in the app, exactly as many times as the sender allowed | `packages/core/test/secrets.interop.test.ts` (17: web path on the production schema 002–009, app ↔ web both ways through `src/secrets.ts`, 3 views, expiry, wrong key, sweeps; §2.4); `packages/core/src/secrets.test.ts` (34, core-crypto: error mapping, unlock, locks); web `app/api/open` route tests | P9 on the live project (text, Wi-Fi, 5 MB image, each device: Hermes/quick-crypto parity); flows 12, 13 | qa (interop test, P9 run), core-crypto (module + its tests), lead (live project) | **test green 17/17 ×3**; P9 and the flows pending the device build + U8 ids |
| Nothing about a secret reaches the server except ciphertext and the id; the key stays in the fragment | §2.4 sweep over SQL log, DB dump, stored objects, `/api/open` bodies and responses, in 4 encodings, with a canary; route source contract (no decrypt/fragment code in `route.ts`); phone request bodies carry only `id|precise|unlockToken` | P6 (Vercel log for `/s/<id>` and `/api/open`: path and id only); M18 | qa | **landed**; P6/M18 pending device build and live AASA/assetlinks |
| Secret links route into the app (Universal Links / App Links) with the fragment read on the device, and to the website without the app | flow 13 (openLink → `viewer.peek`, second open `viewer.gone`); `apps/mobile/lib/__tests__/*` link parsing (core-crypto/native-security, N6) | M18 (both halves), P6, P7, M9 | native-security (N6, S21+), qa (13, M18, P6, P7) | 13 written (dry: U8 ids); N6 in progress |
| Share from Photos and Files into OnePeek (share extension / intent): to a chat as view-once, or as a link; the received copy never outlives the action | flows 14, 15 (device-marked system steps); `files.test.ts` W2-2 `deletePicked`/`clearPickerCaches` (reused by the share path, to confirm in U8 review) | P1, P2, P3, P4; S21+ (N6: extension memory, FLAG_SECURE on the extension) | native-security (N6, S21+), mobile-ui (U8), qa (14, 15, P1–P3) | flows written (dry); N6/U8 in progress |
| QR scanning routes invites, secrets and safety numbers and refuses foreign codes without showing them | flow 16 ×4 | P8 | mobile-ui (U8 scanner), qa (16, P8) | written (dry); needs a camera: physical iOS, Android virtual scene |
| Report a chat with ids only; block a member | `supabase/tests/chat-reports.test.ts` (13: service-role table, `report_chat` member check, reason enum, 20/day cap, upsert) + `app/api/chat/report` route tests (6: exactly `{ p_room, p_reason }` forwarded) (backend, B5); U8 unit tests for the block state (mobile-ui, to land) | P10 | backend (B5), mobile-ui (U8), qa (P10) | B5 **landed** (web 142); U8 pending |
| FLAG_SECURE on the secret viewer; cover under capture | `security/__tests__/*` extended by N6 (to land) | P5; S1, S3, S6 | native-security | pending N6 |
| Leak guard keeps up with the new sinks (W3-3) | `leak-guard.test.ts` 113 + `log.test.ts` 10 = 123/123 ×3; `npm run lint` 0 errors (§1.6: `Sharing`, `Notifications`, `MediaLibrary`, file writes, `Paths.document`, remote `Image`; notification copy must be literal; `redact()` numbers) | the §1.6 "what a reviewer must still read" list, applied to the U8/N6 PRs | qa (rules), security-reviewer (reads) | **landed 2026-11-01**, W3-3 closed |
| No open high findings | — | security-reviewer's Phase 2 report | security-reviewer | S1 ongoing |

Counts on 2026-11-01 (this branch, `mobile/qa/phase2-tests` after merging `mobile/integration` with C4 + B5): web
142/142, core 322/322 (275 after C4 + 30 W3-3 probes + 17 Q5), mobile jest 230/230; `npm run typecheck` clean; `npm run lint` 0 errors;
`check-flows.mjs` 23 flows, 226 ids (59 proposed), 35 dry steps, `flows OK`. Reporting at the gate follows §6.3; a
dry step is never counted as passed; P-checks as `P<n> <device> PASS|FAIL <date> <evidence>`.
