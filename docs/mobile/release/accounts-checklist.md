# OnePeek mobile: accounts and credentials the human must create (task R0)

Owner: `release`. Written 2026-10-31 against `mobile/integration` (Expo SDK 58, `apps/mobile/app.config.ts`).
Console paths were checked against the Apple, Google, Expo, Firebase and Supabase documentation on the
same day; where a page did not show the exact label, the item says so instead of guessing. Menus move,
so treat the paths as the place to start looking, not as gospel.

Facts this list is built on:

- This Mac has **no Xcode, Android Studio, Java or emulator**. Every iOS and Android build runs on
  **EAS Build** in the cloud, so an Expo account is the first dependency of everything else.
- Identifiers are fixed by the lead and `app.config.ts`: bundle id / package **`io.onepeek.app`**,
  scheme **`onepeek`**, Universal Links / App Links for `onepeek.io` and `www.onepeek.io`
  (`/s/*`, `/chat/join`). The web app already serves `onepeek.io` on Vercel.
- Push: `expo-notifications` on the device, APNs with a **token-based `.p8` key** and **FCM v1** on the
  server (plan tasks B1–B4).
- Supabase project is the production one, ref `xndotbjwzbkknewyuqvf` (there is no staging; plan §8 Q1).
- **Nothing in this file is done by an agent.** Agents never create accounts, never sign in to a console,
  never upload a build and never spend money (rule 6; see the last section).

How to read each item: **Where to click** is the console path. **Bring back** is the value the lead
needs and the exact place it goes (EAS credential, EAS environment variable, Vercel environment
variable or `app.config.ts` field). **Costs** is money. **Unblocks** names the plan task.

Hand values over in a password manager share or by pasting them into the terminal session yourself.
Never paste a `.p8`, `.jks`, service-account JSON or private key into chat, a PR or a doc. CI already
fails if any such file is tracked (`.github/workflows/ci.yml`, "No secrets committed").

---

## Part A: before the Phase 0 device spike (task C2)

The spike needs one Android dev build and one iOS dev build installed on real phones. Order matters:
A1 → A2 → A3 → A4. A5 is optional for the spike.

### A1. Expo account + EAS project

| | |
| --- | --- |
| **Where to click** | 1. https://expo.dev/signup → create the account (use the company e-mail, not a personal one, so the project can live in an organisation later). 2. Optional but recommended: **expo.dev → account menu → Create organization** named `onepeek`, so credentials are "Organization-wide app credential management" rather than tied to one person. 3. Tell the lead the account/organisation name. |
| **Then the lead runs (once, with you watching)** | `npx eas-cli@latest login` (you type the password; the lead never sees it), then from `apps/mobile`: `npx eas-cli@latest init` ("Create or link an EAS project"). This creates the project on expo.dev and writes **`extra.eas.projectId`** (and `owner` if an organisation was chosen) into `apps/mobile/app.config.ts`. The lead commits that change. The lead may use `eas init --id <project-id>` if you created the project in the dashboard first. |
| **Bring back** | Account/organisation slug; nothing secret. The project id lands in `app.config.ts` → `extra.eas.projectId` (committed, public). |
| **Costs** | **Free plan: $0.** "Up to 15 Android and 15 iOS builds" (the pricing page does not state the reset period; check **expo.dev → account → Usage**), low-priority queue ("90+ minutes" at peak), 45-minute build timeout, unlimited members. A paid plan is **not** needed for Phase 0. If the 30 builds run out before Gate 0, the lead will stop and ask; nothing is upgraded without you. |
| **Unblocks** | Every EAS build: C2 (spike), later R1 (`eas.json` profiles), every device gate. |

Also needed for the dev build to talk to Supabase (free, you already have it): **Supabase dashboard →
Project Settings → API Keys** → copy the **anon / publishable key** into `apps/mobile/.env` as
`EXPO_PUBLIC_SUPABASE_ANON_KEY` (git-ignored; same value the web app ships in the browser, so it is
not secret) and, for cloud builds, as an EAS environment variable
(**expo.dev → project → Environment variables → Add Variables**, name `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
visibility *plain text*, environments `development`, `preview`, `production`).

### A2. Apple Developer Program membership

| | |
| --- | --- |
| **Where to click** | https://developer.apple.com/programs/enroll/ . Enrol as **Organization** if OnePeek has a legal entity (needs a **D-U-N-S number**: Apple's lookup tool on the enrolment page finds or requests one, free, allow days to two weeks) or as **Individual** (your name shows as the seller on the App Store; can be transferred to an organisation later, with friction). After payment, the **Account Holder** must accept the latest **Program License Agreement** at developer.apple.com/account (banner at the top) or nothing below works. |
| **Bring back** | **Team ID** (10 characters). Found at **developer.apple.com/account → Membership details** (label on that page may read "Team ID"; the Apple help page for this did not load during verification, so confirm on screen). Goes to: Vercel env **`APPLE_TEAM_ID`** (plan task B3, see B3 below) and the lead's notes for `eas credentials`. Also the **Apple ID e-mail** used for the account so the lead knows which login EAS will ask you for. |
| **Costs** | **$99 USD / year** (confirmed on Expo's setup guide, which quotes Apple's fee). |
| **Unblocks** | A3, A4, the iOS half of C2, APNs key (B1), App Store Connect (B6), TestFlight. Without this there is **no iOS build of any kind** (see "free alternatives"). |

### A3. Register the App ID `io.onepeek.app` with its capabilities

EAS can register the App ID automatically during the first `eas build -p ios` (you log in to Apple in
the terminal when it prompts; the lead does not learn your password). Doing it by hand first avoids
surprises and lets you tick the capabilities we need. Role required: **Account Holder or Admin**.

| | |
| --- | --- |
| **Where to click** | **developer.apple.com/account → Certificates, Identifiers & Profiles → Identifiers → (+) → App IDs → Continue → type App → Continue.** Description `OnePeek`, **Explicit App ID**, Bundle ID **`io.onepeek.app`**. Under **Capabilities** tick: **Associated Domains**, **Push Notifications**, **Sign in with Apple** (click **Configure** → choose **primary** App ID → Save). **Continue → Register.** To change later: **Identifiers → select the App ID → Edit → tick → Save** (Apple warns that provisioning profiles containing a modified App ID become invalid; EAS regenerates them on the next build). |
| **Bring back** | Nothing to copy; tell the lead it is done. Capabilities map to `app.config.ts`: `ios.associatedDomains` (already set), `expo-notifications` plugin (already set), `expo-apple-authentication` plugin (already set). |
| **Costs** | Included in A2. |
| **Unblocks** | iOS dev build (C2), Universal Links (B3/N6), Sign in with Apple (U2), APNs (B1). |

Note on the capability list: a dev build for the spike would work with none of these ticked, but the
provisioning profile EAS creates is tied to the App ID's capabilities, so ticking them now means one
fewer rebuild in Phase 1.

### A4. Test devices for iOS internal distribution (ad hoc)

TestFlight is not available until an App Store Connect record exists (B6), and Phase 0 should not wait
for it. EAS **internal distribution** installs a dev build straight onto registered iPhones.

| | |
| --- | --- |
| **Where to click** | The lead runs `npx eas-cli@latest device:create` from `apps/mobile`; it prints a URL / QR code. Open it **on each test iPhone** in Safari, install the provisioning profile it offers (Settings → Profile Downloaded → Install). This registers the device's UDID in your Apple account under **Certificates, Identifiers & Profiles → Devices**. Apple allows **100 iPhones per membership year**. Alternatively add UDIDs by hand at **Devices → (+)**. |
| **Bring back** | Nothing; the registration is visible in the Apple account. Tell the lead which phones (model + iOS version) so the device matrix in `docs/mobile/test-plan.md` matches. |
| **Costs** | None beyond A2. |
| **Unblocks** | iOS half of C2: `eas build -p ios --profile development` with `"distribution": "internal"` in `eas.json` (R1 writes the profile). |

### A5. Android for the spike: nothing to buy

The Android dev build is an **APK** signed with a keystore EAS generates and stores on the first
`eas build -p android` (you answer "yes" to "Generate a new Android Keystore?"). It installs on any phone
with "install unknown apps" allowed. **No Google Play account is needed for Phase 0.** Google Play is
item B4 below, for Phase 1.

Bring back after the first Android build (needed in Phase 1, cheap to grab now): the keystore's
**SHA-256 and SHA-1 fingerprints**. `npx eas-cli@latest credentials -p android` → select the profile →
the keystore summary lists the fingerprints. (The Mac has no Java, so `keytool` is not an option
locally; if the CLI does not show SHA-256, download `credentials.json` from the same menu and the lead
will compute it in an EAS build step or you run `keytool` on another machine.) These go to
**`ANDROID_SHA256_CERT`** (App Links) and to the Google OAuth Android client (B5).

### A6. R1 addendum: EAS environment variables, spike commands, Vercel variables

Added by task R1 (2026-10-31). `apps/mobile/eas.json` now exists; each build profile selects the matching
EAS **environment** (`development`, `preview`, `production`), so values are never in the repo.

**EAS environment variables to create** (expo.dev -> project -> Environment variables, or `eas env:create`),
for each of `development`, `preview`, `production`:

| Name | Type / visibility | Value from |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | string, plain text | `https://xndotbjwzbkknewyuqvf.supabase.co` (Supabase -> Project Settings -> API) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | string, plain text (public by design) | Supabase -> Project Settings -> API Keys -> anon / publishable key |
| `GOOGLE_SERVICES_JSON` | **file**, secret | Firebase console download (checklist B2); wiring in `fcm-client-config.md` |

Example: `npx eas-cli@latest env:create --name EXPO_PUBLIC_SUPABASE_URL --value <url> --environment development --environment preview --environment production --visibility plaintext`.

**Device spike commands** (you run them; the lead watches; order matters):

1. `cd apps/mobile && npx eas-cli@latest login` (you type the password), then `npx eas-cli@latest init`.
   `init` edits `app.config.ts` (`extra.eas.projectId`, `owner`): give that diff to the lead to commit.
2. Create the env vars above (`GOOGLE_SERVICES_JSON` can wait: the spike needs no push).
3. Android (free): `npx eas-cli@latest build --profile development --platform android`. Say yes to
   "Generate a new Android Keystore". Install the APK from the build page.
4. iOS (needs A2): register each test iPhone with `npx eas-cli@latest device:create`, open the link on
   the phone, then `npx eas-cli@latest build --profile development --platform ios`.
5. Start the dev server with `npx expo start --dev-client` and open `onepeek://spike` on the phone.

**Vercel environment variables the backend agent adds this phase** (Vercel -> project -> Settings ->
Environment Variables; Sensitive where secret). Names are final unless the backend agent says otherwise:

| Name | Where the value comes from |
| --- | --- |
| `APNS_KEY_ID` | Apple developer portal -> Keys -> the APNs key (10 chars), checklist B1 |
| `APNS_TEAM_ID` | Apple developer portal -> Membership details (same as `APPLE_TEAM_ID`) |
| `APNS_PRIVATE_KEY` | Contents of `AuthKey_<KEYID>.p8` (base64 or as the backend agent specifies); downloadable once |
| `APNS_BUNDLE_ID` | `io.onepeek.app` |
| `APNS_USE_SANDBOX` | `true` for development / ad hoc dev builds, `false` for TestFlight and App Store builds |
| `FCM_SERVICE_ACCOUNT_JSON` | Firebase -> Project settings -> Service accounts -> Generate new private key (secret) |
| `APPLE_TEAM_ID` | Apple Team ID (AASA `appID` is `<TEAMID>.io.onepeek.app`) |
| `ANDROID_SHA256_CERT_FINGERPRINTS` | Comma-separated SHA-256 fingerprints: the EAS keystore (`eas credentials -p android`, A5) and later the Play App Signing certificate (Play console -> Test and release -> App integrity -> App signing). Replaces the older name `ANDROID_SHA256_CERT` used in earlier text. |

Costs: none beyond Part A items. `eas submit`, builds to the stores and OTA publishing remain yours to run.


---

## Part B: before Phase 1 push testing (tasks B1–B4, Gate 1) and native sign-in (U2)

Order: B1 and B2 in parallel → B3 → B4 → B5 → B6. B7 is optional until Phase 3.

### B1. APNs authentication key (`.p8`, token-based)

Two paths; pick one and tell the lead which. Either way **one key serves all OnePeek apps** and is
**downloadable exactly once** (Apple: "the key is not saved in your developer account and you won't be
able to download it again"). Put the `.p8` in the password manager immediately.

| | |
| --- | --- |
| **Path 1: let EAS create it** | During the first iOS build EAS asks "Setup Push Notifications for your project?" and "Generating a new Apple Push Notifications service key" → answer **yes** to both, log in to Apple when prompted. EAS stores the key under **expo.dev → project → Credentials → iOS → Push Key**. You can download it from there once (`eas credentials -p ios → Push Key → download`) for the server side. |
| **Path 2: create it by hand** (role: **Account Holder or Admin**) | **developer.apple.com/account → Certificates, Identifiers & Profiles → Keys → (+)** → Key Name `OnePeek APNs` → tick **Apple Push Notifications service (APNs)** → **Configure** → environment **Sandbox & Production**, type **Team Scoped** → Save → **Continue → Confirm → Download** → **Done**. The **Key ID** is shown under the key name when you select the key in **Keys**. Upload it to EAS later with `eas credentials -p ios → Push Key → Add a new push key` if the Expo push service is used (see the open question below). |
| **Bring back** | `AuthKey_<KEYID>.p8` file, **Key ID** (10 chars), **Team ID** (from A2). Where they go: **Vercel → onepeek project → Settings → Environment Variables** as **`APNS_KEY_ID`**, **`APNS_TEAM_ID`**, **`APNS_PRIVATE_KEY`** (the file contents, base64-encoded so newlines survive; the backend agent will document the exact encoding in B2) and **`APNS_BUNDLE_ID`** = `io.onepeek.app`. Mark them *Sensitive* in Vercel. Also to EAS credentials if Expo's push service is used. |
| **Costs** | None beyond A2. |
| **Unblocks** | B2 (APNs sender in `lib/alerts.ts`), B4, Gate 1 "push with no content". |

**Open question for the lead/backend (not for you):** whether `push_devices.token` holds native APNs/FCM
device tokens (server talks to Apple and Google directly: `.p8` and service account live **only on
Vercel**) or Expo push tokens (Expo's push service sends: `.p8` and service account live **only in EAS
credentials**). Plan B2 reads as the former. Until that is settled, keep the `.p8` where you can hand it
to either.

### B2. Firebase project for FCM v1

| | |
| --- | --- |
| **Where to click** | 1. https://console.firebase.google.com → **Add project** (name `onepeek`; **disable Google Analytics** when asked, we do not collect analytics) → Create. Sign in with the Google account that will also own Google Play (B4) and Google Cloud OAuth clients (B5) so everything sits in one Google Cloud project. 2. **Project settings (gear) → General → Your apps → Add app → Android** → package name **`io.onepeek.app`** → Register → **Download google-services.json**. 3. **Project settings → Cloud Messaging** → confirm **Firebase Cloud Messaging API (V1)** is *Enabled* (the legacy API is gone; nothing to do if V1 shows enabled). 4. **Project settings → Service accounts → Generate new private key → Generate key** → a JSON file downloads. |
| **Bring back** | (a) **`google-services.json`** — public identifiers, but the repo's CI forbids tracking it, so it goes to EAS as a **file-type, secret environment variable** named **`GOOGLE_SERVICES_JSON`** (expo.dev → project → **Environment variables → Add Variables** → type *File*, visibility *Secret*, environments `development`, `preview`, `production`). `app.config.ts` then gets `android.googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json'` (lead's edit; the local copy stays git-ignored, the lead adds `google-services.json` to `apps/mobile/.gitignore`). (b) **Service account JSON** (`<project>-firebase-adminsdk-....json`) — a real secret. Goes to: **Vercel env `FCM_SERVICE_ACCOUNT_JSON`** (base64, *Sensitive*) for the server sender (B2), and/or **EAS credentials** via `eas credentials -p android → production → Google Service Account → Manage your Google Service Account Key for Push Notifications (FCM V1) → Set up … → Upload a new service account key` (or **expo.dev → Credentials → Android → Service credentials → FCM V1 service account key → Add a service account key**) if Expo's push service is used. See the open question under B1. |
| **Costs** | **Free** (Firebase Spark plan; FCM has no charge). Creating a Firebase project also creates a Google Cloud project; no billing account is needed. |
| **Unblocks** | Android half of B2/B4, Android push at Gate 1. The Android build itself does **not** need Firebase; only push does. |

### B3. Universal Links / App Links values for Vercel (plan task B3)

The backend agent adds route handlers for `/.well-known/apple-app-site-association` and
`/.well-known/assetlinks.json` that read two env vars. You supply the values.

| | |
| --- | --- |
| **Where to click** | **Vercel → onepeek project → Settings → Environment Variables → Add**. |
| **Bring back / set** | **`APPLE_TEAM_ID`** = Team ID from A2 (the AASA `appID` is `<TEAMID>.io.onepeek.app`). **`ANDROID_SHA256_CERT`** = comma-separated list of SHA-256 fingerprints, colon-separated uppercase hex, of **every** certificate that signs an OnePeek APK: the EAS dev/preview keystore (A5) now, and the **Play App Signing key** (B4) once it exists. Both as *Plain* (they are public by design; the files are served to anyone). Environments: Production, Preview. |
| **Costs** | None. |
| **Unblocks** | B3 route handlers, N6 (link handling on device), Q5 (routing with and without the app). Universal Links on iOS are verified by Apple's CDN against the live `onepeek.io`, so this must be on **production** Vercel before an iOS build can be tested against it. |

### B4. Google Play Console: developer account, app record, internal testing, Play App Signing

| | |
| --- | --- |
| **Where to click** | 1. https://play.google.com/console/signup → choose **Organization** (needs a D-U-N-S number, company website and e-mail on the company domain) or **Personal** (government ID + card in your legal name; **personal accounts must run a closed test with testers for a period Google sets** — widely reported as 12 testers for 14 days, not confirmed on Google's page — before production access). Identity verification can take days. 2. **All apps → Create app**: name `OnePeek`, default language English, **App**, **Free**, accept the declarations → Create app. 3. **Test and release → Testing → Internal testing → Create new release**; on the **Testers** tab create an e-mail list (up to **100 testers**, no Play review) and copy the opt-in link for the team. The lead gives you the `.aab` from EAS (`eas build -p android --profile preview`), you upload it; agents never upload. 4. Play App Signing is on by default for new apps: after the first upload go to **Test and release → Setup → App signing** (Google's help article routes it as **Protected with Play → Play Store protection → Manage Play app signing**; the label differs by console version) → **App signing key certificate** → copy **SHA-256** and **SHA-1**. The **upload key** stays the EAS keystore from A5. |
| **Bring back** | App signing **SHA-256** → append to Vercel **`ANDROID_SHA256_CERT`** (B3). App signing **SHA-1** → Google OAuth Android client (B5). Package name is fixed (`io.onepeek.app`); once the first bundle is uploaded it cannot change. |
| **Costs** | **$25 USD one-time** registration fee. |
| **Unblocks** | App Links verification for store-signed builds, internal testing track (Phase 3 beta), Google native sign-in for release builds. Not needed for Phase 0 or for Gate 1 push tests on dev builds. |

### B5. Supabase Auth providers for native sign-in (plan task U2)

The web already uses e-mail OTP/password, Google and Azure OAuth, and passkeys (`app/login/page.tsx`,
`app/chat/SignIn.tsx`). Mobile adds **Sign in with Apple (native)**, **Google (native, id-token)** and
the `onepeek://` return path for magic links. All of this is in the existing production Supabase
project; no new account.

**Apple (native only, no secret needed)**

| | |
| --- | --- |
| **Where to click** | **supabase.com/dashboard → project `xndotbjwzbkknewyuqvf` → Authentication → Providers → Apple** → Enable → **Client IDs**: add **`io.onepeek.app`** (Supabase: "Register all of the App IDs that will be using your Supabase project"). Leave the Services ID / secret key empty unless web "Sign in with Apple" is added later (then the Services ID must be the **first** entry and the secret rotates every 6 months). Save. |
| **Bring back** | Nothing; confirm done. The app calls `expo-apple-authentication` → `supabase.auth.signInWithIdToken({ provider: 'apple', token })`. |
| **Costs** | None. |

**Google (native, id-token flow)**

| | |
| --- | --- |
| **Where to click** | 1. https://console.cloud.google.com → select the Google Cloud project created with Firebase (B2) → **APIs & Services → OAuth consent screen** (Google now calls this **Google Auth Platform → Branding / Audience**): app name `OnePeek`, support e-mail, privacy policy `https://onepeek.io/privacy` and terms URLs, publishing status *In production* (or *Testing* with the team's e-mails for now). 2. **Google Auth Platform → Clients → Create client**, three times: **Web application** (name `OnePeek Supabase`; authorised redirect URI `https://xndotbjwzbkknewyuqvf.supabase.co/auth/v1/callback` — the web login may already have one; reuse it), **iOS** (bundle id `io.onepeek.app`; Team ID optional until published), **Android** (package `io.onepeek.app`, **SHA-1** of the EAS keystore from A5; add a second Android client later with the Play App Signing SHA-1 from B4). 3. **Supabase → Authentication → Providers → Google** → **Client IDs** = the web client id first, then the iOS and Android client ids, comma-separated; **Client Secret** = the web client's secret (already there if the web uses Google). Supabase says to enable **Skip nonce check** only if the client library cannot handle nonces; the lead decides after U2 is implemented. |
| **Bring back** | **Web client ID** (public; the lead wires it as `webClientId` for `@react-native-google-signin/google-signin` and in `app.config.ts`), **iOS client ID** (public; it also yields the `REVERSED_CLIENT_ID` the iOS URL scheme needs). Nothing secret reaches the repo. |
| **Costs** | None. |

**Redirect URLs for the `onepeek://` scheme (magic link / OAuth fallback)**

| | |
| --- | --- |
| **Where to click** | **Supabase → Authentication → URL Configuration → Redirect URLs → Add URL**: **`onepeek://**`** (double star so any path and query match; Supabase's own native example is `com.supabase://login-callback/`, exact paths are stricter and preferred once the app's callback route is fixed — the lead will tell you the final path, likely `onepeek://auth/callback`). Keep **Site URL** = `https://onepeek.io`. If the e-mail templates still use `{{ .SiteURL }}`, Supabase requires `{{ .RedirectTo }}` for `redirectTo` to take effect (**Authentication → Email Templates**); check with the lead before editing, it affects web e-mails too. No `exp://` entries: the app uses dev builds, not Expo Go. |
| **Bring back** | Confirmation; and the final callback path, once agreed. |
| **Costs** | None. |
| **Unblocks** | U2 sign-in screen on device, Gate 1 "phone ↔ browser end to end" with a signed-in account. |

### B6. App Store Connect app record and TestFlight

Needed for Gate 1 testers beyond A4's phones; required for Phase 3.

| | |
| --- | --- |
| **Where to click** | https://appstoreconnect.apple.com → **Apps → (+) → New App**: Platforms **iOS**, Name `OnePeek`, Primary Language English, **Bundle ID** `io.onepeek.app` (from A3), **SKU** `onepeek-ios-1`, **User Access** Full. Role: Account Holder, Admin or App Manager; the **Account Holder must have signed the latest agreement** under **Business** first. After creation the app shows **Prepare for Submission**. **TestFlight tab → Internal Testing → (+)** → create a group `OnePeek team` and add testers (internal groups hold up to 100 App Store Connect users). Builds appear there after you (not an agent) upload them via **Transporter** or run `eas submit` yourself. |
| **Bring back** | The numeric **Apple ID of the app** (**App Store → App Information → General Information → Apple ID**) → `eas.json` `submit.production.ios.ascAppId` (public; R1 adds it). |
| **Costs** | Included in A2. |
| **Unblocks** | TestFlight distribution for the device matrix in Phase 3; the Phase 3 privacy labels and export-compliance questionnaire live on this record. |

### B7. Optional, later: App Store Connect API key for `eas submit` (Phase 3)

Not needed before Gate 2. If you want the lead to be able to push builds to TestFlight for you:
**App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys → (+)**, role
**App Manager**, download the `.p8` once, note **Key ID** and **Issuer ID**; the lead stores them with
`eas credentials -p ios → production → App Store Connect: Manage your API Key`. Still, **the decision
to submit stays yours**: the lead prepares the command and you run it. The Android equivalent (a Play
Console service account) is likewise deferred.

---

## Values summary: what goes where

| Value | Public? | Destination |
| --- | --- | --- |
| EAS project id | yes | `apps/mobile/app.config.ts` → `extra.eas.projectId` (written by `eas init`, committed) |
| Supabase anon/publishable key | yes | `apps/mobile/.env` `EXPO_PUBLIC_SUPABASE_ANON_KEY` (git-ignored) + EAS env var, plain text |
| Apple Team ID | yes | Vercel `APPLE_TEAM_ID`; also `APNS_TEAM_ID` |
| APNs Key ID + `.p8` | **secret** | Vercel `APNS_KEY_ID`, `APNS_PRIVATE_KEY` (base64), `APNS_BUNDLE_ID`; EAS iOS Push Key if Expo push service is used |
| Firebase `google-services.json` | identifiers only, but never tracked | EAS file env var `GOOGLE_SERVICES_JSON` (secret) → `android.googleServicesFile` |
| Firebase service account JSON | **secret** | Vercel `FCM_SERVICE_ACCOUNT_JSON` (base64); EAS Android "Google Service Account Key for FCM V1" if Expo push service is used |
| EAS keystore SHA-256 / SHA-1 | yes | Vercel `ANDROID_SHA256_CERT` (SHA-256); Google OAuth Android client (SHA-1) |
| Play App Signing SHA-256 / SHA-1 | yes | appended to `ANDROID_SHA256_CERT`; second Google OAuth Android client |
| Google OAuth web + iOS client IDs | yes | Supabase Google provider; `app.config.ts` / sign-in code (lead) |
| Google OAuth web client secret | **secret** | Supabase Google provider only |
| App Store Connect app Apple ID (numeric) | yes | `eas.json` `submit.production.ios.ascAppId` |

Env var names on Vercel other than `APPLE_TEAM_ID` and `ANDROID_SHA256_CERT` (which plan B3 fixes) are
proposals; the backend agent confirms them in B2 before you set anything.

## Costs at a glance

| Item | Cost | When |
| --- | --- | --- |
| Expo / EAS | $0 (Free plan) | Phase 0 |
| Apple Developer Program | $99 / year | Phase 0 (iOS spike) |
| Google Play Console | $25 once | Phase 1 end / Phase 3 |
| Firebase (Spark) | $0 | Phase 1 |
| Supabase, Vercel | already paid for the web app; no new plan | — |

Total new spend before Gate 1: **$99**. Before beta: **$124**. Nothing recurring except Apple.

---

## Free alternatives for the Phase 0 spike

- **Android, $0 and no accounts except Expo:** `eas build -p android --profile development` produces
  an APK (`"android": { "buildType": "apk" }`, `"developmentClient": true`, `"distribution": "internal"`).
  Install it from the build page's **Install** button / QR on any Android phone with "install unknown
  apps" enabled. This alone answers the `ts-mls` + `react-native-quick-crypto` performance question on
  Android, and the Free plan's 15 Android builds are plenty for the spike.
- **iOS has no free path to a real iPhone.** A development build on a device needs a provisioning
  profile, and that needs the **$99 Apple Developer Program** (A2). Free Apple IDs can only sign
  7-day builds from a local Xcode, which this Mac does not have. What *is* free: an **iOS simulator
  build** (`"ios": { "simulator": true }`), but there is no simulator on this Mac either, so it only
  helps if someone on the team has a Mac with Xcode. Recommendation: enrol in A2 in week 1 so the
  iOS half of C2 is not the gate's critical path; the spike's numbers must come from a **real iPhone**
  (plan §2, C2 "on real iOS and Android dev builds").
- **Push for the spike:** not needed. C2 measures crypto and sync only; push waits for Phase 1.
- **Google Play, Firebase, App Store Connect:** none needed for the spike.
- **Supabase:** production project with throwaway rooms (plan §8 Q1, option b); no new project.

## What we will NOT do without you (rule 6)

Agents prepare files, commands and documents. They never:

1. Create an Expo, Apple, Google, Firebase or any other account, or an organisation inside one.
2. Sign in to developer.apple.com, App Store Connect, Google Play Console, Firebase, Google Cloud,
   the Supabase or Vercel dashboards, or `eas login` with your credentials. When `eas build` asks
   for an Apple login, **you** type it.
3. Pay for anything or change a plan (Expo paid tiers, Apple, Google Play, Supabase Pro for staging).
4. Generate, download, upload or move signing or push credentials: APNs `.p8`, keystores, Play upload
   keys, Firebase service accounts, App Store Connect API keys. They tell you which menu; you click.
5. Upload a build to TestFlight or Google Play, create a release, or submit for review. `eas submit`
   is run by you, if at all.
6. Register test devices in your Apple account (you open the `eas device:create` link on the phone).
7. Set production environment variables on Vercel or Supabase, change Supabase Auth providers,
   redirect URLs or e-mail templates, or apply a migration to the production database.
8. Commit a `.env`, `google-services.json`, `.p8`, `.jks`, `.p12` or service-account JSON (CI blocks it).

Where an agent *can* act once you have done your part: run `eas init` with you present, write
`eas.json`, `app.config.ts` fields, `.gitignore` entries, store listing text, privacy labels and
export-compliance drafts (flagged for a human adviser), and trigger `eas build` on the Free plan with
your OK.

## Open questions for the human

1. **Entity type.** Apple and Google both ask Organization vs Individual/Personal. Organization needs a
   D-U-N-S number (free, days to two weeks) and shows the company name on the stores. Which, and does
   a D-U-N-S number already exist for the OnePeek legal entity?
2. **Google account.** Which Google account owns Firebase, Google Cloud OAuth clients and Google Play?
   One account for all three avoids cross-project confusion.
3. **Push token model** (for lead/backend, see B1): native device tokens with the server sending via
   APNs/FCM directly, or Expo push tokens via Expo's push service? Decides whether the `.p8` and the
   service-account JSON live on Vercel, in EAS credentials, or both.
4. **Expo organisation name.** `onepeek` if free; otherwise tell the lead what you picked, it becomes
   `owner` in `app.config.ts`.
5. **Supabase e-mail templates.** Switching to `{{ .RedirectTo }}` affects web magic links too; OK to
   coordinate that change with the web, or should mobile use a different template?

## Sources checked on 2026-10-31

- Expo: push notifications setup, FCM V1 credentials, EAS CLI reference, build setup, environment
  variables (overview, manage), app credentials, `eas submit` iOS, pricing (docs.expo.dev, expo.dev/pricing).
- Apple: Create a private key, Get a key identifier, Register an App ID, Enable app capabilities,
  Add a new app (developer.apple.com/help). The "Locate your Team ID" page did not render; see A2.
- Google: Use Play App Signing, Set up an open, closed or internal test (support.google.com).
- Supabase: Login with Apple, Login with Google, Redirect URLs (supabase.com/docs).
- Fees ($99/year Apple, $25 one-time Google Play) confirmed on Expo's setup guide and Google's
  Play Console help via search; third-party pages were used only for the personal-account testing rule,
  which Google's page states exists without giving numbers.
