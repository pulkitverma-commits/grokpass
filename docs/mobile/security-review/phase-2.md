# Security review: Phase 2 (secrets inside chat and sharing)

Branch `mobile/integration`, range `d441f9b..ae9f638` (everything after the Gate 1 approval: C4 core
secrets, U8 screens, N6 share/link plumbing, B5 report endpoint, Q5 interop test and sink lint, the
`expo-share-intent@9.0.0` install). 89 files, +8216/−143. Read-only review against the web secret code
as the parity baseline (`app/page.tsx`, `app/s/[id]/page.tsx`, `app/api/open/route.ts`,
`app/api/unlock/*`, migrations 002–005) and the Phase 1 close-out. Tests were not re-run here (disk at
~1 GB); the recorded counts are web 142, core 322, mobile 376.

## Verdict

**No critical. No high. Four medium (P2-1..P2-4), six low (P2-5..P2-10).** Under the gate rule ("no
open high or critical") Phase 2 can pass, but two of the mediums are claims the gate document makes
that the code does not keep (`forgetLinkingURL()` and `consumeShare()` have no caller), and one
re-opens the W1-1 invariant the Phase 1 reports built the AuthGate around. All four have small fixes
and should land before the close-out. The core secrets module is a faithful copy of the web path:
nothing the app sends differs from the website in name, shape or order, the key never leaves the
fragment except into WebCrypto, and no new plaintext reaches a server, a log or an error.

## Findings

### P2-1 (medium) — `PushRefresher` now subscribes to `auth.onChange`, inside the W1-1 window

- `apps/mobile/components/PushRefresher.tsx:44` `auth.onChange((s) => { if (s) { last.current = null;
  void refresh(); } })` → `refresh()` (`:31-39`) → `push.current()` → permissions → device token →
  `push.register()` → `lib/chat.ts:306-308` `getChat().registerPushDevice(platform, t)` (RPC under the
  client's current session). `lib/chat.ts:237-245`: `verifyOtp` installs the session the email link
  carries (supabase-js fires `SIGNED_IN` here, `:195`), *then* the address is compared, *then*
  `signOut({ scope: 'local' })`, which is a network round-trip before the local session is removed.
- Failure scenario (W1-1 as the close-out describes it): the victim asked for a sign-in link; the
  attacker sends their own link to the victim's phone; `completeFromUrl` verifies it, the attacker's
  session exists for the compare + sign-out round-trip, `onChange` fires, `refresh()` runs (sealed
  read, cached permission, cached token) and `register_push_device` leaves with the attacker's JWT. A
  JWT already on the wire stays valid after the local sign-out. Result: this phone's push token row
  is re-owned by the attacker (008 takeover semantics): the victim stops getting pushes, and the
  attacker's rooms wake the victim's phone. The payload is content-free, so no text is disclosed;
  this is why it is medium and not high. The Phase 1 close-out (W2-8, W3-5) recorded "no
  `auth.onChange` subscription, so it cannot act inside the W1-1 window" as the reason the component
  was safe, and `push-refresher.test.tsx:98` now asserts the opposite behaviour.
- Fix (owner: mobile-ui + core-crypto): do not act on `onChange`. Have `lib/chat.ts` expose a
  `auth.onSignedIn(cb)` that fires only after `completeFromUrl` returned `true` (and after
  Apple/Google/guest sign-in resolve), or have `completeFromUrl`'s `ok` path call `push.refresh()`
  itself. Test: in `push-refresher.test.tsx`, an `onChange(session)` with no preceding verified
  sign-in registers nothing; in `chat.test.ts`, the W3-5 assertion "no `rpc` other than
  `verifyOtp`/`signOut` between the two during a mismatch" (still unwritten) now has a concrete
  consumer to catch.

### P2-2 (medium) — `forgetLinkingURL()` is never called; the gate document says it is

- `apps/mobile/security/links.ts:130-133` exists and is tested (`links.test.ts:106`), but `grep
  forgetLinkingURL apps/mobile/app apps/mobile/components apps/mobile/lib` is empty. `app/s/[id].tsx`
  reads the key from `useLinkingURL()` (`:82, :87-93`) and never forgets it; `app/chat/join.tsx`
  likewise. `docs/mobile/gates/phase-2.md:15, :42` and `log.md:29` state the key "leaves the native
  initial-URL cache after the key is imported"; `security/README.md:229` says "the viewer should call
  it" (it was handed to mobile-ui and dropped).
- Failure scenario: a cold start from `https://onepeek.io/s/<id>#<key>` leaves the full URL in
  `ExpoLinkingRegistry.initialURL` / `ExpoLinkingModule.initialURL` for the process lifetime and, on
  Android, in `activity.intent` (what `Linking.getInitialURL()` returns, and part of the Recents task
  record). Anything in the process that reads the initial URL later (the next screen, a library hook
  such as `expo-share-intent`'s `useLinkingURL()` consumer, a future debug surface) sees the AES key
  of a secret that may already have burned, or not yet. Low exploitability on its own; medium because
  the gate relies on the claim and the fix is two lines.
- Fix (owner: mobile-ui): in `app/s/[id].tsx`, call `forgetLinkingURL()` right after the peek
  succeeds (`:125`, the key has been imported by then), and in `app/chat/join.tsx` once `initialToken`
  is captured. Test: `secret-viewer.test.tsx` "Universal Link" case asserts the mock
  `Linking.clearInitialURL` and `clearIntentData` were called once after `peekSecretLink` resolved
  and not before. Correct the gate line until then.

### P2-3 (medium) — `consumeShare()` is never called: shared plaintext stays on disk until the next launch

- `apps/mobile/security/shareIntent.ts:53-56` `consumeShare()` and the README (`:40, :56, :156,
  :199`) say the share screen calls it when the share is sent or cancelled. `app/share.tsx` does not
  import it; `send()` (`:84-97`) and `cancel` (`:82`) leave the copy in `<cache>/share-intent/`.
  `SecretComposer.tsx:88, :93, :113` deliberately never deletes `initialFile`, so the link path leaves
  it too. Only `sweepShareCache()` on the next launch (`shareIntent.ts:101-103`) removes it.
- Failure scenario: a photo shared from Photos into a view-once chat message is a plaintext file in
  the app cache for as long as the app stays warm (hours or days on a phone that is never killed),
  outliving the view-once message it became; same for a PDF shared into a one-time link. W2-2 closed
  exactly this class for the pickers. FLAG_SECURE and the backup exclusion do not cover a file.
- Fix (owner: mobile-ui): `app/share.tsx` calls `consumeShare()` in `send()`'s success and error paths
  and in `cancel`, and `SecretComposer` calls `onDone` → the share screen's `cancel` after the link
  is made (already the case through `onDone={cancel}`: add `consumeShare()` there). Test:
  `share.test.tsx` asserts the mock `consumeShare` is called once after a successful send, after a
  failed send, after cancel, and after "Make a one-time link" completes.

### P2-4 (medium) — Android share receiver copies `file://` URIs with the app's own permissions and has no caps

- `apps/mobile/modules/share-intent/android/.../ShareIntentModule.kt:150-151` accepts `scheme ==
  "content" || scheme == "file"`; `:158` opens it through `ContentResolver.openInputStream`, which for
  a `file://` URI is a plain `FileInputStream` in *our* process. `:60-76` copies every URI of an
  `ACTION_SEND_MULTIPLE` with no count or byte limit. `app/share.tsx:50` names the result by the
  random cache name, so the user sees `<24 hex>.db, 1.8 MB`.
- Failure scenario (share-intent injection): a malicious app fires `ACTION_SEND` with
  `EXTRA_STREAM = file:///data/data/io.onepeek.app/databases/onepeek-chat.db` (or
  `shared_prefs/SecureStore.xml`, or the `files/` tree). Our module copies our own private file into
  the share cache and the share screen offers "Encrypt and send" into a room the attacker may be a
  member of, or "Make a one-time link". The sealed rows are AES-GCM under a Keystore-wrapped key, so
  the content is not plaintext, but private app files leave the sandbox on one user tap with a name
  the user cannot recognise. A second malicious app can also hand 200 large videos and fill the cache
  (the copy runs to completion before the share screen appears). `content://` URIs are safe as written:
  the grant is the sender's, and we export no provider of our own.
- Fix (owner: native-security): accept `content://` only; additionally refuse any URI whose authority
  starts with `appContext.reactContext.packageName`; cap items at 10 and bytes at
  `MAX_ATTACHMENT_BYTES` (stop the copy and delete the partial file when exceeded); surface the
  dropped count to JS so the share screen can say "some items were skipped". Mirror the caps in
  `appGroup.ts` (`MAX_ITEMS` is 50; files have no size check) and in `shareParams`. Test: the Kotlin
  path compiles only on EAS (S22), so add the JS-side guard too: `getPendingShare()` in
  `ShareIntentModule.ts:34` filters `file://` URIs that are not under `<cache>/share-intent/`, with a
  jest case for a `file:///data/data/io.onepeek.app/databases/x.db` entry being dropped.

### P2-5 (low) — Shared text, including a secret link's key, travels as a route param from the bridge to `/share`

- `security/shareIntent.ts:91-94` `router.push({ pathname: '/share', params })` with `params.text`;
  `app/share.tsx:42-47, :60-64` classifies it and only *then* parks it in the hand-off. The comment at
  `shareIntent.ts:12-13` makes this explicit ("passed through as `text` unchanged"). The hand-off was
  introduced because "expo-router would keep [params] in its history and could put in a URL"
  (`lib/links.ts:3-5`); this path does what the hand-off was built to avoid, for both a secret link
  and for arbitrary shared text (a password shared from a password manager).
- Fix (owner: native-security): the bridge already imports `security/links`: run `parseOnePeekLink`
  on `p.text` before routing; for `secret` stash the full link (`lib/links.stashHandoff`) and
  `router.push('/s/<id>')`, for `invite` the same to `/chat/join`; only non-link text goes to
  `/share`. Test: `shareIntent.test.tsx:98` ("a OnePeek link shared as text goes through as text")
  inverts to "routes to `/s/<id>` with the link in the hand-off and never in `params`".

### P2-6 (low) — "Open secret" renders on an unheld Secret-room bubble

- `components/room/MessageBubble.tsx:66-67` computes `link` for every text bubble;
  `:143-148` renders the button in the meta row regardless of `hidden` (the `Reply` button next to it
  is gated by `!hidden`, `:149`). `room.test.tsx:427-437` covers a Quick room only.
- Failure scenario: in a Secret room, before anyone holds, the bubble announces "this message carries
  a one-time secret link" (a shoulder-surfer learns a credential is being passed), and a tap opens the
  viewer, which decrypts the link's content with no hold at all (the room's hold-to-read is bypassed
  for the one thing the sender chose to protect twice). The link's own `guard` option still applies
  if the sender set it.
- Fix (owner: mobile-ui): gate the button on `!hidden`; when the sender set `guard`, the viewer does
  the rest. Test: a Secret room bubble with a link has no `link.<id>` until held.

### P2-7 (low) — The viewer's unlock step destructures a string: the in-app recipient-lock flow cannot succeed

- `app/s/[id].tsx:176` `const { token } = await unlockApi.verifyUnlockCode(url, lockCode)`;
  `lib/secrets.ts:184-187` returns `Promise<string>`. `token` is `undefined`, `setUnlockToken(undefined)`,
  `needsCode` stays true, "Email confirmed" never shows. The test passes because
  `test/secrets-mock.ts:27` returns `{ token }`; the `as unknown as UnlockApi` cast (`:43`) hides it
  from TypeScript. Fails closed (nothing opens), so low; but a recipient-locked secret cannot be
  opened in the app and the "Open in browser" fallback is hidden while `hasUnlockFlow` is true.
- Fix (owner: mobile-ui): drop the optional-API shim now that C4 is merged, import
  `verifyUnlockCode` directly and use its string. Test: make the mock return a string (the contract),
  and add one import-shape test that renders the viewer against the real `lib/secrets` module with a
  faked `fetch`.

### P2-8 (low) — "Open in browser" on Android re-opens OnePeek

- `app/s/[id].tsx:226-229` `Linking.openURL(url)` with `https://onepeek.io/s/<id>#<key>`;
  `app.config.ts:61-72` declares the verified App Link for `/s/`. On Android the view intent resolves
  to the app itself (singleTask → `onNewIntent` → the same viewer). The geofenced and
  feature-unavailable fallbacks therefore have no path on Android; on iOS `openURL` of a universal
  link the calling app owns goes to Safari, with the key in Safari's history until the web viewer's
  `replaceState` (`app/s/[id]/page.tsx:268`) rewrites the entry. Acceptable as a fallback only because
  the user chose it and the web viewer strips the fragment; it should say so.
- Fix (owner: mobile-ui): on Android open through `expo-web-browser` `openBrowserAsync` (a Custom
  Tab does not consult App Links) or, both platforms, build the URL for the web without the fragment
  and let the user paste the key (worse UX, no history exposure). Add a sentence under the button:
  "Opens in your browser; the link will be in its history." Device check S24b.

### P2-9 (low) — The quota client id is a device identifier that survives sign-out, reset and reinstall

- `apps/mobile/lib/secrets.ts:62-83`: `onepeek.client` in SecureStore with
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, created once, "not wiped by reset: quota identity" (log.md, lead
  decision), sent as `p_client_id` on every `create_secret` (`secrets.ts:291`) whether guest, signed in
  or signed out, and `resetThisPhone()` does not touch it. The web equivalent lives in `localStorage`
  and dies with site data; the iOS keychain entry outlives app deletion.
- Failure scenario: the server can correlate every secret created from this phone across accounts and
  across a "Reset chats on this phone", for the life of the device. Not a leak of content; a privacy
  delta against the website that the copy ("OnePeek never sees it or the key") does not mention.
- Fix (owner: core-crypto/lead): accept and document in known-limitations, or wipe it in
  `resetThisPhone()` and on sign-out (the quota then starts over, which the server already tolerates
  for a cleared browser). Test: `chat.test.ts` reset removes `onepeek.client`.

### P2-10 (low) — `expo-share-intent@9.0.0`: what its plugin adds and what to check once wired

Read from `node_modules/expo-share-intent` (not yet in `app.config.ts`):

- **iOS native additions:** a second target `ShareExtension` (bundle `io.onepeek.app.share-extension`,
  `plugin/build/ios/constants.js`), the `com.apple.security.application-groups` entitlement with
  `group.io.onepeek.app` (same id as ours by construction: `group.${bundleIdentifier}`), an
  `AppGroupIdentifier` Info.plist key, activation rules defaulting to web URL + web page only (set
  `iosActivationRules` for text, images, movies, files), a JS preprocessor file for web pages. With
  EAS-managed credentials it needs `extra.eas.build.experimental.ios.appExtensions` (README §231) and
  the App Group capability on both identifiers.
- **Where plaintext lands on iOS:** shared text and URLs are written to
  `UserDefaults(suiteName: group)` (`ShareExtensionViewController.swift:119-121, :142-144`): a
  plist in the App Group container, included in iCloud/Finder backups, kept until the app calls
  `clearShareIntent` (`resetShareIntent()`). Files are copied to the container root under
  `uuid.ext`; a video's thumbnail is named `base64(originalName).jpg` (`:616-620`), so an original
  file name does touch disk. The wake URL is `onepeek://dataUrl=onepeekShareKey?nonce=…#<type>`
  (`:494`): no content, but `ExpoShareIntentModule.swift:60` `NSLog("HandleUrl …")` writes it to the
  unified log. The JS hook only forwards URLs containing `onepeek://dataUrl=` to native
  (`build/useShareIntent.js:38-45`), so a Universal Link with a key does not reach that `NSLog`.
- **Android additions:** its own `ACTION_SEND`/`SEND_MULTIPLE` intent filters (default `text/*`),
  `launchMode=singleTask` on MainActivity, and a native module that also consumes the launching
  intent: it copies into `cacheDir` root as `IMG_<timestamp>.<ext>` (not random) and logs the original
  display name, `Log.i("FileDirectory", "File name: $fileName")` (`ExpoShareIntentModule.kt:303`).
  Two consumers of one intent is a race; the log line breaks the "no file names in logs" rule.
- **Checks once wired (owner: native-security):** `disableAndroid: true` (keep our module);
  `isShareWakeUrl` (`security/links.ts:117-120`) must match the package's `onepeek://dataUrl=` shape,
  and `parseOnePeekLink` must still return null for it (it does: host `dataUrl=…` is neither `auth`
  nor a path); `useShareIntent`'s iOS branch calls `resetShareIntent()` where `consumeShare()` runs
  (P2-3), so the UserDefaults copy goes with the files; exclude the group container from backup is
  not possible per-key, so document the window as the README already does for our own extension;
  `options.debug` must stay off (every `console.debug` of content is behind it; `utils.js:44`
  logs only the parse error); expo-router will try to route the wake URL's path
  (`dataUrl=onepeekShareKey`), so an unmatched-route screen or a redirect is needed, and AuthGate will
  send a signed-out user to `/welcome` from it (harmless). Record S27 against the package instead of
  the hand-written extension.

## Checked and found correct

- **Core parity.** `packages/core/src/secrets.ts` sends exactly the web's `create_secret` arguments,
  in the web's key order, optional ones only when set (`:289-301` vs `app/page.tsx:193-202`),
  including the `invalid time window` → `offsetTz()` retry (`:304-306` vs `:207-208`); header literals
  are the same objects in the same order (`:257-263` vs `:165-172`); `/api/open` body is
  `{ id, precise, unlockToken }` with `unlockToken: undefined` dropped by `JSON.stringify`, as the web
  (`:402` vs `app/s/[id]/page.tsx:239`); the 403 code set equals the route's `LOCK_ERRORS`;
  `peek_secret { p_id }`; file ciphertext removed after the final view only (`:443` vs `:290`) and
  after a refused create (`dropFile`). Nothing the app sends is absent from the web path.
- **Key handling.** The key exists in the link string, `keyB64` and WebCrypto only; `SecretError`
  carries a code and typed numbers, never the input (`secrets.test.ts:600`); `parseSecretLink` is
  hand-written (no `URL`), https-only, host allow-list, no port/userinfo, 43-char key that decodes to
  32 bytes, id `[A-Za-z0-9]{6,32}` matching the route's check. `lib/links.secretLinkFrom` defers to
  it for the final word.
- **Unlock flow.** Server: 5 attempts then `code_hash` nulled, 15-minute token; client clamps to six
  digits and never sends the email with the open (`secrets.test.ts:198`).
- **Viewer lifecycle.** Decrypted content is state only; cleared on `AppState !== 'active'`, on focus
  loss, on timer end and on unmount with the temp image deleted (`s/[id].tsx:131-143`); `expo-image`
  `cachePolicy="none"`; `noCopy` removes the Copy button and `selectable`; `noSave` removes Save;
  `guard` shows content only while held with the watermark; the hand-off is read once and refused
  when the id does not match (`:87-93`). `/s` in `PUBLIC` is the web's behaviour (anyone holding the
  link opens it); `peek_secret` and `/api/open` are anonymous on the web too.
- **Composer.** The full link reaches `Clipboard.setStringAsync`, `Share.share` and the chat `send`
  only; on screen it is masked unless `extra.e2e === true` (W3-2 fixed: `app.config.ts:14-21`,
  `SecretComposer.tsx:253-255`, `InviteSheet.tsx`, `__tests__/app.config.test.ts`); secret inputs
  carry the W2-7 keyboard flags; picker copies are deleted after use (`:87-93, :113`).
- **Report.** Migration 009: RLS on, no grants to anon/authenticated, `security definer`,
  `search_path = ''`, schema-qualified `public.chat_is_member`, reason enum checked twice, upsert per
  (room, reporter), 20/day cap. A non-member gets `not_a_member` whether the room exists or not (the
  predicate is one `exists` query), so no room enumeration through the RPC or the route. Route
  validates the bearer with `getUser`, forwards exactly `{ p_room, p_reason }` under the caller's own
  session, maps errors to fixed strings. Client sends `{ room, reason }` with the bearer and nothing
  else (`report.test.ts`).
- **Block list.** Device ids in the sealed keystore (`blockedKey`), filtered on `m.sender` (a device
  id, `client.ts:22`); nothing leaves the phone; the copy says so.
- **Scanner.** `qr` only, decode in-process, no capture call; dispatch through `classify`, which has
  no `auth` branch, so a QR cannot drive the OAuth callback; a scanned safety number must equal a
  member's computed number before "mark verified" is offered.
- **App Group reader.** Manifest `v: 1`, ≤ 64 KB, ≤ 50 items, file names `^[a-f0-9]{16,64}(\.[a-z0-9]{1,8})?$`
  (no traversal), moved into the cache, group directory wiped on every path including errors.
- **Android module.** Random 24-hex names, cache dir only, never reads `DISPLAY_NAME`, no logging,
  `stripIntent()` replaces the intent with `ACTION_MAIN` so Recents cannot re-deliver.
- **Glue.** `auth.setForeground` only starts/stops supabase-js auto-refresh; `getSupabase()` returns
  the same client; `withShareExtension` with `extension: false` adds the App Group entitlement only
  (inert without a writer that shares the team id).
- **Lint and redaction.** W3-3 sinks added in both configs identically (`Sharing`, `Notifications`
  content literal rule, `MediaLibrary`, `.write`, `Paths.document`, remote `Image` source); `redact()`
  is strictly tighter (bare numbers and array numbers redacted); test-plan §1.6 carries the
  "name-based, not taint" sentence. No `console.` in the range outside tests; the fetch hosts remain
  the two literals.

## Status of the open lows from `phase-1-close-out.md`

| Id | Status now |
| --- | --- |
| W1-8 residual (`onepeek://spike`) | **Still open**: `apps/mobile/app/spike.tsx` is present. |
| W2-2 residual (iOS `/private` prefix) | **Still open**: device check (qa §4.1). |
| W2-4 (EXIF/GPS) | **Still open**: Phase 3 by decision; the share target now adds a second photo path with the same property. |
| W2-6 / W3-2 (E2E flag) | **Closed in passing**: fail-closed `e2eFlag()` in `app.config.ts`, `extra.e2e === true` is the only unmask (InviteSheet, SecretLinkSheet), `app.config.test.ts` present. |
| W2-8 residual (re-register after sign-in) | **Closed, but see P2-1**: the chosen mechanism (`auth.onChange`) is the one the close-out said must not be used. |
| W2-9 / W3-5 (core-side test) | **Still open**, and now load-bearing (P2-1). |
| W3-3 (sink lint) | **Closed in passing**: lint, `redact()`, §1.6. |
| W3-4 (`treeText()` allow-list) | **Closed in passing**: `room.test.tsx:73-85` walks every prop except functions and `_`-prefixed keys. |
| Web parity (reply quotes) | **Still open**: human / web owner. |

## Device-only claims (cannot be settled by reading)

- FLAG_SECURE on the viewer and the share screen (S26); the share screen's first frame after the
  bridge's `secureScreenMount('share')`.
- Whether `Linking.openURL` of an `https://onepeek.io/s/…` link on Android returns to the app (P2-8)
  and what Safari records on iOS.
- Android `file://` share from a hostile app and the `SEND_MULTIPLE` cache growth (P2-4); S22.
- The Kotlin module compiles and `OnNewIntent` fires under expo-modules 58 (S21); the iOS App Group
  container is readable through `Paths.appleSharedContainers` with the entitlement alone (S27).
- `expo-share-intent` behaviour once wired (P2-10): double intent consumption on Android, the
  `NSLog` line, the UserDefaults plist lifetime.
- iOS keychain persistence of `onepeek.client` across app deletion (P2-9).
- The W1-1 race window length on a real device (P2-1): how often `register_push_device` beats the
  `signOut` round-trip.
