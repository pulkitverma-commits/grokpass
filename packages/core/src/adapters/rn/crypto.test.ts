import { describe, it, expect } from 'vitest';
import { assertSubtleSupport } from './crypto';

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
