# Android user distribution

The Android CI workflow now builds a release-mode standalone QA APK with an embedded JS bundle. This is not a production artifact: the native template may use a debug signing key, and the QA run does not require live backend or FCM credentials. Do not distribute it to customers.

Trusted main builds additionally produce a signed APK and Play AAB, only if these GitHub Actions secrets have been configured by the release owner:
- EXPO_PUBLIC_SUPABASE_URL (documented production project URL)
- EXPO_PUBLIC_SUPABASE_ANON_KEY (public anon/publishable key only)
- ONEPEEK_GOOGLE_SERVICES_JSON_B64 (base64 Firebase Android client configuration, not server service account)
- ONEPEEK_ANDROID_KEYSTORE_B64 (base64 existing release/upload keystore)
- ONEPEEK_ANDROID_STORE_PASSWORD, ONEPEEK_ANDROID_KEY_ALIAS, ONEPEEK_ANDROID_KEY_PASSWORD

Do not create or rotate a signing key without coordinating with the release owner. The production versionCode uses the Android workflow run number; if an existing Play listing has a higher versionCode, coordinate a monotonic migration before distributing. Keep the certificate fingerprint registered for Android App Links and OAuth; for Play App Signing the store signing certificate can differ from the upload certificate.

The production artifact is uploaded only after the package, embedded JS, non-debuggable APK, APK signature and AAB signature have been verified. This does not verify real-device auth, encrypted chat interoperability, push delivery, or Google Play review. Complete the device gates in docs/mobile/plan.md before public distribution. No automatic Play submission is performed.
