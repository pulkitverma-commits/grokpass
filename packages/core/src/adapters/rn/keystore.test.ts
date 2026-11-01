import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRnKeyStore, resetWrapCache, WRAP_KEY_ID } from './keystore';
import type { KeyStore } from '../../chat/ports';
import { createSecureStoreMock, createSqliteMock, hasNodeSqlite, WHEN_UNLOCKED_THIS_DEVICE_ONLY, type SecureStoreMock, type SqliteMock } from '../../../test/rn-mocks';
import type { SqliteModuleLike } from './keystore';
import { toB64Url } from '../../crypto';

// The same contract as adapters/web/keystore.test.ts, against the React Native store built on a
// Map-backed SecureStore and node:sqlite in memory (docs/mobile/test-plan.md §1.2 and §1.3).
//
// The wrapping-key cache is process-wide per SecureStore entry name (like the web adapter's per
// database name), so every case starts with `resetWrapCache()`: the equivalent of a relaunch.

function hex(u8: Uint8Array) { return Buffer.from(u8).toString('hex'); }
function latin1(u8: Uint8Array) { return Buffer.from(u8).toString('latin1'); }
function b64(u8: Uint8Array) { return Buffer.from(u8).toString('base64'); }

const UNAVAILABLE = { code: 'keystore_unavailable' };

describe.skipIf(!hasNodeSqlite)('rn keystore', () => {
  let log: string[];
  let secure: SecureStoreMock;
  let sqlite: SqliteMock;
  /** One database handle per case, like the one file the app has; "relaunched" stores reuse it. */
  let sameFile: SqliteModuleLike;
  let ks: KeyStore;

  beforeEach(() => {
    resetWrapCache();
    log = [];
    secure = createSecureStoreMock(log);
    sqlite = createSqliteMock(log);
    const db = sqlite.module.openDatabaseSync(':memory:');
    sameFile = { openDatabaseSync: () => db };
    ks = createRnKeyStore({ secureStore: secure.module, sqlite: sameFile });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  // ---- §1.2 contract (same assertions as the web store)

  it('round-trips bytes and bigints', async () => {
    await ks.put('room:1:state', { s: new Uint8Array([1, 2, 3]), e: BigInt(7) });
    expect(await ks.get('room:1:state')).toEqual({ s: new Uint8Array([1, 2, 3]), e: BigInt(7) });
  });

  it('handles large values (group state can be hundreds of KB)', async () => {
    const big = crypto.getRandomValues(new Uint8Array(65536));
    const huge = new Uint8Array(600_000); huge.set(big);
    await ks.put('room:big', { s: huge });
    expect((await ks.get<{ s: Uint8Array }>('room:big'))!.s).toEqual(huge);
  });

  it('stores only ciphertext at rest', async () => {
    await ks.put('msg:a', { body: 'VERY-SECRET-TEXT' });
    const raw = sqlite.dump();
    expect(raw).toHaveLength(1);
    expect(latin1(raw[0].ct)).not.toContain('VERY-SECRET-TEXT');
  });

  it('refuses and deletes expired records', async () => {
    await ks.put('msg:old', { body: 'gone' }, Date.now() - 1);
    await ks.put('msg:new', { body: 'here' }, Date.now() + 60_000);
    expect(await ks.get('msg:old')).toBeNull();
    expect(await ks.keys('msg:')).toEqual(['msg:new']);
    await ks.put('msg:old2', { body: 'gone' }, Date.now() - 1);
    expect(await ks.sweep()).toBe(1);
  });

  it('a record moved to another key fails to decrypt', async () => {
    await ks.put('a', { v: 'alpha' });
    const raw = sqlite.dump()[0];
    sqlite.insert([{ ...raw, key: 'b' }]);
    expect(await ks.get('b')).toBeNull();
    expect(await ks.get('a')).toEqual({ v: 'alpha' });
  });

  it('wipe makes everything unreadable and removes it', async () => {
    await ks.put('room:1:state', { s: 1 });
    await ks.put('room:2:state', { s: 2 });
    await ks.wipe();
    expect(await ks.get('room:1:state')).toBeNull();
    expect(await ks.keys()).toEqual([]);
    expect(secure.items.has(WRAP_KEY_ID)).toBe(false);
    expect(sqlite.dump()).toEqual([]);
    expect(sqlite.meta()).toEqual([]);   // the wiping marker is gone once the rows are
  });

  it('deletes by prefix', async () => {
    await ks.put('room:1:state', 1);
    await ks.put('room:1:msg:a', 2);
    await ks.put('room:2:state', 3);
    await ks.delPrefix('room:1:');
    expect(await ks.keys()).toEqual(['room:2:state']);
  });

  it('keys(prefix) are sorted and delete removes one', async () => {
    await ks.put('b', 1); await ks.put('a', 2); await ks.put('c', 3);
    expect(await ks.keys()).toEqual(['a', 'b', 'c']);
    await ks.del('b');
    expect(await ks.keys()).toEqual(['a', 'c']);
    expect(await ks.get('missing')).toBeNull();
  });

  // ---- §1.3 RN specifics

  it('stores the wrapping key with WHEN_UNLOCKED_THIS_DEVICE_ONLY and no biometric gate', async () => {
    await ks.put('x', 1);
    expect(secure.items.has(WRAP_KEY_ID)).toBe(true);
    expect(secure.setOptions.get(WRAP_KEY_ID)).toEqual({ keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    expect(secure.setOptions.get(WRAP_KEY_ID)?.requireAuthentication).toBeUndefined();
    // One key per device: a second put reuses it.
    await ks.put('y', 2);
    expect(log.filter(l => l === `secure.set ${WRAP_KEY_ID}`)).toHaveLength(1);
  });

  it('the SQLite file holds only ciphertext: no plaintext, hex, base64 or wrapping key bytes', async () => {
    const BODY = 'the-quick-brown-fox-jumps';
    await ks.put('room:1:state', { secret: BODY });
    const rows = sqlite.dump();
    const everything = rows.flatMap(r => [latin1(r.iv), hex(r.iv), b64(r.iv), latin1(r.ct), hex(r.ct), b64(r.ct), r.key]).join('\n');
    const bodyBytes = new TextEncoder().encode(BODY);
    for (const needle of [BODY, hex(bodyBytes), b64(bodyBytes), toB64Url(bodyBytes)]) expect(everything).not.toContain(needle);
    const wrapB64Url = secure.items.get(WRAP_KEY_ID)!;
    const wrapBytes = Buffer.from(wrapB64Url.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    for (const needle of [wrapB64Url, wrapBytes.toString('hex'), wrapBytes.toString('latin1'), wrapBytes.toString('base64')]) expect(everything).not.toContain(needle);
  });

  it('every record has a fresh 12-byte IV, even for the same key and value', async () => {
    await ks.put('same', { v: 'twice' });
    const first = sqlite.dump()[0];
    await ks.put('same', { v: 'twice' });
    const second = sqlite.dump()[0];
    expect(first.iv).toHaveLength(12);
    expect(second.iv).toHaveLength(12);
    expect(hex(first.iv)).not.toBe(hex(second.iv));
    expect(hex(first.ct)).not.toBe(hex(second.ct));
  });

  it('imports the wrapping key non-extractable and zeroes the raw bytes once the import has copied them', async () => {
    const importKey = vi.spyOn(crypto.subtle, 'importKey');
    await ks.put('x', { v: 'kept' });
    const wrapCalls = importKey.mock.calls.filter(c => c[0] === 'raw' && (c[2] as { name: string }).name === 'AES-GCM');
    expect(wrapCalls).toHaveLength(1);
    const [, raw, , extractable, usages] = wrapCalls[0];
    expect(extractable).toBe(false);
    expect(usages).toEqual(['encrypt', 'decrypt']);
    expect(raw).toBeInstanceOf(Uint8Array);
    expect((raw as Uint8Array).length).toBe(32);
    // The very buffer handed to importKey was wiped afterwards...
    expect(Array.from(raw as Uint8Array).every(b => b === 0)).toBe(true);
    // ...and the key still works, so the import copied the bytes rather than keeping a view.
    expect(await ks.get('x')).toEqual({ v: 'kept' });
    await ks.put('y', { v: 'later' });
    expect(await ks.get('y')).toEqual({ v: 'later' });
    // The stored key is not all zeros either.
    expect(secure.items.get(WRAP_KEY_ID)).not.toBe(toB64Url(new Uint8Array(32)));
  });

  it('wipe deletes the SecureStore key before any row is deleted', async () => {
    await ks.put('room:1:state', { s: 1 });
    log.length = 0;
    await ks.wipe();
    const keyDelete = log.indexOf(`secure.delete ${WRAP_KEY_ID}`);
    const firstRowDelete = log.findIndex(l => /^sql DELETE/i.test(l));
    expect(keyDelete).toBeGreaterThanOrEqual(0);
    expect(firstRowDelete).toBeGreaterThan(keyDelete);
  });

  it('rows captured before a wipe are unreadable afterwards, even re-inserted', async () => {
    await ks.put('room:1:state', { s: 'alpha' });
    await ks.put('room:2:state', { s: 'beta' });
    const before = sqlite.dump();
    await ks.wipe();
    // The store keeps working with its new key (the table is empty, so provisioning is allowed).
    await ks.put('room:3:state', { s: 'gamma' });
    expect(await ks.get('room:3:state')).toEqual({ s: 'gamma' });
    sqlite.insert(before);
    expect(await ks.keys()).toEqual(['room:1:state', 'room:2:state', 'room:3:state']);
    expect(await ks.get('room:1:state')).toBeNull();
    expect(await ks.get('room:2:state')).toBeNull();
    expect(await ks.get('room:3:state')).toEqual({ s: 'gamma' });
  });

  it('a copied database is unreadable on another device: keystore_unavailable, never a silent new key', async () => {
    await ks.put('room:1:state', { s: 'alpha' });
    const rows = sqlite.dump();
    // Another device: its own SecureStore (a different entry name stands in for a different Keychain).
    const otherSecure = createSecureStoreMock();
    const otherSqlite = createSqliteMock();
    const copy = createRnKeyStore({ secureStore: otherSecure.module, sqlite: otherSqlite.module, dbName: ':memory:', wrapKeyId: 'onepeek.wrap.other-device' });
    await copy.keys();  // creates the schema
    otherSqlite.insert(rows);
    expect(await copy.keys()).toEqual(['room:1:state']);
    await expect(copy.get('room:1:state')).rejects.toMatchObject(UNAVAILABLE);
    await expect(copy.put('room:2:state', 1)).rejects.toMatchObject(UNAVAILABLE);
    expect(otherSecure.items.size).toBe(0);   // nothing was provisioned behind the user's back
  });

  // ---- M1: a null from SecureStore while rows exist must not overwrite the device key

  it('M1: key missing but rows present → keystore_unavailable, rows kept, no key written; wipe() recovers', async () => {
    await ks.put('room:1:state', { s: 'alpha' });
    // The platform drops / invalidates the Keystore entry behind the store's back...
    secure.items.delete(WRAP_KEY_ID);
    resetWrapCache();   // ...and the app is relaunched over the same file.
    const fresh = createRnKeyStore({ secureStore: secure.module, sqlite: sameFile });
    log.length = 0;

    await expect(fresh.get('room:1:state')).rejects.toMatchObject(UNAVAILABLE);
    await expect(fresh.put('room:2:state', { s: 'beta' })).rejects.toMatchObject(UNAVAILABLE);
    expect(log.filter(l => l.startsWith('secure.set'))).toEqual([]);
    expect(secure.items.has(WRAP_KEY_ID)).toBe(false);
    expect(sqlite.dump().map(r => r.key)).toEqual(['room:1:state']);   // the row is still there
    expect(await fresh.keys()).toEqual(['room:1:state']);

    // Only an explicit wipe() may re-provision.
    await fresh.wipe();
    expect(sqlite.dump()).toEqual([]);
    await fresh.put('room:3:state', { s: 'gamma' });
    expect(secure.items.has(WRAP_KEY_ID)).toBe(true);
    expect(log.filter(l => l === `secure.set ${WRAP_KEY_ID}`)).toHaveLength(1);
    expect(await fresh.get('room:3:state')).toEqual({ s: 'gamma' });
  });

  it('M1: the decrypt-failure retry path cannot provision either', async () => {
    await ks.put('room:1:state', { s: 'alpha' });
    // Same process, key still cached; a row sealed by someone else fails to decrypt, the store
    // re-reads SecureStore, which has meanwhile lost the entry.
    const foreign = createSecureStoreMock();
    const foreignDb = createSqliteMock();
    const other = createRnKeyStore({ secureStore: foreign.module, sqlite: foreignDb.module, wrapKeyId: 'onepeek.wrap.foreign' });
    await other.put('room:1:state', { s: 'theirs' });
    sqlite.insert(foreignDb.dump());
    secure.items.delete(WRAP_KEY_ID);
    log.length = 0;
    await expect(ks.get('room:1:state')).rejects.toMatchObject(UNAVAILABLE);
    expect(log.filter(l => l.startsWith('secure.set'))).toEqual([]);
  });

  // ---- L2: an interrupted wipe is finished on the next launch instead of refusing

  it('L2: key deleted but the row delete failed → the next launch finishes the wipe and provisions', async () => {
    await ks.put('room:1:state', { s: 'alpha' });
    await ks.put('room:2:state', { s: 'beta' });
    sqlite.failOnce = /^DELETE FROM sealed$/;
    await expect(ks.wipe()).rejects.toThrow(/injected failure/);
    expect(secure.items.has(WRAP_KEY_ID)).toBe(false);
    expect(sqlite.dump()).toHaveLength(2);
    expect(sqlite.meta()).toEqual([{ k: 'wiping', v: '1' }]);

    // Relaunch over the same file.
    resetWrapCache();
    log.length = 0;
    const relaunched = createRnKeyStore({ secureStore: secure.module, sqlite: sameFile });
    expect(await relaunched.keys()).toEqual(['room:1:state', 'room:2:state']);   // dead metadata, until...
    await relaunched.put('room:3:state', { s: 'gamma' });                        // ...the first use finishes the wipe
    expect(await relaunched.keys()).toEqual(['room:3:state']);
    expect(sqlite.meta()).toEqual([]);
    expect(await relaunched.get('room:3:state')).toEqual({ s: 'gamma' });
    expect(log.filter(l => l === `secure.set ${WRAP_KEY_ID}`)).toHaveLength(1);
  });

  it('N2: a marker left by a wipe that died after the row delete is cleared on the next provisioning', async () => {
    await ks.put('room:1:state', { s: 'alpha' });
    sqlite.failOnce = /^DELETE FROM meta WHERE k = \?$/;
    await expect(ks.wipe()).rejects.toThrow(/injected failure/);
    expect(secure.items.has(WRAP_KEY_ID)).toBe(false);
    expect(sqlite.dump()).toHaveLength(0);
    expect(sqlite.meta()).toEqual([{ k: 'wiping', v: '1' }]);   // the stale marker

    // Relaunch; the first use provisions a key and must also drop the marker.
    resetWrapCache();
    const relaunched = createRnKeyStore({ secureStore: secure.module, sqlite: sameFile });
    await relaunched.put('room:3:state', { s: 'gamma' });
    expect(sqlite.meta()).toEqual([]);
    expect(await relaunched.get('room:3:state')).toEqual({ s: 'gamma' });

    // Months later the key is lost for real: with the marker gone this is keystore_unavailable, not a silent delete.
    secure.items.delete(WRAP_KEY_ID);
    resetWrapCache();
    const later = createRnKeyStore({ secureStore: secure.module, sqlite: sameFile });
    await expect(later.get('room:3:state')).rejects.toMatchObject(UNAVAILABLE);
    expect(sqlite.dump().map(r => r.key)).toEqual(['room:3:state']);
  });

  it('L2: without the wiping marker, missing key + rows is NOT treated as a wipe', async () => {
    await ks.put('room:1:state', { s: 'alpha' });
    secure.items.delete(WRAP_KEY_ID);
    resetWrapCache();
    const relaunched = createRnKeyStore({ secureStore: secure.module, sqlite: sameFile });
    await expect(relaunched.put('room:3:state', 1)).rejects.toMatchObject(UNAVAILABLE);
    expect(sqlite.dump().map(r => r.key)).toEqual(['room:1:state']);
  });

  // ---- L1 / L3: the cache is per entry name, and wipe() drops it again after the SecureStore delete

  it('two instances share one wrapping key, however the module object is passed, and survive a wipe on either', async () => {
    // Both instances point at the same database rows as well (the app has one file).
    const a = createRnKeyStore({ secureStore: secure.module, sqlite: sameFile });
    const b = createRnKeyStore({ secureStore: { ...secure.module }, sqlite: sameFile });   // L1: a wrapper copy, not the module itself
    await Promise.all([a.put('from:a', 1), b.put('from:b', 2)]);
    expect(log.filter(l => l === `secure.set ${WRAP_KEY_ID}`)).toHaveLength(1);
    expect(await b.get('from:a')).toBe(1);
    expect(await a.get('from:b')).toBe(2);
    await a.wipe();
    await b.put('after', 3);          // b re-reads the new key rather than sealing under the destroyed one
    expect(await a.get('after')).toBe(3);
    expect(await b.get('from:a')).toBeNull();
  });

  it('L3: a put() racing the SecureStore delete inside wipe() cannot leave the old key cached', async () => {
    await ks.put('before', 1);
    let release!: () => void;
    let reached!: () => void;
    const parked = new Promise<void>(r => { reached = r; });
    secure.hooks.beforeDelete = () => { reached(); return new Promise<void>(r => { release = r; }); };
    const wiping = ks.wipe();
    await parked;   // wipe() is now parked inside deleteItemAsync: cache dropped once, entry still present
    expect(log.at(-1)).toBe(`secure.delete ${WRAP_KEY_ID}`);
    expect(secure.items.has(WRAP_KEY_ID)).toBe(true);
    await ks.put('racer', 2);   // re-reads and caches the OLD key (the delete has not landed yet)
    release();
    await wiping;
    expect(sqlite.dump()).toEqual([]);
    log.length = 0;
    await ks.put('after', 3);   // must provision a NEW key, not seal under the cached destroyed one
    expect(log.filter(l => l === `secure.set ${WRAP_KEY_ID}`)).toHaveLength(1);
    expect(secure.items.has(WRAP_KEY_ID)).toBe(true);
    expect(await ks.get('after')).toBe(3);
  });
});
