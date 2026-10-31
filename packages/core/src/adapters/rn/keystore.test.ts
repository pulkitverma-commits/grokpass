import { describe, it, expect, beforeEach } from 'vitest';
import { createRnKeyStore, WRAP_KEY_ID } from './keystore';
import type { KeyStore } from '../../chat/ports';
import { createSecureStoreMock, createSqliteMock, hasNodeSqlite, WHEN_UNLOCKED_THIS_DEVICE_ONLY, type SecureStoreMock, type SqliteMock } from '../../../test/rn-mocks';
import { toB64Url } from '../../crypto';

// The same contract as adapters/web/keystore.test.ts, against the React Native store built on a
// Map-backed SecureStore and node:sqlite in memory (docs/mobile/test-plan.md §1.2 and §1.3).

function hex(u8: Uint8Array) { return Buffer.from(u8).toString('hex'); }
function latin1(u8: Uint8Array) { return Buffer.from(u8).toString('latin1'); }
function b64(u8: Uint8Array) { return Buffer.from(u8).toString('base64'); }

describe.skipIf(!hasNodeSqlite)('rn keystore', () => {
  let log: string[];
  let secure: SecureStoreMock;
  let sqlite: SqliteMock;
  let ks: KeyStore;

  beforeEach(() => {
    log = [];
    secure = createSecureStoreMock(log);
    sqlite = createSqliteMock(log);
    ks = createRnKeyStore({ secureStore: secure.module, sqlite: sqlite.module, dbName: ':memory:' });
  });

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
    sqlite.insert(before);
    expect(await ks.keys()).toEqual(['room:1:state', 'room:2:state']);
    expect(await ks.get('room:1:state')).toBeNull();
    expect(await ks.get('room:2:state')).toBeNull();
    // The store keeps working with its new key.
    await ks.put('room:3:state', { s: 'gamma' });
    expect(await ks.get('room:3:state')).toEqual({ s: 'gamma' });
  });

  it('a copied database is unreadable without the device SecureStore entry', async () => {
    await ks.put('room:1:state', { s: 'alpha' });
    const rows = sqlite.dump();
    const otherSecure = createSecureStoreMock();
    const otherSqlite = createSqliteMock();
    const copy = createRnKeyStore({ secureStore: otherSecure.module, sqlite: otherSqlite.module, dbName: ':memory:' });
    await copy.keys();  // creates the schema
    otherSqlite.insert(rows);
    expect(await copy.keys()).toEqual(['room:1:state']);
    expect(await copy.get('room:1:state')).toBeNull();
  });

  it('two instances over the same SecureStore share one wrapping key and survive a wipe on either', async () => {
    // Both instances point at the same database rows as well (the app has one file).
    const db = sqlite.module.openDatabaseSync(':memory:');
    const shared = { openDatabaseSync: () => db };
    const a = createRnKeyStore({ secureStore: secure.module, sqlite: shared });
    const b = createRnKeyStore({ secureStore: secure.module, sqlite: shared });
    await Promise.all([a.put('from:a', 1), b.put('from:b', 2)]);
    expect(log.filter(l => l === `secure.set ${WRAP_KEY_ID}`)).toHaveLength(1);
    expect(await b.get('from:a')).toBe(1);
    expect(await a.get('from:b')).toBe(2);
    await a.wipe();
    await b.put('after', 3);          // b re-reads the new key rather than sealing under the destroyed one
    expect(await a.get('after')).toBe(3);
    expect(await b.get('from:a')).toBeNull();
  });
});
