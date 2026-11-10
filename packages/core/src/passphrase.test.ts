// Passphrase-share key derivation (crypto.ts). The vectors below are shared with TopShelf's Swift
// implementation (SendSecurelyCryptoTests) so both sides derive byte-identical keys; the PBKDF2
// half was cross-checked with Python's hashlib.pbkdf2_hmac.
import { describe, it, expect } from 'vitest';
import {
  derivePassKeys, derivePassContentKey, decryptBytes, encryptBytes, fromB64Url, toB64Url, sha256Hex,
  PASS_ITERATIONS, PASS_INFO, PASS_LINK_PREFIX,
} from './crypto';

const V = {
  passphrase: 'correct horse battery staple',
  salt: 'AQIDBAUGBwgJCgsMDQ4PEA',                                     // bytes 1..16
  link: 'QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8',                 // bytes 0x40..0x5f
  half: 'oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8',                 // bytes 0xa0..0xbf
  authKey: 'AAjmm4n_rBqnux9EKJumWvqnEd1FDwqrbDIuTNV7shY',
  authHash: '250ccd0d2d420ec5d8354578c3f9a1b6c6942b35d19c63a8a32aa1a2a7d18e6e',
  wrap: '8g3663rJ70KKv-dQMGjyuR9xvpj2GYJ0Bc6_UWZJy_I',
  plain: 'hello from topshelf',
  ctWithIv0to11: 'NODUvaR1p-A2DzRiXFRLWD121jzLc7sNpp6HNg_VZwhQu3w',
};

describe('passphrase shares', () => {
  it('uses the documented parameters', () => {
    expect(PASS_ITERATIONS).toBe(600_000);
    expect(PASS_INFO).toBe('onepeek-pass-v1');
    expect(PASS_LINK_PREFIX).toBe('p1.');
  });

  it('derives the shared test vector', async () => {
    const { authKeyB64, wrapKey } = await derivePassKeys(V.passphrase, V.salt);
    expect(authKeyB64).toBe(V.authKey);
    expect(toB64Url(wrapKey)).toBe(V.wrap);
    expect(await sha256Hex(fromB64Url(authKeyB64))).toBe(V.authHash);
    const key = await derivePassContentKey(V.link, wrapKey, V.half, ['encrypt', 'decrypt']);
    const iv = new Uint8Array(12).map((_, i) => i);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(V.plain)));
    expect(toB64Url(ct)).toBe(V.ctWithIv0to11);
  }, 30_000);

  it('round-trips, and a wrong passphrase, link part or server half cannot decrypt', async () => {
    const { wrapKey } = await derivePassKeys(V.passphrase, V.salt);
    const key = await derivePassContentKey(V.link, wrapKey, V.half, ['encrypt', 'decrypt']);
    const blob = await encryptBytes(key, new TextEncoder().encode('secret'));
    expect(new TextDecoder().decode(await decryptBytes(key, blob))).toBe('secret');

    const wrong = await derivePassKeys('Correct horse battery staple', V.salt);
    expect(wrong.authKeyB64).not.toBe(V.authKey);
    await expect(decryptBytes(await derivePassContentKey(V.link, wrong.wrapKey, V.half), blob)).rejects.toThrow();
    const otherLink = toB64Url(new Uint8Array(32).fill(7));
    await expect(decryptBytes(await derivePassContentKey(otherLink, wrapKey, V.half), blob)).rejects.toThrow();
    const otherHalf = toB64Url(new Uint8Array(32).fill(9));
    await expect(decryptBytes(await derivePassContentKey(V.link, wrapKey, otherHalf), blob)).rejects.toThrow();
    // Tampered ciphertext fails authentication.
    const tampered = blob.slice(); tampered[20] ^= 1;
    await expect(decryptBytes(key, tampered)).rejects.toThrow();
  }, 60_000);

  it('normalises the passphrase to NFC and rejects bad key material', async () => {
    const composed = await derivePassKeys('café', V.salt);
    const decomposed = await derivePassKeys('café', V.salt);
    expect(decomposed.authKeyB64).toBe(composed.authKeyB64);
    await expect(derivePassKeys('x', toB64Url(new Uint8Array(8)))).rejects.toThrow(/salt/);
    await expect(derivePassContentKey(toB64Url(new Uint8Array(16)), composed.wrapKey, V.half)).rejects.toThrow(/key material/);
  }, 60_000);
});
