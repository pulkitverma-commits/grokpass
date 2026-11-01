# FCM client config and `googleServicesFile` wiring (task R1)

`google-services.json` (Firebase, Android) is not a password, but the repo keeps it out of git
(`apps/mobile/.gitignore` and the CI "No secrets committed" check). It reaches builds through EAS.

1. Human creates the Firebase project and Android app `io.onepeek.app` (checklist B2) and downloads `google-services.json`.
2. Upload it as an EAS **file-type** environment variable, once per environment:
   `npx eas-cli@latest env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility secret --environment development --environment preview --environment production`
   (or expo.dev -> project -> Environment variables -> Add Variables -> type File). On the build worker the
   variable holds the **path** of the file, which is what `googleServicesFile` expects.
3. Lead adds one line to `apps/mobile/app.config.ts` inside `android: { ... }`:

   ```ts
   googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
   ```

   Locally the fallback reads a git-ignored `apps/mobile/google-services.json` (or the variable is unset and
   the Android build simply has no push, as today). Without the file, builds still work; only FCM token
   registration fails.
4. iOS: APNs needs **no** `GoogleService-Info.plist`. Only if Firebase SDK features are ever added, mirror
   the same pattern with `GOOGLE_SERVICE_INFO_PLIST` and
   `ios.googleServicesFile: process.env.GOOGLE_SERVICE_INFO_PLIST ?? './GoogleService-Info.plist'`.
5. The Firebase **service account** JSON (server sending) is a real secret and is never an app build input:
   it goes to Vercel as `FCM_SERVICE_ACCOUNT_JSON` (checklist B2).

Check: `eas env:list --environment production` shows `GOOGLE_SERVICES_JSON` (value hidden). Never print it.
