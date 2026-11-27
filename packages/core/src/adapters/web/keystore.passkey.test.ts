import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { createWebKeyStore, chatOperation, KeystoreLockedError, type PrfProvider } from './keystore';

// A simulated authenticator. Each passkey has a secret; PRF(salt) = SHA-256(secret || salt), so the
// same passkey and salt always give the same 32 bytes and a different passkey gives different ones.
type FakeAuthenticator = { chosen: string; mode: 'ok' | 'cancel' | 'no-prf'; calls: { credId?: string }[] };
const secrets: Record<string, Uint8Array> = { alice: new Uint8Array(32).fill(1), other: new Uint8Array(32).fill(2) };
const idOf = (name: string) => new TextEncoder().encode('cred-' + name);
const nameOf = (id: Uint8Array) => new TextDecoder().decode(id).replace(/^cred-/, '');

function fakePrf(a: FakeAuthenticator): PrfProvider {
  return async ({ credId, salt }) => {
    a.calls.push({ credId: credId ? nameOf(credId) : undefined });
    if (a.mode === 'cancel') return null;
    // With allowCredentials the browser only offers that passkey; without, the person picks one.
    const name = credId ? nameOf(credId) : a.chosen;
    if (a.mode === 'no-prf') return { credId: idOf(name), output: null };
    const secret = secrets[name];
    const buf = new Uint8Array(secret.length + salt.length);
    buf.set(secret); buf.set(salt, secret.length);
    return { credId: idOf(name), output: new Uint8Array(await crypto.subtle.digest('SHA-256', buf)) };
  };
}

async function raw(store: 'meta' | 'sealed'): Promise<{ keys: string[]; values: any[] }> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('onepeek-chat', 1);
    req.onsuccess = () => {
      const s = req.result.transaction(store, 'readonly').objectStore(store);
      const k = s.getAllKeys();
      const v = s.getAll();
      v.onsuccess = () => { resolve({ keys: (k.result as IDBValidKey[]).map(String), values: v.result }); req.result.close(); };
      v.onerror = () => reject(v.error);
    };
    req.onerror = () => reject(req.error);
  });
}

let auth: FakeAuthenticator;
let ks: ReturnType<typeof createWebKeyStore>;

/** A new page load: a fresh store instance with nothing unlocked in memory. */
function reload() {
  ks.passkey.lockNow();
  ks = createWebKeyStore({ prf: fakePrf(auth) });
}

describe('keystore passkey lock', () => {
  beforeEach(async () => {
    auth = { chosen: 'alice', mode: 'ok', calls: [] };
    ks = createWebKeyStore({ prf: fakePrf(auth) });
    await ks.wipe();
    await ks.put('device:u1', { id: 'dev-1', signing: new Uint8Array([9, 9]) });
    await ks.put('room:r1:state', { s: new Uint8Array([1, 2, 3]) });
  });

  it('is off by default and works exactly as before', async () => {
    expect(await ks.passkey.status()).toBe('off');
    expect(await ks.get('room:r1:state')).toEqual({ s: new Uint8Array([1, 2, 3]) });
    expect(auth.calls).toHaveLength(0);
  });

  it('turning it on keeps every record readable and removes the device key', async () => {
    await ks.passkey.enable();
    expect(await ks.passkey.status()).toBe('unlocked');
    expect(await ks.get('device:u1')).toEqual({ id: 'dev-1', signing: new Uint8Array([9, 9]) });
    expect(await ks.get('room:r1:state')).toEqual({ s: new Uint8Array([1, 2, 3]) });
    const meta = await raw('meta');
    expect(meta.keys).toEqual(['pk']);                       // no usable 'wrap' key left on disk
    expect(meta.values[0].wrapped).toBeInstanceOf(ArrayBuffer);
  });

  it('after a reload nothing can be read or written until the passkey unlocks it', async () => {
    await ks.passkey.enable();
    reload();
    expect(await ks.passkey.status()).toBe('locked');
    await expect(ks.get('room:r1:state')).rejects.toBeInstanceOf(KeystoreLockedError);
    await expect(ks.put('room:r1:state', { s: 1 })).rejects.toBeInstanceOf(KeystoreLockedError);
    // Even a missing record: a locked store must never look like an empty one.
    await expect(ks.get('nope')).rejects.toBeInstanceOf(KeystoreLockedError);
    await ks.passkey.unlock();
    expect(auth.calls.at(-1)).toEqual({ credId: 'alice' });  // asks for the same passkey
    expect(await ks.get('room:r1:state')).toEqual({ s: new Uint8Array([1, 2, 3]) });
  });

  it('a different passkey cannot unlock it', async () => {
    await ks.passkey.enable();
    reload();
    // Simulate an authenticator answering for another credential with the requested id.
    ks = createWebKeyStore({ prf: async ({ salt }) => ({ credId: idOf('alice'), output: new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([...secrets.other, ...salt]))) }) });
    await expect(ks.passkey.unlock()).rejects.toThrow('wrong_passkey');
    expect(await ks.passkey.status()).toBe('locked');
  });

  it('records on disk cannot be opened with anything left on disk', async () => {
    await ks.passkey.enable();
    const meta = (await raw('meta')).values[0];
    const sealed = await raw('sealed');
    // Everything stored is ciphertext or public parameters; there is no CryptoKey object any more.
    for (const v of [...(await raw('meta')).values, ...sealed.values]) expect(v).not.toBeInstanceOf(CryptoKey);
    expect(meta.salt).toHaveLength(32);
  });

  it('cancelling or an authenticator without PRF changes nothing', async () => {
    auth.mode = 'cancel';
    await expect(ks.passkey.enable()).rejects.toThrow('cancelled');
    auth.mode = 'no-prf';
    await expect(ks.passkey.enable()).rejects.toThrow('prf_unsupported');
    expect(await ks.passkey.status()).toBe('off');
    expect((await raw('meta')).keys).toEqual(['wrap']);
    expect(await ks.get('room:r1:state')).toEqual({ s: new Uint8Array([1, 2, 3]) });
  });

  it('turning it off restores a device key and keeps the records', async () => {
    await ks.passkey.enable();
    reload();
    await expect(ks.passkey.disable()).rejects.toBeInstanceOf(KeystoreLockedError);
    await ks.passkey.unlock();
    await ks.passkey.disable();
    expect(await ks.passkey.status()).toBe('off');
    reload();
    expect(await ks.get('room:r1:state')).toEqual({ s: new Uint8Array([1, 2, 3]) });
    expect((await raw('meta')).keys).toEqual(['wrap']);
  });

  it('new writes while unlocked survive a reload and unlock', async () => {
    await ks.passkey.enable();
    await ks.put('room:r2:state', { s: 'new' });
    reload();
    await ks.passkey.unlock();
    expect(await ks.get('room:r2:state')).toEqual({ s: 'new' });
  });

  it('expired records are dropped when turning it on', async () => {
    await ks.put('msg:old', { b: 'x' }, Date.now() - 1);
    await ks.passkey.enable();
    expect(await ks.keys('msg:')).toEqual([]);
  });

  it('a write racing the turn-on is kept, under the new key', async () => {
    const enabling = ks.passkey.enable();
    const writing = ks.put('room:r1:state', { s: 'during' });
    await Promise.all([enabling, writing]);
    reload();
    await ks.passkey.unlock();
    expect(await ks.get('room:r1:state')).toEqual({ s: 'during' });
  });

  it('many writes racing the turn-on and turn-off are all kept', async () => {
    const writes = Array.from({ length: 20 }, (_, i) => ks.put(`k${i}`, i));
    await Promise.all([ks.passkey.enable(), ...writes]);
    const more = Array.from({ length: 20 }, (_, i) => ks.put(`m${i}`, i));
    await Promise.all([ks.passkey.disable(), ...more]);
    reload();
    for (let i = 0; i < 20; i++) {
      expect(await ks.get(`k${i}`)).toBe(i);
      expect(await ks.get(`m${i}`)).toBe(i);
    }
  });

  it('a record it cannot open stops the turn-on and changes nothing', async () => {
    // Plant a record sealed under some other key.
    await new Promise<void>((resolve) => {
      const req = indexedDB.open('onepeek-chat', 1);
      req.onsuccess = () => {
        const t = req.result.transaction('sealed', 'readwrite');
        t.objectStore('sealed').put({ iv: new Uint8Array(12), ct: new ArrayBuffer(32) }, 'room:bad:state');
        t.oncomplete = () => { req.result.close(); resolve(); };
      };
    });
    await expect(ks.passkey.enable()).rejects.toThrow('unreadable_records');
    expect(await ks.passkey.status()).toBe('off');
    expect((await raw('meta')).keys).toEqual(['wrap']);
    expect(await ks.get('room:r1:state')).toEqual({ s: new Uint8Array([1, 2, 3]) });
  });

  it('an unlock that started before the lock was turned off elsewhere fails cleanly', async () => {
    await ks.passkey.enable();
    reload();
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const slow: PrfProvider = async (req) => { await gate; return fakePrf(auth)(req); };
    const tab2 = createWebKeyStore({ prf: slow });
    const unlocking = tab2.passkey.unlock();                  // prompt open in tab 2
    await ks.passkey.unlock();                                 // meanwhile tab 1 unlocks...
    await ks.passkey.disable();                                // ...and turns it off
    release();
    await expect(unlocking).rejects.toThrow('changed');
  });

  it('wipe and turn-on in parallel never leave old records readable', async () => {
    await Promise.allSettled([ks.wipe(), ks.passkey.enable()]);
    reload();
    if (await ks.passkey.status() === 'locked') await ks.passkey.unlock();
    expect(await ks.get('room:r1:state')).toBeNull();
  });

  it('turning the lock on waits for a chat operation to save its state', async () => {
    let finish!: () => void;
    const serverDone = new Promise<void>(r => { finish = r; });
    // A room operation: the server already has the change; the local save comes after.
    const operation = chatOperation(async () => {
      await serverDone;
      await ks.put('room:r1:state', { s: 'after-commit' });
    });
    const enabling = ks.passkey.enable();
    await new Promise(r => setTimeout(r, 20));
    expect(await ks.passkey.status()).toBe('off');           // still waiting for the operation
    finish();
    await Promise.all([operation, enabling]);
    reload();
    await ks.passkey.unlock();
    expect(await ks.get('room:r1:state')).toEqual({ s: 'after-commit' });
  });

  it('the idle re-lock waits for a chat operation, and nested operations do not deadlock', async () => {
    await ks.passkey.enable();
    let finish!: () => void;
    const step = new Promise<void>(r => { finish = r; });
    const operation = chatOperation(async () => {
      await step;
      // An operation inside an operation (e.g. a room lock inside createRoom) while a re-lock waits.
      await chatOperation(() => ks.put('room:r1:state', { s: 'nested' }));
    });
    const relocking = ks.passkey.lockWhenIdle();
    await new Promise(r => setTimeout(r, 20));
    expect(await ks.passkey.status()).toBe('unlocked');
    finish();
    await Promise.all([operation, relocking]);
    expect(await ks.passkey.status()).toBe('locked');
    await ks.passkey.unlock();
    expect(await ks.get('room:r1:state')).toEqual({ s: 'nested' });
  });

  it('a key unlocked from a lock that was since replaced is not used', async () => {
    await ks.passkey.enable();                               // this page holds the data key unlocked
    // Another tab turns the lock off and on again: a new lock record (new salt, new data key).
    // Simulated by replacing the record on disk while this page keeps its key in memory.
    await new Promise<void>((resolve) => {
      const req = indexedDB.open('onepeek-chat', 1);
      req.onsuccess = () => {
        const t = req.result.transaction('meta', 'readwrite');
        const st = t.objectStore('meta');
        const g = st.get('pk');
        g.onsuccess = () => st.put({ ...g.result, salt: crypto.getRandomValues(new Uint8Array(32)) }, 'pk');
        t.oncomplete = () => { req.result.close(); resolve(); };
      };
    });
    expect(await ks.passkey.status()).toBe('locked');
    await expect(ks.put('room:r1:state', { s: 'stale' })).rejects.toBeInstanceOf(KeystoreLockedError);
    await expect(ks.get('room:r1:state')).rejects.toBeInstanceOf(KeystoreLockedError);
  });

  it('wipe removes the passkey lock too', async () => {
    await ks.passkey.enable();
    await ks.wipe();
    expect(await ks.passkey.status()).toBe('off');
    expect((await raw('meta')).keys).toEqual([]);
    await ks.put('x', 1);
    expect(await ks.get('x')).toBe(1);
  });

  it('a second instance in the same page stops using the old device key once the lock is on', async () => {
    const other = createWebKeyStore({ prf: fakePrf(auth) });
    await other.put('a', 1);                                  // caches the device key
    await ks.passkey.enable();
    await other.put('b', 2);                                  // must use the passkey data key now
    reload();
    await ks.passkey.unlock();
    expect(await ks.get('a')).toBe(1);
    expect(await ks.get('b')).toBe(2);
  });
});
