// WebCrypto on React Native. Hermes has no `crypto`; `react-native-quick-crypto` provides a native
// one (`getRandomValues`, `randomUUID`, `subtle` with AES-GCM, HKDF, SHA-256, Ed25519, X25519).
// The core (crypto.ts, mls.ts via ts-mls, the keystore sealing) only ever calls `globalThis.crypto`,
// so installing it once, before any core import, is the whole integration.
//
// The module is required lazily inside installRnCrypto(), not imported at the top: packages/core
// must not resolve `react-native-quick-crypto` in the web build or in the Node test run.

let installed = false;

/**
 * Makes react-native-quick-crypto the global `crypto` (and its Buffer the global `Buffer`), then
 * verifies the runtime has everything the core needs (`assertRuntimeSupport`), throwing with the
 * list of what is missing. Call it once from the app entry (`apps/mobile/index.js` or the root
 * layout) before importing anything from `@onepeek/core`. Idempotent once it has succeeded; a
 * failed call may be retried.
 *
 * Uses the library's own `install()` (react-native-quick-crypto 1.1.9, README "Installation":
 * `import { install } from 'react-native-quick-crypto'; install();`, implemented in src/index.ts as
 * `global.crypto = QuickCrypto; global.Buffer = Buffer`). `load` is injectable for tests only.
 */
export function installRnCrypto(load: () => { install: () => void } = loadQuickCrypto): void {
  if (installed) return;
  load().install();
  assertRuntimeSupport();
  installed = true;
}

function loadQuickCrypto(): { install: () => void } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- resolved by Metro at bundle time; never loaded on the web or in Node
  return require('react-native-quick-crypto') as { install: () => void };
}

const SUBTLE_METHODS = ['encrypt', 'decrypt', 'digest', 'importKey', 'exportKey', 'generateKey', 'sign', 'verify', 'deriveBits'] as const;

/** Globals the core uses besides `crypto`: base64 (wrapping key, record packing) and UTF-8 codecs. */
const RUNTIME_GLOBALS = ['atob', 'btoa', 'TextEncoder', 'TextDecoder'] as const;

function missingCrypto(c: unknown): string[] {
  const missing: string[] = [];
  const cr = c as { subtle?: Record<string, unknown>; getRandomValues?: unknown; randomUUID?: unknown } | undefined;
  if (!cr) return ['crypto'];
  if (typeof cr.getRandomValues !== 'function') missing.push('getRandomValues');
  if (typeof cr.randomUUID !== 'function') missing.push('randomUUID');
  if (!cr.subtle) missing.push('subtle');
  else for (const m of SUBTLE_METHODS) if (typeof cr.subtle[m] !== 'function') missing.push(`subtle.${m}`);
  return missing;
}

/**
 * Throws a clear error when the installed `crypto` lacks something the core needs; used by the C2
 * spike screen and by `installRnCrypto`. `c` defaults to the global.
 */
export function assertSubtleSupport(c: unknown = globalThis.crypto): void {
  const missing = missingCrypto(c);
  if (missing[0] === 'crypto') throw new Error('crypto: globalThis.crypto is undefined; call installRnCrypto() before importing @onepeek/core');
  if (missing.length) throw new Error(`crypto: the installed WebCrypto lacks ${missing.join(', ')}`);
}

/**
 * `assertSubtleSupport` plus the non-crypto globals the core relies on (`atob`, `btoa`,
 * `TextEncoder`, `TextDecoder`; Hermes has them from RN 0.74). One error names everything missing.
 * `g` defaults to `globalThis`.
 */
export function assertRuntimeSupport(g: unknown = globalThis): void {
  const obj = g as Record<string, unknown>;
  const missing: string[] = [];
  for (const name of RUNTIME_GLOBALS) if (typeof obj[name] !== 'function') missing.push(name);
  missing.push(...missingCrypto(obj.crypto).map(m => (m === 'crypto' ? 'crypto' : `crypto.${m}`)));
  if (missing.length) throw new Error(`crypto: the runtime lacks ${missing.join(', ')}; call installRnCrypto() before importing @onepeek/core`);
}
