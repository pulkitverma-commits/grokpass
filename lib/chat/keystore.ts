// Local, encrypted storage for Secret Chat (browser only).
//
// Everything sensitive (MLS group state, private key packages, the signing key, decrypted
// messages) is sealed with AES-256-GCM under a *non-extractable* wrapping key. IndexedDB
// stores that CryptoKey object itself, so page scripts can use it but can never read its
// bytes. This is software protection: a browser profile copied off a device together with
// its key store can still be opened. It is not hardware-backed, and we don't claim it is.
//
// Panic Exit / Burn call wipe(): deleting the wrapping key makes every sealed record unreadable
// at once, even if deleting the records themselves is interrupted.

import { toB64Url, fromB64Url } from '../crypto';

const DB = 'onepeek-chat';
const VERSION = 1;
const STORES = ['meta', 'sealed'] as const;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: (typeof STORES)[number], mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => resolve(r ? r.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

let wrapKey: Promise<CryptoKey> | null = null;
function wrappingKey(): Promise<CryptoKey> {
  return (wrapKey ??= (async () => {
    const existing = await tx<CryptoKey>('meta', 'readonly', s => s.get('wrap'));
    if (existing) return existing;
    const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await tx('meta', 'readwrite', s => s.put(k, 'wrap'));
    return k;
  })());
}

// Tagged JSON so Uint8Array and bigint survive the round trip.
function pack(v: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(v, (_k, x) => {
    if (x instanceof Uint8Array) return { $b: toB64Url(x) };
    if (typeof x === 'bigint') return { $n: x.toString() };
    return x;
  }));
}
function unpack<T>(b: ArrayBuffer): T {
  return JSON.parse(new TextDecoder().decode(b), (_k, x) => {
    if (x && typeof x === 'object' && typeof x.$b === 'string' && Object.keys(x).length === 1) return fromB64Url(x.$b);
    if (x && typeof x === 'object' && typeof x.$n === 'string' && Object.keys(x).length === 1) return BigInt(x.$n);
    return x;
  });
}

type Sealed = { iv: Uint8Array; ct: ArrayBuffer; expiresAt?: number };

/** Stores a value encrypted. `expiresAt` (ms) makes get() refuse and delete it afterwards. */
export async function put(key: string, value: unknown, expiresAt?: number) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // The record key is bound as associated data so sealed blobs can't be swapped between keys.
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(key) }, await wrappingKey(), pack(value) as BufferSource);
  await tx('sealed', 'readwrite', s => s.put({ iv, ct, expiresAt } satisfies Sealed, key));
}

export async function get<T>(key: string): Promise<T | null> {
  const rec = await tx<Sealed>('sealed', 'readonly', s => s.get(key));
  if (!rec) return null;
  if (rec.expiresAt !== undefined && rec.expiresAt <= Date.now()) { await del(key); return null; }
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv as BufferSource, additionalData: new TextEncoder().encode(key) }, await wrappingKey(), rec.ct);
    return unpack<T>(plain);
  } catch {
    return null;  // wrong key (after a wipe) or tampered record
  }
}

export async function del(key: string) {
  await tx('sealed', 'readwrite', s => s.delete(key));
}

/** Deletes every record whose key starts with `prefix` (e.g. everything for one room). */
export async function delPrefix(prefix: string) {
  const keys = (await tx<IDBValidKey[]>('sealed', 'readonly', s => s.getAllKeys())) ?? [];
  await tx('sealed', 'readwrite', s => { for (const k of keys) if (String(k).startsWith(prefix)) s.delete(k); });
}

export async function keys(prefix = ''): Promise<string[]> {
  const all = (await tx<IDBValidKey[]>('sealed', 'readonly', s => s.getAllKeys())) ?? [];
  return all.map(String).filter(k => k.startsWith(prefix));
}

/** Removes expired records (call on load and on a timer). */
export async function sweep() {
  const now = Date.now();
  const rows: [string, Sealed][] = [];
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('sealed', 'readonly');
      const c = t.objectStore('sealed').openCursor();
      c.onsuccess = () => { const cur = c.result; if (cur) { rows.push([String(cur.key), cur.value as Sealed]); cur.continue(); } };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } finally { db.close(); }
  const dead = rows.filter(([, v]) => v.expiresAt !== undefined && v.expiresAt <= now).map(([k]) => k);
  if (dead.length) await tx('sealed', 'readwrite', s => { for (const k of dead) s.delete(k); });
  return dead.length;
}

/** Destroys the wrapping key first (instantly making all data unreadable), then the records. */
export async function wipe() {
  wrapKey = null;
  await tx('meta', 'readwrite', s => s.delete('wrap'));
  await tx('sealed', 'readwrite', s => s.clear());
}
