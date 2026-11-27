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
// that is stored only AES-KW-wrapped under a key derived from a passkey's WebAuthn PRF output, and
// is unwrapped (non-extractable) into memory only after the person passes Face ID / Touch ID /
// their PIN. While locked, get/put throw KeystoreLockedError instead of acting as if the store
// were empty. Limits (docs/secret-chat/known-limitations.md): it protects data written after it is
// turned on, not copies taken before; it does not rotate the device's MLS or signing keys; script
// running on onepeek.io can still ask for the passkey and, if the person approves, get the key.
//
// Concurrency: every operation runs under a Web Lock shared by all tabs of the origin. Reads and
// writes take it shared; wipe, turning the lock on/off and first-time key creation take it
// exclusively, so a re-seal never races a write and no tab keeps writing under a retired key.
// The current key is read from IndexedDB inside the lock on every call (no cache).
//
// `indexedDB` is read from the global at call time (never captured), so tests can swap it.

import type { KeyStore } from '../../chat/ports';
import { seal, unseal, isExpired, type Sealed } from '../../chat/keystore';

const DB = 'onepeek-chat';
const VERSION = 1;
const STORES = ['meta', 'sealed'] as const;
const LOCK_NAME = 'onepeek-chat-keystore';

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
  wrapped: ArrayBuffer; // AES-KW(KEK, data key); KEK = HKDF-SHA256(PRF output, salt = credId)
};

/** One PRF evaluation: the credential used and its 32-byte output (null when unsupported). */
export type PrfResult = { credId: Uint8Array; output: Uint8Array | null };
/** Runs a WebAuthn assertion with the PRF extension. Null when the person cancels. */
export type PrfProvider = (req: { credId?: Uint8Array; salt: Uint8Array }) => Promise<PrfResult | null>;

export type PasskeyLockStatus = 'off' | 'locked' | 'unlocked';

const PK = 'pk';
const PK_INFO = new TextEncoder().encode('onepeek-chat-keystore-v1');

/** Identifies this page in key-change broadcasts, so it can ignore its own. */
export const KEYSTORE_TAB_ID = Math.random().toString(36).slice(2);

// ---------------------------------------------------------------------------- IndexedDB

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('keystore_blocked'));
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

/** The device key and the passkey lock record, read together. */
async function readMeta(): Promise<{ wrap?: CryptoKey; pk?: PasskeyMeta }> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction('meta', 'readonly');
      const s = t.objectStore('meta');
      const w = s.get('wrap');
      const p = s.get(PK);
      t.oncomplete = () => resolve({ wrap: w.result as CryptoKey | undefined, pk: p.result as PasskeyMeta | undefined });
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('aborted'));
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
      t.onabort = () => reject(t.error ?? new Error('aborted'));
    });
  } finally { db.close(); }
  return rows;
}

// ---------------------------------------------------------------------------- locking

// Fallback where the Web Locks API is missing: one queue per page, everything exclusive.
let fallbackChain: Promise<unknown> = Promise.resolve();

/**
 * Runs `fn` under the keystore's cross-tab lock. Never call it from inside another locked
 * section: a queued exclusive request would wait for the outer holder and deadlock.
 */
function withLock<T>(mode: LockMode, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks?.request) return locks.request(LOCK_NAME, { mode }, fn) as Promise<T>;
  const run = fallbackChain.then(fn, fn);
  fallbackChain = run.catch(() => {});
  return run;
}

// Chat operations (send to the server, then save state) hold OPS_LOCK shared for their whole run;
// anything that drops or changes the key (turning the lock on/off, re-locking) takes it
// exclusively, so it waits for in-flight operations instead of leaving a room's saved state behind
// the server's. Shared holds are counted per page, so nested operations never queue behind a
// waiting exclusive request (which would deadlock). The cost: a page that is constantly busy
// re-locks only once it goes quiet.
const OPS_LOCK = 'onepeek-chat-operations';
let opsActive = 0;
let opsHeld: Promise<void> | null = null;
let opsRelease: (() => void) | null = null;

/** Runs a chat operation while holding the operations lock shared (re-entrant within the page). */
export async function chatOperation<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks?.request) return fn();
  if (opsActive++ === 0) {
    opsHeld = new Promise<void>((acquired, failed) => {
      locks.request(OPS_LOCK, { mode: 'shared' }, () => new Promise<void>(done => { opsRelease = done; acquired(); })).catch(failed);
    });
  }
  try {
    await opsHeld;
    return await fn();
  } finally {
    if (--opsActive === 0) { opsRelease?.(); opsRelease = null; opsHeld = null; }
  }
}

/** Waits until no chat operation runs in any tab, then runs `fn` with new ones held off. */
function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks?.request) return fn();
  return locks.request(OPS_LOCK, { mode: 'exclusive' }, fn) as Promise<T>;
}

// ---------------------------------------------------------------------------- keys

// Data keys unlocked with a passkey in this page, per database, with the salt of the lock record
// they came from. Memory only: a reload locks again.
const unlockedKeys = new Map<string, { key: CryptoKey; salt: Uint8Array }>();

/** The unlocked key, only if it belongs to the lock record on disk now (not one since replaced). */
function unlockedFor(pk: PasskeyMeta): CryptoKey | null {
  const u = unlockedKeys.get(DB);
  return u && sameBytes(u.salt, pk.salt) ? u.key : null;
}

/** The key records are sealed with right now, or null when none exists yet. Throws while locked. */
function currentKey(meta: { wrap?: CryptoKey; pk?: PasskeyMeta }): CryptoKey | null {
  if (meta.pk) {
    const k = unlockedFor(meta.pk);
    if (!k) throw new KeystoreLockedError();
    return k;
  }
  return meta.wrap ?? null;
}

/** Creates the device key if neither it nor a passkey lock exists. Exclusive lock only. */
async function ensureDeviceKey(): Promise<void> {
  const meta = await readMeta();
  if (meta.wrap || meta.pk) return;
  const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await tx('meta', 'readwrite', s => s.put(k, 'wrap'));
}

async function kekFrom(prf: Uint8Array, credId: Uint8Array): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', prf as BufferSource, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: credId as BufferSource, info: PK_INFO }, ikm,
    { name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

/** Unwraps the data key straight into a non-extractable CryptoKey: its bytes never reach JS. */
function unwrapDataKey(wrapped: ArrayBuffer, kek: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey('raw', wrapped, kek, 'AES-KW', { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Decrypts every live record with `from` and seals it again with `to`. Fails on any unreadable one. */
async function reseal(from: CryptoKey | null, to: CryptoKey): Promise<[string, Sealed][]> {
  const now = Date.now();
  const out: [string, Sealed][] = [];
  for (const [key, rec] of await allSealed()) {
    if (isExpired(rec, now)) continue;
    if (!from) throw new Error('unreadable_records');
    let value: unknown;
    try { value = await unseal(from, key, rec); } catch { throw new Error('unreadable_records'); }
    out.push([key, await seal(to, key, value, rec.expiresAt)]);
  }
  return out;
}

/** Tells other tabs the store's key changed (passkey lock turned on/off) so they reload. */
function announceKeyChange() {
  try { new BroadcastChannel('onepeek-chat').postMessage({ t: 'keystore', from: KEYSTORE_TAB_ID }); } catch { /* ignore */ }
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------------------------------------------------------------------------- WebAuthn PRF

/**
 * The browser's PRF provider: a WebAuthn assertion with the `prf` extension and user verification
 * required. The challenge is random and never sent anywhere: the assertion isn't used to log in,
 * only to make the authenticator compute PRF(salt), which it does only after Face ID / PIN; the
 * user-verified flag is checked here too. Account passkeys are registered for onepeek.io, so that
 * is the relying party on the live site.
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
  // authenticatorData byte 32 holds the flags; bit 2 (0x04) is "user verified".
  const flags = new Uint8Array((cred.response as AuthenticatorAssertionResponse).authenticatorData)[32] ?? 0;
  if (!(flags & 0x04)) throw new Error('not_verified');
  const out = (cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }).prf?.results?.first;
  return { credId: new Uint8Array(cred.rawId), output: out ? new Uint8Array(out) : null };
};

// ---------------------------------------------------------------------------- the store

/**
 * Builds the browser KeyStore. Instances in a page share the unlocked passkey key; the web app
 * creates one (lib/chat/keystore.ts) and hands it to the chat client.
 */
export function createWebKeyStore(opts: { prf?: PrfProvider } = {}): KeyStore & { passkey: PasskeyLock } {
  const prf = opts.prf ?? webPrf;

  async function put(key: string, value: unknown, expiresAt?: number) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const written = await withLock('shared', async () => {
        const k = currentKey(await readMeta());
        if (!k) return false;
        const rec = await seal(k, key, value, expiresAt);
        await tx('sealed', 'readwrite', s => s.put(rec satisfies Sealed, key));
        return true;
      });
      if (written) return;
      await withLock('exclusive', ensureDeviceKey);
    }
    throw new Error('keystore_unavailable');
  }

  function get<T>(key: string): Promise<T | null> {
    return withLock('shared', async () => {
      // The key first: while passkey-locked this throws even for a missing record, so a locked
      // store never looks like an empty one (which would make the client register a new device).
      const k = currentKey(await readMeta());
      const rec = await tx<Sealed>('sealed', 'readonly', s => s.get(key));
      if (!rec) return null;
      if (isExpired(rec, Date.now())) { await tx('sealed', 'readwrite', s => s.delete(key)); return null; }
      if (!k) return null;
      try { return await unseal<T>(k, key, rec); } catch { return null; } // written under a destroyed key, or tampered
    });
  }

  function del(key: string) {
    return withLock('shared', async () => { await tx('sealed', 'readwrite', s => s.delete(key)); });
  }

  function delPrefix(prefix: string) {
    return withLock('shared', async () => {
      const keys = (await tx<IDBValidKey[]>('sealed', 'readonly', s => s.getAllKeys())) ?? [];
      await tx('sealed', 'readwrite', s => { for (const k of keys) if (String(k).startsWith(prefix)) s.delete(k); });
    });
  }

  function keys(prefix = ''): Promise<string[]> {
    return withLock('shared', async () => {
      const all = (await tx<IDBValidKey[]>('sealed', 'readonly', s => s.getAllKeys())) ?? [];
      return all.map(String).filter(k => k.startsWith(prefix));
    });
  }

  /** Removes expired records (call on load and on a timer). */
  function sweep() {
    return withLock('shared', async () => {
      const now = Date.now();
      const dead = (await allSealed()).filter(([, v]) => isExpired(v, now)).map(([k]) => k);
      if (dead.length) await tx('sealed', 'readwrite', s => { for (const k of dead) s.delete(k); });
      return dead.length;
    });
  }

  /** Destroys the keys (device key and passkey lock) and every record in one transaction. */
  function wipe() {
    return withLock('exclusive', async () => {
      unlockedKeys.delete(DB);
      await txBoth((m, s) => { m.delete('wrap'); m.delete(PK); s.clear(); });
    });
  }

  const passkey: PasskeyLock = {
    async status() {
      const pk = (await readMeta()).pk;
      if (!pk) return 'off';
      return unlockedFor(pk) ? 'unlocked' : 'locked';
    },

    async enable() {
      // The prompt happens before taking the lock, so other tabs aren't blocked while it's open.
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const r = await prf({ salt });
      if (!r) throw new Error('cancelled');
      if (!r.output) throw new Error('prf_unsupported');
      try {
        const kek = await kekFrom(r.output, r.credId);
        await quietly(() => withLock('exclusive', async () => {
          const meta = await readMeta();
          if (meta.pk) throw new Error('already_on');
          const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
          const wrapped = await crypto.subtle.wrapKey('raw', fresh, kek, 'AES-KW');
          const dataKey = await unwrapDataKey(wrapped, kek); // the non-extractable copy we keep
          const records = await reseal(meta.wrap ?? null, dataKey);
          const pk: PasskeyMeta = { v: 1, credId: r.credId, salt, wrapped };
          // All at once: the records under the new key, the wrapped data key, the device key gone.
          await txBoth((m, sealed) => {
            sealed.clear();
            for (const [key, rec] of records) sealed.put(rec, key);
            m.put(pk, PK);
            m.delete('wrap');
          });
          unlockedKeys.set(DB, { key: dataKey, salt });
        }));
        announceKeyChange();
      } finally {
        r.output.fill(0);
      }
    },

    async unlock() {
      const before = (await readMeta()).pk;
      if (!before) throw new Error('not_on');
      const r = await prf({ credId: before.credId, salt: before.salt });
      if (!r) throw new Error('cancelled');
      if (!r.output) throw new Error('prf_unsupported');
      try {
        const kek = await kekFrom(r.output, before.credId);
        await withLock('shared', async () => {
          const pk = (await readMeta()).pk;
          // Turned off or re-enabled (another passkey/salt) while the prompt was open.
          if (!pk || !sameBytes(pk.salt, before.salt) || !sameBytes(pk.credId, before.credId)) throw new Error('changed');
          let dataKey: CryptoKey;
          try { dataKey = await unwrapDataKey(pk.wrapped, kek); } catch { throw new Error('wrong_passkey'); }
          unlockedKeys.set(DB, { key: dataKey, salt: pk.salt });
        });
      } finally {
        r.output.fill(0);
      }
    },

    lockNow() {
      unlockedKeys.delete(DB);
    },

    lockWhenIdle() {
      return quietly(async () => { unlockedKeys.delete(DB); });
    },

    async disable() {
      await quietly(() => withLock('exclusive', async () => {
        const meta = await readMeta();
        if (!meta.pk) return;
        const dataKey = unlockedFor(meta.pk);
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
      }));
      announceKeyChange();
    },
  };

  return { get, put, del, delPrefix, keys, sweep, wipe, passkey };
}

/**
 * The passkey lock on this browser's store. `enable` asks for a passkey, re-seals every record
 * under a new data key protected by that passkey's PRF output, and deletes the device key.
 * `unlock` asks for the same passkey again (once per page load). `disable` needs it unlocked.
 * Errors: 'cancelled', 'prf_unsupported' (this passkey or browser can't do PRF), 'not_verified',
 * 'wrong_passkey', 'changed' (turned off/on elsewhere meanwhile), 'unreadable_records' (a record
 * can't be opened with the current key; nothing is changed), 'already_on', 'not_on'.
 */
export interface PasskeyLock {
  status(): Promise<PasskeyLockStatus>;
  enable(): Promise<void>;
  unlock(): Promise<void>;
  /** Drops the key immediately (the page is about to go away, e.g. Panic Exit). */
  lockNow(): void;
  /** Drops the key once no chat operation is running in any tab (idle re-lock, Panic elsewhere). */
  lockWhenIdle(): Promise<void>;
  disable(): Promise<void>;
}
