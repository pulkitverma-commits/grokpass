// Mobile app lint: Expo's config plus the build rules. console.* is an error here (rule 1:
// nothing sensitive is ever logged; use the core's redacting logger instead).
import expoConfig from 'eslint-config-expo/flat.js';
import prettier from 'eslint-config-prettier';

// ---------------------------------------------------------------------------- leak guard (Q4)
// Mirror of packages/core/eslint.config.mjs (kept as a copy: the app's lint must not import the
// core's tooling). packages/core/test/leak-guard.test.ts probes this config too, so the two copies
// cannot drift silently. esquery regexes cannot contain `/`, hence `\x2f` inside String.raw.
const TELEMETRY = String.raw`/^(Sentry|crashlytics|analytics|Bugsnag|datadog|mixpanel|amplitude|posthog)$/i`;
const TELEMETRY_IMPORT = String.raw`/^(@sentry\x2f|@bugsnag\x2f|@datadog\x2f|mixpanel|@amplitude\x2f|posthog|@react-native-firebase\x2f(crashlytics|analytics)|@segment\x2f|expo-analytics|react-native-google-analytics)/`;
const LOGGER = String.raw`/^(log|logger)$/`;
const LOGGER_VERBS = String.raw`/^(log|info|warn|error|debug|trace|fatal|verbose|silly|notice|critical)$/`;
const SINKS = String.raw`/^(console|Sentry|crashlytics|analytics|Bugsnag|datadog|mixpanel|amplitude|posthog|log|logger)$/i`;
const SENSITIVE = String.raw`/^(message|body|plaintext|token|accessCode|code|secret|key|nick|fileName|name)$/`;
const STRINGIFY = "CallExpression.arguments[callee.object.name='JSON'][callee.property.name='stringify']";
const TELEMETRY_MSG = 'No crash reporting or analytics SDK in OnePeek: it would receive whatever the screen holds. Use log() from @onepeek/core/src/log with redact().';
const STRINGIFY_MSG = 'JSON.stringify of a sensitive value passed to a sink. Pass it through redact() from @onepeek/core/src/log, or do not log it.';

const LEAK_GUARD = [
  { selector: `CallExpression[callee.type='MemberExpression'][callee.object.name=${TELEMETRY}]`, message: TELEMETRY_MSG },
  { selector: `CallExpression[callee.type='MemberExpression'][callee.object.object.name=${TELEMETRY}]`, message: TELEMETRY_MSG },
  { selector: `CallExpression[callee.type='MemberExpression'][callee.object.callee.name=${TELEMETRY}]`, message: TELEMETRY_MSG },
  { selector: `CallExpression[callee.name=${TELEMETRY}]`, message: TELEMETRY_MSG },
  { selector: `ImportDeclaration[source.value=${TELEMETRY_IMPORT}]`, message: TELEMETRY_MSG },
  { selector: `CallExpression[callee.name='require'] > Literal.arguments:first-child[value=${TELEMETRY_IMPORT}]`, message: TELEMETRY_MSG },
  {
    selector: `CallExpression[callee.type='MemberExpression'][callee.object.name=${LOGGER}][callee.property.name=${LOGGER_VERBS}]`,
    message: 'Ad-hoc logger objects are not allowed; the only approved path is log(event, redact(fields)) from @onepeek/core/src/log.',
  },
  { selector: `CallExpression[callee.object.name=${SINKS}] > ${STRINGIFY} > Identifier.arguments:first-child[name=${SENSITIVE}]`, message: STRINGIFY_MSG },
  { selector: `CallExpression[callee.object.name=${SINKS}] > ${STRINGIFY} > MemberExpression.arguments:first-child[property.name=${SENSITIVE}]`, message: STRINGIFY_MSG },
  { selector: `CallExpression[callee.object.callee.name=${TELEMETRY}] > ${STRINGIFY} > Identifier.arguments:first-child[name=${SENSITIVE}]`, message: STRINGIFY_MSG },
  { selector: `CallExpression[callee.name=${LOGGER}] > ${STRINGIFY} > Identifier.arguments:first-child[name=${SENSITIVE}]`, message: STRINGIFY_MSG },
  { selector: `CallExpression[callee.name=${LOGGER}] > ${STRINGIFY} > MemberExpression.arguments:first-child[property.name=${SENSITIVE}]`, message: STRINGIFY_MSG },
];

// The phone talks to two hosts. A literal URL anywhere else (another host, plain http, or a
// relative path, which React Native cannot resolve anyway) is an error.
const ONEPEEK_OR_SUPABASE = String.raw`^(?!https:\x2f\x2f(([a-z0-9-]+\.)*onepeek\.io|[a-z0-9-]+\.supabase\.co)(\x2f|$)).*`;
const FETCH = "CallExpression:matches([callee.name='fetch'], [callee.object.name='globalThis'][callee.property.name='fetch'])";
const FETCH_MSG = 'fetch() with a literal URL must point at https://onepeek.io or https://<project>.supabase.co; nothing else leaves the phone.';
const FETCH_GUARD = [
  { selector: `${FETCH} > Literal.arguments:first-child[value=/${ONEPEEK_OR_SUPABASE}/]`, message: FETCH_MSG },
  { selector: `${FETCH} > TemplateLiteral.arguments:first-child[expressions.length=0][quasis.0.value.cooked=/${ONEPEEK_OR_SUPABASE}/]`, message: FETCH_MSG },
];

export default [
  ...expoConfig,
  prettier,
  { ignores: ['ios/**', 'android/**', '.expo/**', 'node_modules/**'] },
  { rules: { 'no-console': 'error' } },
  // Leak guard (Q4): every file in the app, tests and e2e tooling included.
  { rules: { 'no-restricted-syntax': ['error', ...LEAK_GUARD, ...FETCH_GUARD] } },
  // CommonJS tooling files run under Node.
  { files: ['*.config.js'], languageOptions: { globals: { __dirname: 'readonly', require: 'readonly', module: 'writable', process: 'readonly' } } },
];
