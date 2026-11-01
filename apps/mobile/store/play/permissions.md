# Android permissions declared by OnePeek 1.0, with user-facing justification

Owner: `release`. Derived on 2026-11-01 from `apps/mobile/app.config.ts` (lead-owned) and the config
plugins it lists, by reading each plugin's `plugin/build/*.js` in `node_modules` (SDK 58). The lead should
confirm the list against `npx expo config --type introspect` → `android.permissions` (the merged
manifest is only produced on an EAS build; this Mac has no Android toolchain). Play Console shows the
final list under **App bundle explorer → Permissions** after the first upload; reconcile against this
file then.

## Permissions the app needs

| Permission | Added by | Runtime prompt? | What the user is told / why |
| --- | --- | --- | --- |
| `android.permission.INTERNET` | React Native / Expo base manifest | No (normal) | Talking to onepeek.io and Supabase over HTTPS. |
| `android.permission.CAMERA` | `expo-camera` plugin (also by `expo-image-picker`) | Yes, when the user opens Scan or chooses "Take photo" | **Scan invite and secret QR codes; take a photo to send in a chat.** The image is encrypted on the phone before upload. Store listing / Data safety: camera data is not collected. |
| `android.permission.POST_NOTIFICATIONS` (API 33+) | `expo-notifications` plugin | Yes, when the user turns notifications on in Settings | **Optional.** Shows "You have a new message in a private chat." and nothing else; the app never prompts on its own (`PushRefresher` re-registers only after the user opted in). |
| `android.permission.RECEIVE_BOOT_COMPLETED` | `expo-notifications` plugin | No (normal) | Lets the notifications library restore scheduled notifications after a reboot. OnePeek schedules none, but the plugin declares it; harmless, no data. |
| `android.permission.USE_BIOMETRIC` (API 28+) and `android.permission.USE_FINGERPRINT` (legacy) | `expo-local-authentication` plugin | No (normal; the OS shows its own prompt) | **Unlock OnePeek** with fingerprint / face / device PIN on cold start and after 60 s in the background. |
| `android.permission.VIBRATE` | possibly `expo-haptics` or the RN template at build time | No (normal) | Haptic feedback on hold-to-read and buttons. **Not found in any library manifest read on this Mac**; listed so the lead checks the merged manifest. If absent, delete this row. |
| `android.permission.READ_EXTERNAL_STORAGE` (maxSdkVersion 32) and `android.permission.WRITE_EXTERNAL_STORAGE` (maxSdkVersion 32) | `expo-image-picker` plugin | On Android 12 and lower, when picking a photo | **Pick a photo to send.** On Android 13+ the system Photo Picker is used and these permissions do not apply (`maxSdkVersion`). The plugin adds them for older devices; the app's minimum is Android 10 (device matrix), so they stay. Picked files are encrypted before upload and the picker copy deleted after the send. |

Photo and document picking on Android 13+ uses the system pickers (`expo-image-picker`,
`expo-document-picker`) and needs **no** `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO`; the app declares neither
(Play's Photo and Video Permissions policy is therefore not triggered). The share-sheet receive path
(`ACTION_SEND`) is an intent filter, not a permission.

## Permissions added by plugins that the app does **not** use (action for the lead)

| Permission | Added by | Problem | Fix (one line each in `app.config.ts`, lead-owned) |
| --- | --- | --- | --- |
| `android.permission.RECORD_AUDIO` | `expo-camera` plugin (`recordAudioAndroid` defaults to `true`) **and** `expo-image-picker` plugin (`microphonePermission` defaults on) | OnePeek records no audio and no video. An unused dangerous permission in the Play permissions list and a microphone entry in the Android settings page contradict "no microphone" in the store copy and Data safety form; Play reviewers ask about it. On iOS the same two plugins insert a default `NSMicrophoneUsageDescription` ("Allow OnePeek to access your microphone"), an unused usage string App Review also notices. | Replace the two plain entries with `['expo-camera', { recordAudioAndroid: false, microphonePermission: false }]` and `['expo-image-picker', { microphonePermission: false }]`. Both plugins then also add a `<uses-permission tools:node="remove">` block for `RECORD_AUDIO` so no other library re-adds it. Keep `cameraPermission` unset (the app's own `NSCameraUsageDescription` in `ios.infoPlist` is kept by the plugin because it only fills missing keys). |
| `android.permission.CAMERA` from `expo-image-picker` | duplicate of expo-camera's | Harmless (same permission). | none |

Until the lead applies the fix, the honest store answer is: "the app declares `RECORD_AUDIO` because of a
library default and never uses it; it will be removed in the next build". Better to fix before the first
upload, since Play remembers the permission history.

## Permissions the app deliberately does not declare

| Permission | Why not |
| --- | --- |
| Location (`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`) | No feature reads location. Geofenced one-time links are opened on the website instead ("Open in browser"), and the viewer is told why. |
| Contacts (`READ_CONTACTS`) | Invites are links and QR codes. |
| `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` / `READ_MEDIA_VISUAL_USER_SELECTED` | System Photo Picker on Android 13+. |
| `MANAGE_EXTERNAL_STORAGE` | Never. Shared files arrive through `content://` URIs copied into the app cache. |
| `SYSTEM_ALERT_WINDOW`, `QUERY_ALL_PACKAGES`, accessibility services | Never. |
| `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` | Not added by `expo-notifications` 58 for this configuration; confirm absent in the merged manifest. |
| `com.google.android.c2dm.permission.RECEIVE` | Legacy FCM permission; the FCM client library may add it via its own manifest. If present, it is the push transport and covered by the notifications justification. |

## Other manifest facts a reviewer sees

- `android:allowBackup="false"` plus `dataExtractionRules` / `fullBackupContent` excluding every domain
  (`plugins/withBackupRules.js`): chat keys and messages are not backed up or transferred.
- `FLAG_SECURE` is set on the main activity window in `onCreate` (`plugins/withSecureWindow.js`), so the
  whole app is black in screenshots, recordings, casting and the recent-apps thumbnail. Not a permission,
  but it is what Play reviewers will notice first; `../app-store/review-notes.md` explains it.
- App Links intent filter with `autoVerify` for `onepeek.io` and `www.onepeek.io` (`/s/*`, `/chat/join`);
  verification depends on `/.well-known/assetlinks.json` carrying the Play App Signing SHA-256
  (checklist B3/B4).
- Share intent filters (`SEND`, `SEND_MULTIPLE`) for text, images and any file; no exported content
  provider.
- `predictiveBackGestureEnabled: false`.

## Play Console "Permissions declaration" forms

None of the declared permissions is in Play's sensitive-permission set that needs a declaration form
(SMS/Call Log, Accessibility, All files access, Location in background, VPN, Exact alarms, Photo/Video
on API 33+). If `RECORD_AUDIO` stays in the build, no form is needed either, but the Data safety form
must still say audio is not collected (true) and the permission remains visible on the store page.
