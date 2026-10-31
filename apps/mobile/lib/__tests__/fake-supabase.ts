// A supabase-js stand-in for lib/chat tests: records every auth call in `__calls`, hands out a fake
// client whose session is persisted through the `auth.storage` it was created with (one JSON blob
// under one key, as GoTrueClient does), and answers the few RPCs the glue tests reach.

export type Storage = { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void> };
export type RecordedCall = { method: string; args: unknown[] };

export function createFakeSupabase(fn: typeof jest.fn) {
  const calls: { method: string; args: unknown[] }[] = [];
  const clients: Record<string, unknown>[] = [];
  const createClient = fn((url: string, key: string, opts: { auth: { storage: Storage } }) => {
    const storage = opts.auth.storage;
    const STORAGE_KEY = 'sb-xyzcompany-auth-token';
    let session: Record<string, unknown> | null = null;
    const listeners: ((event: string, s: unknown) => void)[] = [];
    const rec = (method: string, ...args: unknown[]) => calls.push({ method, args });
    const persist = async () => {
      if (session) await storage.setItem(STORAGE_KEY, JSON.stringify(session));
      else await storage.removeItem(STORAGE_KEY);
    };
    const newSession = (user: Record<string, unknown>) => ({
      access_token: 'eyJhbGciOiJIUzI1NiJ9.ACCESS-TOKEN-PAYLOAD-7f3a9c1d2e4b.SIGNATURE-0a1b2c3d4e5f',
      refresh_token: 'rt-9f8e7d6c5b4a3f2e1d0c-REFRESH-TOKEN',
      token_type: 'bearer', expires_in: 3600, user,
    });
    const client = {
      url, key, opts, authStorage: storage,
      auth: {
        async getSession() {
          rec('getSession');
          if (!session) { const raw = await storage.getItem(STORAGE_KEY); session = raw ? JSON.parse(raw) : null; }
          return { data: { session }, error: null };
        },
        onAuthStateChange(cb: (event: string, s: unknown) => void) {
          rec('onAuthStateChange');
          listeners.push(cb);
          return { data: { subscription: { unsubscribe: () => { listeners.splice(listeners.indexOf(cb), 1); rec('unsubscribe'); } } } };
        },
        async signInWithIdToken(c: unknown) { rec('signInWithIdToken', c); session = newSession({ id: 'apple-user', is_anonymous: false }); await persist(); return { data: { session }, error: null }; },
        async signInWithOAuth(c: unknown) { rec('signInWithOAuth', c); return { data: { provider: 'google', url: 'https://xyzcompany.supabase.co/auth/v1/authorize?provider=google&code_challenge=abc' }, error: null }; },
        async exchangeCodeForSession(code: string) {
          rec('exchangeCodeForSession', code);
          if (code !== 'good-code') return { data: { session: null }, error: { message: 'invalid flow state' } };
          session = newSession({ id: '10000000-0000-4000-8000-000000000001', email: 'owner@example.test', is_anonymous: false });
          await persist();
          return { data: { session }, error: null };
        },
        async verifyOtp(p: unknown) { rec('verifyOtp', p); session = newSession({ id: 'email-user', email: 'owner@example.test', is_anonymous: false }); await persist(); return { data: { session }, error: null }; },
        async setSession(p: unknown) { rec('setSession', p); return { data: { session: null }, error: { message: 'must not be called' } }; },
        async signInWithOtp(c: unknown) { rec('signInWithOtp', c); return { data: {}, error: null }; },
        async signInAnonymously() { rec('signInAnonymously'); session = newSession({ id: 'guest-user', is_anonymous: true }); await persist(); return { data: { session }, error: null }; },
        async signOut(o: unknown) { rec('signOut', o); session = null; await persist(); return { error: null }; },
        stopAutoRefresh() { rec('stopAutoRefresh'); },
        passkey: { list: async () => ({ data: [] }) },
        async signInWithPasskey() { return { error: null }; },
      },
      async rpc(fn: string, args: Record<string, unknown>) {
        rec('rpc', fn, args);
        if (fn === 'chat_register_device') return { data: 'device-1', error: null };
        return { data: null, error: null };
      },
      storage: { from: () => ({ upload: async () => ({ error: null }), download: async () => ({ data: null, error: { message: 'none' } }) }) },
      channel: () => { throw new Error('unused'); },
      removeChannel: () => {},
      realtime: { setAuth: () => {} },
    };
    clients.push(client);
    return client;
  });
  return { __esModule: true, createClient, __calls: calls, __clients: clients };
}
