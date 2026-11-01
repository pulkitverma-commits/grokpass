# OnePeek app: Maestro end-to-end flows (Q3)

Owner: `qa`. One YAML per v1 journey in `flows/`, both platforms through `appId: io.onepeek.app`,
every element addressed by the testIDs in [`TESTIDS.md`](TESTIDS.md) (the single source of truth;
`mobile-ui` builds against it, `scripts/check-flows.mjs` enforces it). Companion to
`docs/mobile/test-plan.md` §3.

**Status 2026-10-31 (wave 2): written and statically checked, not run.** This Mac has no Xcode,
Android Studio, Java or Maestro (`docs/mobile/log.md`), and there is no device build yet (EAS
account pending). What was checked: every file parses as YAML, every `id:` exists in `TESTIDS.md`
(all ids the flows use are now in the code: 0 dry steps), no flow calls
`takeScreenshot`/`startRecording`, headers carry `appId`, `name` and `tags`
(`node apps/mobile/e2e/scripts/check-flows.mjs`: `17 flows, 168 ids in TESTIDS.md (1 proposed)`).
Where to run them is the lead's decision ("Where to run", below); both options are written up.

**Build:** the flows need the **E2E build**, the `eas.json` profile `e2e` (extends `development`,
iOS `simulator: true` for CI). Only a build of that profile (`EAS_BUILD_PROFILE=e2e`, which
`app.config.ts` turns into `extra.e2e`) makes `invite.link` render the full link that 03 copies
(security review W1-9 / W3-2); every other build, `expo export` bundle or local release build masks
it and 03 stops at its `assertTrue` on purpose. `EXPO_PUBLIC_E2E` in a shell unmasks nothing. `release` owns `eas.json`; the profile is requested in
the qa wave-2 report.

## Flows

| # | File(s) | Journey | Devices | Runnable today? |
| --- | --- | --- | --- | --- |
| 01 | `01-welcome-guest.yaml` | Welcome → Get started → Continue as guest → Chats home | 1 | yes |
| 02 | `02-signin-email.yaml` | Welcome → Sign in → email → "check your inbox" | 1 | yes; stops at the sent state. **Manual step M1:** the link lands in a mailbox; open it on the same device and assert Chats home. `MAESTRO_EMAIL` must be an inbox the team controls (production sends a real email). |
| 03 | `03-create-secret-room.yaml` | New chat → Secret → 1-hour timer (`new.timer.3600`), code, name, nick → create → invite sheet → copy (`invite.toast`) → done → room → back to Chats; publishes the link to the relay | A | yes, on the E2E build (masked link otherwise, see above) |
| 04 | `04-join-with-code.yaml` + `04-let-in.yaml` | B opens the link → wrong code → `join.error` → right code → nick → submit → room in its waiting state (`room.waiting`, send disabled); A sees `chats.pending` + "Let in" on Chats home → taps it → opens the room | B then A | yes |
| 05 | `05-message-roundtrip.yaml` + `.peer.yaml` | A picks the 1 m composer timer (`room.timer` → `room.timer.60`), types and sends; B: waiting notice gone, bubble shows "Hold to read", body **not** visible, holds, body still not asserted, countdown shows, replies | A then B | yes |
| 11 | `11-verify-safety-number.yaml` + `.peer.yaml` | A: menu → Verify people → 60-digit safety number → published to the relay → mark verified → "Verified"; B: same number digit for digit (compared in the flow) → mark verified | A then B | yes |
| 06 | `06-file-view-once.yaml` + `.peer.yaml` | A: attach sheet, view-once already **on** (asserted, never tapped), picks a photo from the system picker, sends; own file row disabled. B: opens once (viewer behind `viewer.hold`, no share button), closes; the row is `enabled: false`, a tap opens nothing, still disabled after a relaunch | A then B | yes, except the system picker label (`Photo.*`) is confirmed on the first device run |
| 07 | `07-screenshot-notice.peer.yaml` (B first) + `07-screenshot-notice.yaml` | system screenshot on B → `room.notice` row on A, not a bubble | B then A | yes; the screenshot trigger runs outside Maestro (relay); see "Screenshots" |
| 08 | `08-burn.yaml` + `.peer.yaml` | A: menu (Panic row present) → burn → **cancel** → burn → confirm → room gone, still gone after relaunch; B: `room.ended` → back → no room, still gone after relaunch | A then B | yes |
| 10 | `10-settings-notifications.yaml` | Settings → Notifications on → OS prompt handled → switch `checked: true`, no error → relaunch keeps it → off again. Never asserts the token | 1 | needs a device that can mint a push token (tag `push`, `MAESTRO_PUSH=1` in the run script) |
| 09 | `09-panic-lock.yaml` | Chats → Settings → `panic` (single tap, no confirmation) → `locked.screen` ("Locked by Panic Exit"), Settings/Chats/room not visible → relaunch still locked → (optional) biometric unlock | 1 | yes; unlock only with `MAESTRO_BIOMETRIC=sim` |

Sub-flows in `flows/_common/`: `guest-home` (fresh install to Chats home), `back-to-chats`
(`room.back` when in a room, else Android back / iOS edge swipe, twice), `open-room` (tap the only
room if on Chats home).

Tags: `ios`, `android` (every flow runs on both), `single` (01, 02, 03, 09, 10: one device),
`two-device` with `device-a` / `device-b` (03 to 08, 11), `push` (10 only).

## Rules the flows follow

- **Never capture secret content.** No `takeScreenshot`, no `startRecording`, anywhere
  (`check-flows.mjs` fails the run otherwise). Assertions are `assertVisible`/`assertNotVisible`
  on **ids**; message text is only ever asserted **absent** (`assertNotVisible: <body>` before and
  after hold-to-read). The revealed state is never asserted on text. The viewer's preview is never
  held (06). Positive text assertions are on fixed UI copy only ("Hold to read", "Verified",
  "Locked by Panic Exit", "may have taken a screenshot"). The two values copied between devices are
  the invite link (03 → 04, through the in-memory relay, room burned by 08) and the safety number
  (11, made to be compared and not a secret). The push token is never rendered or asserted (10).
- **Fixture strings only** (test-plan §1.1): body `The launch code is 4471`, access code
  `blue-river-42`, nick `Sam Okonkwo`, room `qa-launch`. Rooms are throwaway: 1-hour timer, burned
  by flow 08 at the end of every run.
- **No dynamic data in ids.** `msg.<id>` is matched with the regex `msg\..+` and an `index`.
- Steps that depend on an id outside the contract are marked `TODO(testid)` and listed under
  "Proposed" in `TESTIDS.md`; `check-flows.mjs` prints them as "dry steps".

## Two devices

Maestro drives one device per flow. A two-device journey is two flows (`<nn>-<journey>.yaml` for
the device whose action names the journey, `<nn>-<journey>.peer.yaml` or `04-let-in.yaml` for the
other) run in order by `scripts/run-two-device.sh`, which also starts the **relay**
(`relay/server.mjs`, `127.0.0.1:4311`, in memory, prints nothing):

1. A runs `03`: `copyTextFrom: id: invite.link` → `runScript relay-put.js` publishes the link.
2. B runs `04`: `runScript relay-get.js` reads it (or takes `MAESTRO_ROOM_LINK` when set),
   rewrites `https://onepeek.io/…` to `onepeek://…` (simulators do not verify Universal Links;
   set `MAESTRO_UNIVERSAL_LINKS=1` on physical devices), then `openLink`.
3. The script alternates A and B for 04-let-in, 05, 11, 06, 07, 08, then 10 on A only with
   `MAESTRO_PUSH=1`, and finishes with 09 on A (it leaves A locked). 16 flows, 17 with 10.

The link carries the invite token, so: the script never echoes variables or enables `set -x`; the
relay keeps it in memory only; the room is burned by 08. See "What is never kept".

Environment (defaults in each flow's `env:`; `-e NAME=value` overrides):

| Variable | Used by | Default |
| --- | --- | --- |
| `MAESTRO_RELAY` | 03, 04, 07, 09, 11 | `http://127.0.0.1:4311` |
| `MAESTRO_PUSH` | run script: `1` runs 10 | `0` |
| `MAESTRO_DEVICE` | 07, 09 (which simulator the relay acts on) | set by the run script |
| `MAESTRO_ROOM_LINK` | 04 | empty → read from the relay |
| `MAESTRO_UNIVERSAL_LINKS` | 04 | `0` (rewrite to `onepeek://`) |
| `MAESTRO_ACCESS_CODE` | 03, 04 | `blue-river-42` |
| `MAESTRO_ROOM_NAME`, `MAESTRO_OWNER_NICK` | 03 | `qa-launch`, `qa-owner` |
| `MAESTRO_NICK` | 04 | `Sam Okonkwo` |
| `MAESTRO_BODY`, `MAESTRO_BODY2` | 05 | `The launch code is 4471`, `Got it` |
| `MAESTRO_EMAIL` | 02 | `qa-maestro@onepeek.io` (lead: replace with a real team inbox) |
| `MAESTRO_BIOMETRIC` | 09 | `skip` (`sim` asks the relay to accept the simulator biometric) |

## Screenshots (flow 07) and biometrics (flow 09)

Maestro cannot take a *system* screenshot (its `takeScreenshot` goes through the test driver, does
not fire the OS event, and would save the screen to disk) or answer a biometric prompt. The relay
does both on request (`POST /trigger`, allow-listed commands only):

- iOS screenshot: Simulator.app "Save Screen" (⌘S via `osascript`), which posts
  `UIApplicationUserDidTakeScreenshotNotification`. It targets the frontmost simulator, so B must
  be frontmost during 07 (the run script drives B right before). **To confirm on the first real
  run**; if ⌘S does not fire the notification on the installed Simulator version, 07 becomes a
  manual check (test-plan §4 M5).
- Android screenshot: `adb shell input keyevent KEYCODE_SYSRQ`. With `FLAG_SECURE` the image is
  **black**, and the app is told about it only on **Android 14+**
  (`Activity.registerScreenCaptureCallback`); on older Android the notice does not appear and 07 is
  a manual check there.
- Biometric: `xcrun simctl spawn <udid> notifyutil -p com.apple.BiometricKit_Sim.fingerTouch.match`
  / `adb -s <serial> emu finger touch 1`. Off by default (`MAESTRO_BIOMETRIC=skip`): 09 ends on the
  locked screen in CI.

## What is never kept

- The iOS Simulator saves "Save Screen" captures to the Desktop; the run script points it at a
  temp dir (`defaults write com.apple.iphonesimulator ScreenShotSaveLocation`) that the relay
  deletes after every trigger and the script deletes on exit. Android: the relay removes
  `/sdcard/Pictures/Screenshots/*` after the key event.
- Maestro writes a screenshot of the last screen on failure and keeps command logs (which include
  `inputText` values and env) under `~/.maestro/tests`. The run script uses `--debug-output` on a
  temp dir, deletes every `*.png`/`*.jpg`/`*.mp4` in it on exit, and deletes the dir unless
  `KEEP_DEBUG=1`. **CI must never upload `~/.maestro` or the debug dir as an artifact.** Maestro
  Cloud keeps screenshots and recordings of every step by default: see the trade-off below.

## Where to run (decision deferred to the lead; both written up)

Prerequisite for either: a development build from EAS (`eas build --profile development
--platform ios|android`, simulator-flavoured for iOS: `"ios": { "simulator": true }` in the
profile), so `EXPO_TOKEN` in CI secrets. Flows point at the production Supabase project with
throwaway rooms (test-plan §0.2).

### Option A: GitHub Actions, our own runners

- iOS on `macos-15` (arm64): `xcrun simctl boot` two iPhone simulators, install the `.app` from
  the EAS artifact on both, `curl -Ls https://get.maestro.mobile.dev | bash`, run
  `scripts/run-two-device.sh` with the two udids. Two-device flows work because both simulators
  are local. Cost: macOS minutes are 10× Linux; run nightly and on the Phase 1 PR, not per push.
- Android on `ubuntu-latest` with KVM (`sudo chown $USER /dev/kvm` after enabling via
  `udev` rule) and `reactivecircus/android-emulator-runner@v2` twice (two AVDs, API 34 for the
  screenshot callback), install the `.apk` on both, same script with the two serials.
- Both: `maestro test --include-tags single` first, then the two-device script; `--format junit`
  into the job summary; **no artifact upload** of Maestro output (see above). The proposed workflow
  is in the Q3/Q4 report (`.github/**` is lead-owned).

### Option B: Maestro Cloud

- `maestro cloud --apiKey "$MAESTRO_CLOUD_KEY" --app-file <app.zip|apk> apps/mobile/e2e/flows
  --include-tags single`. Runs 01, 02, 03 (without a peer) and 09 on their device farm; results in
  the Maestro console and as a PR check.
- **Limits:** one device per flow and no ordering across flows, so the two-device journeys
  (04 to 08) cannot run there; the relay is unreachable from their devices (the link would have to
  travel through Maestro Cloud's own env, which is logged); every step is screenshotted and kept on
  their servers, which for 05 and 06 means a revealed message or a view-once image stored off-site.
  That last point alone makes Option B unsuitable for anything beyond the `single` set unless the
  flows never reveal content, which 05 and 06 must. Recommendation: Option A for `two-device`,
  Option B at most as a quick `single` smoke.

## Local run (a Mac with Xcode, or a machine with Android Studio)

```sh
# one device, the single set
maestro test apps/mobile/e2e --include-tags single --include-tags ios   # or android

# two devices (same platform), e.g. two booted iOS simulators
xcrun simctl list devices booted              # pick the two udids
MAESTRO_DEVICE_A=<udid-a> MAESTRO_DEVICE_B=<udid-b> apps/mobile/e2e/scripts/run-two-device.sh
# Android: adb devices → serials (emulator-5554, emulator-5556)
# add MAESTRO_PUSH=1 when the devices can mint a push token (10)

# static check (no device): YAML, ids against TESTIDS.md, forbidden commands
node apps/mobile/e2e/scripts/check-flows.mjs
```

Seed one photo before 06: `xcrun simctl addmedia <udid> e2e-photo.png` /
`adb -s <serial> push e2e-photo.png /sdcard/Pictures/` then a media-scanner broadcast. The photo
is any PNG; it is never asserted on and the file is deleted by view-once.

## Report format

As test-plan §6.3: `maestro test …` → `N flows: N passed, 0 failed, 0 skipped (<device>, <OS>,
build <eas id>)`; dry steps (none today) are listed by id and flow, never counted as passed; a flow
excluded by tag (10 without a push-capable device) is listed as skipped, with the reason.
