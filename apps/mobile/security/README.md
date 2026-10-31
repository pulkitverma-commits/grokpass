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

## API (`apps/mobile/security/index.ts`)

| Export | Use |
| --- | --- |
| `SecurityProvider({ children, cover?, now? })` | Root wrapper. Renders children only when unlocked; renders `cover` (default `LockCover`) while `locked \|\| inactive \|\| captured`. |
| `useSecurity()` | `{ locked, unlock(), lockNow(), panic(), captured, biometrics, deviceInsecure, inactive }` |
| `useSecureScreen(key)` | Call from every chat and secret screen (key per screen, e.g. `room:<id>`). Android: asserts FLAG_SECURE on mount; unmount is a no-op (the flag is app-wide and never released, see N1). iOS: no-op. |
| `useScreenshotAlert(roomId, ttl)` / `onScreenshot(cb)` | On a screenshot, `getChat().sendScreenshotAlert(roomId, ttl)`; never the server directly. |
| `Watermark({ viewerName, deviceCode })` | Translucent diagonal overlay, web wording `<name> · <code> · <stamp>`. `shortDeviceCode(id)` = the web's `shortId`. |
| `LockCover` | Plain full-screen cover (`testID="app.cover"`, accessibility label "OnePeek is hidden"). |
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
iOS is never described as blocking screenshots.
