# Google Play listing: OnePeek 1.0 (en-US default)

Owner: `release`. For the human to paste into **Play Console → Grow → Store presence → Main store listing**
and **Store settings**. Same facts and honest-copy rule as the App Store listing; Android wording differs
only where the platform does (Android really does block screenshots in the app; FLAG_SECURE).

## Store settings

| Field | Value |
| --- | --- |
| App name | `OnePeek` (30 max) |
| App or game | App |
| Free or paid | Free |
| Category | Communication |
| Tags (optional, up to 5) | Messaging, Privacy, Encryption, File sharing |
| Email address (shown publicly, required) | `secret@onepeek.io` |
| Phone (optional) | human's choice |
| Website | `https://onepeek.io` |
| External marketing | leave on (default) unless the human prefers off |
| Privacy policy URL (App content → Privacy policy) | `https://onepeek.io/privacy`, after `docs/mobile/release/privacy-policy-additions.md` is published |

## Main store listing

### Short description (80 characters)

`End-to-end encrypted chats that vanish. Hold to read. One-time links. No tracking.`

(79 characters.)

### Full description (4000 characters)

```
OnePeek is a private chat and one-time link app built so there is nothing left to leak.

END-TO-END ENCRYPTED
Messages, photos and files are encrypted on your phone before they are sent, using the Messaging Layer Security standard (MLS, RFC 9420). The keys stay in your phone's secure hardware-backed storage. OnePeek's servers only ever hold ciphertext and cannot read what you share.

HOLD TO READ
In a Secret Chat, a message from someone else is shown only while you press and hold it. Let go and it is hidden again. Message previews stay hidden until held, and autocorrect and the keyboard's personal dictionary are switched off while you type.

MESSAGES THAT VANISH
Pick a timer from 10 seconds to days. The timer can start when a message is read or the moment it is sent. Chats end after an hour, a day or a week, and you can burn a whole chat, for everyone, in one tap.

THREE KINDS OF CHAT
• Quick Chat: share a link and talk. Messages vanish a minute after they are read.
• Secret Chat: adds an access code, hidden previews and a 30-second default timer.
• Business Room: invite only. You approve each person and can verify identities with a safety number or QR code.

SCREENSHOTS AND RECORDINGS BLOCKED
On Android, screenshots and screen recordings of OnePeek come out black, casting shows black, and the app is blank in the recent-apps switcher. The app shows a cover instead of your chats while it is in the background. A faint watermark with the viewer's name, device and time sits over every chat, so a photo of the screen shows who was looking. No app can stop another phone's camera, and we don't claim to.

LOCKED ON YOUR PHONE
OnePeek locks with your fingerprint, face unlock or screen-lock PIN on every cold start and after a minute in the background. Panic Exit locks it instantly. Chat keys and messages are excluded from Android backups and device-to-device transfers.

ONE-TIME LINKS
Send a password, Wi-Fi details, a photo or a file as a link that burns after one view. The decryption key lives after the # in the link, which never reaches our servers. Open a link someone sent you straight in the app. Share from Photos, Files or your browser into OnePeek to encrypt and send.

GUESTS WELCOME
Join a chat from an invite link without creating an account. Sign in with Google or an email link when you want your chats to follow you.

WHAT THE SERVER SEES
Ciphertext, device ids and timers. No message text, no file names, no nicknames, no keys. Notifications carry no content: just "You have a new message in a private chat."

Honest limits, so you can decide for yourself: OnePeek cannot stop a camera pointed at the screen; a rooted phone or custom ROM may not honour the screenshot block; photos keep their embedded details (such as location) unless your phone removes them; a third-party keyboard still sees what you type; and the encryption library we use (ts-mls) has not yet had an independent security audit. Details: onepeek.io/secret-chat.

OnePeek is free and has no ads, no analytics and no trackers. Questions: secret@onepeek.io
```

(About 2,900 characters.) "Sign in with Apple" is omitted on Android: the button is hidden there
(`appleAvailable` is false off iOS). Do not name Plus/Pro web plans.

### Graphics

| Asset | Spec | Source |
| --- | --- | --- |
| App icon | 512 × 512 PNG, ≤ 1 MB | `public/icon-512.png` (same source as the app icons) |
| Feature graphic | 1024 × 500 JPEG/PNG, required | compose: icon on `#0A0C0F`, subtitle text; no device frame needed |
| Phone screenshots | 2–8, 16:9 or 9:16, 320–3840 px per side | shot list in `../app-store/screenshots.md`; Android captures are black by design (FLAG_SECURE), so the images are composed from iOS captures or photographed; the UI shown must be the app's |
| 7" / 10" tablet screenshots | only if the console demands them | phone shots scaled, or restrict form factors |
| Promo video | optional, skip for 1.0 | |

### Release notes for 1.0 (500 characters per language, Production → Release → Release notes)

```
<en-US>
First release of OnePeek for Android.
• End-to-end encrypted Quick, Secret and Business chats
• Hold to read, timers from 10 seconds, burn a chat in one tap
• Screenshots and recordings blocked in the app; blank in recent apps
• Fingerprint / face / PIN lock, Panic Exit, no backups of chat data
• One-time links for passwords, Wi-Fi details, photos and files
• Share into OnePeek from Photos, Files and your browser
• Join as a guest from an invite link, or sign in with Google or an email link
</en-US>
```

(About 470 characters; the console counts them.)

## App content declarations (Policy → App content), pointers

| Declaration | Answer | File |
| --- | --- | --- |
| Privacy policy | `https://onepeek.io/privacy` | `docs/mobile/release/privacy-policy-additions.md` |
| App access | All functionality available without special access (guest path); instructions from the review notes | `../app-store/review-notes.md`, Play section |
| Ads | No, the app contains no ads | |
| Content rating | IARC questionnaire | `content-rating.md` |
| Target audience and content | 18+ | `target-audience.md` |
| News app | No | |
| COVID-19 contact tracing / status | No | |
| Data safety | per data type | `data-safety.md` |
| Government apps | No | |
| Financial features | No | |
| Health | No | |
| Account deletion URL (inside Data safety) | **missing today**: see `data-safety.md` | |
