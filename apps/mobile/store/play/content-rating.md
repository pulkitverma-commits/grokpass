# Content rating (IARC questionnaire): OnePeek 1.0

Owner: `release`. For the human at **Play Console → Policy → App content → Content rating → Start
questionnaire**. IARC computes the rating per territory (ESRB, PEGI, USK, ClassInd, ACB, GRAC, and
Google's generic rating for India and elsewhere) from the answers; nothing is chosen by hand. Answers
below describe the app as built on `mobile/integration` (2026-11-01). Questions are paraphrased; the
console's exact wording may differ. The questionnaire is re-done when a feature changes the answers (for
example, if voice messages are ever added).

| Section | Question (paraphrased) | Answer | Why |
| --- | --- | --- | --- |
| Email address | Contact for the rating certificate | `secret@onepeek.io` or the human's | required |
| Category | Which best describes the app | **"Social, Communication, or User-Generated Content"** (the IARC category for apps whose primary purpose is communication; not "Utility, Productivity, Communication, or Other" because the chat is the centre) | messaging app |
| Violence | Does the app contain violence, realistic or cartoon; references to violence | No | no content from the developer |
| Sexuality | Sexual content, nudity, suggestive content | No | |
| Language | Profanity, crude humour | No | |
| Controlled substances | Alcohol, tobacco, drugs references | No | |
| Gambling | Simulated gambling; real gambling; cash prizes | No | |
| Horror / scary | | No | |
| Crude humour, discrimination | | No | |
| Miscellaneous: **Does the app allow users to interact or exchange content with other users?** | | **Yes** | text, photos, files between members of a chat, end-to-end encrypted; the developer cannot moderate content; users can block members and report a chat |
| Miscellaneous: **Can users share their location with other users?** | | **No** | the app has no location permission; the one IP-derived city is shown to a one-time link sender, not shared between chat users, and not by the app |
| Miscellaneous: **Does the app allow users to purchase digital goods?** | | **No** | no in-app purchases; paid plans exist only on the website and the app never links to them |
| Miscellaneous: **Does the app contain unrestricted internet access (a browser)?** | | **No** | "Open in browser" opens a Chrome Custom Tab for a onepeek.io link only |
| Miscellaneous: **Does the app share the user's personal information with third parties?** | | **No** | processors only (Supabase, Vercel, FCM) |
| Miscellaneous: **Does the app contain advertising?** | | **No** | |
| Miscellaneous: **Is the app a web browser or search engine?** | | No | |
| Miscellaneous: **Does the app promote or facilitate…** (illegal activity, etc.) | | No | |

## Expected result

Apps whose only flag is "users can interact / exchange content" (unmoderated user communication)
typically rate **ESRB Teen** / **PEGI 12** or **PEGI 16** / **USK 12** / **Google generic: Rated for 12+**
or **16+**, depending on the current IARC matrix for "unrestricted interaction". Record what the
certificate says in `docs/mobile/log.md`. If it comes out lower than Teen, do not try to raise it by
changing answers; the answers are facts.

## Consistency checks

- The App Store age rating (`../app-store/listing.md`) answers the same facts; expected 13+ there.
- `target-audience.md` declares 18+ as the target audience regardless of the content rating: a
  content rating of Teen does not make the app "designed for" teens.
- If voice notes, stickers, link previews from third-party sites, or an in-app browser are added later,
  re-run the questionnaire before the release that ships them.
