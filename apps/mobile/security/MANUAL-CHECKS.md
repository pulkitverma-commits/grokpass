# Manual device checks for the native protections

For qa to fold into `docs/mobile/test-plan.md` §4. Each check: steps, expected result per platform.
Evidence is a photo from another phone or a terminal log, never a screenshot of the device under
test (for the obvious reason). Use throwaway 1-hour rooms on production (no staging).

| # | Protection | Steps | Android (expected) | iOS (expected) |
| --- | --- | --- | --- | --- |
| S1 | N1 FLAG_SECURE, chat | Open a room, press the hardware screenshot combo | Toast "Can't take screenshot due to security policy" (OEM wording varies); nothing in Photos; **no alert sent** on Android 13 and below (nothing happened). On Android 14+ the OS still notifies the app → the other side may show the notice; record which | n/a |
| S2 | N1 FLAG_SECURE, everywhere | Repeat S1 on the Chats list, Settings, Locked screen, and while the OS permission dialog is up | All black / refused: the flag is on the window from `onCreate`, not per screen | n/a |
| S3 | N1 recording / cast | Start a screen recording (Quick Settings) or cast to a TV, open a room | The recording shows black for the whole app; casting shows black | n/a (see S6) |
| S4 | N1 app switcher | Open a room, press Overview | Thumbnail blank | Thumbnail shows the cover ("OnePeek"), not the chat |
| S5 | N2 screenshot notification | Open a room on the iPhone, take a screenshot | n/a | Screenshot **is taken** and shows the chat (or, if the best-effort canvas worked on this iOS version, a black/blank image: record the iOS version and result). Within 5 s the other device shows "<name> may have taken a screenshot."; the taker's own screen shows the "You pressed a screenshot shortcut…" notice; the SQL log (companion) shows ciphertext only |
| S6 | N2 recording cover | Start a Control Centre screen recording, then open a room; also AirPlay-mirror to a Mac | n/a | The recording / mirror shows the cover from the moment recording starts; the room is visible on the phone itself; stopping the recording removes the cover without relocking |
| S7 | N2 inactive cover | In a room, pull down Control Centre / receive a call / swipe to the switcher | Cover shown (plus FLAG_SECURE blank thumbnail) | Cover shown while inactive; removed on return without a prompt if < 60 s |
| S8 | N4 cold start | Force-quit, relaunch | Locked screen; no chat content behind it (check with TalkBack/VoiceOver: the room list is not in the tree) | same |
| S9 | N4 unlock | Tap Unlock; (a) succeed with biometrics, (b) cancel, (c) fail biometrics until the OS offers the passcode and use it | (a) Chats; (b) still locked; (c) passcode path unlocks | same (Face ID → "Use passcode") |
| S10 | N4 auto-lock 59 s | Open a room, background the app, return after 55–59 s | Same room, no prompt | same |
| S11 | N4 auto-lock 61 s | Same, return after 65 s | Locked screen; after unlock the room list is intact | same |
| S12 | N4 Panic Exit | In a room, trigger Panic Exit (Settings or mobile-ui's gesture); then force-quit and relaunch | Cover within one frame, then Locked; relaunch still locked; after unlock the rooms and messages are unchanged | same |
| S13 | N4 panic flag from elsewhere | With a debug build, set `onepeek.lock = '1'` in SecureStore from a debug menu / companion while the app is backgrounded; foreground it | Locked at once (reload on active) | same |
| S14 | N4 insecure device | Remove the screen lock in phone settings, relaunch | Locked screen shows the "no passcode" warning; Unlock opens without a prompt; re-adding a PIN restores the prompt on the next foreground | same |
| S15 | N3 iOS backup | Finder → Back Up Now (unencrypted) to the Mac; then `sqlite3 ~/Library/Application\ Support/MobileSync/Backup/<udid>/Manifest.db "select relativePath from Files where domain='AppDomain-io.onepeek.app'"` | n/a | No `Documents/SQLite/onepeek-chat.db`, `-wal`, `-shm`; list any file that is present. Keychain items are not in an unencrypted backup by definition |
| S16 | N3 iOS device transfer | Quick Start transfer or iCloud restore to a second iPhone, install OnePeek | n/a | No chats; the keystore reports `keystore_unavailable` or a clean state and the app offers "Reset chats on this phone"; the wrapping key did not travel (ThisDeviceOnly) |
| S17 | N3 Android backup | Debug build: `adb backup -f qa.ab io.onepeek.app` (Android ≤ 11); `adb shell bmgr backupnow io.onepeek.app` then `bmgr list sets`; Android 12+: `adb shell dumpsys backup | grep -A3 onepeek` | `qa.ab` header-only (~1 KB) or "app opted out"; no data set; `dumpsys` shows not eligible; `databases/`, `files/SQLite/` and `shared_prefs/` absent from any archive | n/a |
| S18 | N3 Android transfer | Google "Copy data" to a new phone | New phone has no OnePeek data | n/a |
| S19 | N5 watermark | Open a Secret room, hold a bubble; photograph the screen with another phone | Faint `<nick> · <code> · <date time>` readable in the photo, repeated across the screen; it does not intercept taps (hold-to-read still works) | same |
| S20 | A11y | VoiceOver / TalkBack on: repeat S5 and S7 | Alert still sent; cover announced as "OnePeek is hidden"; watermark not read out | same |

Not tested because it is not true: "iOS blocks screenshots", "a camera is stopped", "a rooted or
jailbroken phone keeps the flags". If S5 shows a black iOS screenshot, record it as a best-effort
observation for that iOS version; it changes no copy.
