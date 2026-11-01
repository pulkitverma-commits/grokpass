# App Privacy ("nutrition label") answers for OnePeek 1.0

Owner: `release`. For the human to enter at **App Store Connect → App → App Privacy**. Every line is derived
from code on `mobile/integration` (2026-11-01): `apps/mobile/lib/chat.ts`, `apps/mobile/lib/secrets.ts`,
`packages/core/src/secrets.ts`, `app/api/open/route.ts`, `supabase/migrations/006_secret_chat.sql`,
`008_mobile_push_tokens.sql`, `009_chat_reports`, `apps/mobile/eslint.config.mjs` (telemetry ban) and
`docs/secret-chat/known-limitations.md`. Apple's definitions: data is **collected** when it is
transmitted off the device in a way that lets the developer or partners access it for longer than needed
to service the request; **linked** when it is tied to the user's identity (account); **tracking** means
linking with third-party data for advertising or sharing with data brokers.

**Draft for a human adviser, not legal advice.** Two judgement calls (ciphertext as "not collected",
the push token as a Device ID) are marked below and should be confirmed before submission.

## Summary answer

**Do you or your third-party partners collect data from this app?** Yes.

**Tracking.** No. The app contains no advertising SDK, no analytics SDK and no crash reporter (the
mobile ESLint config fails the build on any import of Sentry, Crashlytics, Firebase Analytics, Mixpanel,
Amplitude, PostHog, Segment, Datadog, Bugsnag, `expo-insights`); nothing is shared with data brokers;
`NSUserTrackingUsageDescription` is absent and App Tracking Transparency is never requested.

## Per data type

Apple's label groups data as "Linked to You" / "Not Linked to You" / "Used to Track You". For each type
below: whether it is collected, the purposes, and whether it is linked.

### Collected, linked to the user's identity

| Data type | Collected? | Purpose | Linked | Why / where in code |
| --- | --- | --- | --- | --- |
| **Contact Info → Email Address** | Yes (only for users who sign in with email, Google or Apple; guests give none) | App Functionality (sign in, account) | Linked | Supabase Auth stores the account email (`auth.users`). Sign in with Apple may deliver Apple's private relay address instead; that is still an email address for this label. The web privacy policy already lists "Account details (optional)". Recipient-locked one-time links ask the viewer for an email to receive a 6-digit code (`/api/unlock/send`); the server keeps a hash of the code, and the email is used to send it. |
| **Identifiers → User ID** | Yes | App Functionality | Linked | The Supabase user id (`auth.uid()`) owns chat devices (`chat_devices.owner`), push tokens (`push_devices.owner`), reports and, for signed-in senders, the one-time secrets they create. Guests get an anonymous Supabase user id too (`signInAnonymously`); it is an account identifier even without an email, so it is declared here. |
| **Identifiers → Device ID** | Yes | App Functionality | Linked | Three app-generated identifiers reach the server and are stored against the account: (1) the **APNs device push token** (`push_devices.token`, registered through `register_push_device`, deleted on sign-out, reset and when APNs reports it dead; it is how a content-free "You have a new message in a private chat." notification reaches the phone); (2) the **chat device id** (`chat_devices.id`, a UUID the server assigns to this phone's MLS signing key) and its **device label** `"<model> · <OS> <version>"` (for example `iPhone 15 · iOS 18.1`; never the user-typed device name, `lib/chat.ts` `deviceLabel()`), shown to the user under Settings → Devices so they can revoke a phone; (3) the **quota client id** for free one-time links, see the next table (not linked). **Judgement call:** Apple's examples for Device ID are the advertising identifier and "other device-level ID"; a push token is a device-level identifier the developer stores, so it is declared here rather than left out. The adviser may prefer "Other Data Types"; either way it is disclosed. |

### Collected, not linked to identity

| Data type | Collected? | Purpose | Linked | Why / where in code |
| --- | --- | --- | --- | --- |
| **Identifiers → Device ID** (second entry if the console allows one per linkage; otherwise fold into the row above and describe both) | Yes | App Functionality | Not linked | The **free-quota client id** (`onepeek.client` in the keychain, this device only, `lib/secrets.ts`): a random 16–64 character id sent as `p_client_id` when a one-time link is created, so the free quota can be counted per install without an account. It is not tied to an account (it is sent even for signed-out users and is wiped on sign-out and "Reset chats on this phone"); OnePeek can tell that two secrets came from the same install between wipes, nothing more (known-limitations 13). |
| **Location → Coarse Location** | Yes, in one case | App Functionality | Not linked to the viewer | The app never reads device location (no `expo-location`, no location permission). But when a sender created a one-time link **on the website** with "Show me where it's opened" turned on, the server (`app/api/open/route.ts`, `p_source: 'network'`) records the **city-level location derived from the viewer's IP address** (Vercel's `x-vercel-ip-*` headers) at the moment the link is opened, and shows it to the sender. A link opened in the app goes through the same `/api/open` call, so this happens for app viewers too. The viewer is anonymous to the server unless the link is also recipient-locked. The app's own composer has no such option. **Gap for mobile-ui:** the web viewer tells the viewer before they open such a link ("The viewer is told before they open it", privacy page); the app's viewer does not read `shareLocation` from the peek and shows no notice. Either add the notice (preferred, parity with the web and with this label) or this row must stay and be explained in the policy. |

### Not collected (and why that is the honest answer)

| Data type | Answer | Why |
| --- | --- | --- |
| **Messages (texts, photos, files, nicknames)** | Not collected | **Judgement call, same position as Signal's label.** Message text, attachments, file names, nicknames and reactions are encrypted on the phone with MLS (RFC 9420; AES-128-GCM / AES-256-GCM, HKDF, X25519, Ed25519 via `ts-mls`) before upload. The server stores ciphertext it cannot decrypt, keyed by room and device ids, and deletes it on the room's timer. Apple's definition of collection turns on data the developer can **access**; ciphertext without the key is not accessible content. The adviser should confirm this reading; the alternative (declaring "Other User Content, Not Linked") would be misleading to users because it implies OnePeek can read it. |
| **One-time secret content** | Not collected | Same: AES-256-GCM on the device, key in the URL fragment, which the app hands to the core only and never to the server (`/api/open` receives the id, never the key; audited in `security/README.md` N6c). |
| **Contacts** | Not collected | No contacts permission; invites are links. |
| **Photos or Videos** | Not collected | Picked photos are encrypted on the phone before upload and the plaintext copy is deleted after the send; the server sees ciphertext (see Messages). Photo library access is read-only and only for pictures the user picks. |
| **Audio Data** | Not collected | No recording feature. (Note for the lead: the `expo-camera` and `expo-image-picker` config plugins add a default microphone usage string and the Android `RECORD_AUDIO` permission unless told not to; see `apps/mobile/store/play/permissions.md`. Unused permissions are not "collection" but will raise reviewer questions.) |
| **Precise Location** | Not collected | No location permission; geofenced links are website-only in the app. |
| **Health & Fitness, Financial Info, Sensitive Info, Browsing History, Search History, Purchases** | Not collected | None of these exist in the app. |
| **Name** | Not collected | Nicknames are user-chosen, end-to-end encrypted control messages; the room name is stored only on the device ("Name (only on your device)"). Sign in with Apple's name scope is not requested. |
| **Phone Number, Physical Address** | Not collected | Never asked. |
| **Usage Data (product interaction, advertising data)** | Not collected | No analytics SDK; no event logging. Supabase and Vercel keep ordinary request logs (IP address, path, timestamp) for a short retention period to operate the service; nothing in the app sends usage events. Apple's optional-disclosure rules are not relied on here: there simply is no usage telemetry. |
| **Diagnostics (crash data, performance data)** | Not collected | No crash reporter; the ESLint leak guard forbids one because it would capture whatever the screen holds. Apple's own crash reports (if the user opted in to share with developers) are Apple's collection, not the app's, and are listed by Apple as not requiring disclosure. |
| **Customer Support** | Not collected | Support is by email outside the app. |
| **Other Data Types** | Reports: "Report chat" sends the room id and a reason from a fixed list (`report_chat`, 20 per day cap). Ids only, no content. Declare under **Other Data Types → Other Data, Linked, App Functionality** if the adviser wants it listed; it is covered by User ID otherwise. |

## Per-purpose summary (what the console asks per data type)

- **Third-Party Advertising:** none.
- **Developer's Advertising or Marketing:** none (no marketing emails are triggered by the app).
- **Analytics:** none.
- **Product Personalization:** none.
- **App Functionality:** email, user id, device ids / push token, quota client id, coarse location (the one case above).
- **Other Purposes:** none.

## Service providers (for the adviser; Apple does not list them on the label)

| Provider | Receives | Role |
| --- | --- | --- |
| Supabase (hosting the Postgres database, Auth, Storage, Realtime) | account email, user ids, device ids, push tokens, ciphertext, timers, report ids | processor |
| Vercel (hosting onepeek.io and the API routes) | request logs; the IP-derived city for opt-in location secrets; push fan-out | processor |
| Apple APNs | the device push token and the fixed notification text | processor (Apple's own terms) |
| Google FCM | not used by the iOS app | (Android only) |
| Photon / OpenStreetMap reverse geocoding (`lib/geo`) | lat/lon of a **device** location shared by a **web** viewer only; the app never sends device coordinates (`precise: null`) | processor, web path only |

## Account deletion (guideline 5.1.1(v), checked here because it is reviewed together with privacy)

The app lets users create accounts (Sign in with Apple creates one), so Apple requires a way to **delete the
account from within the app** (a link to a web page is acceptable only if it is a straightforward deletion
flow, not "email us"). Today the app offers **Sign out** and **Reset chats on this phone**, and the privacy
policy says "email us". **This is an open item for the web owner / lead:** either an in-app "Delete account"
that calls a server-side deletion, or a signed-in page on onepeek.io that deletes the account, linked from
Settings. Google Play's Data safety form asks for the same URL (see `play/data-safety.md`). Expect a
rejection on 5.1.1(v) if 1.0 ships without it.

## Questions for the adviser

1. Is "Not collected" the right label for end-to-end encrypted message and file ciphertext the developer
   stores but cannot read? (Precedent: Signal. Counter-view: Apple's literal "transmitted off device".)
2. Is the APNs push token best declared as **Device ID** (chosen) or **Other Data Types**?
3. Does the one opt-in case of IP-derived city count as Coarse Location "collected" when the sender, not
   OnePeek, is the one who sees it? (Declared Yes here to be safe.)
4. Do Supabase/Vercel request logs need any disclosure beyond the privacy policy? (Declared no here.)
