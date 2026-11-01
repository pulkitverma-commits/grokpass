# Security review: Phase 1 close-out (`mobile/integration` b0a88f9..c85861b)

Reviewer: security-reviewer, task S1, third pass (Gate 1 verification). Date: 2026-11-01. Branch
`mobile/integration` at `c85861b`; range `b0a88f9..c85861b`: the wave-2 fixes from mobile-ui (W2-1,
W2-2, W2-3, W2-4, W2-7, W2-8, W2-9, W2-10), backend (W2-5 and the §1.5 test gaps), the lead (W2-6
guard, `e2e` EAS profile), qa (W1-10, TESTIDS, flows 03–11, test plan v1.2). 51 files, +2123/−225.

Method: full reads of `app/room/[id].tsx`, `components/room/Composer.tsx`, `components/room/MessageBubble.tsx`,
`components/PushRefresher.tsx`, `lib/files.ts`, `app/_layout.tsx`, `app.config.ts`, `eas.json`,
`supabase/migrations/008_*`; diffs of everything else in the range; every new or changed test read
against the claim it is meant to prove. Run: `npm test` from the root (Node from
`~/Sites/newspop/.node/bin`): web **123/123** (9 files), core **194/194** (10 files), mobile jest
**193/193** (24 suites), exit 0. No code edited; the only write is this file.

## Verdict

**No open high. No critical.** Eight of the ten wave-2 findings are closed with a proving test; W2-6
is partial (guard landed, no test, and it does not cover the paths that produce a bundle outside EAS
Build); W2-9 is closed for the AuthGate half and still lacks the core-side test. W1-10 is closed by
qa with the residuals listed under W3-3. The backend test-gap pass is closed. One new medium (W3-1):
the W2-1 fix made the composer preview content-free, but a *sent* reply quotes the hidden parent's
text inside the sender's own bubble, unheld and unwatermarked, for as long as the message lives;
same code path on the web. It is the same class as W2-1 and should land before the first external
tester sees a Secret room, but it does not block Gate 1 under the "no open high or critical" rule.
Four new lows (W3-2..W3-5).

## Part A: wave-2 fixes as landed

| Item | Status | Proof (file:line, test) | Residual |
| --- | --- | --- | --- |
| W2-1 reply preview shows Secret text unheld | **closed** (composer) | `[id].tsx:388-389`: `secret && !replyTo.mine` → `nameOf(sender)` and `replyHidden`; `Composer.tsx:41` renders "Replying to a hidden message from {name}"; `[id].tsx:166` `onScreenshot` → `setReplyTo(null)` in Secret rooms; `:167-168` render-phase sync drops the reply on `inactive`. `room.test.tsx` "W2-1: replying to a hidden Secret message…": hold → Reply → release → `room.replyPreview` is the sender line, `queryByText(/locker/)` null, `treeText()` free of the body; the captured `onScreenshot` callback removes the preview; `inactive` removes it again. Second test: Quick rooms and own messages keep the 40-char quote and `send()` still carries the reply id. | The quote inside the **sent** bubble is not covered: W3-1. `treeText()` is an allow-list of props (see W3-4). |
| W2-2 picker plaintext never deleted | **closed** | `files.ts:62-78` `deletePicked` deletes only a URI under `Paths.cache` (`inCache` prefix with a trailing `/`, so `cache-not/` is excluded); `[id].tsx:236` oversize, `:237` replace, `:251` `finally` after `sendFile` (success and failure), `:255-258` cancel (`AttachSheet onClose`), `:381` on re-open. `files.ts:90-101` `clearPickerCaches` removes `ImagePicker`, `DocumentPicker`, `onepeek-view`; called from `_layout.tsx:81` on every launch and `chat.ts:344` in `resetThisPhone()` (Settings → `/reset` → `resetThisPhone`, `reset.tsx:24`). Tests: `files.test.ts` 6 cases (delete under cache, leave `content://` and `/files/` alone, sibling-dir trap, sweep of the three dirs leaving `other-cache`, no-op, writeTemp after sweep); `room.test.tsx` "W2-2" success/failure/cancel/oversize all call `deletePicked` with the picked object; `chat.test.ts` reset calls the sweep once; `layout.test.tsx` sweep once on launch. `known-limitations.md` 12 documents the photo-library original. | Device check: on iOS the picker may return `file:///private/var/…` while `Paths.cache.uri` is `file:///var/…`; then `deletePicked` skips (silently) and the copy lives until the next launch sweep (same base path, so the sweep still catches it). Add to qa §4.1. Panic Exit does not sweep (its copy says "Nothing was deleted", honest). |
| W2-3 viewer temps survive a kill | **closed** | `clearPickerCaches` includes `onepeek-view`; `files.ts:83, 99, 133` `writeTemp` awaits the in-flight sweep so a temp is never written under a directory being removed. Test "the viewer still writes temp files after the sweep". | A process kill is a cold start, so "until the next launch" is exactly the kill case. None. |
| W2-4 EXIF/GPS undocumented | **closed by decision** (honest sentence) | `AttachSheet.tsx:63` "Photos keep their embedded details, such as location, unless your phone removes them." (`attach.exif`); `known-limitations.md` 10. Test `room.test` "W2-4". Strip via `expo-image-manipulator` deferred to Phase 3 (log.md). | Open low until the strip lands (owner mobile-ui, Phase 3). |
| W2-5 table grants bypass the cap | **closed** | `008:39-42` `revoke all … from anon, authenticated; grant select, delete … to authenticated`; both RPCs are `security definer`, policy unchanged. `push-devices.test.ts` "authenticated can only select and delete directly": insert (own uid, valid shape) and two updates → `permission denied`; own delete works; three older tests re-pointed from RLS/unique/check errors to `permission denied`. `deployment.md` updated. | None. `select` stays granted (an owner can read their own token rows; harmless). |
| W2-6 `EXPO_PUBLIC_E2E` unguarded | **partial** | `app.config.ts:10-14` throws when `EXPO_PUBLIC_E2E === '1'` and `EAS_BUILD_PROFILE ∈ {preview, production}`; `eas.json:43-52` `e2e` profile (extends `development`, sets the flag, iOS simulator, internal). flow 03 asserts the copied link has a `#` and no `•` so a masked build fails on purpose. | No test (the W2 fix asked for one with both env combinations). `EAS_BUILD_PROFILE` is set by EAS Build (cloud and `--local`) only; `expo export` for `eas update`, `expo run:ios --configuration Release`, an Xcode/Gradle release from the prebuilt project all evaluate the config with `PROFILE === ''` and pass: W3-2. |
| W2-7 keyboard learning | **closed** | `Composer.tsx:32, 69` `SECRET_INPUT` = `autoCorrect:false, spellCheck:false, autoCapitalize:'none', importantForAutofill:'no', textContentType:'none'`, spread only when `secret`; `autoComplete="off"` everywhere. Test `room.test` "W2-7" asserts all five on a Secret composer and their absence on a Quick one. `known-limitations.md` 11 (third-party keyboards). | None. |
| W2-8 no re-register after takeover/rotation | **closed** | `PushRefresher.tsx` mounted at `_layout.tsx:87` (inside `ChatProvider`, so after the session is known; outside `SecurityProvider`, so it also runs while locked). Start: `push.current()` → `getPermissionsAsync` (never `request`) → `getDevicePushTokenAsync` → `push.register`; `addPushTokenListener` → `register`; `last` ref dedupes the start-up fetch's own listener event; every failure swallowed. No `auth.onChange` subscription, so it cannot act inside the W1-1 window. Token reaches `push.register` and a ref only; test asserts `toJSON()` is null. `push-refresher.test.tsx` 6 cases: start re-register once, no registration → nothing (no permission check, no token), permission revoked → no token fetched, rotation registers the new token and unmount removes the listener, rotation without a registration does nothing, failing register swallowed. | Re-register after sign-in deferred to Phase 2 (decision). A takeover during a long warm session is reclaimed only at the next launch. If the start-up register fails (offline) `last` is already set, so a later listener event with the same token is ignored until the next launch (liveness only). |
| W2-9 W1-1 window positional | **closed** (gate) / **open** (core test) | `_layout.tsx:51-60` invariant written down; `AuthGate` unchanged (`welcome`/`sign-in` → `/` only). `layout.test.tsx` "invariant (W2-9)": on `auth`, SIGNED_IN as the owner, as an attacker, then signed out → no `replace`/`push`; plus the two positive gate cases. `expo-router-mock` gained `setSegments`. | The `chat.test.ts` assertion "no `rpc` between `verifyOtp` and `signOut` during a mismatch" was not added (owner core-crypto, low). |
| W2-10 copy | **closed** | `auth.tsx:35` "…been requested from another phone, or OnePeek was closed in between. Ask for a new link on this phone."; `auth.test.tsx:30` asserts it, URL still absent from the tree. | None. |
| W1-10 leak-guard blind spots (qa) | **closed** | Both eslint configs: `expo-insights`, `expo-updates` added to `TELEMETRY_IMPORT`; new `OFF_DEVICE` selector (Clipboard.set*, Share.share/open, Linking.openURL/sendIntent/openSettings, WebBrowser.open*Async, Alert.alert/prompt, `new WebSocket|XMLHttpRequest`) × six argument shapes (identifier, member, template identifier/member, object-property identifier/member) with the existing `SENSITIVE` list. `leak-guard.test.ts` 16 new probes (3 imports, 13 sink shapes) and a negative case (`href`, `roomId`, a fixed `Alert`); the clean fragment gained the InviteSheet/Welcome/sign-in call shapes. `log.ts:43` every string inside an array is redacted whole; `log.test.ts` proves nested arrays and mixed arrays. test-plan §1.6 lists the rules. | Name-based; what still passes is listed under W3-3. |
| Backend test-gap pass (§1.5 d, f, 1+2, 8) | **closed** | `push-devices.test.ts`: same `(platform, token)` three times → one row, same id/created_at, `last_seen` monotonic (d); column set is exactly the six columns and the raw row text carries no UA/email/room/name even when the JWT has `email`, `user_agent`, `user_metadata` (f). `alerts.native.test.ts`: fixture sweep (`packages/core/test/fixtures` + decoys + ids + credentials, as text/hex/base64/base64url) over every captured APNs http2 request and every FCM fetch (token exchange and sends), with the JWT-bearing header/assertion swept for key material only (1+2); a canary proves the sweep fires. Credentials never in errors (8): APNs 500 with an echoing body, transport throwing an error full of secrets, FCM 500 on send and on exchange, fetch rejecting with secrets, both transports failing in `pushToNative` → `{sent:0, dead:[]}`/`0`, nothing thrown, nothing logged; `nodeHttp2Request` rejections are the fixed strings `http2_deadline|session_closed|session_timeout|stream_closed|stream_timeout` (`alerts.ts:225-249`); malformed key → inert; `bad_room` never echoes input (`alerts.ts:143`). | None. |

## Part B: new findings (W3)

### W3-1 (medium) — A sent reply to a hidden Secret message quotes its text in the sender's own bubble, unheld

- `components/room/MessageBubble.tsx:52-53` `guarded = secret && !m.mine && !m.file`, `hidden = guarded && !held`;
  `:97-101` renders the quote when `parent && !hidden`, and `:45-48` `replyPreview(parent, secret)`
  returns `p.body` for a text parent. `hidden` describes the *child* bubble; for the sender's own
  message it is always `false`, so the quote shows the parent's body (two lines, `numberOfLines={2}`)
  whatever the parent's hold state. `[id].tsx:360` passes `parent = byId.get(m.replyTo)` for every
  bubble. The watermark is drawn only while `holding` (`[id].tsx:293, 373`), so it is absent.
- Failure scenario: Bea sends "The locker code is 4471." in a Secret room. I hold it, tap Reply
  (preview now reads "Replying to a hidden message from Bea": W2-1 fixed), type "On my way", send.
  My bubble carries "The locker code is 4471." on top of "On my way", in the clear, with no hold, no
  watermark, surviving screenshots and `inactive`, for the lifetime of my message (my timer, not
  Bea's; her message may already have expired). An iOS screenshot or a shoulder-surfer gets her text
  from my bubble. On every *other* member's screen my bubble is `!m.mine`, so there it is guarded and
  the quote shows only while held; the exposure is on the sender's own device. The gap is against the
  room's promise ("Press and hold a message to read it", `INTRO_SECRET`) and the header comment the
  fix just added (`[id].tsx:8-10`, "no Secret text is ever on screen while nothing is held"), not a
  disclosure to a different person. Parity: the web does the same (`app/chat/r/[id]/page.tsx:341`).
- Not introduced in this range (MessageBubble is untouched), missed in wave 2 where I read `!hidden`
  as the parent's state. Rated medium like W2-1 because it is more persistent than the composer
  preview was.
- Fix (owner: mobile-ui; tell the web owner): `replyPreview(parent, secret, m)` → when
  `secret && !parent.mine` return the sender's name or "Hidden message" (the parent's `sender` is
  on `BubbleMessage`; `senderName` is already passed for the child, a `parentName` prop or a
  `nameOf` callback covers the parent). Keep the quote for own parents and non-Secret rooms. Test
  (`room.test.tsx`): Secret room, hold m1 → Reply → release → type → send → the sent bubble
  (`msg.uuid-1`) is in the tree and `treeText()` does not contain "locker"; a Quick room keeps the
  quote. Add the same line to `known-limitations` if the web fix is not shipped at the same time.

### W3-2 (low) — The W2-6 guard is a deny-list on a variable only EAS Build sets, and it has no test

- `app.config.ts:10-14` throws for `EAS_BUILD_PROFILE ∈ {preview, production}`. EAS Build (cloud and
  `eas build --local`) sets that variable; `expo export` (what `eas update` runs to publish an OTA
  bundle to the `production`/`preview` channel), `expo run:ios|android --configuration Release`, and
  a release archive from the generated `ios/`/`android/` projects do not. In all of those `PROFILE`
  is `''`, the guard is silent, and `InviteSheet.tsx:19` inlines `EXPO_PUBLIC_E2E` from the shell at
  bundle time. `runtimeVersion: { policy: 'appVersion' }` means an OTA bundle built that way is
  accepted by every store build of the same version.
- Failure scenario: a developer who ran the two-device flows (shell has `EXPO_PUBLIC_E2E=1` from the
  README) publishes a hot-fix with `eas update --channel production`; every installed app shows the
  full invite link (the owner's bearer token) in the sheet, which W1-9 masked. Low because the token
  shown is the owner's own and is already one tap away via Copy/Share; the loss is the on-screen
  hygiene (screenshots, shoulder-surfing, FLAG_SECURE covers Android only).
- Fix (owner: lead): fail closed instead of open — `const E2E = process.env.EXPO_PUBLIC_E2E === '1'
  && process.env.EAS_BUILD_PROFILE === 'e2e'`, expose it as `extra.e2e`, and have `InviteSheet` read
  `Constants.expoConfig?.extra?.e2e === true` instead of the raw env (the `e2e` profile is the only
  producer; `run-two-device.sh` documents `EAS_BUILD_PROFILE=e2e` for a local `expo start`). Add
  `apps/mobile/__tests__/app.config.test.ts`: the config evaluates with `{E2E:1, PROFILE:e2e}` and
  sets `extra.e2e`, evaluates with `{E2E:1, PROFILE:''}` and does not, throws for `preview` and
  `production`. Also note that the Android `e2e` build is an installable APK with internal
  distribution; keep it off the distribution page.

### W3-3 (low) — What the W1-10 sink rule does not catch

- The rule fires on the *name* of the argument (`SENSITIVE` list) in six syntactic shapes. It stays
  quiet for: an intermediate with a neutral name (`const text = m.body; Clipboard.setStringAsync(text)`),
  a call result (`Share.share({ message: render() })`), a URL built earlier from a token, a spread or
  computed property, `globalThis.WebSocket`, and for sinks that are not on the list although the
  app uses or could use them: `Sharing.shareAsync` (`expo-sharing`, the sink `files.ts:148` actually
  uses), `Notifications.scheduleNotificationAsync({ content: { title, body } })` (lock-screen text),
  `MediaLibrary.saveToLibraryAsync|createAssetAsync`, `File.write` to `Paths.document` (backed up),
  `Image source={{ uri }}` to a remote host. `redact()` leaves numbers alone (a six-digit access code
  held as a number under a neutral key survives).
- This is the nature of a lint tripwire; the real proof stays the tests that sweep the rendered tree
  and the captured requests. Owner: qa. Fix: add `Sharing`, `Notifications.scheduleNotificationAsync`,
  `MediaLibrary` to `OFF_DEVICE` with the object-property shapes (content.body is a nested property:
  add a `Property > ObjectExpression > Property` shape), and write the "name-based, not taint"
  sentence into test-plan §1.6 so the next reviewer does not read the rule as a guarantee.

### W3-4 (low) — `treeText()` is an allow-list; a new content-bearing prop would not be seen

- `room.test.tsx` `treeText()` collects string children and `accessibilityLabel|Hint|Value`,
  `placeholder`, `value`, `text`. It omits `testID` (fine today, ids only), `title`, `defaultValue`,
  `accessibilityActions`, `aria-*`, `source`, `alt`, `nativeID`, `selection`. The reason for not
  stringifying the whole tree (FlatList's `data` prop reaches the host ScrollView's JS props with
  every message body, and host props can hold fiber internals) is sound: `data` never reaches native.
- Fix (owner: mobile-ui/qa): invert it — walk every prop except `data`, `style`, functions and
  `children`, stringify the rest — so a future `accessibilityActions` or `title` carrying a body
  fails the test instead of passing silently. Reuse the helper in `new.test`/`settings` sweeps.

### W3-5 (low) — W2-9's core-side half is still untested

- The AuthGate invariant has its test; the complementary `chat.test.ts` assertion that during a
  mismatch no `rpc` is recorded between `verifyOtp` and `signOut` (so no screen or helper can act on
  the foreign session) was not written. `PushRefresher` was checked by reading: it does not subscribe
  to `auth.onChange`, so it cannot register this phone's token under the attacker's account in that
  window. The test would pin that for the next component that mounts at the root. Owner: core-crypto.

## Checked and found correct (one line each)

- `clearPickerCaches` runs synchronously inside its async IIFE (no await before the loop), each
  directory in its own try, nothing thrown, nothing logged; `_layout.tsx:81` calls it before `ready`
  so it precedes any picker or viewer; `writeTemp` awaits the last sweep.
- `sendPicked` deletes in `finally` after `sendFile` has read the bytes lazily through `fileSource(p)`;
  a failed send cannot be retried with the same copy (the user re-picks), which is the right side.
- `Composer` reply row keeps `accessibilityLiveRegion="polite"`; the announced string is content-free
  in the hidden case; `onCancelReply` unchanged.
- `PushRefresher` never calls `requestPermissionsAsync`; the Settings switch remains the only prompt.
  Token string never reaches state, text, an error or a log; `String(t.data)` goes to `push.register`
  only (which seals it in the auth store and calls the RPC).
- 008 RPCs still `security definer`, `search_path = ''`, grants unchanged; down script untouched.
- `e2e` flows: the invite link travels Maestro → local relay (`relay/server.mjs` binds `127.0.0.1`,
  memory only, prints nothing) → device B; flow 11 publishes the safety number (not a secret); no
  screenshot or recording in any flow (`check-flows.mjs`); `run-two-device.sh` never echoes a
  variable. `relay-value.js` names the key only on failure.
- `redact()` change is strictly tighter (strings in arrays were partially shown before).
- No `console.` in any file of the range outside tests; no new network literal; eslint configs in
  core and mobile stay identical in the leak-guard section and `leak-guard.test.ts` probes both.
- `known-limitations.md` 10–12 and `deployment.md` match the code; the Settings copy "Forgets every
  chat and key stored here" is now true for the sender's cache as well.
- Web: unchanged in the range except `lib/alerts.native.test.ts`; the parity gaps are the reply
  preview (`page.tsx:371`, W2-1) and the parent quote (`page.tsx:341`, W3-1).

## Claims that need a device build (carry-over plus new)

- iOS picker URI prefix (`/private/var` vs `/var`) against `Paths.cache.uri` (`deletePicked`, W2-2).
- `expo-image-picker` / `expo-document-picker` cache directory names on both platforms match
  `PLAINTEXT_DIRS`.
- `getDevicePushTokenAsync` and `addPushTokenListener` on a real device after a restore/reinstall
  (`PushRefresher` rotation path); `register_push_device` upsert reclaiming a taken-over token.
- The earlier list in `phase-1-wave-2.md` (FLAG_SECURE after `MissingActivity`, share-sheet timing,
  hold gesture under VoiceOver/TalkBack, `isCaptured` timing) is unchanged.

## Gate 1 verdict line

**No open high or critical.** Closed with tests: W2-1 (composer), W2-2, W2-3, W2-5, W2-7, W2-8,
W2-9 (gate half), W2-10, W1-10, backend §1.5 d/f/1+2/8. Closed by decision: W2-4 (honest sentence;
strip in Phase 3). Partial: W2-6 (guard without test, EAS-only variable: W3-2). New: **W3-1
(medium)** sent-reply quote shows hidden Secret text in the sender's bubble (also on the web);
lows W3-2..W3-5. web 123/123, core 194/194, mobile 193/193.

## Open lows across the three reports (owner)

| Id | One line | Owner |
| --- | --- | --- |
| W1-8 residual | `onepeek://spike` still opens in a release build (own SecureStore entry, clipboard of benchmark lines); file to be deleted after the spike | lead |
| W2-2 residual | iOS `/private` path prefix may make `deletePicked` a no-op until the launch sweep; needs a device check (qa §4.1) | qa |
| W2-4 | EXIF/GPS not stripped; honest sentence shipped, `expo-image-manipulator` re-encode in Phase 3 | mobile-ui |
| W2-6 / W3-2 | E2E flag guard is deny-list on `EAS_BUILD_PROFILE`, untested, blind to `expo export`/`eas update`/local release builds | lead |
| W2-8 residual | no re-register after sign-in (Phase 2); takeover during a warm session reclaimed at next launch only | mobile-ui |
| W2-9 / W3-5 | `chat.test.ts` "no rpc between verifyOtp and signOut" not written | core-crypto |
| W3-3 | sink lint is name-based; `Sharing`, `Notifications.scheduleNotificationAsync`, `MediaLibrary` not listed; numbers pass `redact()` | qa |
| W3-4 | `treeText()` allow-list of props; invert to a deny-list walk | mobile-ui / qa |
| Web parity | `page.tsx:371` reply preview and `:341` parent quote show Secret text (W2-1, W3-1) | web owner |
