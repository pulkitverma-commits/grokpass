# Google Play Data safety form: OnePeek 1.0

Owner: `release`. For the human to enter at **Play Console → Policy → App content → Data safety**. Same facts
as `../app-store/privacy-labels.md` (read that first; it cites the code). Google's definitions differ from
Apple's in three places that matter here, so the answers are not a copy:

- Google counts data as **collected** when it is transmitted off the device, **but** exempts (per the Data
  safety help, "Data collection" exceptions, as last read on 2026-11-01; re-read the help text in the console
  on the day): *ephemeral processing* (held in memory only as long as needed for the request), and
  *end-to-end encrypted transfers between users where the developer cannot read the data*. OnePeek's
  messages, files and one-time secrets fall under the second exemption, so they are **not declared**.
  **Judgement call for the adviser**: confirm the current wording of that exemption.
- Google asks per data type whether it is **required or optional** for the user, and whether it is
  **shared** with third parties (processors acting on the developer's behalf, such as Supabase and
  Vercel, are **not** "sharing"; a push transport is also a processor).
- Google asks separately whether **all data is encrypted in transit** and whether users can **request
  deletion**.

**Draft for a human adviser, not legal advice.**

## Overview questions

| Question | Answer | Why |
| --- | --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** | Email, user ids, device ids (below). |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | HTTPS/TLS to onepeek.io and Supabase only; `lib/chat.ts` refuses a Supabase URL that is not `https://<ref>.supabase.co`; the mobile ESLint config forbids `fetch` to any other host. |
| Do you provide a way for users to request that their data is deleted? | **Yes**, and the console will ask for the mechanism/URL | Today: sign out (deletes the push token server-side, wipes local keys), "Reset chats on this phone", chat timers delete ciphertext, one-time links burn. **Account deletion:** only by email today (privacy policy). Google's account-deletion requirement (effective 2024 for apps with account creation) wants a **web URL where users can request deletion of the account and associated data, usable without the app**. **Open item for the web owner:** publish `https://onepeek.io/account/delete` (or similar) that deletes the account and its rows after sign-in, and link it from the app's Settings. Until then, enter the privacy-policy URL and the support email and expect a policy warning. |
| Does your app allow users to create an account? | **Yes** (Google, email link; Apple on iOS only) | Triggers the account-deletion fields above. |
| Is your app an eligible health app / Does it target children? | No | |

## Data types

For each: Collected? Shared? Ephemeral? Required or optional? Purposes.

### Personal info

| Type | Collected | Shared | Optional | Purposes | Notes |
| --- | --- | --- | --- | --- | --- |
| Email address | **Yes** | No | **Optional** (guests never give one) | App functionality, Account management | Supabase Auth account email; also the viewer email typed to receive a 6-digit code for a recipient-locked one-time link (used to send the code; the server keeps a hash of the code). |
| Name | No | | | | Nicknames are end-to-end encrypted control messages; the room name stays on the device. |
| User IDs | **Yes** | No | Required (an anonymous Supabase user id is created even for guests) | App functionality, Account management | `auth.uid()` owns chat devices, push tokens, reports and (signed-in senders) one-time secrets. |
| Address, Phone number, Race, Political/religious beliefs, Sexual orientation, Other personal info | No | | | | Never asked. |

### Financial info

Not collected (no purchases, no payment info).

### Health and fitness

Not collected.

### Messages

| Type | Collected | Why |
| --- | --- | --- |
| Emails, SMS or MMS | No | |
| Other in-app messages | **No, under the end-to-end encryption exemption** | Message text, attachments, file names, reactions and nicknames are encrypted on the device with MLS (RFC 9420) and the server stores ciphertext it cannot read, deleted on the room timer. If the adviser decides the exemption does not apply, declare "Other in-app messages: collected, not shared, required, App functionality" and add a sentence to the policy saying it is ciphertext. |

### Photos and videos / Audio files / Files and docs

| Type | Collected | Why |
| --- | --- | --- |
| Photos, Videos | No (same exemption) | Picked media is encrypted on the device before upload; the plaintext picker copy is deleted after the send. |
| Voice or sound recordings, Music files, Other audio | No | No audio feature. The `RECORD_AUDIO` permission added by two config plugins is unused; see `permissions.md`. |
| Files and docs | No (same exemption) | Documents picked from Files are encrypted on the device; one-time link files likewise (AES-256-GCM, key in the link). |

### Calendar, Contacts

Not collected (no permission, no feature).

### App activity

| Type | Collected | Why |
| --- | --- | --- |
| App interactions, In-app search history, Installed apps, Other user-generated content, Other actions | No | No analytics SDK (ESLint forbids one). "Report chat" sends a room id and a reason from a fixed list; that is covered under User IDs / Device IDs, not content. |

### Web browsing

Not collected (no in-app browser; "Open in browser" launches a Chrome Custom Tab on onepeek.io only).

### App info and performance

| Type | Collected | Why |
| --- | --- | --- |
| Crash logs | No | No crash reporter; Google Play's own vitals are Google's collection, not the app's, and are excluded by Google's rules. |
| Diagnostics | No | |
| Other app performance data | No | |

### Device or other IDs

| Type | Collected | Shared | Optional | Purposes | Notes |
| --- | --- | --- | --- | --- | --- |
| Device or other IDs | **Yes** | No | Partly optional | App functionality | (1) **FCM device push token** (`push_devices.token`), registered through `register_push_device` only if the user turns notifications on (optional), deleted on sign-out, reset and when FCM reports it dead; the server uses it to send the fixed text "You have a new message in a private chat." through Firebase Cloud Messaging (Google is the transport; a processor, not a third party receiving data for its own use). (2) **Chat device id** (server-assigned UUID for this phone's MLS signing key) with the label `"<model> · Android <version>"` (never the user's device name), so users can see and revoke their phones in Settings → Devices (required for chat). (3) **Free-quota client id** for one-time links: a random id in the Android Keystore-backed SecureStore, sent as `p_client_id` when a link is created so the free quota can be counted per install; wiped on sign-out and reset; not tied to an account (known-limitations 13). No advertising id, no IMEI, no Android ID is read. |

### Location

| Type | Collected | Why |
| --- | --- | --- |
| Approximate location | **Yes, in one case; not shared; optional** | The app reads no location (no permission). When a sender created a one-time link **on the website** with "Show me where it's opened" on, the server derives the viewer's **city from the viewer's IP address** at open time (`app/api/open/route.ts`) and shows it to the sender; a link opened in the app goes through the same call. Declare as Approximate location, App functionality, not shared. Purpose text: "shown to the sender of a one-time link who opted in; the viewer sees a notice" — the notice exists on the web viewer and **not yet in the app's viewer** (open item for mobile-ui; see privacy-labels.md). If the adviser reads Google's "derived from IP for the request only" guidance as exempting this, it may be dropped; it is stored with the secret's open record, so it is declared here. |
| Precise location | No | |

## Data usage and handling: purpose wording the console accepts

For every "Yes" above select **App functionality** (and **Account management** for email and user id).
Never select Analytics, Advertising or marketing, Fraud prevention/security/compliance (the quota id is
not fraud prevention in Google's sense; if the adviser prefers it there, say so), Personalization or
Developer communications.

## Third parties and SDKs (the console's "Does your app share…" per type)

None of the declared data is **shared** in Google's sense. Processors: Supabase (database, auth, storage,
realtime), Vercel (API routes, request logs), Firebase Cloud Messaging (push transport, token and fixed
text only; Firebase Analytics is **disabled** in the Firebase project per checklist B2 and no Firebase SDK
other than the FCM client config is in the app). SDK index: the app uses the Expo SDK (open source, no
telemetry when `expo-insights` and `expo-updates` are absent, which the ESLint guard enforces) and the
Supabase JS client. Google may auto-detect SDKs from the AAB; if it lists one that reports "collects data",
reconcile against this file before accepting.

## Security practices section (shown on the store)

- Data is encrypted in transit: Yes.
- You can request that data be deleted: Yes (with the account-deletion URL once it exists).
- Independent security review: **do not tick**. `ts-mls` has had no independent audit and neither has the
  app; the listing says so.
- Committed to the Play Families policy: No (18+).

## Questions for the adviser

1. Confirm the end-to-end-encryption exemption wording in Google's Data safety help still covers
   ciphertext the developer stores (not just relays).
2. Confirm "Approximate location" must be declared for the sender-opt-in IP city, or may be omitted.
3. Account deletion: confirm that a web page is required (Google's policy) and that "email us" fails it.
