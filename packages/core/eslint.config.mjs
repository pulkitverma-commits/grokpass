// ESLint for @onepeek/core (flat config). Same stack as the root config, but the rules the web
// app only warns on are errors here: this package is new code and is shared with the phones.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// ---------------------------------------------------------------------------- leak guard (Q4)
// Rule 1 of the build: nothing sensitive is ever logged or sent anywhere but onepeek.io and the
// Supabase project. `no-console` closes the console; these selectors close every other sink.
// The same list lives in apps/mobile/eslint.config.mjs; packages/core/test/leak-guard.test.ts
// probes both configs, so a selector that stops matching fails the suite.
// esquery regexes cannot contain `/`, hence `\x2f`; String.raw keeps the backslashes for esquery.
const TELEMETRY = String.raw`/^(Sentry|crashlytics|analytics|Bugsnag|datadog|mixpanel|amplitude|posthog)$/i`;
const TELEMETRY_IMPORT = String.raw`/^(@sentry\x2f|@bugsnag\x2f|@datadog\x2f|mixpanel|@amplitude\x2f|posthog|@react-native-firebase\x2f(crashlytics|analytics)|@segment\x2f|expo-analytics|expo-insights|expo-updates|react-native-google-analytics)/`;
const LOGGER = String.raw`/^(log|logger)$/`;
const LOGGER_VERBS = String.raw`/^(log|info|warn|error|debug|trace|fatal|verbose|silly|notice|critical)$/`;
const SINKS = String.raw`/^(console|Sentry|crashlytics|analytics|Bugsnag|datadog|mixpanel|amplitude|posthog|log|logger)$/i`;
const SENSITIVE = String.raw`/^(message|body|plaintext|token|accessCode|code|secret|key|nick|fileName|name)$/`;
const STRINGIFY = "CallExpression.arguments[callee.object.name='JSON'][callee.property.name='stringify']";
const TELEMETRY_MSG = 'No crash reporting or analytics SDK in OnePeek: it would receive whatever the screen holds. Use log() from packages/core/src/log.ts with redact().';
const STRINGIFY_MSG = 'JSON.stringify of a sensitive value passed to a sink. Pass it through redact() from packages/core/src/log.ts, or do not log it.';
// W1-10: calls that carry a value off the phone or into another app (clipboard, share sheet, another
// app via a URL, the system browser, a WebSocket) or onto the screen outside our own views (Alert).
// They are legitimate with a link or a literal (InviteSheet, Welcome, sign-in), so only an argument
// that is a secret-named identifier, member, template expression or object-property value is an error.
// W3-3 adds the sinks the app uses or could use: `Sharing.shareAsync` (expo-sharing, the share sheet
// for files), `Notifications.scheduleNotificationAsync|presentNotificationAsync` (lock-screen text),
// `MediaLibrary.saveToLibraryAsync|createAssetAsync|...` (Photos, backed up and indexed), and file
// writes (`File#write`, `FileSystem.writeAsStringAsync`, any `.write(...)`: a plaintext on disk outlives
// the screen). The guard is NAME-based (see test-plan §1.6): it fires on the argument's own name only.
const OFF_DEVICE = ":matches(CallExpression:matches([callee.object.name='Clipboard'][callee.property.name=/^set(String|Url|Image)(Async)?$/], [callee.object.name='Share'][callee.property.name=/^(share|open)$/], [callee.object.name='Linking'][callee.property.name=/^(openURL|sendIntent|openSettings)$/], [callee.object.name='WebBrowser'][callee.property.name=/^open[A-Za-z]*Async$/], [callee.object.name='Alert'][callee.property.name=/^(alert|prompt)$/], [callee.object.name='Sharing'][callee.property.name=/^share(Async)?$/], [callee.object.name='Notifications'][callee.property.name=/^(schedule|present)NotificationAsync$/], [callee.object.name='MediaLibrary'][callee.property.name=/^(saveToLibraryAsync|createAssetAsync|createAlbumAsync|addAssetsToAlbumAsync)$/], [callee.property.name=/^(write|writeAsStringAsync|writeAsync|writeAsStringSync)$/]), NewExpression[callee.name=/^(WebSocket|XMLHttpRequest)$/])";
const OFF_DEVICE_MSG = 'A secret-named value is handed to a sink that leaves the phone or our own views (clipboard, share sheet, URL, browser, WebSocket, Alert, Sharing, Notifications, MediaLibrary, a file write). Only links, literals and redact()ed fields may go there.';
// W3-3: lock-screen text is fixed copy. `content.title|subtitle|body` of a local notification must be a
// string literal (the push payload already is: "You have a new message in a private chat.").
const NOTIFICATION_CONTENT = "CallExpression[callee.object.name='Notifications'][callee.property.name=/^(schedule|present)NotificationAsync$/] > ObjectExpression.arguments > Property[key.name='content'] > ObjectExpression.value > Property[key.name=/^(title|subtitle|body)$/] > .value:not(Literal)";
const NOTIFICATION_MSG = 'Notification title/subtitle/body must be a string literal: whatever is here is shown on the lock screen and kept by the OS. Route with content.data = { roomId }, never content.';
// W3-3: the Documents directory is in the device backup set (iOS) and the auto-backup set on Android
// builds without our rules; nothing of ours is written there. Use Paths.cache (swept on launch).
const BACKED_UP_DIR = ":matches(MemberExpression[object.name='Paths'][property.name='document'], MemberExpression[object.name='FileSystem'][property.name='documentDirectory'])";
const BACKED_UP_MSG = 'Paths.document / FileSystem.documentDirectory is backed up off the phone. Write temporaries under Paths.cache (deleted on every launch) and nothing else.';
// W3-3: a remote image URL built from a secret-named value (`<Image source={{ uri: `https://…/${token}` }}>`)
// sends it to that host. Local file:// and data: URIs under a neutral name (the viewer's `uri`) pass.
const IMAGE_SOURCE = "JSXOpeningElement[name.name=/^(Image|ImageBackground|ExpoImage|FastImage)$/] > JSXAttribute[name.name=/^(source|src)$/] > JSXExpressionContainer > ObjectExpression > Property[key.name=/^(uri|url)$/]";
const IMAGE_MSG = 'A secret-named value is used as a remote image URL; the host receives it. Decrypt to bytes and show a local data:/file: URI instead.';

export const LEAK_GUARD = [
  { selector: `CallExpression[callee.type='MemberExpression'][callee.object.name=${TELEMETRY}]`, message: TELEMETRY_MSG },
  { selector: `CallExpression[callee.type='MemberExpression'][callee.object.object.name=${TELEMETRY}]`, message: TELEMETRY_MSG },
  { selector: `CallExpression[callee.type='MemberExpression'][callee.object.callee.name=${TELEMETRY}]`, message: TELEMETRY_MSG },
  { selector: `CallExpression[callee.name=${TELEMETRY}]`, message: TELEMETRY_MSG },
  { selector: `ImportDeclaration[source.value=${TELEMETRY_IMPORT}]`, message: TELEMETRY_MSG },
  { selector: `CallExpression[callee.name='require'] > Literal.arguments:first-child[value=${TELEMETRY_IMPORT}]`, message: TELEMETRY_MSG },
  {
    selector: `CallExpression[callee.type='MemberExpression'][callee.object.name=${LOGGER}][callee.property.name=${LOGGER_VERBS}]`,
    message: 'Ad-hoc logger objects are not allowed; the only approved path is log(event, redact(fields)) from packages/core/src/log.ts.',
  },
  { selector: `CallExpression[callee.object.name=${SINKS}] > ${STRINGIFY} > Identifier.arguments:first-child[name=${SENSITIVE}]`, message: STRINGIFY_MSG },
  { selector: `CallExpression[callee.object.name=${SINKS}] > ${STRINGIFY} > MemberExpression.arguments:first-child[property.name=${SENSITIVE}]`, message: STRINGIFY_MSG },
  { selector: `CallExpression[callee.object.callee.name=${TELEMETRY}] > ${STRINGIFY} > Identifier.arguments:first-child[name=${SENSITIVE}]`, message: STRINGIFY_MSG },
  { selector: `CallExpression[callee.name=${LOGGER}] > ${STRINGIFY} > Identifier.arguments:first-child[name=${SENSITIVE}]`, message: STRINGIFY_MSG },
  { selector: `CallExpression[callee.name=${LOGGER}] > ${STRINGIFY} > MemberExpression.arguments:first-child[property.name=${SENSITIVE}]`, message: STRINGIFY_MSG },
  { selector: `${OFF_DEVICE} > Identifier.arguments[name=${SENSITIVE}]`, message: OFF_DEVICE_MSG },
  { selector: `${OFF_DEVICE} > MemberExpression.arguments[property.name=${SENSITIVE}]`, message: OFF_DEVICE_MSG },
  { selector: `${OFF_DEVICE} > TemplateLiteral.arguments > Identifier.expressions[name=${SENSITIVE}]`, message: OFF_DEVICE_MSG },
  { selector: `${OFF_DEVICE} > TemplateLiteral.arguments > MemberExpression.expressions[property.name=${SENSITIVE}]`, message: OFF_DEVICE_MSG },
  { selector: `${OFF_DEVICE} > ObjectExpression.arguments > Property > Identifier.value[name=${SENSITIVE}]`, message: OFF_DEVICE_MSG },
  { selector: `${OFF_DEVICE} > ObjectExpression.arguments > Property > MemberExpression.value[property.name=${SENSITIVE}]`, message: OFF_DEVICE_MSG },
  // W3-3: one level deeper, for `{ content: { body } }` and `{ content: { title: m.nick } }`.
  { selector: `${OFF_DEVICE} > ObjectExpression.arguments > Property > ObjectExpression.value > Property > Identifier.value[name=${SENSITIVE}]`, message: OFF_DEVICE_MSG },
  { selector: `${OFF_DEVICE} > ObjectExpression.arguments > Property > ObjectExpression.value > Property > MemberExpression.value[property.name=${SENSITIVE}]`, message: OFF_DEVICE_MSG },
  { selector: `${OFF_DEVICE} > ObjectExpression.arguments > Property > ObjectExpression.value > Property > TemplateLiteral.value > Identifier.expressions[name=${SENSITIVE}]`, message: OFF_DEVICE_MSG },
  { selector: NOTIFICATION_CONTENT, message: NOTIFICATION_MSG },
  { selector: BACKED_UP_DIR, message: BACKED_UP_MSG },
  { selector: `${IMAGE_SOURCE} > Identifier.value[name=${SENSITIVE}]`, message: IMAGE_MSG },
  { selector: `${IMAGE_SOURCE} > MemberExpression.value[property.name=${SENSITIVE}]`, message: IMAGE_MSG },
  { selector: `${IMAGE_SOURCE} > TemplateLiteral.value > Identifier.expressions[name=${SENSITIVE}]`, message: IMAGE_MSG },
  { selector: `${IMAGE_SOURCE} > TemplateLiteral.value > MemberExpression.expressions[property.name=${SENSITIVE}]`, message: IMAGE_MSG },
];

// Phones talk to two hosts. A literal URL anywhere else (another host, plain http, or a relative
// path, which React Native cannot resolve anyway) is an error. Computed URLs are the adapter's
// job (`<apiBaseUrl>/api/chat/notify`, validated by checkOnePeekUrl) and are not matched here.
const ONEPEEK_OR_SUPABASE = String.raw`^(?!https:\x2f\x2f(([a-z0-9-]+\.)*onepeek\.io|[a-z0-9-]+\.supabase\.co)(\x2f|$)).*`;
const FETCH = "CallExpression:matches([callee.name='fetch'], [callee.object.name='globalThis'][callee.property.name='fetch'])";
const FETCH_MSG = 'fetch() with a literal URL must point at https://onepeek.io or https://<project>.supabase.co; nothing else leaves the phone.';
export const FETCH_GUARD = [
  { selector: `${FETCH} > Literal.arguments:first-child[value=/${ONEPEEK_OR_SUPABASE}/]`, message: FETCH_MSG },
  { selector: `${FETCH} > TemplateLiteral.arguments:first-child[expressions.length=0][quasis.0.value.cooked=/${ONEPEEK_OR_SUPABASE}/]`, message: FETCH_MSG },
];

// `no-restricted-globals` cannot see `globalThis.window`; close that door in both directories.
// (`globalThis.fetch` / `globalThis.FileReader` in adapters/rn/platform.ts are deliberate.)
const GLOBAL_THIS_GUARD = {
  selector: "MemberExpression[object.name='globalThis'][property.name=/^(window|document|localStorage|sessionStorage|indexedDB|XMLHttpRequest)$/]",
  message: 'Browser-only global reached through globalThis; the core must go through a port (chat/ports.ts).',
};

export default tseslint.config(
  { ignores: ['node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.{ts,js,mjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.es2022 } },
    rules: {
      // Rule 1 of the build: nothing sensitive is ever logged. The core never logs at all.
      'no-console': 'error',
      'no-restricted-syntax': ['error', ...LEAK_GUARD],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // The platform-neutral core reaches the browser only through the ports in chat/ports.ts.
    files: ['src/chat/**/*.ts', 'src/crypto.ts', 'src/secrets.ts', 'src/time.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch', 'XMLHttpRequest', 'File', 'BroadcastChannel'].map(name => ({
          name,
          message: `${name} is platform-specific; the core must reach it through a port (chat/ports.ts).`,
        })),
      ],
    },
  },
  {
    // The React Native adapters run on Hermes: no DOM. Anything browser-only must stay in adapters/web.
    files: ['src/adapters/rn/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'navigator', 'indexedDB', 'localStorage', 'sessionStorage', 'XMLHttpRequest', 'File', 'Blob'].map(name => ({
          name,
          message: `${name} does not exist on React Native; reach it through a port or the web adapter.`,
        })),
      ],
    },
  },
  {
    // Flat config replaces a rule's options wholesale, so each narrower block restates the leak guard.
    files: ['src/chat/**/*.ts', 'src/crypto.ts', 'src/secrets.ts', 'src/time.ts', 'src/adapters/rn/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', GLOBAL_THIS_GUARD, ...LEAK_GUARD],
    },
  },
  {
    // Only the RN adapters may call fetch in the core, and only towards onepeek.io / supabase.co.
    files: ['src/adapters/rn/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', GLOBAL_THIS_GUARD, ...LEAK_GUARD, ...FETCH_GUARD],
    },
  },
);
