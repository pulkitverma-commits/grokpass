# App Review notes for OnePeek 1.0

Owner: `release`. For the human to paste into **App Store Connect → 1.0 → App Review Information → Notes**
(4000 characters) and, with the platform wording swapped, into **Google Play Console → App content →
App access** (see the Play section at the end). Credentials, if any, go in the console's sign-in fields,
never in this repository. Placeholders are in `<angle brackets>`.

## Notes for the reviewer (paste this)

```
OnePeek is an end-to-end encrypted chat and one-time link app. Our servers hold only ciphertext and cannot read messages, files or link contents. A few behaviours are deliberate and may look unusual during review:

1. SIGN-IN IS OPTIONAL. Tap "Start a Quick Chat as a guest" on the sign-in screen. Every chat feature works for a guest (create a chat, invite, send text and photos, timers, burn). Sign in with Apple, Google or an email link is only needed if you want chats to follow your account. There is no password login, so there is no username/password demo account; the guest path and the invite link below are the review path. If you need an authenticated session, use Sign in with Apple with your own Apple ID; it creates an account with no further steps.

2. PHONE LOCK. The app locks on every cold start and after 60 seconds in the background, using Face ID / Touch ID with passcode fallback. The review device must have a passcode set; without one the app shows a warning ("This phone has no passcode…") and opens without a prompt. Nothing is ever wiped by failed unlock attempts.

3. HOLD TO READ. In a Secret Chat, another person's message is shown only while you press and hold it; release and it is hidden again. Your own messages are always visible. The timer under each message starts when it is first held ("once read") or when it was sent, as chosen when the chat was created. This is the product, not a bug.

4. SCREENSHOTS, HONESTLY. On iOS no app can block a screenshot. OnePeek detects one and tells everyone in the chat ("<name> may have taken a screenshot."); the screenshot itself shows what was on screen. While the screen is being recorded or mirrored, the chat is hidden behind a cover. The app switcher thumbnail shows a cover, not the chat. A faint watermark (viewer name, device code, time) is drawn over chats. On Android the window carries FLAG_SECURE, so screenshots and recordings come out black; this is why Android screenshots of chats fail during Play review. Store copy says exactly this and never claims iOS blocks screenshots.

5. DEMO FLOW (two devices or one device plus a browser)
   a. On the review device: open OnePeek, unlock, tap "Start a Quick Chat as a guest", then "New chat". Choose "Secret Chat", set an access code (at least 6 characters), keep the 30 s timer, "Create chat and invite". The invite sheet shows a QR code and a link.
   b. Counterpart: open https://onepeek.io/chat/join on a second device or in a desktop browser, paste the invite link (or scan the QR with the second phone's camera), enter the access code and a nickname. The chat owner (review device) sees "Guest … wants to join" → "Let in". Both sides can now send text; on the review device, press and hold the other side's message to read it; it disappears 30 s after it was first held.
   c. Alternatively we pre-create a Business Room and put its invite link and access code here: <INVITE LINK> / <ACCESS CODE>. Rooms end after at most 7 days, so if this link has expired, use step (a).
   d. One-time link: on https://onepeek.io create a text secret and copy its link (https://onepeek.io/s/<id>#<key>). Send it to the review device by iMessage or Notes and tap it: it opens in OnePeek (Universal Link), shows what kind of secret it is, and "Open" decrypts it on the phone. The link burns after one view. Or paste it into Safari on the phone; the same link opens in the app. Or long-press a link to share it to "OnePeek Share".
   e. Share into OnePeek: from Photos, share a photo to "OnePeek Share"; the share screen offers to encrypt and send it into an active chat or to turn it into a one-time link.

6. PERMISSIONS. Camera: to scan invite and secret QR codes (Scan button) and to take a photo to send in a chat; the image is encrypted on the phone before upload. Photo library: read-only, for pictures the user picks to send; they are encrypted before upload and the picker's temporary copy is deleted after the send. Face ID: to unlock the app. Notifications: optional; a notification carries only "You have a new message in a private chat." and never content, sender or room name. No location, contacts or microphone are used by any feature.

7. USER-GENERATED CONTENT. All content is end-to-end encrypted, so we cannot filter it. Users can block a member (room menu → member → Block, local to the phone), report a chat (room menu → "Report chat", a reason from a fixed list; only ids reach us), and the owner can remove members or burn the room. Contact: secret@onepeek.io.

8. ENCRYPTION. The app uses standard algorithms only (AES-GCM, HKDF, SHA-256, X25519, Ed25519; MLS RFC 9420 via the open-source ts-mls library and OpenSSL via react-native-quick-crypto). The export compliance questionnaire is answered in the app record.

9. Account deletion: <state where it is once built; see privacy-labels.md "Account deletion"; do not submit with "email us" as the only path>.
```

(About 3,700 characters; trim 5(c) if the room is not pre-created.)

## What the human must prepare before submitting

| Item | Where | Notes |
| --- | --- | --- |
| Review account decision | sign-in fields in App Review Information | Mark "Sign-in required: No" and point to the guest path. If Apple insists on credentials, the honest answer is that the app has no password login; options are (i) add an email **code** (OTP) sign-in to the app so a reviewer can use an inbox we forward to them, or (ii) rely on Sign in with Apple with the reviewer's own Apple ID. Decide before the first submission; agents cannot create the review account either way. |
| Pre-created Business Room | onepeek.io or a team phone | Create it on the day of submission (lifetime ≤ 7 days), keep the owner device signed in and the app open while review is expected so the owner can "Let in" the reviewer (owner-only admission, known-limitations 3). If nobody can babysit it, drop 5(c) and keep 5(a)/(b). |
| Counterpart on onepeek.io | the web app in production | The join page and secret viewer at onepeek.io must be live (they are). |
| Universal Links live | Vercel env `APPLE_TEAM_ID` set, `/.well-known/apple-app-site-association` returning the JSON | Reviewers tapping a link in Notes must land in the app, otherwise 5(d) falls back to the web viewer (still works, but the review note would be wrong). Checklist B3. |
| Contact details | App Review Information → Contact | A phone number Apple can call and `secret@onepeek.io` or the human's address. |
| Attachment (optional) | App Review Information → Attachment | A short screen recording of 5(a)–(b) made on a **non**-review device, or photos of the two phones. Never a screenshot of a held Secret message; it is what the product prevents from being useful. |

## Reviewer-facing wording that must stay consistent

- iOS: "detects a screenshot and tells the chat; hides the chat during recording or mirroring; cover in the app switcher".
- Android: "screenshots and recordings come out black (FLAG_SECURE); blank in the recent-apps switcher".
- Both: "no app can stop another camera; watermark; keys never leave the phone; servers hold ciphertext".
- Never: "blocks screenshots on iPhone", "unhackable", "military grade", "audited" (ts-mls is not).

## Google Play version of the notes (App content → App access)

Select **"All or some functionality is restricted"** only if Play insists; otherwise **"All functionality is
available without special access"** is true because the guest path needs no credentials. In the free-text
instructions reuse points 1, 3, 5 and 6, and replace point 4 with: "The app sets FLAG_SECURE on its window,
so screenshots and screen recordings of OnePeek are black and the recent-apps thumbnail is blank. This is
intentional and applies to the whole app, including the sign-in screen. Use a second device to photograph
the screen if evidence is needed." Point 7 satisfies Play's User Generated Content policy (reporting,
blocking, contact). Point 2 (device lock) applies unchanged.
