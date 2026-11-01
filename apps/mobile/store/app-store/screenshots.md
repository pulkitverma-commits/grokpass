# App Store screenshots: requirements and shot list

Owner: `release`. Screenshots can only be taken once a store build exists (TestFlight or a `preview`
build on a registered phone). Nothing in this file is a screenshot; it is the plan. The folder
`apps/mobile/store/screenshots/` (empty until then) receives the files, named as in the table below.

## Hard rules

1. **No real secret content ever appears.** Every message, file name, nickname, code and link in a shot
   is staged fixture text (use the strings from `docs/mobile/test-plan.md` §1.1 only if they are harmless
   in public; otherwise invent clearly fake content such as "Wi-Fi: Cafe-Guest / password: demo-only").
2. **The iOS screenshot of a held Secret message is taken on a phone we control**, in a room whose other
   member is another phone we control. On iOS the screenshot works (and the other phone will show the
   "may have taken a screenshot" notice, which is the honest demonstration). On Android screenshots are
   black by design, so Android shots are taken with the **`preview` or `development` profile only if the
   lead supplies a build flag that lifts FLAG_SECURE**; today no such flag exists and the policy is
   "never allow", so **Android store screenshots are composed from the iOS captures in a device frame**
   or from a screen recording of the simulator (no simulator on this Mac; see below) or photographed.
   Do not add an `allowScreenCaptureAsync` call for marketing (W1-4).
3. Dark mode only (`userInterfaceStyle: 'dark'`); status bar set to 9:41, full battery, no carrier name.
4. No reviewer, tester or real email address visible. Settings shots use a guest session or a
   `demo@example.com`-style account made for the purpose.
5. The watermark (`<name> · <code> · <time>`) will be visible on held content; that is fine and honest.

## Required sizes (App Store Connect, 2026-11-01)

| Display | Pixels (portrait) | Required? | Devices that produce it |
| --- | --- | --- | --- |
| iPhone 6.9" (iPhone 16 Pro Max / 17 Pro Max class) | 1320 × 2868 (or 1290 × 2796 for 6.7") | **Yes**: Apple requires one set for the largest iPhone size; 6.9" shots are scaled to the smaller classes if 6.7"/6.5" are not uploaded | iPhone 16 Pro Max, 17 Pro Max |
| iPhone 6.7" | 1290 × 2796 | Optional if 6.9" is uploaded (Apple scales down) | iPhone 15 Plus, 16 Plus, 14 Pro Max |
| iPhone 6.5" | 1284 × 2778 / 1242 × 2688 | Optional | iPhone 11 Pro Max, XS Max |
| iPhone 6.1" | 1179 × 2556 (16/15/14 Pro) | Optional, recommended because it is the most common phone | iPhone 15, 16, 17 |
| iPhone 5.5" | 1242 × 2208 | Optional (older devices) | iPhone 8 Plus |
| iPad | any | **Not applicable**: `ios.supportsTablet: false`, so App Store Connect does not ask for iPad shots | |
| Apple Watch, Mac, Apple TV, Vision | | Not applicable | |

Apple accepts up to **10** screenshots per size; 3 to 5 is enough for 1.0. Optional app preview videos
(15–30 s) are skipped for 1.0: a recording of a Secret room shows the cover on iOS (N2) and black on
Android, which is correct behaviour but makes a poor preview; a recording of the Welcome → New chat →
invite flow is possible later if wanted.

**Verify the pixel sizes in App Store Connect on the day**; Apple changes the accepted list with each
iPhone generation. Upload the exact pixel size of the device used; do not resize.

## Shot list (same order on both stores)

| # | File name | Screen | Staged content | Caption (optional overlay text, ≤ 6 words) |
| --- | --- | --- | --- | --- |
| 1 | `01-welcome.png` | Welcome | The three lines as built: "End-to-end encrypted. OnePeek can't read a word.", "Hold to read. Screenshots blocked or flagged.", "Messages vanish on a timer. Burn a chat any time." | none (the screen is the caption) |
| 2 | `02-new-chat.png` | New chat | Secret Chat selected, 30 s timer, "once read", 1 day, an access code field with dots | "Pick how private" |
| 3 | `03-invite.png` | Invite sheet | QR code and the **masked** link (the app masks it unless the `e2e` profile is used; keep it masked) | "Invite with a link or QR" |
| 4 | `04-secret-room-held.png` | Room (Secret) | Two or three fixture messages; one from the other side **held**, showing the text and the watermark; others hidden | "Hold to read" |
| 5 | `05-secret-room-hidden.png` | Room (Secret) | Same room, nothing held: hidden bubbles with timers | "Let go, it's hidden" |
| 6 | `06-locked.png` | Locked screen | Face ID icon, "Unlock OnePeek" | "Locked on your phone" |
| 7 | `07-settings-protection.png` | Settings | The "Screen protection" row (iOS: "Screenshots reported to the chat; recordings hidden" / Android: "Screenshots and recordings blocked in chats") and the protection paragraph | none; the honest copy is the point |
| 8 | `08-secret-viewer.png` | One-time link viewer (`/s/<id>`) | Peek state of a staged text secret: "Open" button, kind and expiry; never the opened content | "Open one-time links in the app" |
| 9 | `09-share-sheet.png` | iOS share sheet with "OnePeek Share" | Photos share sheet; the photo is a stock-style harmless image | "Share from Photos or Files" |

Shots 4 and 5 **must** be taken on iOS (the only platform where a screenshot of a room succeeds). For the
Play Store, reuse 1–8 (Android frames) and replace 9 with the Android share sheet photographed, or omit it.

## How to produce them without a simulator on this Mac

- Install the TestFlight (or `preview`) build on an iPhone 16 Pro Max or 17 Pro Max and on an iPhone 16/17
  (6.1"). Take screenshots with the hardware buttons; AirDrop them to the Mac.
- If no large phone is available: EAS can build `development-simulator`, but there is no simulator on this
  Mac. Ask a team member with Xcode to run the simulator build (`eas build --profile development-simulator`)
  and capture 6.9" and 6.1" from the simulator (Cmd-S saves the exact pixel size).
- Never use a reviewer's or customer's phone.

## Play Store equivalents (for `play/listing.md`)

- Phone screenshots: 2 to 8, 16:9 or 9:16, each side 320–3840 px; PNG or JPEG, ≤ 8 MB. The iOS 6.1"
  captures reframed in a generic Android device frame satisfy this; mark them as illustrative if the
  frame is not a real Android capture (Google does not require the frame to be of a real device, but the
  UI shown must be the app's UI, which it is).
- Feature graphic: **1024 × 500**, required. Compose from the app icon on `#0A0C0F` with the subtitle.
- App icon: 512 × 512 PNG (from `public/icon-512.png`, already the source of the app icons).
- Tablet screenshots: not required if the app is not opted into tablets; the AAB will install on tablets
  unless the lead restricts it, so Play may ask for 7" and 10" shots; answer with the phone shots scaled
  or restrict the form factor in the console.
