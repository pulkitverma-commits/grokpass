// Local, encrypted storage for Secret Chat on the phones (the React Native KeyStore).
//
// Same record format as the browser store (see ../../chat/keystore.ts): every value is sealed
// with AES-256-GCM, the record key bound as additional data, `expiresAt` refused on read. What
// differs is where the two halves live:
//
//   wrapping key   32 random bytes, base64url, in expo-secure-store under `onepeek.wrap` with
//                  `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY` (iOS Keychain, not in
//                  backups, not restored to another device; Android: the Keystore-encrypted
//                  SharedPreferences expo-secure-store uses, with `allowBackup=false` set by the
//                  app). It is imported into `crypto.subtle` once per instance as a
//                  non-extractable key; the bytes are never kept in a JS variable after that.
//   sealed rows    expo-sqlite, file `onepeek-chat.db`, table
//                  `sealed(key TEXT PRIMARY KEY, iv BLOB, ct BLOB, expires_at INTEGER)`.
//                  The file holds only ciphertext. native-security (N3) excludes it from iOS
//                  and Android backups; even a copied database is useless without the device's
//                  SecureStore entry (asserted in keystore.test.ts).
//
// Panic Exit / Burn call wipe(): the SecureStore entry is deleted BEFORE any row, so every record
// becomes unreadable at once even if deleting the rows is interrupted.
//
// The expo modules are injected (`SecureStoreLike`, `SqliteModuleLike`) rather than imported, so
// nothing in packages/core pulls `expo-*` into the web build and tests can pass mocks. The
// mobile app does: `createRnKeyStore({ secureStore: SecureStore, sqlite: SQLite })`.

import type { KeyStore } from '../../chat/ports';
import { seal, unseal, isExpired, type Sealed } from '../../chat/keystore';
import { toB64Url, fromB64Url } from '../../crypto';

// ---- Injected module shapes (structural subsets of expo-secure-store and expo-sqlite)

/** Subset of `expo-secure-store`. `WHEN_UNLOCKED_THIS_DEVICE_ONLY` is the module constant. */
export interface SecureStoreLike {
  getItemAsync(key: string, options?: SecureStoreOptionsLike): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: SecureStoreOptionsLike): Promise<void>;
  deleteItemAsync(key: string, options?: SecureStoreOptionsLike): Promise<void>;
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: number;
}

export type SecureStoreOptionsLike = { keychainAccessible?: number; requireAuthentication?: boolean };

export type SqliteBindValue = string | number | null | Uint8Array;

/** Subset of `expo-sqlite`'s `SQLiteDatabase` (array-bound parameters only). */
export interface SqliteDatabaseLike {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: SqliteBindValue[]): Promise<{ changes: number }>;
  getFirstAsync<T>(sql: string, params: SqliteBindValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params: SqliteBindValue[]): Promise<T[]>;
}

/** Subset of the `expo-sqlite` module. */
export interface SqliteModuleLike {
  openDatabaseSync(name: string): SqliteDatabaseLike;
}

export interface RnKeyStoreOptions {
  secureStore: SecureStoreLike;
  sqlite: SqliteModuleLike;
  /** SQLite file name. Default `onepeek-chat.db`; tests use `:memory:`. */
  dbName?: string;
}

/** SecureStore entry holding the wrapping key. The lock flag (`onepeek.lock`) lives beside it. */
export const WRAP_KEY_ID = 'onepeek.wrap';
export const DB_NAME = 'onepeek-chat.db';

type Row = { key: string; iv: Uint8Array; ct: Uint8Array; expires_at: number | null };

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function fromRow(r: Row): Sealed {
  return { iv: new Uint8Array(r.iv), ct: toArrayBuffer(new Uint8Array(r.ct)), expiresAt: r.expires_at ?? undefined };
}

// One wrapping-key cache per SecureStore module (the app has a single one) and entry name, shared by
// every store instance: two instances racing on first use would otherwise each generate a key and
// the loser's rows would be unreadable, and wipe() on one would leave the other holding a destroyed
// key. Keyed by the module object so tests with separate mocks stay independent.
const wrapKeys = new WeakMap<SecureStoreLike, Map<string, Promise<CryptoKey>>>();

function cacheFor(secureStore: SecureStoreLike): Map<string, Promise<CryptoKey>> {
  let m = wrapKeys.get(secureStore);
  if (!m) { m = new Map(); wrapKeys.set(secureStore, m); }
  return m;
}

function wrappingKey(secureStore: SecureStoreLike, id: string, accessibility: SecureStoreOptionsLike): Promise<CryptoKey> {
  const cache = cacheFor(secureStore);
  let p = cache.get(id);
  if (p) return p;
  p = (async () => {
    let raw: Uint8Array;
    const stored = await secureStore.getItemAsync(id, accessibility);
    if (stored) {
      raw = fromB64Url(stored);
    } else {
      raw = crypto.getRandomValues(new Uint8Array(32));
      await secureStore.setItemAsync(id, toB64Url(raw), accessibility);
    }
    const k = await crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    raw.fill(0);
    return k;
  })();
  cache.set(id, p);
  p.catch(() => { if (cache.get(id) === p) cache.delete(id); });  // let the next call retry
  return p;
}

/** Builds the React Native KeyStore. Instances share the wrapping key (cached per SecureStore entry). */
export function createRnKeyStore(opts: RnKeyStoreOptions): KeyStore {
  const { secureStore } = opts;
  const accessibility: SecureStoreOptionsLike = { keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  const db = opts.sqlite.openDatabaseSync(opts.dbName ?? DB_NAME);
  const wrap = () => wrappingKey(secureStore, WRAP_KEY_ID, accessibility);
  const forgetWrap = () => cacheFor(secureStore).delete(WRAP_KEY_ID);

  let schema: Promise<void> | null = null;
  function ready(): Promise<SqliteDatabaseLike> {
    schema ??= db.execAsync(
      'CREATE TABLE IF NOT EXISTS sealed(key TEXT PRIMARY KEY NOT NULL, iv BLOB NOT NULL, ct BLOB NOT NULL, expires_at INTEGER)',
    );
    return schema.then(() => db);
  }

  async function put(key: string, value: unknown, expiresAt?: number) {
    const rec = await seal(await wrap(), key, value, expiresAt);
    await (await ready()).runAsync(
      'INSERT OR REPLACE INTO sealed(key, iv, ct, expires_at) VALUES (?, ?, ?, ?)',
      [key, rec.iv, new Uint8Array(rec.ct), rec.expiresAt ?? null],
    );
  }

  async function get<T>(key: string): Promise<T | null> {
    const row = await (await ready()).getFirstAsync<Row>('SELECT key, iv, ct, expires_at FROM sealed WHERE key = ?', [key]);
    if (!row) return null;
    const rec = fromRow(row);
    if (isExpired(rec, Date.now())) { await del(key); return null; }
    try {
      return await unseal<T>(await wrap(), key, rec);
    } catch {
      // Another instance may have wiped and re-created the key since we cached ours: re-read it from
      // SecureStore once. If it still fails the row was written under a destroyed key (wipe), came
      // from a database copied off another device, or was tampered with.
      forgetWrap();
      try { return await unseal<T>(await wrap(), key, rec); } catch { return null; }
    }
  }

  async function del(key: string) {
    await (await ready()).runAsync('DELETE FROM sealed WHERE key = ?', [key]);
  }

  async function keys(prefix = ''): Promise<string[]> {
    const rows = await (await ready()).getAllAsync<{ key: string }>('SELECT key FROM sealed ORDER BY key', []);
    return rows.map(r => r.key).filter(k => k.startsWith(prefix));
  }

  async function delPrefix(prefix: string) {
    const d = await ready();
    for (const k of await keys(prefix)) await d.runAsync('DELETE FROM sealed WHERE key = ?', [k]);
  }

  /** Removes expired records (call on launch and on a timer). */
  async function sweep() {
    const res = await (await ready()).runAsync('DELETE FROM sealed WHERE expires_at IS NOT NULL AND expires_at <= ?', [Date.now()]);
    return res.changes;
  }

  /** Destroys the wrapping key first (instantly making all data unreadable), then the rows. */
  async function wipe() {
    forgetWrap();
    await secureStore.deleteItemAsync(WRAP_KEY_ID, accessibility);
    await (await ready()).runAsync('DELETE FROM sealed', []);
  }

  return { get, put, del, delPrefix, keys, sweep, wipe };
}
