# OnePeek mobile: beta runbook (TestFlight and Play internal testing)

Owner: `release`. Written 2026-11-01 for Phase 3. **Every step here is run by the human who owns the Expo,
Apple and Google accounts.** Agents prepared the files (`apps/mobile/eas.json`, `apps/mobile/store/**`,
this document) and may sit beside you and type nothing. Commands are for `cd apps/mobile` on a machine
with Node (on this Mac: `export PATH=/Users/pulkitverma/Sites/newspop/.node/bin:$PATH`); `npx eas-cli@latest`
stands in for `eas`. Console paths are from the Apple, Google and Expo documentation on the date above and
move over time.

Prerequisites from `accounts-checklist.md`: A1 (Expo project, `extra.eas.projectId` committed), A2 (Apple
Developer Program), A3 (App ID with Associated Domains, Push, Sign in with Apple, **App Groups**), B1 (APNs
key in Vercel), B2 (Firebase `GOOGLE_SERVICES_JSON` EAS file variable), B3 (`APPLE_TEAM_ID` and
`ANDROID_SHA256_CERT_FINGERPRINTS` on Vercel), B4 (Play Console app record), B6 (App Store Connect record),
and the Phase 3 items C1–C6 added there.

---

## 0. Before the first upload: checks that cost nothing

Run from the commit you will build (`mobile/integration` or the release branch), in `apps/mobile`:

| # | Check | Command / where | Pass |
| --- | --- | --- | --- |
| 0.1 | Tests green on the commit | `cd ../.. && npm test --workspaces --if-present` (or the lead's recorded counts: web 142, core 322, mobile 396 at Gate 2) | all suites green; record the counts in the release PR |
| 0.2 | Expo config check (test plan §6.2) | `EAS_BUILD_PROFILE=production npx expo config --type introspect` | `ios.entitlements["aps-environment"]` is `production`; `ios.entitlements["com.apple.developer.associated-domains"]` lists `applinks:onepeek.io` and `applinks:www.onepeek.io`; `ios.entitlements["com.apple.security.application-groups"]` is exactly `["group.io.onepeek.app"]`; `android.googleServicesFile` is a path (the EAS variable; locally it is `./google-services.json` and may not exist, which is fine for the check); `extra.e2e` is `false`; `android.permissions` matches `apps/mobile/store/play/permissions.md` (no `RECORD_AUDIO` once the lead applies the plugin options there) |
| 0.3 | No secret tracked | `git ls-files \| grep -E 'google-services.json\|GoogleService-Info.plist\|\.p8$\|\.jks$\|\.p12$\|service-account'` | empty (CI "No secrets committed" also checks) |
| 0.4 | Version and runtime | `grep -n "version:" app.config.ts` | `1.0.0` for the first beta; `runtimeVersion` policy `appVersion`; no `buildNumber` / `versionCode` in the file (remote) |
| 0.5 | App Group on **both** identifiers | developer.apple.com → Identifiers → `io.onepeek.app` and `io.onepeek.app.share-extension` → App Groups capability ticked with `group.io.onepeek.app` | EAS creates the extension's identifier and syncs the capability on the first build with managed credentials; verify after the first build (S27) |
| 0.6 | Universal Links / App Links files live on production | `curl -s https://onepeek.io/.well-known/apple-app-site-association` → JSON with `appID` `<TEAMID>.io.onepeek.app` and the `/s/*`, `/chat/join` paths; `curl -s https://onepeek.io/.well-known/assetlinks.json` → `io.onepeek.app` with the SHA-256 of the EAS keystore **and, after B4, the Play App Signing key** | both 200, correct content type; `www.onepeek.io` too |
| 0.7 | Supabase Auth ready | Supabase → Authentication → Providers: Apple (client id `io.onepeek.app`), Google (web + iOS + Android client ids); URL Configuration → Redirect URLs has `onepeek://auth` (B5) | done; otherwise sign-in fails on device |
| 0.8 | Migration 008 and 009 applied to production | `select proname from pg_proc where proname in ('register_push_device','unregister_push_device','report_chat')` → 3 rows | yes; otherwise push registration and Report chat return errors (deployment.md §5) |
| 0.9 | Vercel push env | `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `APNS_USE_SANDBOX=false` for TestFlight/App Store builds, `FCM_SERVICE_ACCOUNT_JSON` | set; **`APNS_USE_SANDBOX` must be `false`** for TestFlight (a TestFlight build has the production `aps-environment`; sandbox sends fail with BadDeviceToken) |
| 0.10 | Store material ready | `apps/mobile/store/**` reviewed by you; adviser answers recorded for export compliance and the privacy label judgement calls | filed in `docs/mobile/log.md` |

If 0.2 shows `aps-environment` missing, the `expo-notifications` plugin did not run; stop and ask the lead.

## 1. Version and build numbering (from `versioning.md`)

- `version` in `app.config.ts` is the marketing version (`1.0.0`); the lead bumps it in a reviewed commit.
- iOS `buildNumber` and Android `versionCode` are **remote** (`cli.appVersionSource: "remote"`) and
  **auto-incremented** on the `production` profile. Nothing is set by hand. The first production build gets
  `1` on each platform unless you seed it: if a build with a higher number already exists in a store
  (it does not today), run `eas build:version:set -p ios` / `-p android` once.
- Every TestFlight / Play upload is a `production`-profile build; `preview` builds are ad hoc / APK and
  cannot be uploaded to the stores (Play needs an AAB; TestFlight needs an App Store-signed IPA).
- OTA updates are **off** (`expo-updates` is not installed); every change is a store build. If the lead
  enables it later, the hotfix rules in `versioning.md` §4 apply and crypto never ships OTA.

## 2. iOS: production build → TestFlight → testers → external beta

### 2.1 Build

```
cd apps/mobile
npx eas-cli@latest login                      # you type the password
npx eas-cli@latest build --platform ios --profile production
```

Prompts on the first run (answer yourself; the lead may watch): Apple login (your Apple ID; EAS keeps a
session, never the password), "Generate a new Apple Distribution Certificate?" **yes**, "Generate a new
Apple Provisioning Profile?" **yes**, "Set up Push Notifications?" **yes** (it registers the APNs key with
EAS; the server-side `.p8` on Vercel is separate, B1), and the **share extension** `OnePeekShare`
(`io.onepeek.app.share-extension`) gets its own identifier and profile from
`extra.eas.build.experimental.ios.appExtensions`. Expect 20–60 minutes on the Free plan queue.

Check the build page: the artifact is an `.ipa` signed for App Store distribution; the logs show the
`OnePeekShare` target compiled (first time this happens anywhere: S27). If the extension fails to compile,
stop and hand the log to native-security; nothing is uploaded.

### 2.2 Submit to TestFlight

`eas.json` → `submit.production.ios` holds two placeholders you must replace in a commit before running
submit: `ascAppId` = the numeric Apple ID of the app (App Store Connect → App Information → General
Information → **Apple ID**, from B6) and `appleTeamId` = your 10-character Team ID (A2). Both are public
values and are committed. Then:

```
npx eas-cli@latest submit --platform ios --profile production --latest
```

It asks for your Apple ID and an **app-specific password** (appleid.apple.com → Sign-In and Security →
App-Specific Passwords) unless an App Store Connect API key is stored with EAS (checklist B7, optional).
You type these; agents do not. Alternative with no EAS involvement: download the `.ipa` from the build page
and upload it with Apple's **Transporter** app.

### 2.3 Processing and the encryption question

App Store Connect → TestFlight shows the build "Processing" for 5–30 minutes. If the app-level encryption
answers are not yet entered, the build shows **"Missing Compliance"**: enter them from
`apps/mobile/store/app-store/export-compliance.md` **after the adviser has confirmed them** (App
Information → App Encryption Documentation, or the build's "Manage" link). Until then the build cannot be
distributed to testers.

### 2.4 Internal testers (no review)

TestFlight → Internal Testing → the `OnePeek team` group (B6) → add up to 100 App Store Connect users →
enable the build. Testers install TestFlight and accept the email. Internal builds expire after 90 days.
Test on the device matrix in `docs/mobile/test-plan.md` §5.1 and run `apps/mobile/security/MANUAL-CHECKS.md`
S1–S27; **S5 (iOS screenshot) must show the alert on the other phone, and the TestFlight build must
receive a push** (0.9).

### 2.5 External beta (needs Beta App Review)

TestFlight → External Testing → create a group → add the build → fill **Test Information** (what to test,
feedback email `secret@onepeek.io`, the **Beta App Review** notes copied from
`apps/mobile/store/app-store/review-notes.md`, "Sign-in required: No" with the guest path). Beta App
Review takes 1–2 days the first time. Up to 10,000 testers via public link or email. The App Privacy
labels and export compliance must be entered before the first external build is approved.

### 2.6 App Store submission (after the beta, Gate 3)

Prepare 1.0 under **App Store → iOS App**: listing (`listing.md`), screenshots (`screenshots.md`), App
Privacy (`privacy-labels.md`), age rating, App Review Information (`review-notes.md`), select the build,
"Manually release this version", **Submit for Review**. Not part of the beta runbook; listed so the beta
leaves nothing undone.

## 3. Android: AAB → Play internal testing track

### 3.1 Build

```
npx eas-cli@latest build --platform android --profile production
```

First run: "Generate a new Android Keystore?" **yes** (or reuse the one from the dev builds if EAS already
holds it for this project: it will; one keystore per project). The `production` profile builds an
**`.aab`** (`buildType: app-bundle`). The build needs the `GOOGLE_SERVICES_JSON` file variable in the
`production` EAS environment (B2 / `fcm-client-config.md`); without it the build still succeeds and push
simply fails on the device, which the Gate would catch.

### 3.2 First upload is manual

Google requires the **first** AAB of a new app to be uploaded through the console, not the API: Play
Console → Test and release → Testing → **Internal testing** → Create new release → upload the `.aab` from
the EAS build page → release name (defaults to the versionCode) → release notes from
`apps/mobile/store/play/listing.md` → **Save** (do not "Review release" yet if the store listing is
unfinished; a draft is fine). Play App Signing is on by default: Google re-signs with the app signing
key and the EAS keystore becomes the **upload key**.

Immediately after: **Test and release → Setup → App signing** → copy the **App signing key certificate**
SHA-256 → append to Vercel `ANDROID_SHA256_CERT_FINGERPRINTS` (B3) and redeploy the web, or App Links
will not verify on store-installed builds; copy the SHA-1 → second Google OAuth Android client (B5) or
Google sign-in fails on store builds.

### 3.3 Later uploads with `eas submit`

`eas.json` → `submit.production.android` points `serviceAccountKeyPath` at `./google-play-service-account.json`
(git-ignored), `track: internal`, `releaseStatus: draft`. To use it:

1. Google Cloud console (same project as Firebase) → IAM & Admin → Service accounts → Create → download a
   JSON key once. Play Console → Users and permissions → Invite new users → the service account's email →
   permissions "Release to testing tracks" (and "Manage testing tracks") for the OnePeek app only.
2. Either keep the JSON **locally** at `apps/mobile/google-play-service-account.json` when you run
   `npx eas-cli@latest submit --platform android --profile production --latest` (the file never leaves your
   machine except to Google), **or** store it with EAS so `eas build --auto-submit` can use it:
   `npx eas-cli@latest credentials -p android` → `production` → **Google Service Account** → "Manage your
   Google Service Account Key for Play Store Submissions" → upload. The file is a real secret: password
   manager, never chat, never the repo (CI blocks it).
3. `releaseStatus: draft` means the release is created but **not rolled out**; you press "Review release"
   → "Start rollout to Internal testing" in the console. Change to `completed` only when you want
   automatic rollout to internal testers.

### 3.4 Testers

Internal testing → Testers tab → the email list (up to 100) → copy the **opt-in link** and send it to the
team. Internal testing needs no Play review and is live within minutes. Testers must have a Google account
on the device that matches the list. Device matrix: §5.1 of the test plan (budget Android 10/11, mid-range
13/14, Pixel 15/16). Check: `adb shell pm get-app-links io.onepeek.app` says `verified` after 3.2's SHA-256
is live; FLAG_SECURE black screenshots (S1–S3); push arrives with the fixed text (M8).

### 3.5 Closed testing requirement for personal developer accounts

If the Play developer account is **Personal** (not Organization), Google requires a closed test with a
minimum number of opted-in testers for a minimum period (Google's page says the requirement exists; the
widely reported numbers are 12 testers for 14 days, unverified) before production access is granted.
Plan the beta so the closed track runs that long. Organization accounts are exempt. The entity decision
(checklist open question 1) therefore affects the Phase 3 calendar.

### 3.6 Play App content before any wider track

Data safety (`data-safety.md`), content rating (`content-rating.md`), target audience
(`target-audience.md`), App access (review notes, Play section), privacy policy URL, ads declaration (no).
Internal testing does not require them; **closed testing and production do**.

## 4. What to do when a step fails

| Symptom | Likely cause | Action |
| --- | --- | --- |
| iOS build fails provisioning the extension | App Group missing on one identifier, or the extension's bundle id not registered | 0.5; let EAS register it (`eas credentials -p ios`), rebuild |
| "Missing Compliance" stays after processing | encryption answers not entered | 2.3 |
| TestFlight build gets no push | `APNS_USE_SANDBOX` true, or the `aps-environment` is `development` | 0.9 / 0.2 |
| Universal Link opens Safari instead of the app | AASA not live or wrong Team ID; iOS caches AASA for a day | 0.6; reinstall the app after fixing |
| Android App Link opens Chrome | Play App Signing SHA-256 missing from `assetlinks.json` | 3.2 |
| Play rejects the AAB: "version code already used" | remote counter behind the store | `eas build:version:set -p android` to the store's number, rebuild |
| Play: unused permission question (RECORD_AUDIO) | plugin defaults | `apps/mobile/store/play/permissions.md`, lead fixes `app.config.ts`, new build |
| App Review rejects on 5.1.1(v) account deletion | no in-app / web deletion path | web owner builds it; `privacy-labels.md` "Account deletion" |

## 5. Rollback

- **TestFlight:** expire the bad build (TestFlight → the build → Expire) so testers cannot install it, and
  enable the previous build in the group again. Testers on the bad build keep it until they update; there
  is no remote kill. A fix is a new `production` build with a new auto-incremented build number (same
  `version` is fine within TestFlight).
- **Play internal/closed:** create a new release on the track with the previous AAB (the console lets you
  pick an uploaded bundle) or halt the staged rollout (production only). Testers on the bad versionCode
  must update; versionCode can never go down, so "rolling back" is always a new, higher versionCode.
- **App Store production (later):** "Remove this version from sale" or submit a fixed version with
  expedited review; phased release can be paused. No OTA rollback exists because OTA is off.
- **Server side:** `APNS_*` / FCM env vars on Vercel can be reverted instantly; migrations have `_down`
  files (`008_mobile_push_tokens_down.sql`, `009_chat_reports_down.sql`) but dropping `push_devices` orphans
  every registered phone until users re-enable notifications; prefer leaving the tables.
- **Keys:** never rotate the Android upload key or the Apple distribution certificate as a "rollback";
  rotating the upload key requires a Play support request and a new certificate invalidates nothing for
  users but needs a rebuild.

## 6. Costs and who pays

| Item | Cost | Paid by | When |
| --- | --- | --- | --- |
| Apple Developer Program (A2) | US$99 / year | the human, company card | already needed for any iOS build |
| Google Play Console (B4) | US$25 once | the human | before 3.2 |
| EAS Build | Free plan: "up to 15 Android and 15 iOS builds" (reset period not stated on the pricing page; check expo.dev → Usage), low-priority queue, 45-min timeout. Phase 3 needs roughly 2–4 iOS and 2–4 Android `production` builds plus re-spins: fits if the dev builds have not used the quota. If the queue or cap blocks a gate, a paid Expo plan (Starter or Production; prices on expo.dev/pricing, roughly US$19 and US$99 per month when last read) can be bought for one month and cancelled; **not bought without your OK** | the human | only if the Free cap is hit |
| EAS Submit | included in the plan's build credits (submissions are cheap but not free on paid plans; free on Free plan within caps) | | |
| Firebase (FCM) | US$0 (Spark) | | |
| Supabase, Vercel | existing plans; push fan-out adds negligible function invocations | already paid | |
| D-U-N-S number (if Organization accounts) | free, 1–2 weeks | | before A2 / B4 as Organization |
| TestFlight, Play internal testing | free | | |
| Export-compliance adviser | professional fee, your choice | the human | before the first external TestFlight build / App Store submission |
| Test devices (matrix §5.1) | whatever the team does not already own; a budget Android (~₹10k) is the one likely purchase | the human | before the device matrix run |

Total new fixed spend for the beta beyond Phase 1: **US$25** (Play) plus any optional EAS month. Nothing
recurring beyond Apple's US$99/year.

## 7. Log entries to make

After each of: first iOS production build (S27 result), first TestFlight install, first Play internal
release, encryption answers entered (with the adviser's confirmation), Data safety submitted, external beta
approval. One line each in `docs/mobile/log.md`, newest first, with the build numbers.
