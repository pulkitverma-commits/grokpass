import { describe, it, expect, afterEach } from 'vitest';
import { assertSubtleSupport, assertRuntimeSupport, installRnCrypto } from './crypto';

// Node's WebCrypto stands in for react-native-quick-crypto here: this checks the assertion's logic,
// not that quick-crypto works on Hermes (that proof is C2's spike on real phones).
describe('assertSubtleSupport', () => {
  it('passes on a complete WebCrypto', () => {
    expect(() => assertSubtleSupport()).not.toThrow();
    expect(() => assertSubtleSupport(globalThis.crypto)).not.toThrow();
  });

  it('names every missing piece', () => {
    expect(() => assertSubtleSupport(null)).toThrow(/installRnCrypto/);
    expect(() => assertSubtleSupport({ getRandomValues() {}, randomUUID() {} })).toThrow(/lacks subtle$/);
    const partial = { getRandomValues() {}, subtle: { encrypt() {}, decrypt() {}, digest() {}, importKey() {}, exportKey() {}, generateKey() {} } };
    expect(() => assertSubtleSupport(partial)).toThrow('lacks randomUUID, subtle.sign, subtle.verify, subtle.deriveBits');
  });
});

describe('assertRuntimeSupport (L5)', () => {
  it('passes on Node, which has everything the core uses', () => {
    expect(() => assertRuntimeSupport()).not.toThrow();
  });

  it('lists the missing base64 / text codecs and crypto pieces in one error', () => {
    const g = { atob() {}, TextDecoder: class {}, crypto: { getRandomValues() {}, subtle: {} } };
    expect(() => assertRuntimeSupport(g)).toThrow('runtime lacks btoa, TextEncoder, crypto.randomUUID, crypto.subtle.encrypt');
    expect(() => assertRuntimeSupport({})).toThrow('runtime lacks atob, btoa, TextEncoder, TextDecoder, crypto;');
    expect(() => assertRuntimeSupport({ ...g, btoa() {}, TextEncoder: class {}, crypto: globalThis.crypto })).not.toThrow();
  });
});

describe('installRnCrypto (L5)', () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
  afterEach(() => { Object.defineProperty(globalThis, 'crypto', desc); });

  it('verifies what the installer left behind and does not count a failed install as installed', () => {
    let installs = 0;
    const broken = () => ({ install() { installs++; Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues() {} }, configurable: true, writable: true }); } });
    expect(() => installRnCrypto(broken)).toThrow(/runtime lacks crypto\.randomUUID, crypto\.subtle/);
    expect(installs).toBe(1);
    // Not marked installed: a retry runs the installer again.
    expect(() => installRnCrypto(broken)).toThrow(/runtime lacks/);
    expect(installs).toBe(2);

    Object.defineProperty(globalThis, 'crypto', desc);
    let ok = 0;
    const good = () => ({ install() { ok++; /* Node already has a full WebCrypto */ } });
    expect(() => installRnCrypto(good)).not.toThrow();
    expect(ok).toBe(1);
    installRnCrypto(good);   // idempotent once it succeeded
    expect(ok).toBe(1);
  });
});
