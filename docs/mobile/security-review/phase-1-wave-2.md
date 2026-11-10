# Security review: Phase 1 wave 2 (`mobile/integration` 04783c9..b0a88f9)

Reviewer: security-reviewer, task S1, second pass. Date: 2026-10-31. Branch `mobile/integration` at
`b0a88f9`; range `04783c9..b0a88f9` (wave 1 review fixes from core-crypto, backend, native-security and
the lead; mobile-ui wave 2: U3 Locked screen, U5 Conversation, U7 room menu + Settings). 41 files,
+3456/−174, `.claude/worktrees` ignored.

Method: full reads (not hunks) of `apps/mobile/lib/chat.ts`, `lib/files.ts`, `lib/format.ts`,
`app/_layout.tsx`, `app/auth.tsx`, `app/settings.tsx`, `app/index.tsx`, `app/room/[id].tsx`,
`components/LockedScreen.tsx`, `components/InviteSheet.tsx`, `components/ChatProvider.tsx`,
`components/room/{MessageBubble,FileViewer,Composer,AttachSheet,RoomMenu,MineGradient}.tsx`,
`security/{SecurityProvider,secureScreen,constants,Watermark,screenshot}.ts*`, `test/chat-mock.ts`,
`supabase/migrations/008_*`, the diffs of `lib/alerts.ts`, every test in the range, the core's
`client.ts` (ensureDevice/revokeDevice, admit/remove, sendFile/openFile/markViewed/notifyRoom,
markOpened, leave/burn, sync), `adapters/rn/platform.ts` (`fileSource`), 006's `chat_send`
(`p_remove`/`p_activate`), `chat_leave`, `chat_burn`, `chat_revoke_device`, the web room page for the
parity claims, `log.md`, `plan.md` §3, `deployment.md`, `security/README.md`, `MANUAL-CHECKS.md`.
Run: `npm test` from the root (Node from `~/Sites/newspop/.node/bin`): web **108/108**, core
**162/162**, mobile jest **172/172** (21 suites), exit 0. No code edited; worktree clean apart from
this file.

## Verdict

**No open high. No critical.** Every wave-1 fix landed as specified: W1-1, W1-2, W1-3, W1-4, W1-5,
W1-6, W1-7, W1-9 closed with tests; W1-8 closed by the lead's decision (route needs a session);
W1-10 intentionally open (qa, parallel). Wave 2 adds two mediums (W2-1 reply preview puts Secret text
on screen unheld; W2-2 the pickers' plaintext copies of sent files are never deleted) and eight lows.
None blocks a tester build; W2-1 and W2-2 should land before Gate 1 because they contradict copy the
app shows ("text absent from the tree until held"; "Forgets every chat and key stored here").

## Part A: wave-1 fixes as landed

| Item | Status | Proof (test) | Residual / new gap |
| --- | --- | --- | --- |
| W1-1 `token_hash` login CSRF | **closed** | `lib/chat.ts:141-143, 222-235, 243-249`: `pendingEmail` (module memory, 1 h TTL), `type ∈ {magiclink, email}`, session email compared lower-cased, `signOut({scope:'local'})` on mismatch, pending consumed once. `chat.test.ts` "email link (token_hash)": no pending → `false`, `verifyOtp` never called; pending + attacker session → `false`, `signOut` called, auth db empty; 8 refused `type`s; TTL at 1 h / 1 h+1 ms; sign-out and reset forget the pending address. Plan U2 updated. | Cold start: module memory is cleared, the user asks for a new link (accepted in log.md; the `auth.tsx` copy blames "another phone", see W2-10). Between `verifyOtp` and `signOut` the attacker's session is live and `onAuthStateChange` fires SIGNED_IN with it; nothing acts on it today because `AuthGate` never redirects from the `auth` route and no sync-capable screen is mounted while a pending email can exist (sign-in bounces signed-in users), but the safety is positional, not enforced (W2-9). |
| W1-2 push token outlives the account | **closed** | `008:32` `unique (token)`, `:58` `on conflict (token) do update set owner = v_owner`; `push-devices.test` "a token belongs to one owner… (W1-2)": 1 row, owner BOB, ALICE's unregister touches nothing, service role sees one row, direct insert of a held token rejected. `lib/chat.ts:280-310` `push.register/unregister/current` (token sealed under `auth:onepeek.push.token`, rotation unregisters the old one), `signOut()`:264 and `resetThisPhone()`:326 unregister before the session goes; `chat.test.ts` "push": RPC-before-signOut ordering, failing RPC still signs out and clears the local token, token absent from SecureStore / disk / every non-RPC call. | Hijack of another device's token needs the token string, which reaches only the RPC and the sealed store (never rendered, logged or in an error: `reset-settings.test` sweeps the tree). Whoever does learn one can take it over and silence the victim's pushes for good because nothing re-registers after the Settings toggle (W2-8). Direct table writes are still granted to `authenticated` (W2-5). |
| W1-3 unbounded fan-out | **closed** | `008:29, 54` token `32–512` of `[A-Za-z0-9:_-]` as table check and RPC check; `:59-66` trim to 10 per owner, scoped `d.owner = v_owner`; `alerts.ts` `pushToNative` `.order('last_seen', desc).limit(10)` + `.slice(0, 10)`, `inChunks(…, 10)` in `sendApns`/`sendFcm`; tests: 11th registration leaves 10 and drops the oldest, Bob's rows untouched, 9 bad shapes rejected incl. 4096 chars / whitespace / newline, FCM-shaped accepted; `alerts.native.test` "reads at most the 10 most recently seen", "25 tokens go out 10 at a time" (peak in flight = 10, APNs and FCM); notify route mock updated. | No way to evict another owner's rows (both the `delete` and `unregister` are `owner = auth.uid()`). The cap is bypassable by a direct `insert` through PostgREST (table grant), which inflates the table but not the fan-out (the read is capped at 10) — W2-5. |
| W1-4 FLAG_SECURE clearable | **closed** | `secureScreen.ts`: unmount is a no-op; `SecurityProvider.tsx:87-95, 106, 130` asserts `APP_SECURE_KEY` on mount, one retry after `SECURE_RETRY_MS`, and on every `active`. `grep allowScreenCaptureAsync apps/mobile` hits only comments, jest mocks and the README (verified). Tests: `secureScreen.test` unmount never calls allow (also after a rejected prevent, Android); `SecurityProvider.test` W1-4 ×3 (mount + every active; MissingActivity retried once then on active; no retry loop). MANUAL S2/S4 extended. | None found. Device-only: whether `preventScreenCaptureAsync` with a fresh key after `MissingActivity` actually re-sets the flag on the real activity (MANUAL S2 covers it). |
| W1-5 http2 never settles | **closed** | `alerts.ts` `nodeHttp2Request`: `settled` guard, `session.destroy()` on every path, stream `end`/`error`/`close`/`timeout`, session `error`/`close`/`timeout`, `setTimeout(10 s)` on both, 15 s hard deadline, `connect` throw caught. Tests "nodeHttp2Request always settles (W1-5)" ×7 incl. close-only (the old hang), close-after-status resolves, deadline with fake timers, late `end` ignored, `sendApns` keeps a token whose request rejected. | None. |
| W1-6 Supabase URL unvalidated | **closed** | `lib/chat.ts:49-55` `^https://[a-z0-9-]+\.supabase\.co$`, else `''` → no client → `not_configured`. `chat.test.ts` 13 bad forms (path, port, query, fragment, http, userinfo, upper-case, suffix host, prefix host) → no `createClient`, `not_configured`, `evil.example` never reaches the fake; exact host with whitespace accepted. | None. |
| W1-7 stale unlock | **closed** | `SecurityProvider.tsx:76-84, 150-173`: `generation` bumped by every `relock()` (auto-lock, `lockNow`, `panic`, reloaded flag); `unlock()` re-checks after the OS prompt and after `chat.unlock()`; `unlocking` released by the relock. Tests W1-7 ×3: 61 s trip → stale promise `false`, app locked, core untouched, fresh prompt works; `lockNow` mid-prompt; `panic` mid-core-unlock keeps the flag. MANUAL S11b added. | None. |
| W1-8 spike route public | **closed by decision** | `_layout.tsx:25` `PUBLIC` no longer lists `spike`; `settings.tsx:122` row is `__DEV__` only. The file still ships (lead: deleted after the spike runs). | A signed-in user can still open `onepeek://spike` in a release build; no network, own SecureStore entry, clipboard copy of benchmark lines only. Accepted. |
| W1-9 full invite link on screen | **closed** | `InviteSheet.tsx:19, 40`: `maskLink(link)` unless `process.env.EXPO_PUBLIC_E2E === '1'` at bundle time; `new.test.tsx:43` asserts `…#••••••`. | The flag is an ordinary build env with no profile guard, and nothing in the repo sets it (so flow 03's `copyTextFrom invite.link` currently reads the mask): W2-6. |
| W1-10 leak-guard blind spots | **open (qa, parallel)** | — | Unchanged; not re-reviewed here. |

## Part B: wave 2 findings

### W2-1 (medium) — The composer's reply preview puts someone else's Secret-room text on screen while nothing is held

- `apps/mobile/app/room/[id].tsx:373` `replyPreview={replyTo ? (replyTo.file ? … : replyTo.body.slice(0, 40)) : null}`,
  `components/room/Composer.tsx:28-30` renders `Replying to “{replyPreview}”` inside a `View` with
  `accessibilityLiveRegion="polite"`. The Reply button exists only while the bubble is held
  (`MessageBubble.tsx:132-137`), but `replyTo` state outlives the hold.
- Failure scenario: in a Secret room the reader holds a message, taps Reply, lets go. The first 40
  characters ("The locker code is 4471.") now sit in the composer unheld, with no watermark
  (`holding` is false, `[id].tsx:279, 359`), survive the screenshot event and `inactive` (both only
  clear `held`), and are announced by TalkBack/VoiceOver as a live region. An iOS screenshot or a
  shoulder-surfer gets the text without a hold; on a held message the watermark would have named the
  viewer. This contradicts the screen's own header ("message text stays … in the bubbles that show
  it"), log.md ("text absent from the tree until held") and the test `Secret room: text is not in
  the tree until held`, which never presses Reply. The web (`app/chat/r/[id]/page.tsx:371`) has the
  same preview, so this is parity, but the mobile claim is stronger than the web's.
- Fix (owner: mobile-ui): for `secret && !replyTo.mine` pass a content-free preview (`a hidden
  message`, or the sender's name), keep the 40-char preview for own messages and non-Secret rooms;
  consider clearing `replyTo` on the screenshot event too. Test (`room.test.tsx`): hold → press
  `reply.m1` → pressOut → `queryByText(/locker/)` is null and `JSON.stringify(screen.toJSON())`
  does not contain the body. Tell the web owner; it is a one-line change there as well.

### W2-2 (medium) — Plaintext copies made by the pickers are never deleted, so "Reset chats on this phone" leaves sent attachments on disk

- `apps/mobile/lib/files.ts:35` `ImagePicker.launchImageLibraryAsync({ quality: 0.9, … })` writes a
  re-encoded copy under the app's cache (`…/Caches/ImagePicker/` on iOS, `cacheDir/ImagePicker` on
  Android); `:43` `DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })` copies the picked
  document into the cache. `[id].tsx:233-244` `sendPicked` reads it through `fileSource(p)` and
  never touches `p.uri` again; the AttachSheet cancel path (`:382`) and the oversize path (`:228`)
  also leave it. `deleteTemp` exists (`files.ts:88`) but is only used for the viewer's own files.
- Failure scenario: the sender picks a document from Files/iCloud Drive or a photo, sends it as a
  view-once Secret attachment. The encrypted copy expires server-side and the recipient's copy is
  gone, but a plaintext copy stays in the sender's app cache for as long as the OS leaves it (cache
  is not backed up and is cleared under storage pressure, i.e. effectively indefinitely on a phone
  with space). `resetThisPhone()` wipes the keystore, the auth store and the lock flag, not the cache
  (`lib/chat.ts:321-340`), so the Settings copy "Forgets every chat and key stored here" and the
  attach-sheet promise around view-once ("then it's gone for everyone") are not true for the
  sender's phone. Panic Exit does not touch it either. On Android the file sits in a directory any
  file-manager with the app's cache access (adb backup is off, but `run-as` on debuggable builds and
  rooted devices) can read; on iOS it is in the sandbox but it is plaintext.
- Fix (owner: mobile-ui, `lib/files.ts` + `[id].tsx`): after `sendFile` settles (success or error)
  and on AttachSheet cancel/oversize, delete `p.uri` when it lies under `Paths.cache` (both pickers
  put it there; a `DocumentPicker` with `copyToCacheDirectory: false` would return a content URI
  that must not be deleted); add `clearPickerCaches()` (ImagePicker and DocumentPicker directories
  plus `onepeek-view`, W2-3) called from `resetThisPhone()` and on app start. Document the residual
  (the OS photo library still holds the original) in known-limitations. Tests: a `files.test.ts`
  with a mocked `expo-file-system` asserting the picked URI is deleted after a successful and a
  failed send and after cancel; `chat.test.ts` reset calls the sweep.

### W2-3 (low) — Decrypted viewer temp files survive a kill while the viewer is open; no sweep on launch

- `apps/mobile/lib/files.ts:81-86` `writeTemp` → `cache/onepeek-view/<random>.<ext>` for images over
  3 MB and for every "Share or save…"; `FileViewer.tsx:72-76, 79-83` delete on unmount/close;
  `shareBytes` deletes in `finally`. Nothing deletes leftovers from a process that died with the
  viewer open (force-quit, OOM, crash), and `resetThisPhone()` does not know the directory.
- Failure scenario: a view-once 5 MB photo is opened, the app is killed by the OS while it is on
  screen; the plaintext stays in `onepeek-view/` under a random name. Random names stop guessing but
  not a directory listing on a rooted/debuggable device, and view-once semantics on the recipient
  side are broken.
- Fix (owner: mobile-ui): on `SecurityProvider` mount (or `files.ts` module init) and in
  `resetThisPhone()`, delete `new Directory(Paths.cache, 'onepeek-view')` with `idempotent`;
  write temp files only after the directory sweep has run once. Test: a leftover file in the mocked
  directory is gone after the sweep; the viewer path still works.

### W2-4 (low) — Photos are sent with their EXIF (including GPS) and nothing says so

- `files.ts:35` `exif: false` only omits the metadata object from the picker *result*; the bytes
  returned by `a.uri` keep whatever the re-encode preserves (on iOS a `quality < 1` JPEG re-encode
  keeps most EXIF including GPS when the library asset has it; on Android the original is copied).
  `AttachSheet.tsx:62` says "OnePeek never sees the file, its name or its key" (true) but the
  recipient of a "Secret" photo receives the sender's location and device model, and the web does
  not strip either. Not documented in `security/README.md`, `PROTECTION_COPY` or the test plan.
- Fix (owner: mobile-ui + lead decision): either strip by re-encoding through `expo-image-manipulator`
  (`manipulateAsync(uri, [], { compress: 0.9, format: JPEG })` drops EXIF) before `fileSource`, or
  add one honest sentence to the attach sheet / known-limitations ("Photos keep their embedded
  location and camera data"). Test: a fixture JPEG with a GPS IFD loses it after the pipeline.

### W2-5 (low) — 008 grants `insert, update` on `push_devices` to `authenticated`, so the 10-row cap and the owner-takeover rule can be sidestepped at the table

- `008:38` `grant select, insert, update, delete on public.push_devices to authenticated` with the
  owner RLS policy (`:41-42`). Both RPCs are `security definer`, so they need no table grant. A
  signed-in user can `POST /rest/v1/push_devices` (owner = own uid) any number of rows that pass the
  shape check, or `PATCH` a row's `last_seen`/`platform`.
- Failure scenario: an account inserts 100 000 valid-looking rows directly; the fan-out stays at 10
  (`pushToNative` reads `limit 10`), so the W1-3 amplification is still closed, but the table and the
  owner index grow without bound and `register_push_device`'s `not in (… limit 10)` delete runs over
  all of them at every registration (one slow statement per register). No cross-owner effect: the
  policy's `with check (owner = auth.uid())` and the unique token stop takeover by insert (tested).
- Fix (owner: backend, 008 is still unapplied): `grant select, delete` only (the app reads nothing
  from the table today; keep `select` for debugging or drop it too). Test: `as(ALICE, insert …)`
  and `update … set last_seen` are refused with `permission denied`.

### W2-6 (low) — `EXPO_PUBLIC_E2E=1` has no profile guard, and nothing in the repo sets it

- `InviteSheet.tsx:19` reads `process.env.EXPO_PUBLIC_E2E` at bundle time. `eas.json` sets only
  `environment`; `app.config.ts` does not look at the flag; `e2e/scripts/*` never export it. A
  developer with `EXPO_PUBLIC_E2E=1` in their shell (or a stray EAS environment variable) building
  the `production` profile ships the owner's bearer token on screen, which is exactly W1-9. On the qa
  side, flow 03 (`copyTextFrom invite.link`) reads `#••••••` in every build made today.
- Fix (owner: lead, `app.config.ts`): fail the config when `process.env.EXPO_PUBLIC_E2E === '1'`
  and `process.env.EAS_BUILD_PROFILE` is `preview` or `production` (or expose it as `extra.e2e`
  and set it only in a dedicated `e2e` profile). qa: set it in the two-device script's build step.
  Test: a config test with the two env combinations; `new.test` keeps the mask assertion and gains
  one with the flag set rendering the full link.

### W2-7 (low) — Secret-room drafts are offered to the keyboard's personal dictionary

- `components/room/Composer.tsx:56-57` `autoCorrect` on, `autoComplete="off"` (autofill only). On
  iOS QuickType and on Android Gboard/Samsung keyboards, typed words in a non-secure field are
  learned and, on Android, may sync with the keyboard account; third-party keyboards see everything.
  The web cannot influence this; the app can. No copy claims otherwise, so it is hardening, not
  honesty.
- Fix (owner: mobile-ui): in Secret rooms `autoCorrect={false}`, `spellCheck={false}`,
  `autoCapitalize="none"`; on Android also `importantForAutofill="no"`. Note in known-limitations
  that third-party keyboards are outside the app's control. Test: props asserted in `room.test`.

### W2-8 (low) — A taken-over or rotated push token is never re-registered, so a victim's notifications stop silently

- `settings.tsx:66-83` registers only when the switch is toggled; `push.current()` (`lib/chat.ts:307`)
  reports the sealed *local* token, not the server row. No `Notifications.addPushTokenListener`,
  no re-register on launch.
- Failure scenario: (a) 008's owner takeover is one-directional: once another account registers the
  same token (shared phone that was not signed out, or anyone who learned the token), the row is
  theirs, the Settings switch still shows "on" and every message to this account's rooms is
  silently not pushed; (b) APNs/FCM rotate the token (restore, reinstall, FCM refresh) and the old
  row dies with `BadDeviceToken` → deleted by `alerts.ts`, same visible state.
- Fix (owner: mobile-ui + core-crypto): on app start and on `Notifications.addPushTokenListener`,
  when `push.current()` is true call `push.register(platform, freshToken)` (the upsert refreshes
  owner and `last_seen`; `register` already unregisters a rotated previous token). Test: launch with
  a sealed token calls `register_push_device` once; a listener event with a new token unregisters
  the old one.

### W2-9 (low) — The W1-1 mismatch window relies on routing, not on an invariant

- `lib/chat.ts:227-235`: `verifyOtp` installs the foreign session (sealed to disk, `SIGNED_IN`
  emitted) before the email comparison; `signOut` is a network round trip later. `_layout.tsx:54-57`
  happens not to navigate from the `auth` route on a session change and `auth.tsx` navigates only
  on `ok`. A future "signed-in → go home" effect, or any screen that syncs on `SIGNED_IN`, would
  reopen the wave-1 consequence (sync → `not_a_member` → `forgetRoom`, `client.ts:545-547`) for the
  duration of that round trip.
- Fix (owner: core-crypto + lead): write the invariant down in `_layout.tsx` (`AuthGate` must not
  leave `auth` on a session change; `completeFromUrl` is the only exit) and add a test in
  `chat.test.ts` that during the mismatch no `rpc` is recorded between `verifyOtp` and `signOut`,
  plus a `_layout` test that a SIGNED_IN while `segments[0] === 'auth'` does not `router.replace`.
  Alternatively let `completeFromUrl` pause the app-level `onChange` while it runs.

### W2-10 (low, copy) — The failed-link screen blames "another phone" when the app was simply closed

- `app/auth.tsx:35`: "…or been requested from another phone. Links only work on the phone that asked
  for them." The pending address lives in module memory (accepted trade-off), so the most common
  failure for an honest user, tapping the link after the app was killed, shows a sentence that is
  not true for them. Honest-copy rule.
- Fix (owner: mobile-ui): "…expired, already been used, been requested from another phone, or
  OnePeek was closed in between. Ask for a new link on this phone." Test: `auth.test` string update.

## Checked and found correct (one line each)

- Hold-to-read: `MessageBubble.tsx:52-53, 69-73, 91` — someone else's Secret text is not in the tree
  while `!held` (the hidden branch renders "Hold to read"), `accessibilityLabel`/`Hint` carry no
  content, `selectable={!secret}`, the reply quote renders only `!hidden`, the bubble id is the only
  thing in `testID`; `[id].tsx:160-161` releases on the screenshot event and treats `inactive` as
  not held; unmount drops state. Test `room.test` first case proves tree absence and release.
- `markOpened` once: `open()` guards `m.mine || m.expiresAt !== null || inactive`, the core
  (`client.ts:620-621`) returns early on `m.expiresAt`, and `chat_mark_opened` is idempotent
  server-side; two overlapping holds before the RPC returns could call it twice, harmlessly.
- Quick/Business rooms mark on screen only while `!inactive`; Secret rooms only on hold.
- File viewer: images via `data:` URI up to 3 MB else a random-named file under `Paths.cache`
  (never Documents), `expo-image` `cachePolicy="none"`, text under 200 kB only, generic view for the
  rest, deletion on close/unmount/file change, `expo-sharing` only from the "Share or save…" tap and
  never for view-once previews, held-to-view in Secret rooms with the watermark; `accessibilityViewIsModal`.
- View-once ordering: the core stores `viewed` before the download (`client.ts:470`), the screen
  marks again after success and on `gone`; the sender cannot open (`view_once_sent`, row disabled);
  second open goes to `viewer.gone` without a network call (tests).
- Attach: the picked file's name reaches only the MLS-encrypted payload (`client.ts:437-440`), the
  storage object is `application/octet-stream` under a server-issued path, metadata never in an RPC
  argument; size and name shown only to the sender; `fileSource` reads lazily (`platform.test`).
- Owner auto-admit: `[id].tsx:116-121` is the web's condition verbatim (`kind !== 'business'` →
  `admitPending(roomId)`, then `commitRemovals`). In Secret rooms anyone who redeems a valid invite
  with the right access code is admitted the next time the owner's room screen refreshes, without
  the "Let in" row; same as the web, and the Chats home still shows pending rows when the room is
  not open. Accepted by decision; the access code is checked server-side in `redeemInvite`.
- `notifyRoom` after send/sendFile: `client.ts:486-493` sends only the room id and the access token to
  `env.notify` (onepeek.io, S0b M2); `sendFile` already calls it inside the core, so the screen's
  second call is a duplicate request, not a leak (the route is rate-limited).
- Screenshot alert hook: `useScreenshotAlert(joined && !ended ? roomId : null, …)`; one side effect,
  swallowed on failure.
- Watermark: `viewerName` = own nickname or `Device XXXX`, `deviceCode` = 4 hex chars, time; hidden
  from accessibility, `pointerEvents="none"`; drawn only while held or a viewer is open.
- Room menu: remove → `removeMember` (MLS commit + `p_remove`; `chat_send:417-419` lets only the
  owner remove a live device); leave and burn need a second tap (`Confirm`); `chat_burn` is
  `owner = auth.uid()` → `not_owner` server-side; `chat_leave` checks `chat_my_device(p_device)`;
  rename is local only (`setRoomLocal`); Panic Exit calls `panic()` only.
- Safety number: `safetyNumberWith` from signing keys, QR `onepeek-verify:<digits>` as on the web,
  `markVerified` stores the public key locally; nothing secret in the a11y label.
- Settings: `getDevicePushTokenAsync` after `requestPermissionsAsync`; the token goes to
  `push.register` only, never to state, text or an error (test sweeps `toJSON()`); errors are fixed
  strings; `revokeDevice` of this phone wipes the chat keystore in the core (`client.ts:139-144`,
  `chat_revoke_device` is owner-scoped) and the copy says so; devices list shows model+OS labels.
- Locked screen: `SecurityProvider` renders `{locked ? null : children}`, so Stack, AuthGate and every
  screen are unmounted while locked (not covered); `LockedScreen` reads nothing from chat, only
  `getLockStore().get()` synchronously for the "Locked by Panic Exit" line; `locked` starts `true`,
  `deviceInsecure` starts `false` so a cold start always prompts unless enrolment is `NONE`
  (then the warning is shown); brand-only cover while merely inactive/captured.
- `auth.tsx` renders a spinner or a fixed string, never the URL (`auth.test` sweeps for the token);
  `handled` ref prevents a double exchange.
- `test/chat-mock.ts` is imported only from `__tests__` (grep), uses `jest.fn` so it would throw if
  bundled; its `push` stub matches the real surface.
- `_layout.tsx`: `PUBLIC` = `welcome, sign-in, auth, join, chat, reset`; `spike` gone; splash hides
  only when fonts and session are known.
- Copy honesty: room intro per platform (`SHOT_LINE`), Settings "Screen protection" per platform,
  `PROTECTION_COPY` unchanged, Notifications "never content", attach sheet "never sees the file, its
  name or its key" (true for the server), Locked screen "Nothing was deleted", ended state "Its keys
  and messages have been removed from this device" (true: `forgetRoom`). Exceptions are W2-1/W2-2
  (claims stronger than behaviour) and W2-10.
- No `console.` in any wave-2 file; no new network literal; `MineGradient` is pure SVG.
- 008 down script drops only its own objects; `search_path = ''` with qualified names, tested.

## Claims that need a device build

- `preventScreenCaptureAsync(APP_SECURE_KEY)` after a `MissingActivity` failure really sets
  FLAG_SECURE on the attached activity (MANUAL S2, the W1-4 path).
- `expo-document-picker` with `copyToCacheDirectory: true` and `expo-image-picker` cache paths on
  both platforms (W2-2 fix must match them), and whether the iOS re-encode keeps GPS EXIF (W2-4).
- `Sharing.shareAsync` resolution timing on Android: `shareBytes` deletes the temp in `finally`; if
  the promise resolves before the target app reads the content URI the share fails (qa).
- `getDevicePushTokenAsync` on a real device with the `aps-environment` entitlement (carried in
  log.md); token rotation events.
- Hold gesture (`onPressIn`/`onPressOut` with `delayLongPress`) under VoiceOver/TalkBack and inside
  the `FlatList` scroll; whether `inactive` flips fast enough on an incoming call to drop `held`.
- `UIScreen.isCaptured` cover timing while a Secret message is held (frames before detection).

## Verdict line

**No open high; no critical.** W1-1..W1-7 and W1-9 closed with tests, W1-8 closed by decision,
W1-10 open with qa. Wave 2: medium W2-1 (reply preview shows Secret text unheld) and W2-2 (picker
plaintext copies never deleted; reset does not clear them); low W2-3 (viewer temp sweep), W2-4
(EXIF/GPS undocumented), W2-5 (table grants bypass the cap), W2-6 (E2E flag unguarded), W2-7
(keyboard learning), W2-8 (no re-register after takeover/rotation), W2-9 (W1-1 window is positional),
W2-10 (copy). web 108/108, core 162/162, mobile 172/172.
