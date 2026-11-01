# App Store listing: OnePeek 1.0 (English, U.S. as primary locale)

Owner: `release`. Draft for the human to paste into App Store Connect (**App Store → iOS App → 1.0 Prepare
for Submission** and **App Information**). Every sentence below is true of the build on `mobile/integration`
as of 2026-11-01; the honest-copy rule in `apps/mobile/store/README.md` applies (iOS never "blocks"
screenshots). Character limits are Apple's as of the date above; check the field counter in the console.

## App Information (set once per app)

| Field | Value | Limit |
| --- | --- | --- |
| Name | `OnePeek` | 30 |
| Subtitle | `Encrypted chats that vanish` | 30 (27 used) |
| Primary category | Social Networking | |
| Secondary category | Utilities | |
| Bundle ID | `io.onepeek.app` (from the App ID registered in checklist A3) | |
| SKU | `onepeek-ios-1` (checklist B6) | |
| Primary language | English (U.S.) | |
| Content rights | "No, it does not contain, show, or access third-party content" (user content is the users' own; no licensed third-party content) | |
| Age rating | see "Age rating answers" below | |
| Privacy Policy URL | `https://onepeek.io/privacy` (needs the additions in `docs/mobile/release/privacy-policy-additions.md` published first) | |
| License agreement | Apple's standard EULA | |

Subtitle alternatives if the first is rejected or disliked: `Hold to read. Then it's gone.` (29),
`Private chats, hold to read` (27), `End-to-end encrypted chat` (25).

Category note: the website positions OnePeek as one-time password and file sharing for teams; the app's
centre is Secret Chat. Social Networking is where messaging apps sit and where reviewers expect
user-to-user communication features (block, report) to be present, which the app has. If the human
prefers to lead with the one-time links, swap to Primary **Utilities**, Secondary **Social Networking**.

## Version information (per version)

### Promotional text (170 characters, editable without a new build)

`End-to-end encrypted chats and one-time links. Hold to read, messages vanish on a timer, burn a chat in one tap. OnePeek never sees a word.`

(157 characters.)

### Description (4000 characters)

```
OnePeek is a private chat and one-time link app built so there is nothing left to leak.

END-TO-END ENCRYPTED
Messages, photos and files are encrypted on your phone before they are sent, using the Messaging Layer Security standard (MLS, RFC 9420). The keys stay in your phone's secure storage. OnePeek's servers only ever hold ciphertext and cannot read what you share.

HOLD TO READ
In a Secret Chat, a message from someone else is shown only while you press and hold it. Let go and it is hidden again. Message previews stay hidden until held, and the keyboard's autocorrect and personal dictionary are switched off while you type.

MESSAGES THAT VANISH
Pick a timer from 10 seconds to days. The timer can start when a message is read or the moment it is sent. Chats end after an hour, a day or a week, and you can burn a whole chat, for everyone, in one tap.

THREE KINDS OF CHAT
• Quick Chat: share a link and talk. Messages vanish a minute after they are read.
• Secret Chat: adds an access code, hidden previews and a 30-second default timer.
• Business Room: invite only. You approve each person and can verify identities with a safety number or QR code.

SCREEN PROTECTION, HONESTLY DESCRIBED
On iOS a screenshot cannot be blocked by any app. OnePeek is told when one is taken and tells everyone in the chat. While the screen is being recorded or mirrored, the chat is hidden behind a cover. The app shows a cover instead of your chats in the app switcher. A faint watermark with the viewer's name, device and time sits over every chat, so a photo of the screen shows who was looking. No app can stop another camera.

LOCKED ON YOUR PHONE
OnePeek locks with Face ID, Touch ID or your passcode on every cold start and after a minute in the background. Panic Exit locks it instantly. Chat keys and messages are never backed up to iCloud.

ONE-TIME LINKS
Send a password, Wi-Fi details, a photo or a file as a link that burns after one view. The decryption key lives after the # in the link, which never reaches our servers. Open a link someone sent you straight in the app. Share from Photos, Files or Safari into OnePeek to encrypt and send.

GUESTS WELCOME
Join a chat from an invite link without creating an account. Sign in with Apple, Google or an email link when you want your chats to follow you.

WHAT THE SERVER SEES
Ciphertext, device ids and timers. No message text, no file names, no nicknames, no keys. Push notifications carry no content: just "You have a new message in a private chat."

Honest limits, so you can decide for yourself: OnePeek cannot stop a camera pointed at the screen; photos keep their embedded details (such as location) unless your phone removes them; a third-party keyboard still sees what you type; and the encryption library we use (ts-mls) has not yet had an independent security audit. Details: onepeek.io/secret-chat.

OnePeek is free. Questions: secret@onepeek.io
```

(About 2,900 characters.) Do not add "blocks screenshots" or "unhackable" anywhere; do not mention Plus
or Pro plans (the app has no purchases, and naming web-only paid tiers invites a guideline 3.1.1 question).

### Keywords (100 characters, comma-separated, no spaces, no duplicates of the name)

`secret,chat,encrypted,private,messenger,vanish,disappearing,burn,one-time,link,password,share,e2ee`

(99 characters.) Alternatives to rotate in later: `ephemeral`, `mls`, `wifi`, `secure`.

### URLs

| Field | Value |
| --- | --- |
| Support URL | `https://onepeek.io` |
| Marketing URL | `https://onepeek.io/secret-chat` |
| Privacy Policy URL | `https://onepeek.io/privacy` (App Information) |
| Copyright | `© 2026 OnePeek` (or the legal entity name once the entity question in the checklist is answered) |

### What's New in This Version (1.0, 4000 characters)

```
First release of OnePeek for iPhone.

• End-to-end encrypted Quick, Secret and Business chats
• Hold to read, timers from 10 seconds, burn a chat in one tap
• Face ID / Touch ID lock, Panic Exit, no cloud backups of chat data
• Screenshot notices and a recording cover (iOS cannot block screenshots; we say so)
• One-time links for passwords, Wi-Fi details, photos and files, opened right in the app
• Share into OnePeek from Photos, Files and Safari
• Join as a guest from an invite link, or sign in with Apple, Google or an email link
```

### App Review Information

Fill from `review-notes.md`. Sign-in is **not** required to use the app (guest path), and the notes say so.

## Age rating answers

Apple replaced the old 4+/9+/12+/17+ matrix in 2025 with a questionnaire whose result Apple computes
(4+, 9+, 13+, 16+, 18+). Answer the questions as follows; the computed rating is whatever the console
shows, record it in the log. Expected outcome: **13+** (unmoderated user-to-user messaging; compare
Signal), possibly 16+ if Apple weights "user-generated content" higher. Do not pick a rating by hand to
look better.

| Question (wording may differ slightly) | Answer | Why |
| --- | --- | --- |
| Cartoon or fantasy violence; realistic violence; prolonged graphic violence | None | No such content from the app |
| Profanity or crude humour | None | |
| Mature/suggestive themes; sexual content or nudity | None | |
| Horror/fear themes | None | |
| Medical/treatment information | None | |
| Alcohol, tobacco, or drug use or references | None | |
| Simulated gambling; gambling | No | |
| Contests | No | |
| Unrestricted web access | **No** | The app opens no web browser inside itself. "Open in browser" hands a onepeek.io link to Safari (iOS) and nothing else. |
| User-generated content | **Yes** | Chat messages, photos, files and nicknames are user content, end-to-end encrypted. Users can **block a member** (local to the phone) and **report a chat** (ids only reach the server) from the room menu, and the owner can remove members and burn the room. Guideline 1.2 asks for filtering, reporting, blocking and contact information; filtering of encrypted content is impossible and the notes say so. |
| Messaging and chat features | **Yes** | It is a messaging app. Users can message anyone who has the invite link; there is no public discovery or directory. |
| Does the app share the user's location with others | No | The app reads no location (no location permission). |
| Parental controls / age assurance | None | |
| Loot boxes, in-app purchases | None | No purchases in the app |
| Made for Kids | No | |

If Apple's console still shows the older rating matrix, the equivalent answers are: everything "None", Unrestricted Web Access "No", Gambling and Contests "No"; expected 12+ under the old scheme for an unfiltered messaging app (Apple used to put chat apps at 12+ or 17+).

## Things the human must decide before pasting

1. Entity name for the copyright line and the seller name (checklist, open question 1).
2. Primary category (Social Networking vs Utilities), see note above.
3. Whether to localise. Everything above is English only; the app itself ships English only.
