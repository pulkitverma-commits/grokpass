import { describe, it, expect, vi } from 'vitest';
import { createRnEnv, checkOnePeekUrl, createRnLockStore, createRnPlatform, fileSource, wrapRnSupabase, bodyToArrayBuffer, LOCK_ID } from './platform';
import { createChatClient } from '../../chat/client';
import type { KeyStore, SupabaseLike } from '../../chat/ports';
import { createFetchRecorder, createSecureStoreMock, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from '../../../test/rn-mocks';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A keystore that remembers nothing; enough for createInvite and notifyRoom. */
const nullKeystore: KeyStore = {
  get: async () => null, put: async () => {}, del: async () => {}, delPrefix: async () => {}, keys: async () => [], sweep: async () => 0, wipe: async () => {},
};

function fakeSupabase(rpc: (fn: string, args: Record<string, unknown>) => unknown, token = 'tok-123'): SupabaseLike {
  return {
    auth: {
      getSession: async () => ({ data: { session: { access_token: token, user: { id: 'u1' } } } }),
      signInAnonymously: async () => ({ data: { session: null }, error: { message: 'no' } }),
      passkey: { list: async () => ({ data: [] }) },
      signInWithPasskey: async () => ({ error: null }),
    },
    rpc: async (fn, args) => ({ data: rpc(fn, args), error: null }),
    storage: { from: () => ({ upload: async () => ({ error: null }), download: async () => ({ data: null, error: { message: 'none' } }) }) },
    channel: () => { throw new Error('unused'); },
    removeChannel: () => {},
    realtime: { setAuth: () => {} },
  };
}

describe('rn env', () => {
  it('origin() is the fixed production origin it was given, used verbatim in invite links', async () => {
    const env = createRnEnv({ siteUrl: 'https://onepeek.io/', apiBaseUrl: 'https://onepeek.io', deviceLabel: 'iPhone 15' });
    expect(env.origin()).toBe('https://onepeek.io');

    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const sb = fakeSupabase((fn, args) => { calls.push({ fn, args }); return fn === 'chat_register_device' ? '0f0e0d0c-0b0a-4908-8706-050403020100' : 'invite-1'; });
    const platform = createRnPlatform({ supabase: sb, keystore: nullKeystore, secureStore: createSecureStoreMock().module, siteUrl: 'https://onepeek.io/', apiBaseUrl: 'https://onepeek.io', deviceLabel: 'iPhone 15' });
    const client = createChatClient(platform);
    const inv = await client.createInvite('room-1', { expiresIn: 3600, maxUses: 1, approval: false });
    expect(inv.id).toBe('invite-1');
    expect(inv.link.startsWith('https://onepeek.io/chat/join#')).toBe(true);
    // F2-7: `#<token>.1<owner pin>`; only the token goes to the server.
    const [token, pin] = inv.link.split('#')[1].split('.');
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(pin).toMatch(/^1[A-Za-z0-9_-]{64}$/);
    expect(calls.find(c => c.fn === 'chat_create_invite')!.args.p_token).toBe(token);
    expect(JSON.stringify(calls)).not.toContain(pin);
    expect(JSON.stringify(calls)).not.toContain('onepeek.io');  // the origin never reaches the server
  });

  it('deviceLabel() is the injected model name, at most 40 characters, never a user agent', () => {
    expect(createRnEnv({ siteUrl: 'https://onepeek.io', deviceLabel: 'Pixel 8' }).deviceLabel()).toBe('Pixel 8');
    expect(createRnEnv({ siteUrl: 'https://onepeek.io', deviceLabel: 'A'.repeat(100) }).deviceLabel()).toHaveLength(40);
    expect(createRnEnv({ siteUrl: 'https://onepeek.io', deviceLabel: '   ' }).deviceLabel()).toBe('Phone');
  });

  it('randomUUID() is a v4 UUID', () => {
    const env = createRnEnv({ siteUrl: 'https://onepeek.io', deviceLabel: 'p' });
    expect(env.randomUUID()).toMatch(UUID);
    expect(env.randomUUID()).not.toBe(env.randomUUID());
  });

  it('notify() POSTs {room} with the bearer to the absolute notify URL and nothing else', async () => {
    const rec = createFetchRecorder();
    const env = createRnEnv({ siteUrl: 'https://onepeek.io', apiBaseUrl: 'https://www.onepeek.io/', deviceLabel: 'p', fetch: rec.fetch });
    await env.notify('room-9', 'tok-abc');
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0].url).toBe('https://www.onepeek.io/api/chat/notify');
    expect(rec.calls[0].init?.method).toBe('POST');
    expect(rec.calls[0].init?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer tok-abc' });
    expect(JSON.parse(String(rec.calls[0].init?.body))).toEqual({ room: 'room-9' });
  });

  it('notify() never throws (network down, no fetch)', async () => {
    const env = createRnEnv({ siteUrl: 'https://onepeek.io', deviceLabel: 'p', fetch: createFetchRecorder(true).fetch });
    await expect(env.notify('r', 't')).resolves.toBeUndefined();
    const none = createRnEnv({ siteUrl: 'https://onepeek.io', deviceLabel: 'p', fetch: undefined as unknown as typeof fetch });
    const saved = globalThis.fetch;
    (globalThis as { fetch?: typeof fetch }).fetch = undefined;
    try { await expect(none.notify('r', 't')).resolves.toBeUndefined(); } finally { globalThis.fetch = saved; }
  });

  it('the client calls env.notify with exactly (roomId, accessToken) after a send path', async () => {
    const platform = createRnPlatform({ supabase: fakeSupabase(() => null, 'session-token'), keystore: nullKeystore, secureStore: createSecureStoreMock().module, siteUrl: 'https://onepeek.io', apiBaseUrl: 'https://onepeek.io', deviceLabel: 'p' });
    const notify = vi.spyOn(platform.env, 'notify').mockResolvedValue(undefined);
    const client = createChatClient(platform);
    await client.notifyRoom('room-42');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('room-42', 'session-token');
    expect(notify.mock.calls[0]).toHaveLength(2);
  });

  // ---- M2: the bearer and the invite links only ever go to onepeek.io

  it('M2: accepts https://onepeek.io and https://www.onepeek.io (trailing slash tolerated), apiBaseUrl defaults to siteUrl', async () => {
    for (const u of ['https://onepeek.io', 'https://onepeek.io/', 'https://www.onepeek.io', 'https://www.onepeek.io/']) {
      expect(createRnEnv({ siteUrl: u, deviceLabel: 'p' }).origin()).toBe(u.replace(/\/$/, ''));
      expect(checkOnePeekUrl('siteUrl', u)).toBe(u.replace(/\/$/, ''));
    }
    const rec = createFetchRecorder();
    await createRnEnv({ siteUrl: 'https://www.onepeek.io/', deviceLabel: 'p', fetch: rec.fetch }).notify('r', 't');
    expect(rec.calls[0].url).toBe('https://www.onepeek.io/api/chat/notify');
  });

  it('M2: rejects at construction anything that is not https to onepeek.io', () => {
    const bad = [
      'http://onepeek.io',                 // plaintext
      'https://tunnel.example',            // a tunnel / typo'd host
      'https://onepeek.io.evil.example',   // suffix trick
      'https://evil.example/onepeek.io',   // host in the path
      'https://api.onepeek.io',            // a subdomain is not in the allowlist
      'https://onepeek.io:8443',           // a non-default port is a different origin
      'https://user:pw@onepeek.io',        // credentials
      'https://onepeek.io/chat',           // a path would change where /chat/join and /api/chat/notify land
      'https://onepeek.io/?x=1',
      'https://onepeek.io/#frag',
      'http://localhost:3000',             // dev host without the explicit opt-in
      'http://127.0.0.1:3000',
      'onepeek.io',                        // not absolute
      'javascript:alert(1)',
      '',
    ];
    for (const u of bad) {
      expect(() => createRnEnv({ siteUrl: u, deviceLabel: 'p' }), u).toThrow(/createRnEnv: siteUrl/);
      expect(() => createRnEnv({ siteUrl: 'https://onepeek.io', apiBaseUrl: u, deviceLabel: 'p' }), u).toThrow(/createRnEnv: apiBaseUrl/);
      expect(() => createRnPlatform({ supabase: null, keystore: nullKeystore, secureStore: createSecureStoreMock().module, siteUrl: u, deviceLabel: 'p' }), u).toThrow(/createRnEnv/);
    }
    // The message names the option, not the value (a bad URL could be anything).
    expect(() => createRnEnv({ siteUrl: 'https://secret-tunnel.example', deviceLabel: 'p' })).toThrow(expect.not.stringContaining('secret-tunnel'));
  });

  it('M2: allowInsecureDev admits http://localhost and 127.0.0.1 only, and only when asked for', () => {
    expect(createRnEnv({ siteUrl: 'http://localhost:8081', deviceLabel: 'p', allowInsecureDev: true }).origin()).toBe('http://localhost:8081');
    expect(createRnEnv({ siteUrl: 'http://127.0.0.1:3000/', deviceLabel: 'p', allowInsecureDev: true }).origin()).toBe('http://127.0.0.1:3000');
    expect(createRnEnv({ siteUrl: 'https://onepeek.io', deviceLabel: 'p', allowInsecureDev: true }).origin()).toBe('https://onepeek.io');
    for (const u of ['http://onepeek.io', 'http://10.0.2.2:3000', 'http://tunnel.example', 'http://localhost.evil.example']) {
      expect(() => createRnEnv({ siteUrl: u, deviceLabel: 'p', allowInsecureDev: true }), u).toThrow(/createRnEnv: siteUrl/);
    }
    expect(() => createRnEnv({ siteUrl: 'http://localhost:8081', deviceLabel: 'p' })).toThrow(/createRnEnv: siteUrl/);
    expect(() => createRnEnv({ siteUrl: 'http://localhost:8081', deviceLabel: 'p', allowInsecureDev: false })).toThrow(/createRnEnv: siteUrl/);
  });
});

describe('rn lock', () => {
  it('set() is synchronous, persists to SecureStore, and a new instance reads it back', async () => {
    const secure = createSecureStoreMock();
    const lock = createRnLockStore(secure.module);
    await lock.ready;
    expect(lock.get()).toBe(false);
    lock.set();
    expect(lock.get()).toBe(true);           // before any await
    await lock.pending;
    expect(secure.items.get(LOCK_ID)).toBe('1');

    const restarted = createRnLockStore(secure.module);   // simulated process restart
    await restarted.ready;
    expect(restarted.get()).toBe(true);
    restarted.clear();
    expect(restarted.get()).toBe(false);
    await restarted.pending;
    expect(secure.items.has(LOCK_ID)).toBe(false);
  });

  it('a clear() before the stored flag is read wins', async () => {
    const secure = createSecureStoreMock();
    secure.items.set(LOCK_ID, '1');
    const lock = createRnLockStore(secure.module);
    lock.clear();
    await lock.ready;
    expect(lock.get()).toBe(false);
  });

  it('createRnPlatform needs a lock source', () => {
    expect(() => createRnPlatform({ supabase: null, keystore: nullKeystore, siteUrl: 'https://onepeek.io', deviceLabel: 'p' })).toThrow(/lockStore or secureStore/);
  });

  // ---- M3: fail closed, durable, THIS_DEVICE_ONLY

  it('M3: reports locked until the flag has been read, and stays locked when the read throws', async () => {
    const unreadable = createRnLockStore(createSecureStoreMock([], { failReads: true }).module);
    expect(unreadable.get()).toBe(true);   // before the read settles
    await unreadable.ready;                // never rejects
    expect(unreadable.get()).toBe(true);   // and after it failed
    unreadable.clear();                    // the app's own unlock still works
    expect(unreadable.get()).toBe(false);

    const unreadableSync = createRnLockStore(createSecureStoreMock([], { failReads: true, sync: true }).module);
    await unreadableSync.ready;
    expect(unreadableSync.get()).toBe(true);

    const fine = createRnLockStore(createSecureStoreMock().module);
    expect(fine.get()).toBe(true);         // unknown yet: locked
    await fine.ready;
    expect(fine.get()).toBe(false);        // nothing stored: unlocked
  });

  it('M3: with a synchronous SecureStore the flag is on disk before set() returns', () => {
    const secure = createSecureStoreMock([], { sync: true });
    const lock = createRnLockStore(secure.module);
    expect(lock.get()).toBe(false);        // the sync read settled during construction
    lock.set();
    expect(secure.items.get(LOCK_ID)).toBe('1');   // no await at all
    expect(secure.setOptions.get(LOCK_ID)).toEqual({ keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    const restarted = createRnLockStore(secure.module);
    expect(restarted.get()).toBe(true);    // read back synchronously too
  });

  it('M3: without the sync API, pending resolves once the write has landed and the flag is THIS_DEVICE_ONLY', async () => {
    const secure = createSecureStoreMock();
    const lock = createRnLockStore(secure.module);
    await lock.ready;
    lock.set();
    await lock.pending;
    expect(secure.items.get(LOCK_ID)).toBe('1');
    expect(secure.setOptions.get(LOCK_ID)).toEqual({ keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    expect(secure.setOptions.get(LOCK_ID)?.requireAuthentication).toBeUndefined();
  });

  it('M3: a failing sync write falls back to the async one, and pending never rejects', async () => {
    const secure = createSecureStoreMock();
    const items = secure.items;
    secure.module.setItem = () => { throw new Error('keychain busy'); };
    const lock = createRnLockStore(secure.module);
    await lock.ready;
    lock.set();
    expect(lock.get()).toBe(true);
    await lock.pending;
    expect(items.get(LOCK_ID)).toBe('1');

    const broken = createSecureStoreMock();
    broken.module.setItemAsync = async () => { throw new Error('disk'); };
    broken.module.deleteItemAsync = async () => { throw new Error('disk'); };
    const l2 = createRnLockStore(broken.module);
    await l2.ready;
    l2.set();
    await expect(l2.pending).resolves.toBeUndefined();
    expect(l2.get()).toBe(true);           // in memory it is locked regardless
    l2.clear();
    await expect(l2.pending).resolves.toBeUndefined();
  });
});

describe('rn fileSource', () => {
  it('reads lazily, once the core asks, and carries the picker metadata', async () => {
    const read = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const f = fileSource({ uri: 'file:///tmp/a.bin', name: 'a.bin', mime: null, size: 3, read });
    expect(read).not.toHaveBeenCalled();
    expect(f).toMatchObject({ uri: 'file:///tmp/a.bin', name: 'a.bin', mime: '', size: 3 });
    expect(await f.bytes()).toEqual(new Uint8Array([1, 2, 3]));
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('an oversized or empty picked file is refused by sendFile before it is read', async () => {
    const read = vi.fn(async () => new Uint8Array(1));
    const client = createChatClient(createRnPlatform({ supabase: fakeSupabase(() => null), keystore: nullKeystore, secureStore: createSecureStoreMock().module, siteUrl: 'https://onepeek.io', deviceLabel: 'p' }));
    await expect(client.sendFile('r', fileSource({ uri: 'u', name: 'big', size: 50 * 1024 * 1024, read }), 60, false)).rejects.toMatchObject({ code: 'file_too_large' });
    await expect(client.sendFile('r', fileSource({ uri: 'u', name: 'empty', size: 0, read }), 60, false)).rejects.toMatchObject({ code: 'empty_file' });
    expect(read).not.toHaveBeenCalled();
  });
});

describe('rn supabase wrapper', () => {
  it('passes upload bytes straight through and delegates everything else', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const sb = fakeSupabase(() => 'x');
    sb.storage = { from: () => ({ upload, download: async () => ({ data: null, error: { message: 'none' } }) }) };
    const w = wrapRnSupabase(sb);
    const bytes = new Uint8Array([9, 8, 7]);
    await w.storage.from('chat-attachments').upload('p/1', bytes, { contentType: 'application/octet-stream', upsert: false });
    expect(upload).toHaveBeenCalledWith('p/1', bytes, { contentType: 'application/octet-stream', upsert: false });
    expect((await w.rpc('fn', {})).data).toBe('x');
    expect((await w.auth.getSession()).data.session?.access_token).toBe('tok-123');
  });

  it('normalises download bodies to something with a working arrayBuffer()', async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const make = (data: unknown) => wrapRnSupabase({ ...fakeSupabase(() => null), storage: { from: () => ({ upload: async () => ({ error: null }), download: async () => ({ data: data as never, error: null }) }) } });
    // A body whose arrayBuffer() works (web Blob, newer RN).
    const ok = await make({ arrayBuffer: async () => payload.buffer }).storage.from('b').download('p');
    expect(new Uint8Array(await ok.data!.arrayBuffer())).toEqual(payload);
    // Raw bytes.
    const raw = await make(payload).storage.from('b').download('p');
    expect(new Uint8Array(await raw.data!.arrayBuffer())).toEqual(payload);
    // Errors pass through.
    const err = await wrapRnSupabase(fakeSupabase(() => null)).storage.from('b').download('p');
    expect(err.data).toBeNull();
    expect(err.error?.message).toBe('none');
  });

  it('falls back to FileReader when the RN Blob has no usable arrayBuffer()', async () => {
    const payload = new Uint8Array([250, 251, 0, 65, 66]);
    class FakeReader {
      result: unknown = null;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      readAsArrayBuffer() { throw new Error('FileReader.readAsArrayBuffer is not implemented'); }
      readAsDataURL() { this.result = `data:application/octet-stream;base64,${Buffer.from(payload).toString('base64')}`; queueMicrotask(() => this.onload?.()); }
    }
    const g = globalThis as { FileReader?: unknown };
    const saved = g.FileReader;
    g.FileReader = FakeReader;
    try {
      const rnBlob = { arrayBuffer: async () => { throw new Error('not implemented'); } };
      expect(new Uint8Array(await bodyToArrayBuffer(rnBlob))).toEqual(payload);
      expect(new Uint8Array(await bodyToArrayBuffer({}))).toEqual(payload);
    } finally {
      g.FileReader = saved;
    }
  });
});
