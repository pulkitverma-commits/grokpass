# Security review: Phase 1 wave 1 (`mobile/integration` 5ae2395..04783c9)

Reviewer: security-reviewer, task S1. Date: 2026-10-31. Branch `mobile/integration` at `04783c9`; range
`5ae2395..04783c9` (everything merged after Gate 0 approval: backend B1–B4, core-crypto Phase 1, mobile-ui
wave 1, native-security N1–N5, qa Q3/Q4, release R1, lead wiring). 168 files.

Method: `git diff --stat` for the list, then full reads (not hunks) of: `supabase/migrations/008_*`,
`lib/alerts.ts`, `app/api/chat/notify/route.ts`, `app/.well-known/**`, `packages/core/src/chat/client.ts`
(admit/lock/session/sendControl/redeem paths), `adapters/rn/{auth-storage,keystore}.ts`, `src/log.ts`,
`apps/mobile/lib/{chat,format}.ts`, every screen under `apps/mobile/app`, `components/{ChatProvider,
InviteSheet,JoinScreen}.tsx`, `security/**`, `plugins/**`, `modules/screen-state/**`, `app.config.ts`,
`metro.config.js`, `jest.config.js`, both `eslint.config.mjs`, `e2e/relay/server.mjs`, `e2e/scripts/*`,
flow sweep, `eas.json`, `.gitignore`; `expo-screen-capture` 58 JS + Kotlin; migration 006
`chat_create_invite`; the three earlier reviews, `log.md`, plan §1/§3/§7, test-plan §1.5/§1.6/§8.
Run: `npm test` from the root (Node from `~/Sites/newspop/.node/bin`): web **96/96**, core **162/162**,
mobile jest **102/102**, exit 0. No code edited; worktree clean apart from this file.

## Verdict

**One open high (W1-1).** No critical. Three medium (W1-2, W1-3, W1-4), six low. Nothing from S0a/S0b
regressed; N1, N2, N4 closed, N3 closed by the lead's decision (see table). W1-1 is a ten-line change in
`apps/mobile/lib/chat.ts` and should land before any device build is handed to a tester; W1-2 and W1-3
are changes to migration 008, which the human has **not applied yet**, so they are cheap now and
painful later.

## Findings

### W1-1 (high) — An `onepeek://auth` link carrying a `token_hash` signs the phone into whoever's account the hash belongs to (login CSRF), and the client then deletes the victim's local room keys

- `apps/mobile/lib/chat.ts:187-202` (`completeFromUrl`), `:194-196` (`verifyOtp({ token_hash, type })`
  with `type` cast unchecked), `apps/mobile/app/auth.tsx:24` (any `onepeek://auth…` URL that opens the
  app is handed to it), `app/_layout.tsx:25` (`auth` is a public route).
- The comment at `:183-185` refuses implicit-flow fragments "because a crafted link could sign this
  phone into someone else's account", but a `token_hash` is the same kind of bearer: it is not bound
  to this device the way a PKCE `code` is bound to the verifier in sealed storage. GoTrue's
  `token_hash` is `sha224(email || otp)`, so the holder of any magic-link OTP for *any* account can
  compute it.
- Failure scenario: attacker requests a magic link for `attacker@evil` (own inbox), computes
  `token_hash`, and sends the victim `onepeek://auth?token_hash=<hash>&type=magiclink` (a tap in
  iMessage, a QR, an `<a href>` on a page; the OTP is valid for 1 h by default). The app opens the
  `auth` route, `verifyOtp` succeeds, `getSession()` is truthy, `router.replace('/')`. The victim's
  phone is now signed into the attacker's account with no prompt and no visible change except the
  Settings email. Consequences, in order of harm: (1) `sync()` on any of the victim's real rooms gets
  `not_a_member` from the server (different `auth.uid()`) and runs `forgetRoom` under the room lock
  (`client.ts:544-547`): **the victim's MLS state and message copies for every existing room are
  deleted locally** and cannot come back; (2) every room the victim now creates is owned server-side
  by the attacker's user: `chat_create_invite` (006:306) authorises on `user_id = auth.uid()`, so the
  attacker mints an invite for it, redeems on their own device, and appears in the victim's Chats home
  as `Guest XXXX wants to join · used your invite` (index.tsx:158-159) — or is auto-admitted by the U5
  room screen, which the lead has decided will "auto-admit like the web" (log.md); (3) the victim's push
  token (wave 2) registers under the attacker's owner id.
- The existing test `finishes an email link carrying token_hash + type with verifyOtp` (chat.test.ts:181)
  asserts the vulnerable behaviour.
- Fix (owner: core-crypto, `lib/chat.ts`; mobile-ui adjusts `sign-in.tsx` if the API changes):
  (a) bind the link to the device: `sendEmailLink(email)` records the lower-cased address and a
  timestamp (module memory is enough; SecureStore if it must survive a cold start, under the lock
  store's class), `completeFromUrl` accepts `token_hash` only while a pending email exists and is
  younger than the OTP lifetime, and after `verifyOtp` compares `session.user.email` (lower-cased) with
  it; on mismatch call `signOut({ scope: 'local' })`, return `false`; (b) allow only
  `type ∈ {'magiclink', 'email'}`; (c) keep `code` as is (verifier-bound) but also compare nothing is
  needed there. Tests to add (`chat.test.ts`): token_hash with no pending email → `false`, `verifyOtp`
  never called; pending `me@x`, mocked `verifyOtp` yields `other@evil` → `false`, `signOut` called,
  `getSession()` null afterwards; pending `me@x`, session `me@x` → `true`. Rewrite the existing test to
  call `sendEmailLink` first. Record in `docs/mobile/plan.md` U2 that the email link is device-bound.

### W1-2 (medium) — Push tokens outlive the account that registered them on a shared phone; sign-out leaves the row, and 008 lets two owners hold one token

- `supabase/migrations/008_mobile_push_tokens.sql:23` (`unique (owner, token)`), `:43-44` (upsert on
  that pair), `supabase/tests/push-devices.test.ts:95-99` (asserts the same token under two owners is
  allowed, "shared device, two accounts"), `apps/mobile/lib/chat.ts:219-222` (`signOut`) and
  `:234-248` (`resetThisPhone`) call nothing on `push_devices`; `settings.tsx:46` (guest sign-out: "can't
  be signed back into", so its token is orphaned for good). Test-plan §1.5 (e) specified the opposite
  ("registering a token that another owner holds moves it to the caller and the old row is gone"); the
  implementation deviated and the deviation was not logged.
- Failure scenario: A and B share a phone (or A sells it, or A was a guest). A signs out, B signs in
  and registers (wave 2). A's row keeps A's token. Every message in A's rooms now delivers
  `OnePeek / You have a new message in a private chat.` to the phone in B's hands, with A's room UUID in
  `aps.thread-id`, `apns-collapse-id`, FCM `data.room` and `android.notification.tag`. B learns when
  A chats and groups the activity per room; the payload is content-free, but the plan's promise is
  "push with no content *to the member*", not to whoever holds the token now. Tokens are also never
  pruned, so the table and the fan-out (W1-3) grow without bound.
- Fix: backend (008 is unapplied): make the token the key: `unique (token)` and `on conflict (token) do
  update set owner = auth.uid(), platform = excluded.platform, last_seen = now()` (a phone belongs to
  one account at a time); update the test at `:95` to assert `count = 1, owner = BOB`. core-crypto /
  lead: `auth.signOut()` and `resetThisPhone()` call `unregisterPushDevice(token)` *before* revoking the
  session (needs the token; wave 2 push registration should keep it in module memory or in the sealed
  auth store under `AUTH_PREFIX + 'push_token'`), best effort, never blocking sign-out. Put the ordering
  in the plan for the wave-2 push task now. Tests: push-devices.test as above; chat.test: sign-out with
  a known token calls `unregister_push_device` first and still signs out when the RPC fails.

### W1-3 (medium) — No cap on `push_devices` rows per owner: one account turns every notify into an unbounded APNs/FCM fan-out from Vercel

- `008_mobile_push_tokens.sql:20, 42` (token: any text 1–4096 chars, no charset, no row limit),
  `lib/alerts.ts:330-341` (`pushToNative` selects every row for the owner and `Promise.all`s one HTTP
  request per token, no chunking), `:232, :312`.
- Failure scenario: attacker account X registers 50 000 distinct 4 KB "tokens" (one RPC each; the only
  limit is Supabase's global request rate). X joins a room with account Y (also the attacker, or any
  victim who invited X). Each message Y sends triggers `/api/chat/notify` → 50 000 outbound HTTP/2
  requests to `api.push.apple.com` (or FCM) from the serverless function, 4 per minute per sender per
  room, with as many rooms as X likes. Effects: function time-outs for everyone's notifies (the route
  awaits the fan-out before responding), Vercel egress cost, and Apple/Google treating the provider
  key as abusive (bad tokens, floods), i.e. a push outage for all users. Dead-token deletion does not
  help: 4 KB garbage is rejected as `BadDeviceToken` *after* the request is made, and X re-registers.
- Fix (backend; 008 unapplied): in `register_push_device`, after the upsert, `delete from push_devices
  where owner = auth.uid() and id not in (select id … order by last_seen desc limit 10)`; constrain the
  token to what the platforms issue, e.g. `check (token ~ '^[A-Za-z0-9:_-]{32,512}$')` (APNs: 64 hex;
  FCM: ~150–200 chars of `[A-Za-z0-9_:-]`); in `pushToNative`, chunk the sends (e.g. 20 at a time) and
  `.slice(0, 10)` defensively. Tests: push-devices.test: 11th registration leaves 10 rows and the oldest
  `last_seen` is gone; a 4096-char or whitespace token is `bad_token`; alerts.native.test: 25 tokens are
  sent in bounded batches.

### W1-4 (medium) — The app-wide FLAG_SECURE can be cleared by the unmount of any chat screen if the provider's one `preventScreenCaptureAsync` call failed

- `apps/mobile/security/SecurityProvider.tsx:78` (`ScreenCapture.preventScreenCaptureAsync(APP_SECURE_KEY)
  .catch(() => {})`, called once on mount, never retried), `security/secureScreen.ts:17-20`
  (`allowScreenCaptureAsync(key)` on unmount), `secureScreen.test.tsx:17` (asserts the unmount call).
  `node_modules/expo-screen-capture/build/ScreenCapture.js`: `preventScreenCaptureAsync` **removes the
  key from `activeTags` when the native call throws**; `allowScreenCaptureAsync` calls native
  `allowScreenCapture()` → `window.clearFlags(FLAG_SECURE)` (`ScreenCaptureModule.kt:92`) whenever the set
  is empty. The native call throws `MissingActivity` when `currentActivity` is null.
- Failure scenario: cold start where the first `useEffect` runs before the activity is attached (seen
  in practice with dev-client reloads and Android process restarts into a backgrounded app): the app key
  is never held. Later the user opens a room (`useSecureScreen('room:x')` → flag re-added) and leaves it:
  the set becomes empty and native **clears the flag set by `plugins/withSecureWindow.js` in
  `onCreate`**. From then on the Chats list, Settings, the Locked cover and the recent-apps thumbnail
  are capturable until the process dies, while `index.tsx:30` still says "Screenshots are blocked in
  chats on this phone." The failure is silent and the test suite encodes the clearing call as correct.
  The comment in `secureScreen.ts:4-6` ("never reaches the native clear") holds only while the app key
  is in the set.
- Fix (native-security): the app never wants FLAG_SECURE off, so never call `allowScreenCaptureAsync`:
  make `secureScreenUnmount` a no-op (or delete it and keep `useSecureScreen` as "assert on mount"); and
  re-assert `preventScreenCaptureAsync(APP_SECURE_KEY)` on every `AppState` → `active` in the provider.
  Tests: `secureScreen.test`: unmount does **not** call `allowScreenCaptureAsync`; `SecurityProvider.test`:
  with `preventScreenCaptureAsync` rejecting once, the next `active` transition calls it again. MANUAL
  S2 already covers the device side; add "after opening and leaving a room".

### W1-5 (low) — `nodeHttp2Request` never settles on a stream timeout, so one slow APNs stream hangs the notify route

- `lib/alerts.ts:205-220`: `stream.setTimeout(10_000, () => stream.close(NGHTTP2_CANCEL))` emits `close`,
  not `end` or `error`; neither `resolve` nor `reject` runs, `session.close()` is never called,
  `Promise.all` in `sendApns` and then the route wait for the function timeout. No `session.setTimeout`
  on connect either.
- Fix (backend): handle `stream.on('close')` (resolve with the status seen or reject), add
  `session.setTimeout(10_000, …)`, and in `sendApns` race each request against a deadline. Test: inject
  `http2Request` that never resolves and assert `sendApns` resolves within the deadline with the token
  kept (not dead).

### W1-6 (low) — `supabaseUrl` from `expoConfig.extra` is unvalidated; the fetch-literal lint cannot see it

- `apps/mobile/lib/chat.ts:39-47, 79-80`, `app.config.ts:78-79`. S0b M2 pinned `siteUrl`; the Supabase
  host, where the sealed session's refresh token and every RPC go, is whatever `EXPO_PUBLIC_SUPABASE_URL`
  was at build time (EAS env per profile, `eas.json`). A wrong or malicious env in a preview build
  sends the refresh token elsewhere, and nothing in the leak guard (§1.6: computed URLs are out of
  scope) or the core (`checkOnePeekUrl` covers onepeek.io only) refuses it.
- Fix (core-crypto): in `extra()`, accept only `https://<ref>.supabase.co` (the lint's own pattern) and
  otherwise return `''` so `supabase` is `null` → `not_configured`. Test: `extra.supabaseUrl =
  'https://evil.example'` → `getChat()` builds with no Supabase client and `auth.getSession()` throws
  `not_configured`.

### W1-7 (low) — An unlock in flight across a long background trip can finish after the relock

- `security/SecurityProvider.tsx:118-136, 84-106`. `unlock()` awaits the OS prompt and `chat.unlock()`;
  if the app goes to background mid-await and returns after `AUTO_LOCK_MS`, `onChange('active')` sets
  `locked = true`, then the stale promise resolves and `setLocked(false)` without a new prompt. On
  Android the prompt is cancelled by backgrounding (returns false), so the window is iOS with a slow
  `chat.unlock()` (it is local today: `ensureSession` + stubbed passkeys), i.e. milliseconds.
- Fix (native-security): an unlock generation counter incremented on every relock; `unlock()` applies
  its result only if the generation is unchanged. Test: deferred `authenticateAsync`, 61 s trip, resolve
  → still locked.

### W1-8 (low) — The Phase 0 spike screen still ships and is a public route

- `apps/mobile/app/spike.tsx` (exists), `app/_layout.tsx:25` (`'spike'` in `PUBLIC`), `settings.tsx:41`
  (link is `__DEV__` only, but expo-router registers the route in every build; `onepeek://spike` opens
  it signed-out). It uses its own database and SecureStore entry (N1 closed) and talks to no network;
  it copies benchmark lines to the clipboard. No secret exposure; it is dead surface the plan said would
  be deleted after Gate 0 and the honest-copy rule does not cover it.
- Fix (lead): delete `spike.tsx`, the `PUBLIC` entry and the Settings row; or gate the route file
  itself behind `__DEV__` (`export default __DEV__ ? Spike : () => <Redirect href="/" />`). Test:
  `chats.test`/routes test asserts no `spike` route in production.

### W1-9 (low) — The wave-2 decision to render the full invite link in `invite.link` undoes `maskLink`

- `components/InviteSheet.tsx:36` masks today (`maskLink`, `accessibilityLabel="Invite link, hidden"`),
  `e2e/flows/03-create-secret-room.yaml:51-53` reads `invite.link` with `copyTextFrom`, and log.md
  records "`invite.link` renders the full link" as accepted for mobile-ui wave 2. That puts the owner's
  bearer token on screen (shoulder surfing, a photo of the owner's screen, the iOS screenshot that
  cannot be blocked) where the web deliberately shows `#••••••`.
- Fix (mobile-ui + qa): keep the mask on screen; for Maestro, render the full link only when an E2E
  build flag is set (`Constants.expoConfig.extra.e2e`), in a zero-height element with the testID, or
  drive flow 03 from the Copy button and the device clipboard. Test: `new.test` asserts the rendered text
  never contains the fragment unless the flag is set.

### W1-10 (low) — Leak-guard blind spots worth writing down

- `packages/core/eslint.config.mjs`, `apps/mobile/eslint.config.mjs`, test-plan §1.6 "Not covered".
  Sinks that carry data off the phone or into other apps and are not matched: `Clipboard.setStringAsync`,
  `Share.share`, `Linking.openURL`, `WebBrowser.open*Async`, `Image`/`source={{ uri }}`, `WebSocket`,
  `XMLHttpRequest`, `Alert.alert` (on-screen). All are legitimately used by InviteSheet/Welcome today, so
  they cannot be banned, but a rule that flags them with a secret-named argument (same `SENSITIVE` list)
  is cheap. `TELEMETRY_IMPORT` misses `expo-insights` and `expo-updates` (both phone home with device
  data). `redact()` clips strings inside arrays under a non-sensitive key to 32 chars
  (`redact({ ids: [token] })` keeps the first 32 chars; `log` is a no-op today, so no leak).
- Fix (qa): add the two imports to `TELEMETRY_IMPORT`, a sink rule for the list above, redact
  array-of-string members under depth 1 as whole strings, and extend the "Not covered" paragraph.

## Checked and found correct (one line each, for coverage)

- 008 RLS: `revoke all … from anon, authenticated` then `grant` to `authenticated` under a single
  `owner = auth.uid()` policy (`using` + `with check`); anon has nothing; service role bypasses; cascade
  on user delete; down script drops only its own objects. Tests cover owner/other/anon/service/guest.
- Both RPCs raise `not_signed_in` on null `auth.uid()`, take no `owner` argument (nothing to forge),
  check `platform ∈ {ios, android}` (tighter than the test plan's `web`); `unregister` is scoped to the
  caller. `security definer set search_path = public`: `public` is not writable by `authenticated` in
  this project and no unqualified function is called, so no hijack path; `''` + qualified names would be
  the Supabase-recommended form when 008 is next touched.
- `apnsPayload`/`fcmMessage` carry only the two fixed strings and the room UUID (regex-validated,
  lower-cased); `alerts.native.test.ts` sweeps the serialised request for every §1.1 fixture, counts
  UUIDs, checks `apns-topic`/`apns-push-type`, the FCM host, opt-out, dead-token deletion scoped to the
  owner, and that credentials never appear in payloads or errors.
- APNs `.p8` and FCM service account come only from env; `createPrivateKey` failures are swallowed to
  `null` (no key material in error paths); JWTs cached 50 min / until expiry; `apns-collapse-id` and
  `thread-id` are room-scoped (lead's `ROOM_IN_PAYLOAD = true` decision).
- `/api/chat/notify`: session, UUID, room active/not expired, caller active member, `chat_rate_ok`
  throttle, recipients exclude the sender and `push_on = false`, all unchanged; native fan-out sits under
  the same checks; a throwing native sender is contained by `Promise.allSettled`.
- AASA/assetlinks: 404 unless `APPLE_TEAM_ID` matches `^[A-Z0-9]{10}$` / fingerprints match the
  `AA:BB:…` form; JSON content type, no redirect, 1 h cache; `webcredentials` present; `/chat/join` with
  `#*` listed. `.env.example` placeholders only; `deployment.md` §5 says "server only, never in the app".
- Sealed auth storage: own file `onepeek-auth.db` and own entry `onepeek.wrap.auth` (N1 rule); AAD is
  `auth:<supabase key>`; the test dumps SQLite rows and SecureStore for the session JSON, tokens and
  email; `keystore_unavailable` can only arise when SecureStore returns `null` with rows present (a
  device-local condition, not remotely triggerable); a transient read error returns "no session" and
  deletes nothing. supabase-js is built with `persistSession: true`, `autoRefreshToken: true`,
  `detectSessionInUrl: false`, `flowType: 'pkce'`.
- `createRoom({ nickname })` sends the `nick` control under `withRoomLock`; `admitPendingLocked` runs
  entirely inside `withRoomLock` and re-announces **after** the commit is saved and the Welcomes are sent,
  so pending or non-members never receive it in a readable epoch; `sendControl` does not lock itself (no
  nested-lock deadlock). `SyncResult.newAlerts` is a pure split of a counter.
- `registerPushDevice`/`unregisterPushDevice` require a real session (`ensureSession(false)`), trim and
  validate inputs client-side, send only platform and token (`client.push.test.ts`).
- `log()` is a no-op, `redact()` redacts a bare string whole, sensitive keys by regex, errors to
  `{ name, code }`; `npm run lint` configs are errors, both configs probed by `leak-guard.test.ts`, and
  the static `console\.` sweep is green on the whole app and core.
- `parseAuthCallback` requires `onepeek://auth` followed by end, `/`, `?` or `#` (rejects `auth.evil`,
  `auth@evil`, `auth/..`), hand-parses (no Hermes `URL`), and the raw URL reaches nothing else (test
  `never hands the raw URL to anything but the parser`). PKCE `code` is verifier-bound, so a foreign code
  fails. Provider errors and implicit-flow fragments are refused. Apple sign-in binds a hashed nonce.
- `startOAuth` uses `redirectTo: onepeek://auth`, `skipBrowserRedirect: true`, system browser via
  `openAuthSessionAsync`; `signOut({ scope: 'local' })` (other devices stay signed in; see W1-2 for the
  push row); `deviceLabel()` is model + OS only, never `Device.deviceName` (tested).
- `resetThisPhone()`: stops auto-refresh, local sign-out, wipes the chat keystore, wipes the auth store,
  clears the lock, drops the singletons (tested). The reset screen is two taps, `gestureEnabled: false`,
  and `ChatProvider.guard` routes to it only on `code === 'keystore_unavailable'`.
- Invite handling: `inviteTokenFrom` takes only a `#fragment` of 32–128 `[A-Za-z0-9_-]` (an implicit-flow
  fragment cannot match); the token lives in React state, goes only to `peekInvite`/`redeemInvite`
  (Supabase RPC), is never rendered, never in route params (fragment, not query), never persisted;
  `chat/join` keys the screen on the URL. Access code fields: `autoComplete="off"`,
  `textContentType="none"`, `autoCorrect={false}`; nickname capped at 40 in both the field and the core.
- `auth.tsx` renders a spinner or a fixed error string, never the URL; `handled` ref stops a second
  exchange of the same URL (a Google callback can still be exchanged twice via `sign-in.tsx` + the
  route: UX only, the second fails).
- `AuthGate` public set: `welcome`, `sign-in`, `auth`, `join`, `chat` (guest joins), `reset` (must open
  from `guard()` before any session), `spike` (W1-8). Signed-in users are bounced off `welcome`/`sign-in`.
- Copy: Welcome "Screenshots blocked or flagged", Chats footer per platform, Settings "secure storage,
  never backed up", `PROTECTION_COPY`, README N2 "iOS cannot block a screenshot and OnePeek does not
  claim to", MANUAL-CHECKS "Not tested because it is not true". Honest throughout; no room/nick/id is
  interpolated into any prompt or notice except the web's own `<name> may have taken a screenshot.`
- `withSecureWindow`: import added once, `setFlags(FLAG_SECURE, FLAG_SECURE)` inserted after the first
  `super.onCreate(...)` line for both `.kt` and `.java`, marker makes it idempotent, throws when no
  `super.onCreate` exists (no silent unprotected build); `createRunOncePlugin`.
- `withBackupRules`: both XML files exclude `root, file, database, sharedpref, external` for cloud
  backup, device transfer and legacy; manifest gets `allowBackup=false`, `fullBackupContent`,
  `dataExtractionRules`; `expo-secure-store` has `configureAndroidBackup: false` so the two do not
  fight; dangerous mod runs before the manifest mod.
- iOS backup exclusion: the Swift module **creates** the SQLite directory if missing before marking it
  (so first-launch ordering is fine), marks the directory (covers `onepeek-auth.db` and all side files
  created later) plus `onepeek-chat.db{,-wal,-shm,-journal}` individually; missing files return false;
  no path is logged. `CHAT_DB_NAME` equality with the core is tested.
- Lock state machine: locked on cold start, children unmounted (not covered) while locked, cover while
  `inactive || captured`, 60 s boundary tested at 59/61, panic flips state synchronously and writes the
  flag with the sync SecureStore API before `chat.lock()`, `probeDeviceAuth` fails closed to "prompt",
  `deviceInsecure` is honest (`DEVICE_INSECURE_WARNING`), `unlocking` ref prevents double prompts.
  `reload()` is called optionally and does not exist in the core (lead's decision); because the only
  writer of the flag is this process and `unlock()` clears it after the OS check, nothing depends on it.
- `useScreenshotAlert` has exactly one side effect, `getChat().sendScreenshotAlert(roomId, ttl)`,
  swallowed on failure; `Watermark` text is the web's, `pointerEvents="none"`, hidden from a11y.
- `modules/screen-state`: iOS observes `UIScreen.capturedDidChangeNotification` with start/stop/destroy
  symmetry; Android stubs return `false`; the JS binding degrades to "not captured / nothing marked"
  without the native module and never throws.
- Metro: `@onepeek/core` and `@onepeek/core/*` resolve to **this tree's** `packages/core` (so a worktree
  cannot bundle another checkout's core), hierarchical lookup off, the five unused ts-mls suites are
  `empty`. Jest maps the same two specifiers by path.
- E2E: relay binds `127.0.0.1` only, in memory, prints nothing, allow-listed trigger commands with a
  device-id regex; no flow uses `takeScreenshot`/`startRecording`; `run-two-device.sh` never echoes a
  variable, deletes images and the simulator screenshot dir, and removes the debug dir unless
  `KEEP_DEBUG=1` (documented: command logs then contain the link). `eas.json` has placeholders only;
  `google-services.json`, `GoogleService-Info.plist`, `.env`, `google-play-service-account.json`, `*.p8`,
  `*.p12`, `*.key`, `*.pem` are git-ignored. `.github/workflows/ci.yml` is unchanged in the range.

## Previous reviews' items

| Item | What it was | Status at 04783c9 | Evidence |
| --- | --- | --- | --- |
| S0a M1 | web wrapping-key cache per instance over a shared IndexedDB | **held** | `adapters/web/**` untouched in the range (`git diff --stat` empty) |
| S0a M2 | `createWebPlatform` second keystore | **held** | same |
| S0b M1 | SecureStore `null` must not re-provision while rows exist | **held** | `keystore.ts` `onMissingKey` unchanged except N2; tests `M1: …` 2× still present and green |
| S0b M2 | `siteUrl`/`apiBaseUrl` validated https onepeek.io literal | **held** | `app.config.ts:82` literal; `createRnEnv` re-validates; test-plan line now reads "Neither `EXPO_PUBLIC_*` nor `expoConfig.extra` can redirect it" (`test-plan.md:164`), doc remainder closed |
| S0b M3 | panic lock fails closed, persists synchronously, THIS_DEVICE_ONLY | **held** | `SecurityProvider.panic()` → `getLockStore().set()` (sync path) before `chat.lock()`; `platform.ts` unchanged |
| N1 | spike's `wipe()` used the shared `onepeek.wrap` entry | **closed** | `spike.tsx:80` `wrapKeyId: 'onepeek.wrap.spike'`, own `dbName`; the auth store follows the same one-db-per-entry rule (`auth-storage.ts:10-13`) |
| N2 | stale `wiping` marker turns a later key loss into a silent delete | **closed** | `keystore.ts:174-180` clears the marker in the no-rows branch; test `N2: a marker left by a wipe that died after the row delete is cleared…` |
| N3 | lock has no re-read on foreground | **closed by decision** | log.md: "`reload()` stays optional-sync"; provider calls `store.reload?.()`; core has no `reload` (`grep` empty). Harmless because the flag's only writer is this process and `unlock()` clears a spurious locked start after the OS check |
| N4 | `keystore_unavailable` recovery unspecified; test-plan siteUrl line; known-limitations AAD note | **closed** | `ChatProvider.guard` → `/reset`; `reset.tsx` two-tap → `resetThisPhone()`; `keystore.ts:29-34` documents it; known-limitations item 9 added; test-plan line corrected |

## Claims that need a device build (not verifiable here)

- The generated `MainActivity` compiles with the inserted `window.setFlags(...)` and screenshots/
  recordings/recents are black on a real Android (MANUAL S1–S4); the W1-4 path (what `currentActivity`
  is at first render in a dev client and after a process restart).
- `UIScreen.isCaptured` cover timing and the frames before detection (S6); `preventScreenCaptureAsync`'s
  iOS best-effort canvas on the test iOS version (S5); the app-switcher snapshot showing the cover (S4).
- `isExcludedFromBackup` effective on the expo-sqlite directory and side files (S15, S16); Android
  `bmgr`/transfer opt-out (S17, S18); that `SQLite.defaultDatabaseDirectory` is the directory the core's
  `openDatabaseAsync` really writes to on iOS.
- expo-secure-store 58 synchronous `setItem`/`getItem` on device for the panic flag (S12), and
  `errSecInteractionNotAllowed` behaviour on a locked iPhone cold start.
- Universal Link `#fragment` delivery into `useLinkingURL()` on a cold start through expo-router (the
  token path of `chat/join.tsx`), and that expo-router does not surface the fragment or the `auth` query
  (`code`, `token_hash`) in any dev-tools or route-state dump in release builds.
- APNs/FCM real sends (banner wording M8, dead-token behaviour with real `410`/`UNREGISTERED`), AASA and
  assetlinks served by Vercel without a redirect, Face ID prompt text and passcode fallback (S9),
  Apple/Google sign-in round trips including the `onepeek://auth` allow-list in Supabase Auth.
- Hermes behaviour of `react-native-quick-crypto` for the sealed auth store (`installRnCrypto` +
  `assertRuntimeSupport` gate it at launch, as S0b L5 intended).

## Verdict line

**One open high: W1-1 (`token_hash` login CSRF in `completeFromUrl`, with local room-key loss and
attacker-owned rooms as consequences).** Medium: W1-2 (shared-phone push token residue; `unique
(owner, token)` + no unregister on sign-out), W1-3 (no per-owner token cap; notify fan-out
amplification), W1-4 (app-wide FLAG_SECURE clearable through `allowScreenCaptureAsync`). Low: W1-5
to W1-10. S0a/S0b held; N1, N2, N4 closed; N3 closed by decision. web 96/96, core 162/162, mobile
102/102.
