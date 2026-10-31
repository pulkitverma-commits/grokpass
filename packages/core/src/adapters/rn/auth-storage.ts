// Sealed `auth.storage` for supabase-js on React Native.
//
// supabase-js persists the session as one JSON string (access token, refresh token, user) under a
// key it chooses, plus a few small PKCE entries. On the phones that string must not sit in plaintext
// SQLite, and it does not fit expo-secure-store either (iOS caps a Keychain item at 2048 bytes, the
// session is larger). So the values go through the same sealing as the chat keystore: AES-256-GCM
// under a wrapping key held in SecureStore `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, ciphertext rows in
// SQLite, the storage key bound as additional data (see ./keystore.ts).
//
// The store has its own database file (`onepeek-auth.db`) and its own SecureStore entry
// (`onepeek.wrap.auth`): the review's "one database per entry" rule (N1), and so that a chat-keystore
// wipe (Burn, revoking this device) does not also sign the phone out, as on the web where the session
// lives outside IndexedDB. `resetThisPhone()` in the app wipes both.
//
// A refresh token that can no longer be unsealed is not data worth protecting from deletion: if the
// wrapping key is gone while rows exist (`keystore_unavailable`), the store wipes itself and reports
// "no session", so the user signs in again instead of being stuck. A transient SecureStore failure
// (Keychain not yet available) also reads as "no session" for that call and is not destructive.

import type { KeyStore } from '../../chat/ports';
import { ChatError } from '../../chat/client';
import { createRnKeyStore, type RnKeyStoreOptions } from './keystore';

/** The `auth.storage` shape supabase-js accepts (string values, async). */
export interface RnAuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** Destroys the wrapping key, then every row: the phone is signed out and nothing is recoverable. */
  wipe(): Promise<void>;
}

export const AUTH_DB_NAME = 'onepeek-auth.db';
export const AUTH_WRAP_KEY_ID = 'onepeek.wrap.auth';
/** Record-key prefix inside the sealed store, so a storage key can never collide with chat records. */
export const AUTH_PREFIX = 'auth:';

export type RnAuthStorageOptions =
  /** Own file and entry (the app). `dbName` / `wrapKeyId` default to AUTH_DB_NAME / AUTH_WRAP_KEY_ID. */
  | RnKeyStoreOptions
  /** An existing sealed store (tests, or an app that wants one file for everything). */
  | { keystore: KeyStore };

/** Builds the sealed `auth.storage`. Never logs or returns anything but what supabase-js stored. */
export function createRnAuthStorage(opts: RnAuthStorageOptions): RnAuthStorage {
  const ks: KeyStore = 'keystore' in opts
    ? opts.keystore
    : createRnKeyStore({ ...opts, dbName: opts.dbName ?? AUTH_DB_NAME, wrapKeyId: opts.wrapKeyId ?? AUTH_WRAP_KEY_ID });
  const rk = (key: string) => AUTH_PREFIX + key;

  const unavailable = (e: unknown) => e instanceof ChatError && e.code === 'keystore_unavailable';

  async function getItem(key: string): Promise<string | null> {
    let v: unknown;
    try {
      v = await ks.get<unknown>(rk(key));
    } catch (e) {
      if (unavailable(e)) await ks.wipe();   // dead rows under a lost key: start over
      return null;
    }
    return typeof v === 'string' ? v : null;
  }

  async function setItem(key: string, value: string): Promise<void> {
    if (typeof value !== 'string') throw new TypeError('auth storage values must be strings');
    try {
      await ks.put(rk(key), value);
    } catch (e) {
      if (!unavailable(e)) throw e;
      await ks.wipe();
      await ks.put(rk(key), value);
    }
  }

  async function removeItem(key: string): Promise<void> {
    await ks.del(rk(key));
  }

  return { getItem, setItem, removeItem, wipe: () => ks.wipe() };
}
