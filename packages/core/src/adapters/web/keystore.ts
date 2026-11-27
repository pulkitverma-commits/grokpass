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
// Passkey lock (opt-in, see `passkey` below): the records are re-sealed under a random data key
// that is never stored usable. It is kept encrypted under a key derived from a passkey's WebAuthn
// PRF output, and only exists in memory after the person passes Face ID / Touch ID / their PIN.
// A copied browser profile then holds nothing that opens the chats without that authenticator.
// While locked, get/put throw KeystoreLockedError instead of acting as if the store were empty.
//
// `indexedDB` is read from the global at call time (never captured), so tests can swap it.

import type { KeyStore } from '../../chat/ports';
import { seal, unseal, isExpired, type Sealed } from '../../chat/keystore';

const DB = 'onepeek-chat';
const VERSION = 1;
const STORES = ['meta', 'sealed'] as const;

/** Thrown by get/put while the passkey lock is on and this page hasn't unlocked it. */
export class KeystoreLockedError extends Error {
  readonly code = 'keystore_locked';
  constructor() { super('keystore_locked'); }
}

/** What the passkey lock stores in `meta` under 'pk'. Nothing here opens the records by itself. */
type PasskeyMeta = {
  v: 1;
  credId: Uint8Array;   // the passkey whose PRF output unlocks this store
  salt: Uint8Array;     // PRF input (random, not secret)
  iv: Uint8Array;
  wrapped: ArrayBuffer; // AES-256-GCM(KEK, data key); KEK = HKDF(PRF output)
};

/** One PRF evaluation: the credential used and its 32-byte output (null when unsupported). */
export type PrfResult = { credId: Uint8Array; output: Uint8Array | null };
/** Runs a WebAuthn assertion with the PRF extension. Null when the person cancels. */
export type PrfProvider = (req: { credId?: Uint8Array; salt: Uint8Array }) => Promise<PrfResult | null>;

export type PasskeyLockStatus = 'off' | 'locked' | 'unlocked';

const PK = 'pk';
const PK_INFO = new TextEncoder().encode('onepeek-chat-keystore-v1');

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

/** One read-write transaction over both stores, so a re-seal commits all at once or not at all. */
async function txBoth(fn: (meta: IDBObjectStore, sealed: IDBObjectStore) => void): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(['meta', 'sealed'], 'readwrite');
      fn(t.objectStore('meta'), t.objectStore('sealed'));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

async function allSealed(): Promise<[string, Sealed][]> {
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
  return rows;
}

// Data keys unlocked with a passkey in this page, per database. Memory only: a reload locks again.
const unlockedKeys = new Map<string, CryptoKey>();

/** Tells other tabs the store's key changed (passkey lock turned on/off) so they reload. */
function announceKeyChange() {
  try { new BroadcastChannel('onepeek-chat').postMessage({ t: 'keystore' }); } catch { /* ignore */ }
}

async function kekFrom(prf: Uint8Array, credId: Uint8Array): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', prf as BufferSource, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: credId as BufferSource, info: PK_INFO }, ikm,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function importDataKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * The browser's PRF provider: a WebAuthn assertion with the `prf` extension and user verification
 * required. The challenge is random and never sent anywhere: the assertion isn't used to log in,
 * only to make the authenticator compute PRF(salt), which it does only after Face ID / PIN.
 * Account passkeys are registered for onepeek.io, so that is the relying party on the live site.
 */
export const webPrf: PrfProvider = async ({ credId, salt }) => {
  if (typeof navigator === 'undefined' || !navigator.credentials || typeof PublicKeyCredential === 'undefined') return { credId: new Uint8Array(), output: null };
  const host = location.hostname;
  const rpId = host === 'onepeek.io' || host.endsWith('.onepeek.io') ? 'onepeek.io' : host;
  let cred: PublicKeyCredential | null;
  try {
    cred = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId,
        userVerification: 'required',
        timeout: 120_000,
        allowCredentials: credId ? [{ type: 'public-key', id: credId as BufferSource }] : [],
        extensions: { prf: { eval: { first: salt as BufferSource } } } as AuthenticationExtensionsClientInputs,
      },
    }) as PublicKeyCredential | null;
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return null;
    throw e;
  }
  if (!cred) return null;
  const out = (cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }).prf?.results?.first;
  return { credId: new Uint8Array(cred.rawId), output: out ? new Uint8Array(out) : null };
};

// One wrapping-key cache per database, shared by every store instance in the page: two instances
// racing on first use would otherwise each generate a key and the loser's records would be
// unreadable, and wipe() on one instance would leave the other holding a destroyed key.
const wrapKeys = new Map<string, Promise<CryptoKey>>();

async function passkeyMeta(): Promise<PasskeyMeta | undefined> {
  return tx<PasskeyMeta>('meta', 'readonly', s => s.get(PK));
}

/**
 * The key that seals records: the passkey-unlocked data key when the passkey lock is on (checked on
 * every call, so a tab never keeps writing under a device key another tab just retired), otherwise
 * the device's stored wrapping key.
 */
async function wrappingKey(db: string): Promise<CryptoKey> {
  if (await passkeyMeta()) {
    const k = unlockedKeys.get(db);
    if (!k) throw new KeystoreLockedError();
    return k;
  }
  return deviceKey(db);
}

function deviceKey(db: string): Promise<CryptoKey> {
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
export function createWebKeyStore(opts: { prf?: PrfProvider } = {}): KeyStore & { passkey: PasskeyLock } {
  const prf = opts.prf ?? webPrf;
  async function put(key: string, value: unknown, expiresAt?: number) {
    const rec = await seal(await wrappingKey(DB), key, value, expiresAt);
    await tx('sealed', 'readwrite', s => s.put(rec satisfies Sealed, key));
  }

  async function get<T>(key: string): Promise<T | null> {
    const rec = await tx<Sealed>('sealed', 'readonly', s => s.get(key));
    if (!rec) return null;
    if (isExpired(rec, Date.now())) { await del(key); return null; }
    // Outside the try: while passkey-locked this throws, rather than reporting "no such record"
    // (which would make the client register a fresh device).
    const wrap = await wrappingKey(DB);
    try {
      return await unseal<T>(wrap, key, rec);
    } catch {
      // Another instance may have wiped and re-created the key since we cached ours: re-read it
      // from IndexedDB once. If it still fails the record was written under a destroyed key (wipe)
      // or tampered with.
      wrapKeys.delete(DB);
      const again = await wrappingKey(DB);
      try { return await unseal<T>(again, key, rec); } catch { return null; }
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
    const rows = await allSealed();
    const dead = rows.filter(([, v]) => isExpired(v, now)).map(([k]) => k);
    if (dead.length) await tx('sealed', 'readwrite', s => { for (const k of dead) s.delete(k); });
    return dead.length;
  }

  /** Destroys the wrapping key first (instantly making all data unreadable), then the records. */
  async function wipe() {
    wrapKeys.delete(DB);
    unlockedKeys.delete(DB);
    await tx('meta', 'readwrite', s => { s.delete('wrap'); s.delete(PK); });
    // Again: a put() that raced the delete above may have re-read and cached the old key.
    wrapKeys.delete(DB);
    await tx('sealed', 'readwrite', s => s.clear());
  }

  /** Decrypts every live record with `from` and seals it again with `to`. Unreadable ones are dropped. */
  async function reseal(from: CryptoKey, to: CryptoKey): Promise<[string, Sealed][]> {
    const now = Date.now();
    const out: [string, Sealed][] = [];
    for (const [key, rec] of await allSealed()) {
      if (isExpired(rec, now)) continue;
      let value: unknown;
      try { value = await unseal(from, key, rec); } catch { continue; }
      out.push([key, await seal(to, key, value, rec.expiresAt)]);
    }
    return out;
  }

  const passkey: PasskeyLock = {
    async status() {
      if (!(await passkeyMeta())) return 'off';
      return unlockedKeys.has(DB) ? 'unlocked' : 'locked';
    },

    async enable() {
      if (await passkeyMeta()) throw new Error('already_on');
      const device = await deviceKey(DB);
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const r = await prf({ salt });
      if (!r) throw new Error('cancelled');
      if (!r.output) throw new Error('prf_unsupported');
      const raw = crypto.getRandomValues(new Uint8Array(32));
      try {
        const dataKey = await importDataKey(raw);
        const records = await reseal(device, dataKey);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: PK_INFO }, await kekFrom(r.output, r.credId), raw as BufferSource);
        const meta: PasskeyMeta = { v: 1, credId: r.credId, salt, iv, wrapped };
        // All at once: the records under the new key, the sealed data key, and the device key gone.
        await txBoth((m, sealed) => {
          sealed.clear();
          for (const [key, rec] of records) sealed.put(rec, key);
          m.put(meta, PK);
          m.delete('wrap');
        });
        wrapKeys.delete(DB);
        unlockedKeys.set(DB, dataKey);
        announceKeyChange();
      } finally {
        raw.fill(0);
        r.output.fill(0);
      }
    },

    async unlock() {
      const meta = await passkeyMeta();
      if (!meta) return;
      const r = await prf({ credId: meta.credId, salt: meta.salt });
      if (!r) throw new Error('cancelled');
      if (!r.output) throw new Error('prf_unsupported');
      let raw: Uint8Array | null = null;
      try {
        try {
          raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: meta.iv as BufferSource, additionalData: PK_INFO },
            await kekFrom(r.output, meta.credId), meta.wrapped));
        } catch {
          throw new Error('wrong_passkey');
        }
        unlockedKeys.set(DB, await importDataKey(raw));
      } finally {
        raw?.fill(0);
        r.output.fill(0);
      }
    },

    lockNow() {
      unlockedKeys.delete(DB);
    },

    async disable() {
      if (!(await passkeyMeta())) return;
      const dataKey = unlockedKeys.get(DB);
      if (!dataKey) throw new KeystoreLockedError();
      const device = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const records = await reseal(dataKey, device);
      await txBoth((m, sealed) => {
        sealed.clear();
        for (const [key, rec] of records) sealed.put(rec, key);
        m.put(device, 'wrap');
        m.delete(PK);
      });
      unlockedKeys.delete(DB);
      wrapKeys.set(DB, Promise.resolve(device));
      announceKeyChange();
    },
  };

  return { get, put, del, delPrefix, keys, sweep, wipe, passkey };
}

/**
 * The passkey lock on this browser's store. `enable` asks for a passkey, re-seals every record
 * under a new data key protected by that passkey's PRF output, and deletes the device key.
 * `unlock` asks for the same passkey again (once per page load). `disable` needs it unlocked.
 * Errors: 'cancelled', 'prf_unsupported' (this passkey or browser can't do PRF), 'wrong_passkey'.
 */
export interface PasskeyLock {
  status(): Promise<PasskeyLockStatus>;
  enable(): Promise<void>;
  unlock(): Promise<void>;
  lockNow(): void;
  disable(): Promise<void>;
}
