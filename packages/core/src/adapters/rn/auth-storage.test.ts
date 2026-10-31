import { describe, it, expect, beforeEach } from 'vitest';
import { createRnAuthStorage, AUTH_DB_NAME, AUTH_WRAP_KEY_ID, AUTH_PREFIX } from './auth-storage';
import { createRnKeyStore, resetWrapCache, WRAP_KEY_ID, DB_NAME } from './keystore';
import { createSecureStoreMock, createSqliteMock, hasNodeSqlite, WHEN_UNLOCKED_THIS_DEVICE_ONLY, type SecureStoreMock, type SqliteMock } from '../../../test/rn-mocks';
import { forbidden, expectClean } from '../../../test/fixtures';

// What supabase-js writes: one JSON blob holding both tokens and the user (well over the 2048-byte
// iOS Keychain limit once a real JWT is in it), under a key it chooses.
const STORAGE_KEY = 'sb-xndotbjwzbkknewyuqvf-auth-token';
const ACCESS = 'eyJhbGciOiJIUzI1NiJ9.ACCESS-TOKEN-PAYLOAD-7f3a9c1d2e4b.SIGNATURE-0a1b2c3d4e5f';
const REFRESH = 'rt-9f8e7d6c5b4a3f2e1d0c-REFRESH-TOKEN';
const EMAIL = 'owner@example.test';
const SESSION = JSON.stringify({
  access_token: ACCESS, refresh_token: REFRESH, token_type: 'bearer', expires_in: 3600, expires_at: 1_800_000_000,
  user: { id: '10000000-0000-4000-8000-000000000001', email: EMAIL, app_metadata: {}, user_metadata: { padding: 'x'.repeat(2500) } },
});

function hex(u8: Uint8Array) { return Buffer.from(u8).toString('hex'); }
function latin1(u8: Uint8Array) { return Buffer.from(u8).toString('latin1'); }
function b64(u8: Uint8Array) { return Buffer.from(u8).toString('base64'); }

const SECRETS = [forbidden('session JSON', SESSION), forbidden('access token', ACCESS), forbidden('refresh token', REFRESH), forbidden('email', EMAIL)];

describe.skipIf(!hasNodeSqlite)('rn auth storage', () => {
  let log: string[];
  let secure: SecureStoreMock;
  let sqlite: SqliteMock;

  beforeEach(() => {
    resetWrapCache();
    log = [];
    secure = createSecureStoreMock(log);
    sqlite = createSqliteMock(log);
  });

  it('a value survives a round trip and an unknown key reads null', async () => {
    const storage = createRnAuthStorage({ secureStore: secure.module, sqlite: sqlite.module });
    expect(SESSION.length).toBeGreaterThan(2048);   // the case SecureStore alone cannot hold
    await storage.setItem(STORAGE_KEY, SESSION);
    expect(await storage.getItem(STORAGE_KEY)).toBe(SESSION);
    expect(await storage.getItem('sb-other')).toBeNull();
  });

  it('neither the SQLite rows nor SecureStore ever hold the session, the tokens or the email', async () => {
    const storage = createRnAuthStorage({ secureStore: secure.module, sqlite: sqlite.module });
    await storage.setItem(STORAGE_KEY, SESSION);
    await storage.setItem(`${STORAGE_KEY}-code-verifier`, 'pkce-verifier-0123456789abcdef');

    const rows = sqlite.dump();
    expect(rows.map(r => r.key)).toEqual([`${AUTH_PREFIX}${STORAGE_KEY}`, `${AUTH_PREFIX}${STORAGE_KEY}-code-verifier`]);
    const atRest = rows.map(r => `${r.key} ${hex(r.iv)} ${hex(r.ct)} ${latin1(r.ct)} ${b64(r.ct)}`).join('\n');
    expectClean(atRest, [...SECRETS, forbidden('pkce verifier', 'pkce-verifier-0123456789abcdef')], 'the SQLite rows');

    // SecureStore holds exactly one thing: the wrapping key, this device only, under its own entry.
    expect([...secure.items.keys()]).toEqual([AUTH_WRAP_KEY_ID]);
    expectClean([...secure.items].map(([k, v]) => `${k}=${v}`).join('\n'), SECRETS, 'SecureStore');
    expect(secure.setOptions.get(AUTH_WRAP_KEY_ID)).toEqual({ keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    // And the ciphertext is not the wrapping key either.
    expectClean(atRest, [forbidden('wrapping key', Buffer.from(secure.items.get(AUTH_WRAP_KEY_ID)!, 'base64url'))], 'the SQLite rows');
  });

  it('removeItem deletes the row; getItem then reads null', async () => {
    const storage = createRnAuthStorage({ secureStore: secure.module, sqlite: sqlite.module });
    await storage.setItem(STORAGE_KEY, SESSION);
    await storage.setItem('sb-keep', 'kept');
    await storage.removeItem(STORAGE_KEY);
    expect(await storage.getItem(STORAGE_KEY)).toBeNull();
    expect(sqlite.dump().map(r => r.key)).toEqual([`${AUTH_PREFIX}sb-keep`]);
    await storage.removeItem('never-stored');   // idempotent
  });

  it('uses its own database file and SecureStore entry, so a chat-keystore wipe does not sign the phone out', async () => {
    const storage = createRnAuthStorage({ secureStore: secure.module, sqlite: sqlite.module });
    const chat = createRnKeyStore({ secureStore: secure.module, sqlite: sqlite.module });
    await storage.setItem(STORAGE_KEY, SESSION);
    await chat.put('room:1:state', { s: 'alpha' });
    expect([...sqlite.opened.keys()]).toEqual([AUTH_DB_NAME, DB_NAME]);
    expect([...secure.items.keys()].sort()).toEqual([AUTH_WRAP_KEY_ID, WRAP_KEY_ID].sort());

    await chat.wipe();
    expect(await chat.get('room:1:state')).toBeNull();
    expect(await storage.getItem(STORAGE_KEY)).toBe(SESSION);

    await storage.wipe();
    expect(await storage.getItem(STORAGE_KEY)).toBeNull();
    expect(secure.items.has(AUTH_WRAP_KEY_ID)).toBe(false);
  });

  it('a lost wrapping key with rows present means "no session", the dead rows go, and sign-in works again', async () => {
    // One database handle for the whole case, like the one file the app has; relaunched stores reuse it.
    const db = sqlite.module.openDatabaseSync(AUTH_DB_NAME);
    const sameFile = { openDatabaseSync: () => db };
    const storage = createRnAuthStorage({ secureStore: secure.module, sqlite: sameFile });
    await storage.setItem(STORAGE_KEY, SESSION);
    expect(sqlite.dump()).toHaveLength(1);

    secure.items.delete(AUTH_WRAP_KEY_ID);   // Android Keystore reset, entry dropped by the platform
    resetWrapCache();                         // relaunch
    const relaunched = createRnAuthStorage({ secureStore: secure.module, sqlite: sameFile });
    expect(await relaunched.getItem(STORAGE_KEY)).toBeNull();   // no session, not an exception
    expect(sqlite.dump()).toHaveLength(0);                       // the dead rows are gone
    expect(sqlite.meta()).toEqual([]);
    await relaunched.setItem(STORAGE_KEY, SESSION);              // a new sign-in provisions a fresh key
    expect(await relaunched.getItem(STORAGE_KEY)).toBe(SESSION);
    expect(log.filter(l => l === `secure.set ${AUTH_WRAP_KEY_ID}`)).toHaveLength(2);   // first launch + re-provision
  });

  it('the same recovery runs when the first call after the key loss is a write', async () => {
    const db = sqlite.module.openDatabaseSync(AUTH_DB_NAME);
    const sameFile = { openDatabaseSync: () => db };
    const storage = createRnAuthStorage({ secureStore: secure.module, sqlite: sameFile });
    await storage.setItem(STORAGE_KEY, SESSION);
    await storage.setItem('sb-stale', 'old');
    secure.items.delete(AUTH_WRAP_KEY_ID);
    resetWrapCache();
    const relaunched = createRnAuthStorage({ secureStore: secure.module, sqlite: sameFile });
    await relaunched.setItem(STORAGE_KEY, 'fresh-session');
    expect(await relaunched.getItem(STORAGE_KEY)).toBe('fresh-session');
    expect(await relaunched.getItem('sb-stale')).toBeNull();     // everything sealed under the lost key went
    expect(sqlite.dump().map(r => r.key)).toEqual([`${AUTH_PREFIX}${STORAGE_KEY}`]);
  });

  it('a SecureStore that cannot be read right now reads as "no session" and deletes nothing', async () => {
    const db = sqlite.module.openDatabaseSync(AUTH_DB_NAME);
    const sameFile = { openDatabaseSync: () => db };
    const storage = createRnAuthStorage({ secureStore: secure.module, sqlite: sameFile });
    await storage.setItem(STORAGE_KEY, SESSION);
    resetWrapCache();
    const lockedPhone = createSecureStoreMock(log, { failReads: true });
    lockedPhone.items.set(AUTH_WRAP_KEY_ID, secure.items.get(AUTH_WRAP_KEY_ID)!);
    const relaunched = createRnAuthStorage({ secureStore: lockedPhone.module, sqlite: sameFile });
    expect(await relaunched.getItem(STORAGE_KEY)).toBeNull();
    expect(sqlite.dump()).toHaveLength(1);                       // still there for when the Keychain opens
    await expect(relaunched.setItem(STORAGE_KEY, 'x')).rejects.toThrow(/keychain unavailable/);
  });

  it('refuses non-string values and reads a non-string record as null', async () => {
    const storage = createRnAuthStorage({ secureStore: secure.module, sqlite: sqlite.module });
    await expect(storage.setItem('k', 42 as unknown as string)).rejects.toThrow(TypeError);
    const ks = createRnKeyStore({ secureStore: secure.module, sqlite: sqlite.module, dbName: ':memory:', wrapKeyId: 'onepeek.wrap.t' });
    const shared = createRnAuthStorage({ keystore: ks });
    await ks.put(`${AUTH_PREFIX}obj`, { not: 'a string' });
    expect(await shared.getItem('obj')).toBeNull();
    await shared.setItem('s', 'fine');
    expect(await shared.getItem('s')).toBe('fine');
  });
});
