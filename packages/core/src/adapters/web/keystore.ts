// Local, encrypted storage for Secret Chat in the browser (the web KeyStore).
//
// Everything sensitive (MLS group state, private key packages, the signing key, decrypted
// messages) is sealed with AES-256-GCM under a *non-extractable* wrapping key. IndexedDB
// stores that CryptoKey object itself, so page scripts can use it but can never read its
// bytes. This is software protection: a browser profile copied off a device together with
// its key store can still be opened. It is not hardware-backed, and we don't claim it is.
//
// Panic Exit / Burn call wipe(): deleting the wrapping key makes every sealed record unreadable
// at once, even if deleting the records themselves is interrupted.
//
// `indexedDB` is read from the global at call time (never captured), so tests can swap it.

import type { KeyStore } from '../../chat/ports';
import { seal, unseal, isExpired, type Sealed } from '../../chat/keystore';

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

// One wrapping-key cache per database, shared by every store instance in the page: two instances
// racing on first use would otherwise each generate a key and the loser's records would be
// unreadable, and wipe() on one instance would leave the other holding a destroyed key.
const wrapKeys = new Map<string, Promise<CryptoKey>>();

function wrappingKey(db: string): Promise<CryptoKey> {
  let p = wrapKeys.get(db);
  if (p) return p;
  p = (async () => {
    const existing = await tx<CryptoKey>('meta', 'readonly', s => s.get('wrap'));
    if (existing) return existing;
    const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await tx('meta', 'readwrite', s => s.put(k, 'wrap'));
    return k;
  })();
  wrapKeys.set(db, p);
  p.catch(() => { if (wrapKeys.get(db) === p) wrapKeys.delete(db); });
  return p;
}

/**
 * Builds the browser KeyStore. Instances share the wrapping key (cached per database); the web
 * app creates one (lib/chat/keystore.ts) and hands it to the chat client.
 */
export function createWebKeyStore(): KeyStore {
  async function put(key: string, value: unknown, expiresAt?: number) {
    const rec = await seal(await wrappingKey(DB), key, value, expiresAt);
    await tx('sealed', 'readwrite', s => s.put(rec satisfies Sealed, key));
  }

  async function get<T>(key: string): Promise<T | null> {
    const rec = await tx<Sealed>('sealed', 'readonly', s => s.get(key));
    if (!rec) return null;
    if (isExpired(rec, Date.now())) { await del(key); return null; }
    try {
      return await unseal<T>(await wrappingKey(DB), key, rec);
    } catch {
      // Another instance may have wiped and re-created the key since we cached ours: re-read it
      // from IndexedDB once. If it still fails the record was written under a destroyed key (wipe)
      // or tampered with.
      wrapKeys.delete(DB);
      try { return await unseal<T>(await wrappingKey(DB), key, rec); } catch { return null; }
    }
  }

  async function del(key: string) {
    await tx('sealed', 'readwrite', s => s.delete(key));
  }

  async function delPrefix(prefix: string) {
    const keys = (await tx<IDBValidKey[]>('sealed', 'readonly', s => s.getAllKeys())) ?? [];
    await tx('sealed', 'readwrite', s => { for (const k of keys) if (String(k).startsWith(prefix)) s.delete(k); });
  }

  async function keys(prefix = ''): Promise<string[]> {
    const all = (await tx<IDBValidKey[]>('sealed', 'readonly', s => s.getAllKeys())) ?? [];
    return all.map(String).filter(k => k.startsWith(prefix));
  }

  /** Removes expired records (call on load and on a timer). */
  async function sweep() {
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
    const dead = rows.filter(([, v]) => isExpired(v, now)).map(([k]) => k);
    if (dead.length) await tx('sealed', 'readwrite', s => { for (const k of dead) s.delete(k); });
    return dead.length;
  }

  /** Destroys the wrapping key first (instantly making all data unreadable), then the records. */
  async function wipe() {
    wrapKeys.delete(DB);
    await tx('meta', 'readwrite', s => s.delete('wrap'));
    // Again: a put() that raced the delete above may have re-read and cached the old key.
    wrapKeys.delete(DB);
    await tx('sealed', 'readwrite', s => s.clear());
  }

  return { get, put, del, delPrefix, keys, sweep, wipe };
}
