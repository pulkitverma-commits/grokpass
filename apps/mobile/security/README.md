# OnePeek mobile: native protections (`apps/mobile/security`)

What each protection does on each platform, in wording the release agent may copy. Nothing here is
softened or inflated: where a platform cannot do something, it says so.

## Wiring (for the lead)

- `app/_layout.tsx`: wrap the whole tree in `<SecurityProvider>` **inside** the component, after
  `installRnCrypto()` has run at module load and before the `<Stack>`:

  ```tsx
  import { SecurityProvider } from '@/security';
  export default function RootLayout() {
    return (
      <SecurityProvider>
        <StatusBar style="light" />
        <Stack ... />
      </SecurityProvider>
    );
  }
  ```
  Children are not rendered while locked, so the router mounts only after the first unlock.
  mobile-ui's Locked screen (U3) is passed as `cover={<LockedScreen />}`; it reads `useSecurity()`.
- `app.config.ts` `plugins`: `./plugins/withSecureWindow.js`, `./plugins/withBackupRules.js`, and
  `['expo-secure-store', { configureAndroidBackup: false }]` (done on this branch).
- `lib/chat.ts`: the provider calls `getLockStore().set()`, `.get()`, `.reload?.()` and
  `getChat().lock()/isLocked()/unlock()/sendScreenshotAlert()`. `reload()` is called when present.
- `modules/screen-state` is a local Expo module: autolinked from `apps/mobile/modules` (the default
  `nativeModulesDir` of expo-modules-autolinking 58); needs a dev build, not Expo Go.
- **N6 share intent (lead):** mount the bridge once, inside `<SecurityProvider>` next to `<AuthGate>` (it
  needs the router and must not run while locked):

  ```tsx
  import { useShareIntent } from '@/security';
  function ShareIntentBridge() { useShareIntent(); return null; }
  // …inside <SecurityProvider cover={<LockedScreen />}>: <AuthGate session={session} /><ShareIntentBridge />
  ```
  It pushes `/share` with `{ text?, uris? }` exactly once per share (mobile-ui's `app/share.tsx`), after
  asserting FLAG_SECURE. The share screen calls `useSecureScreen('share')` and, when done (sent or
  cancelled), `consumeShare()`. `modules/share-intent` is a second local Expo module (autolinked like
  `screen-state`; dev build, not Expo Go). `app.config.ts` additions are listed under N6.

## API (`apps/mobile/security/index.ts`)

| Export | Use |
| --- | --- |
| `SecurityProvider({ children, cover?, now? })` | Root wrapper. Renders children only when unlocked; renders `cover` (default `LockCover`) while `locked \|\| inactive \|\| captured`. |
| `useSecurity()` | `{ locked, unlock(), lockNow(), panic(), captured, biometrics, deviceInsecure, inactive }` |
| `useSecureScreen(key)` | Call from every chat and secret screen (key per screen, e.g. `room:<id>`). Android: asserts FLAG_SECURE on mount; unmount is a no-op (the flag is app-wide and never released, see N1). iOS: no-op. |
| `useScreenshotAlert(roomId, ttl)` / `onScreenshot(cb)` | On a screenshot, `getChat().sendScreenshotAlert(roomId, ttl)`; never the server directly. |
| `Watermark({ viewerName, deviceCode })` | Translucent diagonal overlay, web wording `<name> · <code> · <stamp>`. `shortDeviceCode(id)` = the web's `shortId`. |
| `LockCover` | Plain full-screen cover (`testID="app.cover"`, accessibility label "OnePeek is hidden"). |
| `parseOnePeekLink(url)` | `{ kind: 'secret', id, key } \| { kind: 'invite', token } \| { kind: 'verify', digits } \| { kind: 'auth' } \| null`. Strict: hosts `onepeek.io` / `www.onepeek.io` / scheme `onepeek`, 10-char secret id, 43-char key, 32–128-char token, 60 digits. For the viewer, the join screen, the scanner and the share screen. `isSecretLink`, `isInviteLink`, `isShareWakeUrl` are shorthands. |
| `forgetLinkingURL()` | After a secret key / invite token has been consumed: clears expo-linking's cached initial URL and (Android) the activity Intent's data, so nothing in the process can read the fragment again. |
| `useShareIntent()` | Root bridge (see Wiring). Sweeps `<cache>/share-intent/` on launch, reads the pending share (Android module / iOS App Group), asserts FLAG_SECURE, `router.push('/share', { text?, uris? })` once per share. |
| `consumeShare()` | Share screen, when done: clears the native pending share and deletes `<cache>/share-intent/`. `sweepShareCache()` is the sweep alone. |
| `readAppGroupShare()` | iOS: reads and wipes `<App Group>/share-intent/` (manifest + files), moving files into `<cache>/share-intent/`. `APP_GROUP = 'group.io.onepeek.app'`. |
| `excludeChatDbFromBackup()` | iOS: marks the SQLite directory and `onepeek-chat.db(-wal/-shm/-journal)` as excluded from backup. Called by the provider on mount. |
| Constants | `AUTO_LOCK_MS` (60 000), `SECURE_RETRY_MS` (500), `UNLOCK_PROMPT`, `DEVICE_INSECURE_WARNING`, `SCREENSHOT_NOTICE_MINE`, `screenshotNoticeTheirs(name)`, `PROTECTION_COPY`. |

## Protections, honestly

### N1 Screenshots, recordings, app switcher: Android
`plugins/withSecureWindow.js` sets `WindowManager.LayoutParams.FLAG_SECURE` on the activity window in
`MainActivity.onCreate`; the provider asserts `preventScreenCaptureAsync(APP_SECURE_KEY)` on mount and
again on every `AppState` → `active` (one delayed retry, `SECURE_RETRY_MS`, if the native call throws
`MissingActivity` on a cold start); `useSecureScreen()` re-asserts it when a chat/secret screen mounts.

**Why there is no "allow" anywhere (W1-4).** expo-screen-capture keeps a set of keys and calls the
native clear (`window.clearFlags(FLAG_SECURE)`) the moment the set becomes empty, and it *drops a key
from the set when the native prevent call throws*. So a design where screens release their key on
unmount is one failed app-key call away from clearing the plugin's flag for the rest of the process:
cold start before the activity is attached (dev-client reload, process restart into a backgrounded
app) → app key never held → open a room, leave it → set empty → flag cleared on the Chats list,
Settings, the Locked cover and the recent-apps thumbnail, silently. OnePeek never wants FLAG_SECURE
off, so nothing in the app calls `allowScreenCaptureAsync`: `useSecureScreen` is "assert on mount,
no-op on unmount", and the provider re-asserts on every foreground. A `grep allowScreenCaptureAsync`
over `apps/mobile` (outside `node_modules`) must only hit comments, the jest mocks and this README.
**Guarantee:** the system compositor refuses to capture the window: screenshots fail (the OS
shows a toast whose wording varies by OEM), screen recordings and casting show black, and the
recent-apps thumbnail is blank. **Limits:** a rooted device, a custom ROM or a camera pointed at
the screen are not stopped. The screenshot *notification* still fires on Android 14+ (black image).

### N2 Screenshots, recordings, app switcher: iOS
**iOS cannot block a screenshot and OnePeek does not claim to.** What happens:
- Screenshot: iOS posts `UIApplication.userDidTakeScreenshotNotification` *after* the capture;
  expo-screen-capture surfaces it, `useScreenshotAlert` sends the encrypted alert, and the other
  side sees the web's notice (`<name> may have taken a screenshot.`). The screenshot itself shows
  whatever was on screen.
- Recording / AirPlay / mirroring: `modules/screen-state` reports `UIScreen.main.isCaptured` and its
  change notification; the provider renders the cover while `captured` is true, so the recording
  shows the cover, not the chat (from the next frame; the frames before detection are not
  protected).
- App switcher / inactive: the provider renders the cover on `AppState` `inactive`/`background` and
  removes it on `active`; the switcher thumbnail shows the cover.
- Best-effort extra: the provider also calls expo-screen-capture `preventScreenCaptureAsync`, which
  on iOS installs a secure-text-field canvas that *may* blank screenshots on current iOS versions.
  It is not an Apple API, Apple can break it in any release, and **no copy, test or store listing
  relies on it**. Manual check M2 records what the test device actually did.

### N3 Backups
- iOS: `excludeChatDbFromBackup()` sets `isExcludedFromBackup` on
  `<Documents>/SQLite` (expo-sqlite's directory) and on the database and its side files. iCloud and
  Finder/iTunes backups skip them. Keychain items stored `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (the
  wrapping key `onepeek.wrap` and the lock flag `onepeek.lock`) are **never migrated to another
  device** by a backup restore or device-to-device transfer (Apple's `ThisDeviceOnly` classes);
  they can persist across a reinstall on the *same* device, which is why the core re-checks the
  keystore state (`keystore_unavailable` recovery) instead of assuming a clean slate.
- Android: `android:allowBackup="false"` (lead) plus `plugins/withBackupRules.js`, which declares
  `dataExtractionRules` (API 31+: cloud backup **and** device transfer) and `fullBackupContent`
  (API ≤ 30) excluding every domain: root, file, database, sharedpref, external. expo-secure-store's
  values live in SharedPreferences encrypted with a key in the Android Keystore; the Keystore key is
  not exportable and is deleted on uninstall, so even a copied SharedPreferences file is
  undecryptable on another device. The rules exclude that file anyway.
- Neither platform protects against a device backup taken from a rooted / jailbroken phone.

### N4 Lock
- Cold start: `locked = true`. Content is **not rendered** until `unlock()` succeeds.
- `unlock()`: `expo-local-authentication` `authenticateAsync` with `disableDeviceFallback: false`
  (biometrics, falling back to the device passcode / PIN / pattern). Prompt text is fixed. Cancel,
  lockout and errors leave the app locked; nothing is ever wiped by failed attempts.
- Auto-lock: leaving `active` records the time; returning after more than `AUTO_LOCK_MS` (60 s)
  locks. 59 s does not. Content stays mounted (covered) during the gap; a lock unmounts it.
- Panic Exit: `panic()` flips `locked` in the same tick, writes the persistent flag
  (`getLockStore().set()`, synchronous SecureStore write) and calls `getChat().lock()`. A force-quit
  and relaunch is still locked; `unlock()` then also calls `getChat().unlock()` to clear the flag.
  Nothing is deleted.
- Foreground: the lock store's `reload()` is called on `AppState` → `active` and a set flag locks
  the app (reviewer N3).
- Stale unlock (W1-7): every relock (auto-lock, `lockNow()`, `panic()`, reloaded flag) bumps an
  unlock generation; `unlock()` reads the generation when it starts and, after the OS prompt and
  after the core's `unlock()`, applies nothing if it changed (returns `false`, stays locked, the
  core's `unlock()` is not called). A relock also releases the in-flight guard so the user can start
  a fresh prompt at once; the stale promise is discarded when it resolves. Window in practice: iOS
  prompt left up across a > 60 s background trip (Android cancels the prompt on background).
- `deviceInsecure`: `getEnrolledLevelAsync()` is `NONE` (no passcode, PIN or biometrics). There is
  nothing the OS can ask for, so `unlock()` succeeds without a prompt and the Locked screen must show
  `DEVICE_INSECURE_WARNING`. **Guarantee on such a phone: none beyond the cover; say so.**
- `biometrics`: `'face' | 'fingerprint' | 'passcode' | 'none'` for the Locked screen's icon/label.

### N5 Watermark
A faint (`opacity 0.1`), rotated, 24× repeated stamp `<viewer name> · <device code> · <date time>`
over chat and viewer content, never interactive and hidden from screen readers. Purpose: a photo of
the screen or an iOS screenshot shows who was looking and when. It does not prevent anything.

### N6a Receiving shares: Android
`app.config.ts` `android.intentFilters` declares `ACTION_SEND` (`text/plain`, `image/*`, `*/*`) and
`ACTION_SEND_MULTIPLE` (`image/*`, `*/*`). `modules/share-intent` (Kotlin) reads the launching Intent in
`OnCreate` and later ones in `OnNewIntent` (MainActivity is `singleTask`): `EXTRA_TEXT`, `EXTRA_STREAM`
(single `Uri` / `ArrayList<Uri>`, `ClipData` fallback). `getPendingShare()` (an `AsyncFunction`, so off the
UI thread) copies each `content://` item through `ContentResolver.openInputStream` into
`<cacheDir>/share-intent/<24 hex>.<ext>` and returns `{ text?, uris? }` with `file://` URIs, once; it then
forgets the share. `clearPendingShare()` / `clearIntentData()` replace the activity's Intent with a bare
`ACTION_MAIN` so a process restore from Recents cannot re-deliver it and `Linking.getInitialURL()` cannot
read a consumed link. **Guarantee:** the shared bytes exist as a plaintext copy in the app cache from
`getPendingShare()` until `consumeShare()` or the next launch, whichever first; the cache is excluded from
backups (N3) and the window is FLAG_SECURE (N1). **Limits:** the source app and the OS keep their own copy
of what was shared (the photo in Photos, the file in Files, the text in the sender's clipboard history on
some OEMs); that is theirs, not ours. A share that arrives while the app is locked is delivered after unlock
(the bridge is mounted inside the provider). Nothing is logged: no URI, name, size or text.

### N6b Receiving shares: iOS
iOS has no share intent. An app receives from the share sheet only through a **Share Extension**: a second
target in its own process that cannot talk to the app directly, only through an **App Group** container
(`FileManager.containerURL(forSecurityApplicationGroupIdentifier:)`). Two honest options, both evaluated:

- **(b) Package — recommended for the first iOS build:** `expo-share-intent@9.0.0` (peer `expo ^58`,
  `expo-linking >=58.0.13`, `expo-constants >=58.0.12`: all satisfied here; the README's table maps SDK 58 →
  9.x). Its config plugin adds the extension target, App Group and activation rules, its hook
  `useShareIntent()` returns `{ text, webUrl, files[{ path, mimeType, fileName, size }] }` and
  `resetShareIntent()`. It needs no `patch-package` since v6. If the lead installs it, the iOS branch of
  `security/shareIntent.ts#readPendingShare` should read from its hook/context instead of
  `readAppGroupShare()` (the file paths it returns are copied the same way into `<cache>/share-intent/`), and
  `plugins/withShareExtension.js` is left with the `extension: false` default (its App Group entitlement is
  harmless; use the package's group id or ours, but one id in both places). Note from its docs: EAS builds
  should have only one extension target, and the native call must be made from the root layout under
  expo-router, which is where our bridge already lives.
- **(a) Hand-written, no package — implemented as an EXPERIMENTAL skeleton:** `plugins/withShareExtension.js`.
  Always on: the `com.apple.security.application-groups` entitlement (`group.io.onepeek.app`) on the app
  target via `withEntitlementsPlist` (tested). Behind `ONEPEEK_SHARE_EXTENSION=1` only: a Swift
  `ShareViewController` (UTType order fileURL/image/movie → url → plainText → data; `NSItemProvider
  .loadFileRepresentation`; files to `<group>/share-intent/<24 hex>.<ext>` with
  `completeUntilFirstUserAuthentication` protection; a `pending.json` manifest), `Info.plist`
  (`NSExtensionActivationRule`: text, 1 URL, 10 images / movies / files), its entitlements, and the target
  wired into the pbxproj with the `xcode` package (`addTarget('app_extension')`, three build phases, per-config
  build settings). **It has never been compiled: this Mac has no Xcode and the first compile is an EAS build
  (S27).** The receiving side is real and tested either way: `security/appGroup.ts` reads the container via
  `Paths.appleSharedContainers['group.io.onepeek.app']` (expo-file-system 58; no native code in the app
  target), validates the manifest (v1, ≤ 50 items, 64 KB, hex names only), moves files into
  `<cache>/share-intent/`, wipes the group directory, and `useShareIntent()` runs it on mount, on every
  `AppState` → `active`, and when `onepeek://share` arrives. Opening that URL from a share extension is not an
  official API (only Today widgets get `NSExtensionContext.open`); the extension uses the responder-chain
  call that community plugins use, and when it stops working the share is still picked up on the next
  launch / foreground. **EAS:** the App Group capability must exist on the app identifier (EAS syncs it from
  the entitlements with managed credentials) and, with the extension enabled, on `io.onepeek.app.share` plus
  an `ios.appExtensions` entry in `app.config.ts` (lead) so the extension gets its own profile.
  **Guarantee once an extension exists:** the plaintext copy lives in the App Group container between the
  share and the next app foreground (seconds normally; until the next launch if the wake URL fails), then in
  `<cache>/share-intent/` until `consumeShare()`. The group container is readable by both processes and is
  included in **iCloud/Finder backups unless excluded**; the app wipes it on read, and the extension writes
  it with `completeUntilFirstUserAuthentication` so it is at least encrypted at rest before first unlock.

### N6c Universal Links / App Links: the fragment stays on the device
Link shapes and the single parser are in `security/links.ts` (header comment). Audit (SDK 58 sources in
`node_modules`, file:line):

- **Cold start, iOS.** `expo-linking/ios/LinkingAppDelegateSubscriber.swift:33-47`
  `application(_:continue:restorationHandler:)` takes `userActivity.webpageURL` (the full URL; iOS keeps the
  fragment in `webpageURL`) into `ExpoLinkingRegistry.shared.initialURL` and posts `onURLReceived`.
  expo-router's `getInitialURL()` (`expo-router/build/link/linking.js:96-111`) reads
  `getLinkingURL()` on iOS → the fragment is available to `useLinkingURL()`. Warm start: same subscriber,
  the `onURLReceived` event (`expo-linking/build/Linking.js:132-142`).
- **Cold start, Android.** `expo-linking/android/.../LinkingReactActivityLifecycleListener.kt:10-24`
  reads `activity.intent.data` in `onCreate` and `intent.data` in `onNewIntent`; `android.net.Uri` keeps the
  fragment and `toString()` prints it. expo-router's Android path uses react-native's
  `Linking.getInitialURL()` (same Intent data). The App Link intent filter matches on `pathPrefix` only; the
  fragment is not part of matching and is not sent to the AASA / assetlinks verification.
- **The router drops it.** `expo-router/build/fork/extractPathFromURL.js:82-116` `fromDeepLink()` builds
  `host + pathname + '?' + query` from `new URL(url)` and never appends `url.hash`. So the navigation state,
  `useLocalSearchParams()`, `usePathname()`, the `Stack` screen params and anything that would persist
  navigation state (nothing does: `grep persistNavigationState|initialState|onStateChange apps/mobile/app
  components` is empty) **never contain the key or token**. `app/chat/join.tsx:9-11` and the secret viewer
  read the full URL from `useLinkingURL()` and extract the fragment with `inviteTokenFrom` /
  `parseOnePeekLink`; the token is handed to the core, never to a route param.
- **Where it remains.** (1) `ExpoLinkingRegistry.shared.initialURL` / `ExpoLinkingModule.initialURL`
  (native memory, process lifetime) until `Linking.clearInitialURL()`; (2) on Android, `activity.intent`
  (also what `Linking.getInitialURL()` returns, and part of the task record the system keeps for Recents,
  readable by privileged system apps only); (3) the React state of the screen that called `useLinkingURL()`.
  `forgetLinkingURL()` clears (1) and (2); (3) goes with the screen. The viewer should call it after
  `importKey` (mobile-ui), not before: `useLinkingURL()` would see null on a remount.
- **Logs / analytics.** No analytics or crash SDK is allowed (eslint leak guard, `eslint.config.mjs`);
  `grep -rnE 'log\(|console\.' apps/mobile/{app,components,lib,security} packages/core/src | grep -iE
  'url|link|href|fragment|hash'` is empty outside tests and comments. Supabase receives the secret `id` (the
  path) through `/api/open`, never the fragment, by construction of the URL and of `fetch`.
- **Not covered.** The browser that opened the link (Safari / Chrome history keeps the full URL unless the
  page strips it; the web viewer does `history.replaceState` after opening), the messaging app the link
  arrived in, and the OS's own URL handling logs (none known to include fragments). Document, do not claim.

### N6d FLAG_SECURE on the secret viewer and the share screen
`useSecureScreen('secret')` from `app/s/[id].tsx` and `useSecureScreen('share')` from `app/share.tsx`
(mobile-ui) re-assert the app-wide flag on mount, like every room (N1); the plugin's `onCreate` flag
already covers both screens before any JS runs, and `useShareIntent()` asserts the `'share'` key right
before it pushes the route so the first frame of a shared photo is covered even if the screen mounts late.
iOS: unchanged from N2 (no screenshot blocking; recording cover; watermark on held content).

## What is tested where
- Jest (`cd apps/mobile && npx jest`): plugin transforms (Kotlin/Java, idempotent, rule XML and
  manifest attributes), provider state machine (cold start, unlock success/failure, 59/61 s,
  panic, reload, lockNow, captured, insecure device, W1-4 app-key assert on mount / every active /
  retry after a throw / no loop, W1-7 stale unlock across a 61 s trip, under lockNow and under
  panic), `useSecureScreen` (mount asserts, unmount never calls allow, even after a rejected
  prevent), `useScreenshotAlert`,
  backup paths, Watermark text and accessibility props.
- Device: see `MANUAL-CHECKS.md`. Native code (Swift, Kotlin, generated MainActivity) compiles only
  in an EAS build; this Mac has no Xcode or Android Studio.

## Rules kept
No `console.*`; no plaintext, keys, codes, room names or file names in prompts, events or errors;
iOS is never described as blocking screenshots. N6: nothing hand-written in `ios/`; the Swift extension
source is generated by the plugin and marked experimental until an EAS build has compiled it.

## `app.config.ts` lines owned by native-security (N6)
- `android.intentFilters[1]`: `{ action: 'SEND', data: [{ mimeType: 'text/plain' }, { mimeType: 'image/*' }, { mimeType: '*/*' }], category: ['DEFAULT'] }`
- `android.intentFilters[2]`: `{ action: 'SEND_MULTIPLE', data: [{ mimeType: 'image/*' }, { mimeType: '*/*' }], category: ['DEFAULT'] }`
- `plugins[last]`: `['./plugins/withShareExtension.js', { appGroup: 'group.io.onepeek.app', extension: process.env.ONEPEEK_SHARE_EXTENSION === '1' }]`
- `ios.infoPlist`: unchanged (the `onepeek` scheme already covers `onepeek://share`).
