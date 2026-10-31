// Sealing helpers shared by every KeyStore implementation (web IndexedDB today, SecureStore +
// SQLite on the phones later). The record format is the one lib/chat/keystore.ts has always
// written, so existing browser data keeps working:
//
//   { iv: 12 random bytes, ct: AES-256-GCM(pack(value)) with the record key as additional data,
//     expiresAt?: ms }
//
// The wrapping key itself is the platform's business (see KeyStore in ./ports.ts).

import { toB64Url, fromB64Url } from '../crypto';

export type { KeyStore } from './ports';

/** One stored record. `ct` includes the GCM tag. */
export type Sealed = { iv: Uint8Array; ct: ArrayBuffer; expiresAt?: number };

// Tagged JSON so Uint8Array and bigint survive the round trip.
export function pack(v: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(v, (_k, x) => {
    if (x instanceof Uint8Array) return { $b: toB64Url(x) };
    if (typeof x === 'bigint') return { $n: x.toString() };
    return x;
  }));
}

export function unpack<T>(b: ArrayBuffer): T {
  return JSON.parse(new TextDecoder().decode(b), (_k, x) => {
    if (x && typeof x === 'object' && typeof x.$b === 'string' && Object.keys(x).length === 1) return fromB64Url(x.$b);
    if (x && typeof x === 'object' && typeof x.$n === 'string' && Object.keys(x).length === 1) return BigInt(x.$n);
    return x;
  });
}

/**
 * Encrypts a value under `wrap`. The record key is bound as associated data so sealed blobs can't
 * be swapped between keys.
 *
 * Known limitation (format v1): `expiresAt` is stored beside the record and is NOT part of the
 * AAD, so someone with write access to the local store (IndexedDB / the SQLite file) can extend or
 * shorten a record's local lifetime without touching the ciphertext; the server enforces its own
 * expiry independently. A format v2 would bind it (AAD = `key\0expiresAt`) and keep reading v1.
 */
export async function seal(wrap: CryptoKey, key: string, value: unknown, expiresAt?: number): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(key) }, wrap, pack(value) as BufferSource);
  return { iv, ct, expiresAt };
}

/** Decrypts a record. Throws when the key is wrong (after a wipe), the record was tampered with or moved. */
export async function unseal<T>(wrap: CryptoKey, key: string, rec: Sealed): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv as BufferSource, additionalData: new TextEncoder().encode(key) }, wrap, rec.ct);
  return unpack<T>(plain);
}

export function isExpired(rec: Pick<Sealed, 'expiresAt'>, now: number): boolean {
  return rec.expiresAt !== undefined && rec.expiresAt <= now;
}
