import { describe, it, expect, vi } from 'vitest';
import { createRnEnv, createRnLockStore, createRnPlatform, fileSource, wrapRnSupabase, bodyToArrayBuffer, LOCK_ID } from './platform';
import { createChatClient } from '../../chat/client';
import type { KeyStore, SupabaseLike } from '../../chat/ports';
import { createFetchRecorder, createSecureStoreMock } from '../../../test/rn-mocks';

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
    const sb = fakeSupabase((fn, args) => { calls.push({ fn, args }); return 'invite-1'; });
    const platform = createRnPlatform({ supabase: sb, keystore: nullKeystore, secureStore: createSecureStoreMock().module, siteUrl: 'https://onepeek.io/', apiBaseUrl: 'https://onepeek.io', deviceLabel: 'iPhone 15' });
    const client = createChatClient(platform);
    const inv = await client.createInvite('room-1', { expiresIn: 3600, maxUses: 1, approval: false });
    expect(inv.id).toBe('invite-1');
    expect(inv.link.startsWith('https://onepeek.io/chat/join#')).toBe(true);
    const token = inv.link.split('#')[1];
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(calls[0].args.p_token).toBe(token);
    expect(JSON.stringify(calls)).not.toContain('onepeek.io');  // the origin never reaches the server
  });

  it('deviceLabel() is the injected model name, at most 40 characters, never a user agent', () => {
    expect(createRnEnv({ siteUrl: 'https://x', apiBaseUrl: 'https://x', deviceLabel: 'Pixel 8' }).deviceLabel()).toBe('Pixel 8');
    expect(createRnEnv({ siteUrl: 'https://x', apiBaseUrl: 'https://x', deviceLabel: 'A'.repeat(100) }).deviceLabel()).toHaveLength(40);
    expect(createRnEnv({ siteUrl: 'https://x', apiBaseUrl: 'https://x', deviceLabel: '   ' }).deviceLabel()).toBe('Phone');
  });

  it('randomUUID() is a v4 UUID', () => {
    const env = createRnEnv({ siteUrl: 'https://x', apiBaseUrl: 'https://x', deviceLabel: 'p' });
    expect(env.randomUUID()).toMatch(UUID);
    expect(env.randomUUID()).not.toBe(env.randomUUID());
  });

  it('notify() POSTs {room} with the bearer to the absolute notify URL and nothing else', async () => {
    const rec = createFetchRecorder();
    const env = createRnEnv({ siteUrl: 'https://onepeek.io', apiBaseUrl: 'https://api.onepeek.io/', deviceLabel: 'p', fetch: rec.fetch });
    await env.notify('room-9', 'tok-abc');
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0].url).toBe('https://api.onepeek.io/api/chat/notify');
    expect(rec.calls[0].init?.method).toBe('POST');
    expect(rec.calls[0].init?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer tok-abc' });
    expect(JSON.parse(String(rec.calls[0].init?.body))).toEqual({ room: 'room-9' });
  });

  it('notify() never throws (network down, no fetch)', async () => {
    const env = createRnEnv({ siteUrl: 'https://x', apiBaseUrl: 'https://x', deviceLabel: 'p', fetch: createFetchRecorder(true).fetch });
    await expect(env.notify('r', 't')).resolves.toBeUndefined();
    const none = createRnEnv({ siteUrl: 'https://x', apiBaseUrl: 'https://x', deviceLabel: 'p', fetch: undefined as unknown as typeof fetch });
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
});

describe('rn lock', () => {
  it('set() is synchronous, persists to SecureStore, and a new instance reads it back', async () => {
    const secure = createSecureStoreMock();
    const lock = createRnLockStore(secure.module);
    await lock.ready;
    expect(lock.get()).toBe(false);
    lock.set();
    expect(lock.get()).toBe(true);           // before any await
    await Promise.resolve();
    expect(secure.items.get(LOCK_ID)).toBe('1');

    const restarted = createRnLockStore(secure.module);   // simulated process restart
    await restarted.ready;
    expect(restarted.get()).toBe(true);
    restarted.clear();
    expect(restarted.get()).toBe(false);
    await Promise.resolve();
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
    expect(() => createRnPlatform({ supabase: null, keystore: nullKeystore, siteUrl: 'https://x', apiBaseUrl: 'https://x', deviceLabel: 'p' })).toThrow(/lockStore or secureStore/);
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
    const client = createChatClient(createRnPlatform({ supabase: fakeSupabase(() => null), keystore: nullKeystore, secureStore: createSecureStoreMock().module, siteUrl: 'https://x', apiBaseUrl: 'https://x', deviceLabel: 'p' }));
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
