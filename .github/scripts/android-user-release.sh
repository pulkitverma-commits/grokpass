#!/usr/bin/env bash
# Trusted main CI only. Never commit credentials or use a debug key for distribution.
set -euo pipefail
umask 077
required=(EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY ONEPEEK_GOOGLE_SERVICES_JSON_B64 ONEPEEK_ANDROID_KEYSTORE_B64 ONEPEEK_ANDROID_STORE_PASSWORD ONEPEEK_ANDROID_KEY_ALIAS ONEPEEK_ANDROID_KEY_PASSWORD)
missing=()
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then missing+=("$name"); fi
done
if (( ${#missing[@]} )); then
  printf 'Missing production build configuration: %s\n' "${missing[*]}" >&2
  exit 1
fi
if [[ "$EXPO_PUBLIC_SUPABASE_URL" != 'https://xndotbjwzbkknewyuqvf.supabase.co' ]]; then
  echo 'Production API URL does not match the documented Onepeek project.' >&2
  exit 1
fi
temp="$(mktemp -d "$RUNNER_TEMP/onepeek-release.XXXXXXXX")"
trap 'rm -rf "$temp"' EXIT
export ONEPEEK_SIGNING_FILE="$temp/release.keystore"
export GOOGLE_SERVICES_JSON="$temp/google-services.json"
printf '%s' "$ONEPEEK_ANDROID_KEYSTORE_B64" | base64 -d > "$ONEPEEK_SIGNING_FILE"
printf '%s' "$ONEPEEK_GOOGLE_SERVICES_JSON_B64" | base64 -d > "$GOOGLE_SERVICES_JSON"
unset ONEPEEK_ANDROID_KEYSTORE_B64 ONEPEEK_GOOGLE_SERVICES_JSON_B64
# Reject server-side keys and Firebase configurations belonging to another app.
python3 - <<'PY'
import os, json, base64
key = os.environ['EXPO_PUBLIC_SUPABASE_ANON_KEY']
if not key.startswith('sb_publishable_'):
    try:
        payload = key.split('.')[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        assert claims.get('role') == 'anon'
    except Exception:
        raise SystemExit('A public Supabase anon/publishable key is required; never embed a service key.')
with open(os.environ['GOOGLE_SERVICES_JSON']) as f:
    firebase = json.load(f)
if not any(c.get('client_info', {}).get('android_client_info', {}).get('package_name') == 'io.onepeek.app' for c in firebase.get('client', [])):
    raise SystemExit('Firebase client must match io.onepeek.app.')
PY
if [[ "$ONEPEEK_ANDROID_KEY_ALIAS" == 'androiddebugkey' ]]; then
  echo 'Debug signing key is forbidden for production.' >&2
  exit 1
fi
export EAS_BUILD_PLATFORM=android EAS_BUILD_PROFILE=production
unset EXPO_PUBLIC_E2E
# Re-generate with production settings. The previous QA build may have no backend or FCM.
(cd apps/mobile && npx expo prebuild --platform android --clean --no-install)
# Verify that native generation actually consumed the supplied Firebase file.
test -s apps/mobile/android/app/google-services.json
# Generated files only: use the trusted release key, never the Expo template's debug signer.
python3 - <<'PY'
import os, pathlib, re
p = pathlib.Path('apps/mobile/android/app/build.gradle')
s = p.read_text()
signing = '''
        onepeekProduction {
            storeFile file(System.getenv("ONEPEEK_SIGNING_FILE"))
            storePassword System.getenv("ONEPEEK_ANDROID_STORE_PASSWORD")
            keyAlias System.getenv("ONEPEEK_ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ONEPEEK_ANDROID_KEY_PASSWORD")
        }
'''
s, n = re.subn(r'(?m)^([ \t]*signingConfigs[ \t]*\{[ \t]*)$', lambda m: m.group(1) + signing, s)
if n != 1:
    raise SystemExit('Unexpected generated signingConfigs block.')
# Only replace the release build type; the debug type stays unchanged.
pat = r'(?ms)(^[ \t]*release[ \t]*\{(?:(?!^[ \t]*\}).)*?signingConfig[ \t]+)signingConfigs\.debug\b'
s, n = re.subn(pat, lambda m: m.group(1) + 'signingConfigs.onepeekProduction', s)
if n != 1:
    raise SystemExit('Unexpected generated release signing configuration.')
code = int(os.environ['GITHUB_RUN_NUMBER'])
assert 0 < code < 2100000000
s, n = re.subn(r'(?m)^([ \t]*versionCode[ \t]+)\d+[ \t]*$', lambda m: m.group(1) + str(code), s)
if n != 1:
    raise SystemExit('Unexpected generated Android versionCode.')
p.write_text(s)
PY
(cd apps/mobile/android && ./gradlew :app:assembleRelease :app:bundleRelease --no-daemon --stacktrace)
apk=apps/mobile/android/app/build/outputs/apk/release/app-release.apk
aab=apps/mobile/android/app/build/outputs/bundle/release/app-release.aab
test -s "$apk" && test -s "$aab"
python3 - "$apk" "$aab" <<'PY'
import sys, zipfile
for path, asset in [(sys.argv[1], 'assets/index.android.bundle'), (sys.argv[2], 'base/assets/index.android.bundle')]:
    with zipfile.ZipFile(path) as z:
        assert z.getinfo(asset).file_size > 0, 'Missing embedded JavaScript bundle'
PY
apksigner="$(find "$ANDROID_HOME/build-tools" -name apksigner -type f | sort -V | tail -1)"
aapt="$(find "$ANDROID_HOME/build-tools" -name aapt -type f | sort -V | tail -1)"
expected="$(keytool -exportcert -keystore "$ONEPEEK_SIGNING_FILE" -alias "$ONEPEEK_ANDROID_KEY_ALIAS" -storepass:env ONEPEEK_ANDROID_STORE_PASSWORD | sha256sum | cut -d' ' -f1)"
"$apksigner" verify --print-certs "$apk" > "$temp/apk-cert.txt"
actual="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$temp/apk-cert.txt" | tr '[:upper:]' '[:lower:]')"
test -n "$actual" && test "$actual" = "$expected"
"$aapt" dump badging "$apk" > "$temp/badging.txt"
grep -F "package: name='io.onepeek.app'" "$temp/badging.txt"
if grep -q 'application-debuggable' "$temp/badging.txt"; then
  echo 'Production APK must not be debuggable'; exit 1
fi
jarsigner -verify "$aab"
# Validate the AAB signer against the same signing certificate.
aab_cert="$(keytool -printcert -jarfile "$aab" | sed -n 's/^[[:space:]]*SHA256:[[:space:]]*//p' | head -1 | tr -d ':' | tr '[:upper:]' '[:lower:]')"
test -n "$aab_cert" && test "$aab_cert" = "$expected"
printf 'Production APK and AAB verified; Android versionCode=%s\n' "$GITHUB_RUN_NUMBER"
