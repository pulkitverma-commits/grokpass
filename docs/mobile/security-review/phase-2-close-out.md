# Security review: Phase 2 close-out (`mobile/integration` ae9f638..f082e05)

Reviewer: security-reviewer, task S1, Gate 2 verification. Date: 2026-11-01. Branch `mobile/integration`
at `f082e05`; range `ae9f638..f082e05` (the P2 fix branches from mobile-ui/core-crypto and
native-security, the iOS share via `expo-share-intent`, the lead's `+native-intent.tsx`, autolinking
exclude and the P2-5 bridge fix). 49 files, +2063/−968.

Method: full reads of every file the ten findings name (`lib/chat.ts`, `components/PushRefresher.tsx`,
`app/s/[id].tsx`, `app/chat/join.tsx`, `app/share.tsx`, `components/SecretComposer.tsx`,
`components/room/MessageBubble.tsx`, `lib/secrets.ts`, `lib/links.ts`, `security/{links,shareIntent,
iosShare,constants,index,secureScreen}.ts`, `modules/share-intent/{src/ShareIntentModule.ts,
android/.../ShareIntentModule.kt}`, `plugins/withAppGroup.js`, `app/+native-intent.tsx`, `app/_layout.tsx`,
`app.config.ts`, `package.json`, `app/room/[id].tsx`, `app/scan.tsx`, `components/JoinScreen.tsx`,
`test/secrets-mock.ts`), every test the fixes cite, `security/README.md`, `known-limitations.md`, the gate
document and the log. **Tests were not run** (disk at 0.4 GB; the lead's run after the last merge is the
record: web 142, core 322, mobile jest 394). No code edited; the only write is this file.

## Verdict

**No open high. No critical.** All ten Phase 2 findings are closed in code with a proving test; P2-4,
P2-8 and P2-10 keep their device/EAS checks (S22, S24b, S27). One new medium (P3-1: the share screen
consumes the plaintext copy on its buttons but not on the three other ways it leaves: iOS swipe-to-dismiss,
Android back, and the signed-out redirect), six new lows (P3-2..P3-7). Under the gate rule Phase 2 passes;
P3-1 is a one-line `useEffect` cleanup and should land with the Phase 3 opening commit.

## Part A: the ten findings as landed

| Id | Status | Fix as landed (file:line) | Proving test (file, test name) | Residual |
| --- | --- | --- | --- | --- |
| P2-1 (medium) PushRefresher on raw `onChange` | **closed** | `lib/chat.ts:194-205` module-level `signedInListeners` + `emitSignedIn`; `:226-229` `auth.onSignedIn(cb)`; emitted only at `:235` (Apple), `:285` (`completeFromUrl` after `verifyOtp`, the address compare at `:275`, and `getSession`), `:300` (guest); `onChange` (`:214-217`) is a plain forward of `onAuthStateChange` and emits nothing here. `PushRefresher.tsx:48` subscribes to `onSignedIn`; no `onChange` import. | `lib/__tests__/chat.test.ts` "W3-5: nothing reaches the backend on the attacker's session: no rpc, from(), storage or channel call between verifyOtp and signOut" (a registered `onSignedIn` listener that would RPC is never called; `between` is `[]`; no `register_push_device` ever); "P2-1: onSignedIn fires once for a matching email link, after the address check, with the verified session"; "P2-1: onSignedIn fires for the Google code exchange, Apple and guest, never from the raw auth event, and unsubscribes"; "P2-1: a throwing onSignedIn listener does not break the sign-in or the other listeners". `components/__tests__/push-refresher.test.tsx` "P2-1: the component never subscribes to the raw auth.onChange, so a session Supabase reports inside the W1-1 window registers nothing"; "W2-8 follow-up: a verified sign-in (auth.onSignedIn) re-registers the current token even when it has not changed". W2-9/W3-5 is thereby closed too. | Listener set is module memory and `resetThisPhone()` does not clear it (by design, `:194-195`). The only subscriber is `PushRefresher`, mounted once in the root layout outside `SecurityProvider` and unsubscribed on unmount, so nothing leaks across a reset; a future screen-level subscriber must unsubscribe or its closure fires on the next sign-in (listeners only ever see verified sessions, so the exposure is a stale `refresh()`, not a W1-1 window). |
| P2-2 (medium) `forgetLinkingURL()` never called | **closed** | `app/s/[id].tsx:125` inside `peekSecretLink(url).then(...)`, before `setPeek` (key imported, launch URL dropped; not on the catch path); `app/chat/join.tsx:18` `useEffect(() => { if (token) forgetLinkingURL(); }, [token])`. `security/links.ts:135-138` clears expo-linking's initial URL and strips the Android Intent. | `app/__tests__/secret-viewer.test.tsx` "Universal Link: the key comes from the launch URL; peek shows the ready state; Open decrypts and shows the text with Copy" (not called while "Checking your link…", once after the peek resolves, still once after the open); "P2-2: a failed peek (gone, bad key) does not forget the launch URL; a hand-off viewer forgets it too once its peek resolves". `app/__tests__/join.test.tsx` "deep link: reads the token from the URL fragment, peeks, asks for code and nickname, redeems" (once); "P2-2: a deep-link route with no token forgets nothing (there is no fragment to forget)". `security/__tests__/links.test.ts` "forgetLinkingURL clears expo-linking's cached URL and the Android Intent data". | A peek that fails with `bad_key`, `network` or `not_configured` leaves the full URL in the native cache for the process (deliberate: a remount can retry); for `gone` the key is worthless. Gate line "leaves the native initial-URL cache after the key is imported" is now true. |
| P2-3 (medium) `consumeShare()` never called | **closed** (buttons) / see **P3-1** | `app/share.tsx:67-72` once-guarded `consume()`; called at `:107` (send ok, after the await), `:113` (send failed), `:98` (`cancel`, header close), `:78-79` (shared text that is a OnePeek link), and via `SecretComposer onLinkMade={consume}` (`:124`); `SecretComposer.tsx:117` fires `onLinkMade` after `createSecretLink` resolved (input encrypted). `security/shareIntent.ts:89-96` `consumeShare` clears the Android pending share, resets the package and sweeps the container on iOS, deletes `<cache>/share-intent/`. | `app/__tests__/share.test.tsx` "a shared file: the first active room is preselected, view once is on, Encrypt and send calls sendFile and opens the room" (consume once, after `sendFile`); "P2-3: nothing is consumed while the screen waits; cancel consumes exactly once"; "\"Make a one-time link instead\" opens the secret composer with the shared text, fixed, and the link is made" (once at link time, not again on Done); "P2-3: a shared file turned into a link is consumed once the link exists (the cache copy goes with it)"; "no active chats: the list says so and only the link path is left; a failed send shows share.error" (failed send consumes once; the cancel after does not repeat). `security/__tests__/shareIntent.test.tsx` "consumeShare clears the native pending share and deletes <cache>/share-intent/ (Android: the container sweep is iOS-only)". | The screen has exits that are not buttons: P3-1. |
| P2-4 (medium) Android receiver: `file://`, no caps | **closed in code; Kotlin compiles only on EAS (S22)** | `ShareIntentModule.kt:176-181` `acceptable()`: scheme `content` only, authority must not start with our package name; `:45-46` `MAX_ITEMS = 10`, `MAX_ITEM_BYTES = 50 MB − 1 KB`; `:129-133` filter + `take(MAX_ITEMS)` + `pendingDropped`; `:184-221` streamed copy, abort and delete the partial file past the cap, delete on any exception, empty file dropped; `dropped` returned at `:93`. JS guard `src/ShareIntentModule.ts:43-53` `filterShareUris`: direct children of `<cache>/share-intent/` only, no `..`, ≤ 10. Mirrors: `security/constants.ts:40-42`; iOS importer `iosShare.ts:83, 92`. `shareParams` never passes `dropped`. | `modules/share-intent/__tests__/ShareIntentModule.test.ts` "a file:// URI into our own private storage is dropped (share-intent injection), our copies are kept"; "at most MAX_SHARE_ITEMS (10): an 11-item list keeps the first ten and reports one dropped"; "getPendingShare applies the filter, adds the native `dropped` count, and returns null when nothing usable is left". `security/__tests__/iosShare.test.ts` "an item over MAX_SHARE_ITEM_BYTES is skipped (never copied), counted in `dropped`, swept; the others go through (P2-4)"; "at most MAX_SHARE_ITEMS (10) files are taken, `dropped` counts the rest". `shareIntent.test.tsx` "shareParams" (dropped never a param). | Per-item cap, no per-share or per-process total: P3-6. `startsWith(packageName)` also refuses a hostile authority such as `io.onepeek.app.evil` (over-refusal, harmless). The sender controls the extension (≤ 8 alphanumerics, lower-cased) and the MIME type; the stem is random, so neither matters. |
| P2-5 (low) shared link travels as a route param | **closed** | Bridge `security/shareIntent.ts:138-151`: `parseOnePeekLink(params.text.trim())` → `stashHandoff` + `router.push({ pathname: '/s/[id]', params: { id } })` / `router.push('/chat/join')`; only non-link text reaches `/share`. Screen `app/share.tsx:76-80`: `classify(sharedText)` → stash, `consume()`, `router.replace(...)`; the field is never drawn (`:119`). | `shareIntent.test.tsx` "a OnePeek secret link shared as text is parked in the hand-off and routed by id only (P2-5)"; "a OnePeek invite link shared as text goes to Join through the hand-off (P2-5)". `share.test.tsx` "P2-5: shared text that is a secret link is classified on arrival, parked in the hand-off, the route REPLACED (not pushed) and the share consumed"; "P2-5: shared text that is an invite link goes to the join flow the same way". | The bridge matches the whole text only; a link inside a sentence still travels as `params.text` for one hop: P3-5. |
| P2-6 (low) "Open secret" on an unheld Secret bubble | **closed** | `MessageBubble.tsx:69` `link = !f && !hidden && onOpenLink ? secretLinkFrom(m.body) : null`. | `app/__tests__/room.test.tsx` "P2-6 Secret room: a bubble with a secret link shows no \"Open secret\" until it is held; the button goes away on release" (no `link.m5`, no "Open secret", no "onepeek.io" in the tree until `pressIn`; own bubble keeps the button). | UX only: the recipient holds the outer Pressable and taps the inner button; with one finger `pressOut` fires first. Not security. |
| P2-7 (low) unlock token destructured from a string | **closed** | `app/s/[id].tsx:177` `setUnlockToken(await verifyUnlockCode(url, lockCode))`; direct import from `@/lib/secrets` (`:40`), no optional-API shim; `lib/secrets.ts:195-198` returns `Promise<string>`; `test/secrets-mock.ts:28` returns a string. | `app/__tests__/secret-viewer-unlock.test.tsx` "P2-7: with the real lib/secrets, a wrong code is reported, the right code yields the token STRING and open sends it as unlockToken" (real `lib/secrets` + real core over the Supabase fake and a faked `fetch`; `/api/open` body is `{ id, precise: null, unlockToken }`; the email reaches only `/api/unlock/send`; token and code never drawn). `secret-viewer.test.tsx` "recipient lock (C4): email → code → token (a string, P2-7); open carries the token and the email, the watermark names the email". | None. |
| P2-8 (low) "Open in browser" loops back on Android | **closed** (device S24b pending) | `app/s/[id].tsx:232-236` Android → `WebBrowser.openBrowserAsync(url)` (Custom Tab), iOS → `Linking.openURL`; `:44` `BROWSER_NOTE` "Opens in your browser. The full link, key included, is handed to the browser and will be in its history." rendered at `:330` under the button. | `secret-viewer.test.tsx` "Android: a Custom Tab (openBrowserAsync), never Linking.openURL (the verified App Link would loop back into the app); the note names the consequence"; "iOS: Linking.openURL hands the Universal Link to Safari; the Custom Tab API is not used"; "a browser that cannot be opened is reported, nothing else changes". | Whether a Chrome Custom Tab leaves the key in Chrome's history until the web viewer's `replaceState` is a device check (S24b); the sentence already says so. |
| P2-9 (low) quota client id survives sign-out/reset | **closed by fix + documentation** | `lib/secrets.ts:96-99` `forgetClientId()` (memory + SecureStore, never throws); `lib/chat.ts:330` in `signOut()` after the Supabase sign-out and regardless of its error, `:408` in `resetThisPhone()`; `docs/secret-chat/known-limitations.md` item 13. | `chat.test.ts` "P2-9: signOut wipes the secrets quota id (onepeek.client) from SecureStore and memory"; "signs out locally, wipes both sealed stores and the lock, and the next getChat() rebuilds" (asserts `CLIENT_ID_KEY` gone and a fresh id after the reset). | A guest who never signs out keeps the id; iOS keychain persistence across reinstall stays a device claim. Both are in item 13. |
| P2-10 (low) `expo-share-intent` wiring checks | **closed in code; S27 (first EAS compile, App Group on both identifiers) pending** | `app.config.ts:111-125` `disableAndroid: true`, activation rules (text, 1 URL, 10 images/movies/files, no WebPage rule), `iosAppGroupIdentifier`, extension name; `package.json:72-80` `expo.autolinking.android.exclude: ['expo-share-intent']` (its Android module, with the file-name `Log.i`, is not compiled); `security/shareIntent.ts:56-58` `packageHookOptions` `{ disabled: os !== 'ios', resetOnBackground: false, debug: false }`; `security/links.ts:122-125` `isShareWakeUrl` matches `onepeek://dataUrl=<key>…` and `parseOnePeekLink` is null for it; `shareIntent.ts:186-196` import (move) → `pkg.resetShareIntent()` → route; `:170` container swept on mount unless this launch is the wake URL; `iosShare.ts:100` swept after every import; `consumeShare` `:92-93` resets the package and sweeps; `app/+native-intent.tsx:6-8` wake URL → `/`. `withAppGroup` ordering: listed before `expo-share-intent` (`app.config.ts:105`), so its entitlements mod runs after the package's (later-registered mods run first) and dedupes the prepended group (`withAppGroup.js:19-28`). | `shareIntent.test.tsx` "the package hook is mounted but disabled on Android; its Android native module is never consulted and the container is never swept"; "cold start with a share: the package state is imported (files moved), the package reset, FLAG_SECURE asserted, /share pushed once with { text, uris }" (import before reset); "launch that IS the package wake-up does not sweep the container first (the files are about to be moved); an ordinary launch does"; "consumeShare on iOS also clears the package's UserDefaults copy (clearShareIntent under the scheme key) and sweeps the group container". `iosShare.test.ts` "files are MOVED into <cache>/share-intent/ under random 24-hex names with a lowercased safe extension; the container root is swept (thumbnail too), Library/Preferences is untouched"; "a second import of the same intent finds nothing (files already moved) and leaves the cache copies alone". `links.test.ts` "isShareWakeUrl: expo-share-intent's dataUrl deep link only; parseOnePeekLink sees no link in it". `plugins/__tests__/withAppGroup.test.js` "both present, ours before the package (its entitlements mod then runs after the package and dedupes)"; "one App Group id in both places; Android half disabled; activation rules = text, 1 URL, 10 images/movies/files"; "dedupes what expo-share-intent prepends". | `+native-intent.tsx` has no test (P3-4). The package's `NSLog` of the content-free wake URL and the UserDefaults plist window are documented in README N6b, not claimed away. Sweep ordering against an overlapping share: P3-3. |

## Part B: new findings (P3)

### P3-1 (medium) — The share screen consumes the plaintext copy on its buttons, not on the other ways it leaves

- `app/share.tsx` calls `consume()` from `send()` (`:107`, `:113`), `cancel` (`:98`, the header close
  button), `onLinkMade` (`:124`) and the link redirect (`:78-79`). Nothing runs on unmount. The screen
  is a modal (`_layout.tsx:134` `presentation: 'modal'`): on iOS the standard way to cancel a modal is
  the swipe-down gesture, on Android the back button; both unmount the screen without `consume()`.
  Third path: `/share` is not in `PUBLIC` (`_layout.tsx:31`), so for a signed-out phone `AuthGate`
  replaces it with `/welcome` the moment it mounts, and `load()` (`:89`) does the same on
  `not_signed_in`; neither calls `consume()`. In all three the copy in `<cache>/share-intent/` (and on
  Android the pending share) stays until the next launch sweep, which is the lifetime P2-3 was rated
  medium for.
- Failure scenario: a photo shared from Photos into OnePeek on iOS, the user changes their mind and
  swipes the sheet away: the plaintext copy stays in the app cache for as long as the process lives.
  Or: a file shared to a phone that is signed out (a guest who signed out, a fresh install): the bridge
  imports it into the cache, pushes `/share`, AuthGate bounces to Welcome, the user signs in and finds
  no share; the copy sits in the cache. The lock path is covered by accident: a relock unmounts the
  Stack and remounting `ShareIntentBridge` runs `sweepShareCache()` again (`shareIntent.ts:171`).
- Fix (owner: mobile-ui): `useEffect(() => () => consume(), [consume])` in `ShareScreen` (the ref
  makes it idempotent; every send and link path awaits its read before the screen can unmount, so
  nothing is consumed under a read). For the signed-out case the bridge should not push `/share` at
  all when `auth.getSession()` is null: consume and drop the share, or stash it and deliver after
  `onSignedIn` (owner: native-security). Tests: `share.test.tsx` "unmount without a button consumes
  once" (`screen.unmount()` → `consumeShare` called once; a cancel before it does not double); a
  signed-out `load()` → `consumeShare` once, `router.replace('/welcome')`.

### P3-2 (low) — The hand-off has no lifetime and the invite slot has no binding

- `lib/links.ts:63-74`: `slots` is module memory with no timestamp; `takeHandoff` is called only when
  a viewer or Join mounts. Two ways a stash outlives its consumer: (a) `app/s/[id].tsx:85-91` returns
  early when the launch URL already names this id, so a stash for the same id (bubble tap for the
  secret the app was cold-started with) is never taken and stays in memory for the process; (b) a
  relock between `stashHandoff` and the destination's mount (the Stack unmounts; on unlock it remounts
  at `index`) leaves the stash for the next viewer or Join to take. The secret slot is safe against a
  wrong reader: `:88-90` discards a stash whose id does not match the route. The invite slot is not:
  `app/chat/join.tsx:17` `inviteTokenFrom(handed) ?? inviteTokenFrom(url)` prefers a stale stash over
  the Universal Link the user just tapped, so a later `/chat/join#<token2>` would peek and redeem the
  stale `token1` without any indication. Only the user's own earlier action can plant the stash (no
  attacker control), so low.
- Fix (owner: mobile-ui): stash `{ value, at }` and have `takeHandoff` drop anything older than ~30 s;
  in `chat/join.tsx` prefer the URL token when both exist (or compare them and refuse on mismatch);
  `clearHandoffs()` from `resetThisPhone()` and on relock. Test: a stash older than the TTL is null; a
  Join mounted with both a stash and a URL uses the URL.

### P3-3 (low) — `consumeShare()` and the container sweep are global, so two overlapping shares interfere

- `security/shareIntent.ts:89-96` deletes the whole `<cache>/share-intent/` directory and, on iOS,
  every file at the App Group container root. `iosShare.ts:100` sweeps the root after each import.
  Shares are not isolated per nonce. (1) A second share arriving while the first share screen is up
  pushes a second `/share`; the first screen's later `cancel` deletes the second share's copy, whose
  `sendFile` then fails to read (availability only). (2) On iOS the extension writes the next share's
  files into the container root before it opens the wake URL; an import or consume of the previous
  share running in that window (`sweepGroupContainer`) deletes them, and the new intent then imports to
  null and is "reset but not routed" (`shareIntent.test.tsx` covers that outcome as benign: here it is
  a silently lost share). The move-vs-copy choice is right (nothing stays in the container); the sweep
  is what races.
- Fix (owner: native-security): copy into `<cache>/share-intent/<nonce>/` and consume by nonce; have
  the container sweep skip files modified in the last ~10 s (the thumbnail rule still catches the
  original-name `.jpg` after the window), or delete only the files the intent listed plus their
  `base64(name).jpg` thumbnails. Test: two imports back to back, the second's files survive the first's
  consume.

### P3-4 (low) — `app/+native-intent.tsx` is untested and the one place that sees every incoming URL

- `app/+native-intent.tsx:6-8` returns `'/'` for `isShareWakeUrl(path)` and `path` otherwise. It relies
  on expo-router passing the full URL (`onepeek://dataUrl=…`) as `path`; if a future expo-router hands
  the extracted path (`dataUrl=onepeekShareKey?nonce=…`) the regex no longer matches and the wake-up
  opens the unmatched route (the share still routes: the bridge reads the package, not the router).
  There is no jest test, and the diff shows none (`+8` lines, no `__tests__`). The function also
  receives every secret link with its key and every `onepeek://auth` callback; today it only tests and
  returns, but it is the natural place for a later "log the path" line to slip in.
- Fix (owner: lead): `app/__tests__/native-intent.test.ts`: the wake URL (with and without
  `?nonce=…#type`) → `'/'`; `https://onepeek.io/s/<id>#<key>`, `onepeek://auth?code=x`, `/room/x` →
  unchanged; and the file imports only `isShareWakeUrl` from `@/security/links` rather than the whole
  `@/security` barrel (which pulls `SecurityProvider`, `expo-share-intent` and the native bindings into
  the router's URL hook). Record in S27 that the wake-up opens no unmatched-route screen on a device.

### P3-5 (low) — The bridge recognises a shared link only when the text is exactly the link

- `security/shareIntent.ts:139` `parseOnePeekLink(params.text.trim())` is the strict whole-string
  parser. A share such as "Look: https://onepeek.io/s/…#…" (Messages, Notes, a mail body) falls through
  to `router.push({ pathname: '/share', params })` at `:153` with the key in `params.text`; the screen's
  `classify()` (`lib/links.ts:50-58`, substring regex) then catches it and `replace`s the route
  (`share.tsx:76-80`). So for embedded links the P2-5 hop (link with key in a route param, in router
  history for one navigation) still exists; `shareIntent.test.tsx` "a OnePeek secret link shared as
  text…" covers the bare-link case only.
- Fix (owner: native-security): in `route()` use `lib/links.classify(params.text)` (or run
  `parseOnePeekLink` over whitespace-split tokens) and stash the extracted `url`. Test: `{ text: 'Look:
  <link>' }` routes to `/s/[id]` with no `#` in any `router.push` argument.

### P3-6 (low) — Per-item caps without a per-share or per-process total

- `ShareIntentModule.kt:45-46, 132`: 10 items × (50 MB − 1 KB) ≈ 500 MB per share, copied to
  completion before the share screen appears; `OnNewIntent` (`:63-69`) accepts a new share each time
  the app is in front, and nothing deletes earlier copies until `consumeShare()` or the next launch.
  The iOS importer has the same shape (`iosShare.ts:83, 92`). A hostile app in the foreground can send
  repeatedly; each send shows the share screen (user-visible), but the copies accumulate in the cache
  (Android may evict the cache under pressure; iOS `Library/Caches` likewise, neither promptly).
- Fix (owner: native-security): a per-share byte total (e.g. 50 MB across items: the screen sends one
  file anyway, `share.tsx:147` "Only the first file is sent") and `sweepShareCache()` before each copy
  when no share screen is mounted; or simply copy only the first item on Android since the screen uses
  only the first. Test: a `SEND_MULTIPLE` of 10 × 40 MB yields one copy / is capped.

### P3-7 (low) — On Android a shared secret link stays in the activity Intent until a successful peek

- The bridge's link path (`shareIntent.ts:140-150`) never calls `clearPendingShare()` /
  `clearIntentData()`; the Kotlin module clears its own `pendingText` (`:87`) but the activity Intent
  still carries `EXTRA_TEXT` (the full link, key included) until `stripIntent()` runs. That happens via
  the viewer's `forgetLinkingURL()` only after a successful peek (`s/[id].tsx:125`) or Join's token
  capture; for a `gone`/`bad_key`/offline peek the link stays in the Intent (and in the task record
  Recents keeps) for the process. The Join path has the same shape for an invite token.
- Fix (owner: native-security): in `route()` call `clearPendingShare()` right after `stashHandoff` for
  the link kinds (text-only shares have no files to keep). Test: `clearPendingShare` called once in the
  P2-5 bridge tests.

## Part C: the questions the close-out asked

- **Hand-off lifetime / wrong screen.** The secret slot cannot be read for a different id (`s/[id].tsx:88-90`
  discards on mismatch); it can outlive its consumer (P3-2 a, b) and then sits in JS memory. The invite
  slot can be read by the next Join regardless of which link brought the user there (P3-2).
- **Bridge pushing `/s/[id]` signed-out.** `s` is in `PUBLIC` (`_layout.tsx:31`), so the viewer opens
  for a signed-out phone, as on the website; the route param is the id only (`shareIntent.test.tsx`
  asserts no `#` in any push). `/chat/join` is public too (`chat`). `/share` is not: see P3-1.
- **`onSignedIn` listeners across `resetThisPhone`.** The set is module memory, deliberately untouched by
  the reset (`chat.ts:194-195`); the one subscriber is the root-layout `PushRefresher`, which does not
  remount on a reset and unsubscribes on unmount. No leak; the invariant to keep is "subscribe at the
  root, not in screens" (P2-1 residual column).
- **iOS import move-vs-copy and sweep ordering.** Move is right; the post-import and consume-time
  container sweeps race a share that is being written: P3-3. The launch-time sweep is correctly skipped
  when the launch URL is the wake-up (`shareIntent.ts:170`, tested).
- **`+native-intent.tsx`.** Correct for the URL shape expo-router passes today; untested; imports the
  whole security barrel: P3-4.

## Checked and found correct

- `completeFromUrl` emits `onSignedIn` after `getSession()` confirms a session, so the PKCE path and
  the email path both report the installed session, never the attacker's (W3-5 test pins the empty
  window). `emitSignedIn` isolates listener exceptions.
- `signOut()` runs `forgetClientId()` even when the Supabase sign-out errored; `resetThisPhone()`
  unregisters push, signs out, wipes both stores, clears the lock, forgets the client id and sweeps the
  picker caches, in that order (tests assert the RPC-before-signOut ordering).
- `forgetLinkingURL()` is called after the key is imported, never before (the `useLinkingURL()`
  remount concern in `links.ts:132-133`), and never on a failed peek.
- The viewer still clears decrypted content on `AppState !== 'active'`, focus loss, timer end and
  unmount; the unlock token is state only and never drawn; `Watermark` names the confirmed email only
  while held.
- `filterShareUris` refuses `content://`, sibling cache directories, nested paths, `..` and empty
  names; `shareParams` copies `text` and `uris` only.
- `importShareIntent` prefers `text` over `webUrl` (the package derives `webUrl` from the text), skips
  non-`file://` paths, missing files and oversize items before touching them, and random-names every
  copy; `Library/Preferences` is a directory and survives the sweep.
- `withAppGroup` validates the group id, is idempotent, registers only the entitlements mod, and the
  app.config test pins its position before `expo-share-intent` and the identical group id.
- `MessageBubble` keeps the link string out of accessibility labels; the sender's own bubble shows the
  button unheld (own content).
- No `console.` in the range outside tests; no new network literal; `debug: false` for the package;
  the Android half of `expo-share-intent` is excluded from autolinking so its `Log.i` of file names is
  not in the build.

## Status of the open lows from the Phase 1 close-out

| Id | Status now |
| --- | --- |
| W1-8 residual (`onepeek://spike`) | **Still open**: `apps/mobile/app/spike.tsx` is present at `f082e05`. |
| W2-2 residual (iOS `/private` prefix) | **Still open**: device check (qa §4.1). |
| W2-4 (EXIF/GPS) | **Still open**: Phase 3 by decision; the share target is a second photo path with the same property. |
| W2-6 / W3-2 (E2E flag) | **Closed** (Phase 2 review, in passing). |
| W2-8 residual (re-register after sign-in) | **Closed** by P2-1's `onSignedIn`. |
| W2-9 / W3-5 (core-side test) | **Closed**: `chat.test.ts` "W3-5: nothing reaches the backend on the attacker's session…". |
| W3-3 (sink lint) | **Closed** (Phase 2 review, in passing). |
| W3-4 (`treeText()` allow-list) | **Closed** (Phase 2 review, in passing). |
| Web parity (reply quotes) | **Still open**: web owner. |

## Gate 2 verdict line

**No open high or critical.** P2-1..P2-10 closed with tests (P2-4, P2-8, P2-10 keep device/EAS checks
S22, S24b, S27). New: **P3-1 (medium)** share-screen exits without `consumeShare()` (iOS swipe-dismiss,
Android back, signed-out redirect); lows P3-2..P3-7. Recorded test counts (lead's run, not re-run here):
web 142/142, core 322/322, mobile 394/394.

## Every open low across Phase 1 and Phase 2 (owner)

| Id | One line | Owner |
| --- | --- | --- |
| W1-8 residual | `spike.tsx` still ships; `onepeek://spike` opens for a signed-in user in a release build | lead |
| W1-1 residual (decision) | pending email address lives in module memory; a cold start between link request and tap needs a new link (gate §4.2) | core-crypto / lead |
| W2-2 residual | iOS `/private/var` vs `/var` prefix may make `deletePicked` a no-op until the launch sweep; device check | qa |
| W2-4 | EXIF/GPS not stripped from picked or shared photos; honest sentence shipped; `expo-image-manipulator` in Phase 3 | mobile-ui |
| P2-4 residual | Kotlin receiver compiles only on EAS; `file://` refusal and the 50 MB abort need S22 on a device | native-security |
| P2-8 residual (decision) | geofenced / unsupported-protection links are handed to the browser with the key; sentence shipped; S24b checks Custom Tab history | mobile-ui / qa |
| P2-10 residual | first EAS compile of the `OnePeekShare` target, App Group capability on both identifiers, wake-URL `NSLog`, UserDefaults plist backup window (S27, documented) | native-security |
| Web parity | `page.tsx` reply preview and parent quote show Secret text (W2-1 / W3-1 class) | web owner |
| P3-2 | hand-off has no TTL; invite slot prefers a stale stash over the tapped link | mobile-ui |
| P3-3 | `consumeShare()` / container sweep are global; overlapping shares delete each other's copies or lose a share | native-security |
| P3-4 | `+native-intent.tsx` untested, relies on the full URL being passed, imports the whole security barrel | lead |
| P3-5 | bridge parses only an exact link; an embedded link still travels as `params.text` for one hop | native-security |
| P3-6 | no per-share or per-process byte total for share copies (≈ 500 MB per share) | native-security |
| P3-7 | Android: a shared secret/invite link stays in the activity Intent until a successful peek / token capture | native-security |

Medium, not low, but open: **P3-1** (share-screen exits without consume) — mobile-ui, with the
signed-out half for native-security.

## Device-only claims (cannot be settled by reading)

Unchanged from `phase-2.md` plus: the iOS modal swipe-dismiss path of P3-1 (that expo-router's
`presentation: 'modal'` is gesture-dismissible in the built app); whether expo-router 58 passes the full
URL to `redirectSystemPath` (P3-4); Chrome Custom Tab history on Android (S24b); the extension's
container write order against the wake URL (P3-3).
