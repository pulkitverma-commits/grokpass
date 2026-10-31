# OnePeek mobile: test plan v1

Owner: `qa`. Status: v1, written 2026-10-31 for task Q2 (`plan.md` §2), awaiting lead review.
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
| `NICK` | `Sam` | nickname (travels encrypted) |
| `ROOM_NAME` | `qa-launch` | room name (local only) |

Each test also captures at run time: the invite token (`link.split('#')[1]`), the file key
(`sent.file.key`), the attachment object path, every MLS private key the mocks hand out, and the
wrapping key bytes the RN keystore mock generates. The helper `forbidden(ctx)` returns the list of
strings and their hex and base64url encodings; `expectClean(artefact: string, ctx)` asserts none of them
occur. The three artefacts checked are:

- **the SQL log**: `lastSql` (RPC name + arguments) serialised with `JSON.stringify`;
- **the DB dump**: `select string_agg(encode(ciphertext,'escape'),'') from chat_messages`, plus
  `chat_members.key_package`, `chat_devices`, `chat_invites`, `chat_rooms`, `chat_attachments`,
  `realtime.messages.payload` and `chat_security_events` dumped as text;
- **the device dump** (mobile only): every row of the in-memory SQLite `sealed` table as hex, plus the
  SecureStore mock's values, plus anything the fake `console` captured.

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

Mocks live in `packages/core/test/rn-mocks.ts` and are the only place `expo-*` names appear in a test:

- `expo-secure-store`: a `Map<string,string>` with `getItemAsync/setItemAsync/deleteItemAsync`,
  recording the `keychainAccessible` option passed. Assert every `setItemAsync` for the wrapping key
  uses `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (and `requireAuthentication` is not set, since the lock is
  the app's, not the item's).
- `expo-sqlite`: backed by `node:sqlite` `DatabaseSync(':memory:')` (Node 22.13+, no new dependency).
  Exposes the same `execAsync/runAsync/getAllAsync` subset the adapter uses. The test can dump the
  `sealed` table.
- `crypto`: `globalThis.crypto` from Node (`webcrypto`). This stands in for `react-native-quick-crypto`
  **only for logic**; it does not prove quick-crypto works on Hermes. That proof is C2's `spike.md`.
- `fetch`: a recorder; `notifyRoom` must `POST` to `Env.notifyUrl()` with body `{ room }` and the
  session bearer, nothing else.

Adapter tests:

- `keystore.rn.test.ts`: the §1.2 contract; plus "the SQLite file holds only ciphertext": after
  `put('room:1:state', { secret: BODY })` the dump of `sealed` contains neither `BODY` nor its hex nor
  its base64url; the wrapping key bytes (read from the SecureStore mock) do not appear in SQLite;
  after `wipe()` the SecureStore mock has no `onepeek.wrap` and `sealed` is empty; the order assertion
  from §1.2.
- `keystore.rn.test.ts` "a copied database is unreadable without the device's SecureStore": serialise
  the SQLite rows, build a second adapter over the same rows and an **empty** SecureStore; every
  `get` is `null`.
- `lock.rn.test.ts`: `lock()` is synchronous from the caller's point of view (flag is also kept in
  memory so the UI can cover the screen before SecureStore resolves), `isLocked()` is true after a
  simulated process restart (new instance, same mock).
- `env.rn.test.ts`: `origin()` is `Constants.expoConfig.extra.siteUrl`; `deviceLabel()` is
  `"<Device.modelName> · OnePeek app"` truncated to 40 chars, never the device name the user typed.
- `filesource.rn.test.ts`: a picked file is read from its `uri` lazily (not at pick time); size comes
  from the picker metadata and is checked against `MAX_ATTACHMENT_BYTES` before reading.

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
- **Migration 008** (`supabase/tests/push-devices.test.ts`, PGlite): owner can insert and read only
  their own `push_devices` rows; another user reads none; `anon` is denied; the service role reads all.

### 1.6 Log hygiene (Q4)

An ESLint rule in the root flat config, scoped to `apps/mobile/**` and `packages/core/**`, errors on
`console.log|info|debug|warn|error` whose arguments reference an identifier matching
`/body|plain|text|key|token|code|secret|password|nickname|state/i` or a template literal containing
`${`. Allowed: `console.error(e.code)` where `e` is a `ChatError`. Plus a vitest test
`packages/core/test/no-console.test.ts` that runs every core test with `console` wrapped and fails if
anything was printed; the mobile app installs the same wrapper in `__DEV__` builds and throws.

## 2. Interop test design (Q1)

File: `packages/core/test/interop.integration.test.ts`. It runs in the root `npm test` (vitest
`include` gains `packages/core/**/*.test.ts`) and in `packages/core`'s own vitest. Timeout 60 s like
the web test. Depends on C1 (core extracted) and C3's adapter code; until C3 lands it uses the §1.3
mocks against the adapter interfaces, so it can start the day C1 merges.

### 2.1 Harness

Extract from `lib/chat/client.integration.test.ts` into `supabase/tests/harness.ts` (shared, no
behaviour change to the web test, which keeps its own copy until the lead approves the move):

- `bootDb()`: PGlite + pgcrypto, stubs, every migration in `supabase/migrations/*.sql` in order
  (so 008 is covered automatically), `window.location.origin = 'https://onepeek.test'`.
- `fakeSupabase(user)`: as today, plus it records `lastSql` per client instead of globally so the
  test can tell which device sent what.
- `storageObjects`: the shared `Map` standing in for the bucket, with the RLS checks.

Two client factories, both returning the **same** `ChatClient` type from `packages/core`:

```ts
const web    = await webClient('alice', ALICE_ID);              // web adapters, own fake-indexeddb
const mobile = await mobileClient('sam', SAM_ID, { guest: true }); // RN adapters over §1.3 mocks
```

`webClient` builds the `ChatPlatform` from `packages/core/src/adapters/web` with a fresh `IDBFactory`
and `localStorage` map; `mobileClient` builds it from `adapters/rn` with a fresh SecureStore map and
`DatabaseSync(':memory:')`. The `on(client, fn)` swap of `globalThis.indexedDB` is only needed for web
clients; mobile clients hold their stores by reference. `dumpDevice(mobile)` returns the SQLite rows +
SecureStore values as one string for `expectClean`.

### 2.2 Scenarios and assertions

Every scenario runs twice with roles swapped (`[owner, member] = [web, mobile]` then
`[mobile, web]`) via `describe.each`. Assertions listed once; "both" means asserted on each side.

**A. Room, invite, access code, admit**
1. Owner `createRoom({ kind:'secret', ttl:30, mode:'on_open', lifetime:3600, accessCode, name })`.
2. `createInvite` link matches `^https://onepeek\.test/chat/join#[A-Za-z0-9_-]{40,}$` from both
   platforms (mobile `Env.origin()` is injected, not read from `window`).
3. Member `peekInvite(token)` → `{ needs_code: true, kind: 'secret' }`.
4. Wrong code → rejects `{ code: 'access_code_wrong' }`; the SQL log contains the wrong code only as
   an RPC argument to `chat_redeem_invite` (it is hashed server-side) and the DB dump never.
5. Right code → `joined === roomId`; member `sync` → `joined: false` until owner `admitPending` → `1`;
   then `joined: true`.
6. `expectClean(sqlLog)`, `expectClean(dbDump)` with the invite token in context, except for the
   `chat_redeem_invite` and `chat_peek_invite` arguments where the token is the input (assert it is
   present only there, and `token_hash` is not its hex).

**B. Text, both directions**
7. Owner `send(BODY, 30)`. SQL log and DB dump clean. Member `sync` → `newMessages: 1`;
   `messages()[0].body === BODY`, `expiresAt === null` (unopened), `mine === false`.
8. Member `markOpened` → `expiresAt - now <= 31_000`.
9. Member `send(BODY2, 30)`; owner `sync`; owner sees `[[true, BODY], [false, BODY2]]`.
10. `expectClean(dumpDevice(mobile))` with `BODY`, `BODY2`, the MLS private key material and the
    wrapping key bytes in context. This is the new assertion the web test cannot make: the phone's
    SQLite holds only sealed blobs.
11. Epoch agreement: `mls.epoch(ownerState) === mls.epoch(memberState)` after both synced.

**C. File**
12. Owner `sendFile(FileSource(FILE_NAME, FILE_BODY), 300, false)`; `sent.file.name === FILE_NAME`.
13. SQL log, stored object bytes (`latin1`) and DB dump contain neither `passport` nor `sent.file.key`.
14. Member `sync`, `openFile` → bytes decode to `FILE_BODY`, `mime === 'text/plain'`.
15. A third user who is not a member: `chat_attachment_readable(objectPath)` is `false`.
16. Mobile's `FileSource.bytes()` is called exactly once per send (no second read during the
    encrypt-then-upload path).

**D. View-once file**
17. Owner `sendFile(..., 300, true)`; owner `openFile` → rejects `view_once_sent`.
18. Member `openFile` once → content; `messages()` shows `viewed: true`; second `openFile` → `gone`;
    replaying `{ ...msg, viewed: false }` → `gone` (server-side claim).
19. On mobile, after the first open the sealed message row still exists but `openFile` is refused
    locally before any RPC (`lastSql` unchanged by the second attempt).

**E. Removal commit**
20. Three devices: owner + two members (one web, one mobile, then swapped). Owner `removeMember(m1)`.
21. `m1.sync` → `removed: true`; `m1.keystore.keys('room:<id>:')` is `[]` (web) /
    `sealed` has no `room:<id>:` rows (mobile).
22. Owner `send('only m2 now')`; `m2.sync` sees it; `m1` is refused by the server (`not_a_member`)
    and, independently, cannot decrypt a message captured from `lastSql` with its old state
    (`mls.decrypt` throws).

**F. Burn**
23. Member `burn` → `not_owner`. Owner `burn`: owner's room keys gone; `chat_messages` for the room is
    `0`; member `sync` → `removed: true` and its keys gone; `realtime.messages` has one `burned`
    event for `room:<id>`; mobile `dumpDevice` has no `room:<id>:` rows and still contains the other
    room's rows (burn is per room, not a wipe).

**G. Screenshot alert**
24. Member `sendScreenshotAlert(roomId, 30)` → `{ alert: 'screenshot' }`; SQL log does not contain
    `screenshot`; owner `sync` sees `{ alert: 'screenshot', mine: false, body: '' }` with
    `expiresAt !== null`; the notice is not counted in `newMessages` for the UI badge (assert the
    client's `newMessages` excludes alerts, or document that it does not).

**H. Nickname**
25. Member joined as `NICK`; after the admit commit and one `sync` on each side, owner
    `members().find(role==='member').nickname === NICK`; the DB dump has no `Sam` as text or hex in
    any table; the `chat_room_members` RPC rows in `lastSql` have no nickname field.
26. Mobile `members()` shows the owner's nickname too (the owner's `nick` control message is sent on
    room creation or first sync; if it is not today, this is a finding for `core-crypto`).

**I. Concurrency (ported)**
27. The web test's "sending while a sync is running" scenario with one side mobile: both sides end
    with `['a1','a2','a3','b1','b2','b3']`.

**J. Panic lock**
28. Mobile `lock()` → `isLocked()` true from a new adapter instance over the same SecureStore mock;
    `unlock()` on a guest session needs no passkey; rooms are intact (`myRooms()` contains the room).

### 2.3 Reporting line for Q1

`npm test -- packages/core/test/interop.integration.test.ts` prints vitest's summary. Q1 is done when
the plan's line reads `Test Files 1 passed, Tests 2×(A..J) passed` (count fixed once written) and
`lib/chat/client.integration.test.ts` still reads `8 passed`.

## 3. Maestro E2E flows (Q3, Phase 1)

### 3.1 Setup facts

- Maestro drives one device per flow and cannot create a second participant. The second participant
  is a **companion**: `apps/mobile/e2e/companion/server.ts`, a Node script that runs the web core
  (web adapters, `fake-indexeddb`) signed in as a guest against the **same Supabase project the app
  points at**, and exposes `http://127.0.0.1:4310` with `POST /join {link, code, nick}`,
  `POST /send {room, body}`, `POST /sendFile {room, name, bytesB64, viewOnce}`,
  `POST /screenshot {room}`, `GET /messages/:room`, `POST /sync/:room`. Maestro's `runScript` calls it
  with `http.post`. The companion burns every room it owns on `SIGINT`.
- The app under test is an EAS **development** build (`eas build --profile development`) installed on
  the simulator, pointed at production via `EXPO_PUBLIC_*` in `eas.json`'s development profile. Rooms
  are throwaway (`lifetime: 3600`). This Mac has no Xcode or Android Studio (`log.md` 2026-10-31), so
  Phase 1 flows run on a machine that has them or in Maestro Cloud; CI runs them nightly, not per PR.
- Sign-in in flows uses **guest** (`join as guest`) wherever the journey allows it. Passkey, Apple and
  Google sign-in cannot be automated on simulators and are manual (§4, M1).
- One flow file per journey, `apps/mobile/e2e/flows/<nn>-<journey>.yaml`, tagged `ios`, `android` or
  both. Shared steps in `apps/mobile/e2e/flows/_common/`. Run: `maestro test apps/mobile/e2e/flows
  --include-tags ios` (or `android`), `--format junit --output e2e/results/<platform>.xml`.

### 3.2 testID conventions (binding for `mobile-ui`)

- Lower-case, dot-separated `screen.element[.qualifier]`; stable across copy changes; one per
  interactive element and per state container; never contains dynamic data (room ids go in
  `accessibilityLabel`, not `testID`).
- Lists: the container `chats.list`, each row `chats.row` (Maestro picks by index or by visible
  text), never `chats.row.<id>`.
- Every `Screen` primitive sets `testID="<screen>.root"` so a flow can `assertVisible: id: room.root`.

| Screen (design) | testIDs |
| --- | --- |
| Welcome (01) | `welcome.root`, `welcome.signin`, `welcome.guest` |
| Sign in (02) | `signin.root`, `signin.passkey`, `signin.apple`, `signin.google`, `signin.email`, `signin.email.send`, `signin.guest` |
| Locked (03) | `locked.root`, `locked.unlock`, `locked.panicHint` |
| Chats (04) | `chats.root`, `chats.list`, `chats.row`, `chats.pending`, `chats.pending.letIn`, `chats.search`, `chats.new`, `chats.secret`, `chats.settings` |
| Conversation (05/06) | `room.root`, `room.title`, `room.menu`, `room.list`, `room.bubble`, `room.bubble.held`, `room.notice`, `room.file`, `room.viewOnce`, `composer.input`, `composer.send`, `composer.attach`, `composer.timer`, `composer.timer.<30s|5m|1h|1d>` |
| View-once viewer | `viewer.root`, `viewer.close`, `viewer.gone` |
| Send secret (07) | `secret.root`, `secret.inChat`, `secret.link`, `secret.send` |
| New chat (08) | `new.root`, `new.kind.<quick|secret|business>`, `new.name`, `new.code`, `new.create` |
| Invite sheet | `invite.root`, `invite.qr`, `invite.link`, `invite.copy`, `invite.share`, `invite.approval`, `invite.done` |
| Join (09) | `join.root`, `join.code`, `join.nick`, `join.submit`, `join.error` |
| Share sheet (10) | `share.root`, `share.room`, `share.send` |
| Scan QR (11) | `scan.root`, `scan.close` |
| Room menu | `menu.members`, `menu.verify`, `menu.safety`, `menu.burn`, `menu.burn.confirm`, `menu.leave`, `menu.leave.confirm`, `menu.rename` |
| Settings (12) | `settings.root`, `settings.push`, `settings.autolock`, `settings.devices`, `settings.panic`, `settings.signout` |
| Global | `app.cover` (the switcher/capture cover view), `toast` |

### 3.3 Flows

Each flow starts with `launchApp: clearState: true` (except 03, 04), ends with `menu.burn` where a
room exists, and asserts via `assertVisible`/`assertNotVisible` on testIDs and on the fixture strings.

| # | File | Journey | Key assertions |
| --- | --- | --- | --- |
| 01 | `01-signin-guest.yaml` | Welcome → guest | `chats.root` visible; `chats.list` empty-state text visible |
| 02 | `02-signin-email.yaml` | Welcome → email link | `signin.email.send` → confirmation copy; **stops there** (the link lands in a mailbox; manual M1) |
| 03 | `03-lock-unlock.yaml` | background 61 s → relaunch | `locked.root` visible; `room.bubble` not visible; simulator biometric accepted (`xcrun simctl spawn booted notifyutil -p com.apple.BiometricKit_Sim.fingerTouch.match` on iOS; `adb -e emu finger touch 1` on Android) → `chats.root` |
| 04 | `04-panic-exit.yaml` | Settings → Panic Exit | `app.cover` visible within one frame, then `locked.root`; relaunch still locked; after unlock the room list is unchanged (count equals before) |
| 05 | `05-create-invite.yaml` | New secret chat → invite | `new.kind.secret`, `new.code` filled with `ACCESS_CODE`, `new.create` → `room.root`; `room.menu` → invite sheet: `invite.link` text matches `^https://.*/chat/join#`, `invite.qr` visible; `copyTextFrom: id: invite.link` |
| 06 | `06-join-admit.yaml` | 05 + companion joins | `runScript` posts the link + code to companion `/join`; app `chats.pending` shows 1; `chats.pending.letIn` → companion `/sync` reports `joined: true`; `room.title` shows member count 2 |
| 07 | `07-message.yaml` | 06 + text both ways | type `BODY` in `composer.input`, `composer.send`; companion `GET /messages` body equals `BODY`; companion `/send BODY2`; `room.bubble` with `BODY2` visible (Secret room: only after `longPressOn: id: room.bubble`, and `assertNotVisible: BODY2` before the hold) |
| 08 | `08-file.yaml` | 06 + file both ways | `composer.attach` → picker (simulator photo library has a seeded image `qa-photo.png`; on Android use the `e2e/fixtures` pushed with `adb push`); `room.file` visible; companion downloads and asserts size > 0; companion `/sendFile passport.txt`; app `room.file` shows `passport.txt` |
| 09 | `09-view-once.yaml` | 06 + view-once from companion | `room.viewOnce` → `viewer.root` visible with content; `viewer.close`; tap again → `viewer.gone` copy; relaunch app → still `gone` |
| 10 | `10-burn.yaml` | 06 + burn | `menu.burn`, `menu.burn.confirm` → `chats.root`, row gone; companion `/sync` reports `removed: true`; relaunch → row still gone |
| 11 | `11-screenshot-notice.yaml` | 06 + companion `/screenshot` | `room.notice` visible with the web's wording; it is not a `room.bubble` |
| 12 | `12-join-by-link.yaml` | companion creates a room, app joins | `openLink: onepeek://chat/join#<token>` (simulators do not verify Universal Links; the https form is manual M9) → `join.root`, `join.code` wrong → `join.error`; right code + `join.nick` → companion admits → `room.root` |
| 13 | `13-settings.yaml` | Settings toggles | `settings.push` off → companion `/send` → no notification banner (iOS: `assertNotVisible` on the banner text within 10 s; Android: `adb shell dumpsys notification` via `runScript` is not available in Maestro, so banner check only); `settings.autolock` shows "1 minute"; `settings.devices` lists this device by label |
| 14 | `14-timer.yaml` | 07 + timer | `composer.timer` → `composer.timer.30s`; send; companion opens (`/sync` + mark opened through `/messages?open=1`); after 31 s `assertNotVisible` of that bubble in the app |
| 15 | `15-safety-number.yaml` | 06 + verify | `menu.verify` shows 60 digits grouped in 12; equals companion's `safetyNumberWith` from `/safety/:room/:device` |

Flows 05 to 15 share `_common/create-and-join.yaml` (`runFlow`) so a change in the create path is
fixed once. Flow 02, 08 (Android picker) and 13 (Android notification) are tagged `ios`/`android`
separately where the steps differ. Expected count at Gate 1: 15 flows × 2 platforms = 30 runs; 02 is
allowed to end early on both.

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

# Maestro (a machine with simulators, or Maestro Cloud)
node apps/mobile/e2e/companion/server.ts &             # second participant, burns its rooms on exit
maestro test apps/mobile/e2e/flows --include-tags ios     --format junit --output apps/mobile/e2e/results/ios.xml
maestro test apps/mobile/e2e/flows --include-tags android --format junit --output apps/mobile/e2e/results/android.xml

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
   anyway (M8) and the list is one tap away.
2. **`FLAG_SECURE` on the Chats list.** N1 says "chat and secret screens". The list shows room names
   and nick names (local data). Recommendation: cover the list too; it costs nothing and simplifies
   M3/M5.
3. **Harness extraction.** Moving the PGlite boot and `fakeSupabase` into `supabase/tests/harness.ts`
   touches the web test file (imports only). Approve, or Q1 duplicates the 90 lines.
4. **Owner nickname.** The web test only asserts the member's nickname reaches the owner. If the
   owner's nickname is not sent on create, mobile `members()` shows `null` for the owner (§2.2 H26).
   `core-crypto` to confirm; otherwise it is a Phase 1 fix.
5. **Simulators.** No Xcode or Android Studio on this Mac. Maestro flows need either a second machine,
   Maestro Cloud (paid), or a GitHub Actions `macos` runner with the iOS simulator (free minutes are
   limited). Pick one before Q3 starts; until then flows are written and reviewed but not run.
6. **`node:sqlite` for the SQLite mock.** Needs Node ≥ 22.13; CI's Node version must match. The
   alternative is `better-sqlite3` (native build, slower install). Recommendation: `node:sqlite`.
7. **Older iPhone.** Confirm the minimum iOS after the first prebuild so the second iPhone in §5.1 is
   bought or borrowed early.
