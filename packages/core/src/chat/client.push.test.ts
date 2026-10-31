import { describe, it, expect, vi } from 'vitest';
import { createChatClient, ChatError } from './client';
import type { ChatPlatform, KeyStore, SupabaseLike, SupabaseSession } from './ports';

// registerPushDevice / unregisterPushDevice call the migration-008 RPCs through the client's rpc
// helper. Backend owns the SQL; this checks the client side: exact RPC names and arguments, the
// session requirement, and that an RPC error surfaces as a ChatError.

const nullKeystore: KeyStore = {
  get: async () => null, put: async () => {}, del: async () => {}, delPrefix: async () => {}, keys: async () => [], sweep: async () => 0, wipe: async () => {},
};

function platform(session: SupabaseSession | null, rpc: SupabaseLike['rpc']): ChatPlatform {
  const supabase: SupabaseLike = {
    auth: {
      getSession: async () => ({ data: { session } }),
      signInAnonymously: async () => { throw new Error('must not sign in a guest for push registration'); },
      passkey: { list: async () => ({ data: [] }) },
      signInWithPasskey: async () => ({ error: null }),
    },
    rpc,
    storage: { from: () => ({ upload: async () => ({ error: null }), download: async () => ({ data: null, error: { message: 'none' } }) }) },
    channel: () => { throw new Error('unused'); },
    removeChannel: () => {},
    realtime: { setAuth: () => {} },
  };
  return {
    supabase, keystore: nullKeystore,
    env: { origin: () => 'https://onepeek.io', deviceLabel: () => 'Phone', randomUUID: () => crypto.randomUUID(), notify: async () => {} },
    lock: { set() {}, get: () => false, clear() {} },
  };
}

const SESSION: SupabaseSession = { access_token: 'tok', user: { id: 'u1' } };
const TOKEN = 'c3d4e5f6a7b8-apns-device-token-0011223344556677';

describe('push device registration', () => {
  it('registerPushDevice calls register_push_device with the platform and the opaque token only', async () => {
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: null, error: null }));
    const c = createChatClient(platform(SESSION, rpc));
    await c.registerPushDevice('ios', `  ${TOKEN}  `);
    await c.registerPushDevice('android', 'fcm-token-abcdef0123456789');
    expect(rpc.mock.calls).toEqual([
      ['register_push_device', { p_platform: 'ios', p_token: TOKEN }],
      ['register_push_device', { p_platform: 'android', p_token: 'fcm-token-abcdef0123456789' }],
    ]);
    // Nothing else travels: no device label, no user id, no session token.
    for (const [, args] of rpc.mock.calls) expect(Object.keys(args).sort()).toEqual(['p_platform', 'p_token']);
  });

  it('unregisterPushDevice calls unregister_push_device with the token only', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const c = createChatClient(platform(SESSION, rpc));
    await c.unregisterPushDevice(TOKEN);
    expect(rpc.mock.calls).toEqual([['unregister_push_device', { p_token: TOKEN }]]);
  });

  it('needs a signed-in session and never creates a guest one for it', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const c = createChatClient(platform(null, rpc));
    await expect(c.registerPushDevice('ios', TOKEN)).rejects.toMatchObject({ code: 'not_signed_in' });
    await expect(c.unregisterPushDevice(TOKEN)).rejects.toMatchObject({ code: 'not_signed_in' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects an unknown platform or an empty token before any network call', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const c = createChatClient(platform(SESSION, rpc));
    await expect(c.registerPushDevice('web' as unknown as 'ios', TOKEN)).rejects.toMatchObject({ code: 'bad_platform' });
    await expect(c.registerPushDevice('ios', '   ')).rejects.toMatchObject({ code: 'bad_token' });
    await expect(c.unregisterPushDevice('')).rejects.toMatchObject({ code: 'bad_token' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces an RPC error as a ChatError with the server code', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'platform must be ios or android: bad_platform' } }));
    const c = createChatClient(platform(SESSION, rpc));
    const err = await c.registerPushDevice('ios', TOKEN).catch(e => e);
    expect(err).toBeInstanceOf(ChatError);
    expect(err.code).toBe('bad_platform');
  });
});
