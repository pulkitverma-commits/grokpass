// WebCrypto on React Native. Hermes has no `crypto`; `react-native-quick-crypto` provides a native
// one (`getRandomValues`, `randomUUID`, `subtle` with AES-GCM, HKDF, SHA-256, Ed25519, X25519).
// The core (crypto.ts, mls.ts via ts-mls, the keystore sealing) only ever calls `globalThis.crypto`,
// so installing it once, before any core import, is the whole integration.
//
// The module is required lazily inside installRnCrypto(), not imported at the top: packages/core
// must not resolve `react-native-quick-crypto` in the web build or in the Node test run.

let installed = false;

/**
 * Makes react-native-quick-crypto the global `crypto` (and its Buffer the global `Buffer`). Call it
 * once from the app entry (`apps/mobile/index.js` or the root layout) before importing anything
 * from `@onepeek/core`. Idempotent.
 *
 * Uses the library's own `install()` (react-native-quick-crypto 1.1.9, README "Installation":
 * `import { install } from 'react-native-quick-crypto'; install();`, implemented in src/index.ts as
 * `global.crypto = QuickCrypto; global.Buffer = Buffer`).
 */
export function installRnCrypto(): void {
  if (installed) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- resolved by Metro at bundle time; never loaded on the web or in Node
  const quickCrypto = require('react-native-quick-crypto') as { install: () => void };
  quickCrypto.install();
  installed = true;
}

const SUBTLE_METHODS = ['encrypt', 'decrypt', 'digest', 'importKey', 'exportKey', 'generateKey', 'sign', 'verify', 'deriveBits'] as const;

/**
 * Throws a clear error when the installed `crypto` lacks something the core needs; used by the C2
 * spike screen and worth calling once at start-up in development builds. `c` defaults to the global.
 */
export function assertSubtleSupport(c: unknown = globalThis.crypto): void {
  const missing: string[] = [];
  const cr = c as { subtle?: Record<string, unknown>; getRandomValues?: unknown; randomUUID?: unknown } | undefined;
  if (!cr) throw new Error('crypto: globalThis.crypto is undefined; call installRnCrypto() before importing @onepeek/core');
  if (typeof cr.getRandomValues !== 'function') missing.push('getRandomValues');
  if (typeof cr.randomUUID !== 'function') missing.push('randomUUID');
  if (!cr.subtle) missing.push('subtle');
  else for (const m of SUBTLE_METHODS) if (typeof cr.subtle[m] !== 'function') missing.push(`subtle.${m}`);
  if (missing.length) throw new Error(`crypto: the installed WebCrypto lacks ${missing.join(', ')}`);
}
