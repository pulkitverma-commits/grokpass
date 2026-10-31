// lib/chat glue: the singletons, the auth flows and the recovery reset, against a recorded
// supabase-js fake, an in-memory expo-sqlite and the SecureStore mock from jest.setup.ts.
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { AUTH_REDIRECT_URL, auth, getChat, getLockStore, parseAuthCallback, resetThisPhone } from '../chat';
import type { FakeSqlite } from './fake-sqlite';

const URL = 'https://xyzcompany.supabase.co';
const ANON = 'anon-key-for-tests';
const USER = { id: '10000000-0000-4000-8000-000000000001', email: 'owner@example.test', is_anonymous: false };
const REFRESH = 'rt-9f8e7d6c5b4a3f2e1d0c-REFRESH-TOKEN';
const ACCESS = 'eyJhbGciOiJIUzI1NiJ9.ACCESS-TOKEN-PAYLOAD-7f3a9c1d2e4b.SIGNATURE-0a1b2c3d4e5f';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { supabaseUrl: 'https://xyzcompany.supabase.co', supabaseAnonKey: 'anon-key-for-tests', siteUrl: 'https://onepeek.io' } } },
}));

jest.mock('expo-device', () => ({
  modelName: 'iPhone 15',
  osName: 'iOS',
  osVersion: '18.1',
  deviceName: "Pulkit's iPhone",   // the user-typed name: must never be registered
}));

jest.mock('expo-sqlite', () => {
  const { createFakeSqlite } = jest.requireActual('./fake-sqlite');
  const fake = createFakeSqlite();
  return { __esModule: true, openDatabaseSync: (name: string) => fake.openDatabaseSync(name), __fake: fake };
});

// A supabase-js stand-in that records every auth call and persists its session through the
// `auth.storage` it was given, the way GoTrueClient does (one JSON blob under one key). It lives in
// ./fake-supabase.ts; the factory here only wires it (babel's jest.mock hoisting rejects type
// annotations inside the factory).
jest.mock('@supabase/supabase-js', () => {
  const { createFakeSupabase } = jest.requireActual('./fake-supabase');
  return createFakeSupabase(jest.fn);
});

type Mocked = { __calls: { method: string; args: unknown[] }[]; __clients: Record<string, unknown>[] };
const sbMock = jest.requireMock('@supabase/supabase-js') as Mocked & { createClient: jest.Mock };
const sqliteFake = (SQLite as unknown as { __fake: FakeSqlite }).__fake;
const secureItems = (SecureStore as unknown as { __items: Map<string, string> }).__items;

// No node types in this tsconfig (Hermes target), so the encodings are spelled out.
const bytes = (v: string | Uint8Array) => (typeof v === 'string' ? new TextEncoder().encode(v) : v);
const hex = (v: string | Uint8Array) => Array.from(bytes(v), b => b.toString(16).padStart(2, '0')).join('');
const latin1 = (v: Uint8Array) => Array.from(v, b => String.fromCharCode(b)).join('');
const b64 = (v: string | Uint8Array) => btoa(latin1(bytes(v)));

/** Everything written to disk by the fakes, in every form a secret could leak in. */
function atRest(): string {
  const rows = [...sqliteFake.files.entries()].flatMap(([file, db]) => [...db.sealed.values()].map(r => `${file} ${r.key} ${hex(r.iv)} ${hex(r.ct)} ${latin1(r.ct)} ${b64(r.ct)}`));
  const secure = [...secureItems].map(([k, v]) => `secure ${k}=${v}`);
  return [...rows, ...secure].join('\n');
}
const callsOf = (method: string) => sbMock.__calls.filter(c => c.method === method);

beforeEach(() => {
  sbMock.__calls.length = 0;
});

describe('getChat / getLockStore', () => {
  it('builds one Supabase client with the sealed auth storage and the PKCE settings, and reuses it', () => {
    const chat = getChat();
    expect(getChat()).toBe(chat);
    expect(sbMock.createClient).toHaveBeenCalledTimes(1);
    const [url, key, opts] = sbMock.createClient.mock.calls[0];
    expect(url).toBe(URL);
    expect(key).toBe(ANON);
    expect(opts.auth).toMatchObject({ persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' });
    for (const m of ['getItem', 'setItem', 'removeItem']) expect(typeof opts.auth.storage[m]).toBe('function');
  });

  it('the lock store is one instance, shared with the chat client', () => {
    const lock = getLockStore();
    expect(getLockStore()).toBe(lock);
    getChat().lock();
    expect(lock.get()).toBe(true);
    expect(getChat().isLocked()).toBe(true);
    lock.clear();
    expect(getChat().isLocked()).toBe(false);
  });

  it('registers a device label made of model and OS only, never the user-typed device name', async () => {
    await auth.signInAsGuest();   // a session, so ensureDevice can register
    const dev = await getChat().ensureDevice();
    expect(dev.id).toBe('device-1');
    const reg = callsOf('rpc').find(c => c.args[0] === 'chat_register_device')!;
    expect(reg.args[1]).toMatchObject({ p_label: 'iPhone 15 · iOS 18.1' });
    expect(JSON.stringify(sbMock.__calls)).not.toContain("Pulkit's iPhone");
    // The device record went into the chat keystore, sealed, in its own file.
    expect([...sqliteFake.files.get('onepeek-chat.db')!.sealed.keys()]).toEqual(['device:guest-user']);
    expect(atRest()).not.toContain(hex(dev.signing.signKey));
    await auth.signOut();
  });
});

describe('auth', () => {
  it('maps the Supabase session to { userId, email, isAnonymous }', async () => {
    expect(await auth.getSession()).toBeNull();
    await auth.signInAsGuest();
    expect(callsOf('signInAnonymously')).toHaveLength(1);
    expect(await auth.getSession()).toEqual({ userId: 'guest-user', email: null, isAnonymous: true });
    await auth.signOut();
    expect(callsOf('signOut')[0].args).toEqual([{ scope: 'local' }]);
    expect(await auth.getSession()).toBeNull();
  });

  it('onChange forwards mapped sessions and the returned function unsubscribes', () => {
    const seen: unknown[] = [];
    const off = auth.onChange(s => seen.push(s));
    expect(callsOf('onAuthStateChange')).toHaveLength(1);
    off();
    expect(callsOf('unsubscribe')).toHaveLength(1);
    expect(seen).toEqual([]);
  });

  it('signInWithApple passes the identity token and nonce to signInWithIdToken', async () => {
    await auth.signInWithApple('apple-identity-token', 'raw-nonce-123');
    expect(callsOf('signInWithIdToken')[0].args).toEqual([{ provider: 'apple', token: 'apple-identity-token', nonce: 'raw-nonce-123' }]);
    expect(await auth.getSession()).toMatchObject({ userId: 'apple-user' });
    await auth.signOut();
  });

  it('startOAuth asks for the onepeek://auth redirect without a browser redirect and returns the URL', async () => {
    const url = await auth.startOAuth('google');
    expect(url).toMatch(/^https:\/\/xyzcompany\.supabase\.co\/auth\/v1\/authorize/);
    expect(callsOf('signInWithOAuth')[0].args).toEqual([{ provider: 'google', options: { redirectTo: AUTH_REDIRECT_URL, skipBrowserRedirect: true } }]);
    expect(AUTH_REDIRECT_URL).toBe('onepeek://auth');
  });

  it('sendEmailLink sends the magic link back to onepeek://auth', async () => {
    await auth.sendEmailLink('  owner@example.test ');
    expect(callsOf('signInWithOtp')[0].args).toEqual([{ email: 'owner@example.test', options: { emailRedirectTo: AUTH_REDIRECT_URL } }]);
  });

  describe('completeFromUrl', () => {
    const FOREIGN = [
      'https://onepeek.io/auth?code=good-code',
      'onepeek://auth.evil.example?code=good-code',
      'onepeek://authx?code=good-code',
      'onepeek://evil?code=good-code',
      'onepeek://auth@evil.example/?code=good-code',
      'onepeek:///auth?code=good-code',
      'onepeek://auth:443?code=good-code',
      'exp://127.0.0.1:8081/--/auth?code=good-code',
      'javascript:alert(1)//onepeek://auth?code=good-code',
      '',
    ];

    it.each(FOREIGN)('refuses %s without talking to Supabase', async (url) => {
      expect(parseAuthCallback(url)).toBeNull();
      expect(await auth.completeFromUrl(url)).toBe(false);
      expect(sbMock.__calls).toEqual([]);
    });

    it('never hands the raw URL to anything but the parser', async () => {
      const url = 'onepeek://auth?code=good-code&state=xyz';
      expect(await auth.completeFromUrl(url)).toBe(true);
      expect(JSON.stringify(sbMock.__calls)).not.toContain(url);
      expect(JSON.stringify(sbMock.__calls)).not.toContain('onepeek://');
      await auth.signOut();
    });

    it('finishes a PKCE callback with exchangeCodeForSession and reports the session', async () => {
      expect(await auth.completeFromUrl('onepeek://auth?code=good-code')).toBe(true);
      expect(callsOf('exchangeCodeForSession')[0].args).toEqual(['good-code']);
      expect(await auth.getSession()).toEqual({ userId: USER.id, email: USER.email, isAnonymous: false });
      await auth.signOut();
    });

    it('a failed exchange is false, not an exception', async () => {
      expect(await auth.completeFromUrl('onepeek://auth/?code=stale-code')).toBe(false);
      expect(callsOf('exchangeCodeForSession')[0].args).toEqual(['stale-code']);
      expect(await auth.getSession()).toBeNull();
    });

    it('finishes an email link carrying token_hash + type with verifyOtp (query or fragment)', async () => {
      expect(await auth.completeFromUrl('onepeek://auth#token_hash=pkce_abc123&type=magiclink')).toBe(true);
      expect(callsOf('verifyOtp')[0].args).toEqual([{ token_hash: 'pkce_abc123', type: 'magiclink' }]);
      await auth.signOut();
      expect(await auth.completeFromUrl('onepeek://auth?token_hash=h2&type=email')).toBe(true);
      expect(callsOf('verifyOtp')[1].args).toEqual([{ token_hash: 'h2', type: 'email' }]);
      await auth.signOut();
    });

    it('refuses provider errors and implicit-flow tokens in the fragment', async () => {
      expect(await auth.completeFromUrl('onepeek://auth?error=access_denied&error_description=The+user+denied')).toBe(false);
      expect(await auth.completeFromUrl('onepeek://auth#access_token=stolen&refresh_token=stolen&type=recovery')).toBe(false);
      expect(await auth.completeFromUrl('onepeek://auth')).toBe(false);
      expect(await auth.completeFromUrl('onepeek://auth#type=magiclink')).toBe(false);   // token_hash missing
      expect(sbMock.__calls.filter(c => c.method !== 'getSession')).toEqual([]);
    });

    it('decodes percent-escapes and + in the parameters and ignores malformed pairs', () => {
      expect(parseAuthCallback('onepeek://auth?code=a%20b&x=1+2&bad=%E0%A4%A&=empty&flag')).toEqual({ code: 'a b', x: '1 2', '': 'empty', flag: '' });
    });
  });

  it('the persisted session is sealed: no token, email or session JSON in SQLite or SecureStore', async () => {
    expect(await auth.completeFromUrl('onepeek://auth?code=good-code')).toBe(true);
    const authDb = sqliteFake.files.get('onepeek-auth.db')!;
    expect([...authDb.sealed.keys()]).toEqual(['auth:sb-xyzcompany-auth-token']);
    const disk = atRest();
    for (const secret of [REFRESH, ACCESS, USER.email, USER.id, '"refresh_token"']) {
      expect(disk).not.toContain(secret);
      expect(disk).not.toContain(hex(secret));
      expect(disk).not.toContain(b64(secret));
    }
    // SecureStore holds only the two wrapping keys (chat, auth); the auth one is this-device-only.
    expect([...secureItems.keys()].sort()).toEqual(['onepeek.wrap', 'onepeek.wrap.auth']);
    await auth.signOut();
    expect(authDb.sealed.size).toBe(0);
  });
});

describe('resetThisPhone', () => {
  it('signs out locally, wipes both sealed stores and the lock, and the next getChat() rebuilds', async () => {
    const before = getChat();
    expect(await auth.completeFromUrl('onepeek://auth?code=good-code')).toBe(true);
    await before.keystore.put('room:r1:state', new Uint8Array([1, 2, 3]));
    getLockStore().set();
    expect(sqliteFake.files.get('onepeek-chat.db')!.sealed.size).toBeGreaterThan(0);
    expect(sqliteFake.files.get('onepeek-auth.db')!.sealed.size).toBe(1);
    expect(secureItems.has('onepeek.wrap')).toBe(true);
    expect(secureItems.has('onepeek.wrap.auth')).toBe(true);
    const builds = sbMock.createClient.mock.calls.length;

    await resetThisPhone();

    expect(callsOf('stopAutoRefresh')).toHaveLength(1);
    expect(callsOf('signOut')[0].args).toEqual([{ scope: 'local' }]);
    expect(sqliteFake.files.get('onepeek-chat.db')!.sealed.size).toBe(0);
    expect(sqliteFake.files.get('onepeek-auth.db')!.sealed.size).toBe(0);
    expect(sqliteFake.files.get('onepeek-chat.db')!.meta.size).toBe(0);
    expect(secureItems.has('onepeek.wrap')).toBe(false);
    expect(secureItems.has('onepeek.wrap.auth')).toBe(false);
    expect(secureItems.has('onepeek.lock')).toBe(false);
    expect(getLockStore().get()).toBe(false);

    const after = getChat();
    expect(after).not.toBe(before);
    expect(sbMock.createClient.mock.calls.length).toBe(builds + 1);
    expect(await auth.getSession()).toBeNull();
    // The new client starts clean and can store again (a fresh wrapping key is provisioned).
    await after.keystore.put('room:r2:state', new Uint8Array([4]));
    expect(await after.keystore.get('room:r2:state')).toEqual(new Uint8Array([4]));
    expect(secureItems.has('onepeek.wrap')).toBe(true);
  });
});

describe('without Supabase configuration', () => {
  it('getChat() still builds; network calls fail with not_configured and foreign callbacks are refused first', async () => {
    const extra = Constants.expoConfig!.extra as Record<string, string>;
    const saved = { ...extra };
    await resetThisPhone();   // drop the configured singleton
    extra.supabaseUrl = '';
    extra.supabaseAnonKey = '';
    try {
      const chat = getChat();
      await expect(chat.myRooms()).rejects.toThrow('not_configured');
      await expect(auth.getSession()).rejects.toThrow('not_configured');
      expect(await auth.completeFromUrl('https://evil.example/?code=x')).toBe(false);   // refused before Supabase is needed
    } finally {
      Object.assign(extra, saved);
      await resetThisPhone();
    }
    expect(sbMock.createClient).toHaveBeenCalled();
  });
});
