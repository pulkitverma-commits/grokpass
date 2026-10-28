import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import * as ks from './keystore';

async function rawRecords(): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('onepeek-chat', 1);
    req.onsuccess = () => {
      const t = req.result.transaction('sealed', 'readonly');
      const g = t.objectStore('sealed').getAll();
      g.onsuccess = () => { resolve(g.result); req.result.close(); };
      g.onerror = () => reject(g.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe('chat keystore', () => {
  beforeEach(async () => { await ks.wipe(); });

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
    const raw = await rawRecords();
    expect(raw).toHaveLength(1);
    const bytes = Buffer.from(new Uint8Array(raw[0].ct)).toString('latin1');
    expect(bytes).not.toContain('VERY-SECRET-TEXT');
  });

  it('uses a wrapping key that cannot be exported', async () => {
    await ks.put('x', 1);
    const key: CryptoKey = await new Promise((resolve) => {
      const req = indexedDB.open('onepeek-chat', 1);
      req.onsuccess = () => {
        const g = req.result.transaction('meta', 'readonly').objectStore('meta').get('wrap');
        g.onsuccess = () => { resolve(g.result); req.result.close(); };
      };
    });
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
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
    const raw = (await rawRecords())[0];
    await new Promise<void>((resolve) => {
      const req = indexedDB.open('onepeek-chat', 1);
      req.onsuccess = () => {
        const t = req.result.transaction('sealed', 'readwrite');
        t.objectStore('sealed').put(raw, 'b');
        t.oncomplete = () => { req.result.close(); resolve(); };
      };
    });
    expect(await ks.get('b')).toBeNull();
  });

  it('wipe makes everything unreadable and removes it', async () => {
    await ks.put('room:1:state', { s: 1 });
    await ks.put('room:2:state', { s: 2 });
    await ks.wipe();
    expect(await ks.get('room:1:state')).toBeNull();
    expect(await ks.keys()).toEqual([]);
  });

  it('deletes by prefix', async () => {
    await ks.put('room:1:state', 1);
    await ks.put('room:1:msg:a', 2);
    await ks.put('room:2:state', 3);
    await ks.delPrefix('room:1:');
    expect(await ks.keys()).toEqual(['room:2:state']);
  });
});
