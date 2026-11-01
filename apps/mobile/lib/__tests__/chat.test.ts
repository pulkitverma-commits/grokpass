// lib/chat glue: the singletons, the auth flows and the recovery reset, against a recorded
// supabase-js fake, an in-memory expo-sqlite and the SecureStore mock from jest.setup.ts.
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { AUTH_REDIRECT_URL, auth, getChat, getLockStore, parseAuthCallback, PENDING_EMAIL_KEY, push, resetThisPhone, type AuthSession } from '../chat';
import { stashHandoff, takeHandoff } from '../links';
import { CLIENT_ID_KEY, getClientId, resetClientIdCache } from '../secrets';
import type { FakeSqlite } from './fake-sqlite';

const URL = 'https://xyzcompany.supabase.co';
const ANON = 'anon-key-for-tests';
const USER = { id: '10000000-0000-4000-8000-000000000001', email: 'owner@example.test', is_anonymous: false };
const REFRESH = 'rt-9f8e7d6c5b4a3f2e1d0c-REFRESH-TOKEN';
const ACCESS = 'eyJhbGciOiJIUzI1NiJ9.ACCESS-TOKEN-PAYLOAD-7f3a9c1d2e4b.SIGNATURE-0a1b2c3d4e5f';
const PUSH_TOKEN = 'apns-7b2e9c4d1f8a6e3b5c0d9f2a4e7b1c8d6a3f5e9b2c4d7a1f8e6b3c5d9a2f4e7b';
const PUSH_TOKEN_2 = 'apns-ROTATED-0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d';
const HOUR = 60 * 60 * 1000;

// lib/files pulls in the pickers and expo-file-system; the reset only has to call its sweep (W2-2).
const mockFiles = { clearPickerCaches: jest.fn(async () => {}) };
jest.mock('../files', () => ({ clearPickerCaches: () => mockFiles.clearPickerCaches() }));

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

type Mocked = { __calls: { method: string; args: unknown[] }[]; __clients: Record<string, unknown>[]; __otp: { email: string }; __failRpc: Set<string> };
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
const rpcsOf = (fn: string) => callsOf('rpc').filter(c => c.args[0] === fn);
/** Every string that reached the Supabase fake outside of RPC arguments. */
const nonRpcCalls = () => JSON.stringify(sbMock.__calls.filter(c => c.method !== 'rpc'));

beforeEach(() => {
  sbMock.__calls.length = 0;
  sbMock.__otp.email = USER.email;
  sbMock.__failRpc.clear();
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

    // W1-1: a token_hash is a bearer, not bound to this device like the PKCE code. The app accepts it
    // only for the address sendEmailLink() asked for on this phone, and only once.
    describe('email link (token_hash)', () => {
      it('refuses a token_hash when no email link was requested on this phone, without calling verifyOtp', async () => {
        expect(await auth.completeFromUrl('onepeek://auth?token_hash=pkce_abc123&type=magiclink')).toBe(false);
        expect(callsOf('verifyOtp')).toEqual([]);
        expect(await auth.getSession()).toBeNull();
      });

      it('finishes the link for the requested address with verifyOtp (query or fragment), case-insensitively, and only once', async () => {
        await auth.sendEmailLink('  Owner@Example.test ');
        expect(await auth.completeFromUrl('onepeek://auth#token_hash=pkce_abc123&type=magiclink')).toBe(true);
        expect(callsOf('verifyOtp')[0].args).toEqual([{ token_hash: 'pkce_abc123', type: 'magiclink' }]);
        expect(await auth.getSession()).toMatchObject({ email: USER.email, isAnonymous: false });
        await auth.signOut();
        // The pending address was consumed: the same link again is refused before Supabase is asked.
        expect(await auth.completeFromUrl('onepeek://auth#token_hash=pkce_abc123&type=magiclink')).toBe(false);
        expect(callsOf('verifyOtp')).toHaveLength(1);

        await auth.sendEmailLink('owner@example.test');
        expect(await auth.completeFromUrl('onepeek://auth?token_hash=h2&type=email')).toBe(true);
        expect(callsOf('verifyOtp')[1].args).toEqual([{ token_hash: 'h2', type: 'email' }]);
        await auth.signOut();
      });

      it.each(['recovery', 'signup', 'invite', 'email_change', 'sms', 'phone_change', 'MAGICLINK', ''])('refuses type=%s even with a pending address', async (type) => {
        await auth.sendEmailLink('owner@example.test');
        expect(await auth.completeFromUrl(`onepeek://auth?token_hash=h&type=${type}`)).toBe(false);
        expect(callsOf('verifyOtp')).toEqual([]);
        await auth.signOut();
      });

      it("signs out again when the link yields another account's session (login CSRF)", async () => {
        await auth.sendEmailLink('me@x.test');
        sbMock.__otp.email = 'other@evil.test';
        expect(await auth.completeFromUrl('onepeek://auth?token_hash=attackers-hash&type=magiclink')).toBe(false);
        expect(callsOf('verifyOtp')).toHaveLength(1);
        expect(callsOf('signOut')[0].args).toEqual([{ scope: 'local' }]);
        expect(await auth.getSession()).toBeNull();
        expect(sqliteFake.files.get('onepeek-auth.db')!.sealed.size).toBe(0);
        // The pending address was consumed by the attempt: a second link needs a new request.
        sbMock.__otp.email = 'me@x.test';
        expect(await auth.completeFromUrl('onepeek://auth?token_hash=h&type=magiclink')).toBe(false);
        expect(callsOf('verifyOtp')).toHaveLength(1);
      });

      it("W3-5: nothing reaches the backend on the attacker's session: no rpc, from(), storage or channel call between verifyOtp and signOut", async () => {
        await auth.sendEmailLink('me@x.test');
        sbMock.__otp.email = 'other@evil.test';
        // P2-1: a verified-sign-in listener that would act on the session (the way PushRefresher does)
        // is never told, and so cannot put an RPC into the window.
        const signedIn = jest.fn((_s: AuthSession) => { void getChat().registerPushDevice('ios', PUSH_TOKEN); });
        const off = auth.onSignedIn(signedIn);
        expect(await auth.completeFromUrl('onepeek://auth?token_hash=attackers-hash&type=magiclink')).toBe(false);
        off();
        expect(signedIn).not.toHaveBeenCalled();
        const methods = sbMock.__calls.map(c => c.method);
        const verified = methods.indexOf('verifyOtp');
        const out = methods.indexOf('signOut', verified);
        expect(verified).toBeGreaterThanOrEqual(0);
        expect(out).toBeGreaterThan(verified);
        // The window in which the foreign session is live on this client, in call order.
        const between = methods.slice(verified + 1, out);
        expect(between.filter(m => ['rpc', 'from', 'storage.from', 'channel'].includes(m))).toEqual([]);
        // Stronger: nothing at all runs in that window (no getSession either); the next thing is the sign-out.
        expect(between).toEqual([]);
        expect(sbMock.__calls[out].args).toEqual([{ scope: 'local' }]);
        // And after the sign-out, still nothing: the device is not registered under the attacker's account.
        expect(methods.slice(out + 1).filter(m => ['rpc', 'from', 'storage.from', 'channel'].includes(m))).toEqual([]);
        expect(rpcsOf('chat_register_device')).toEqual([]);
        expect(rpcsOf('register_push_device')).toEqual([]);
      });

      it('P2-1: onSignedIn fires once for a matching email link, after the address check, with the verified session', async () => {
        const signedIn = jest.fn((_s: AuthSession) => {});
        const off = auth.onSignedIn(signedIn);
        try {
          await auth.sendEmailLink('owner@example.test');
          expect(await auth.completeFromUrl('onepeek://auth?token_hash=h&type=magiclink')).toBe(true);
          expect(signedIn).toHaveBeenCalledTimes(1);
          expect(signedIn.mock.calls[0][0]).toMatchObject({ email: USER.email, isAnonymous: false });
          // Fired after verifyOtp and the compare; the session it reports is the one now installed.
          expect(await auth.getSession()).toEqual(signedIn.mock.calls[0][0]);
          // A refused link (no pending address) is not a sign-in.
          expect(await auth.completeFromUrl('onepeek://auth?token_hash=h&type=magiclink')).toBe(false);
          expect(signedIn).toHaveBeenCalledTimes(1);
          await auth.signOut();
          expect(signedIn).toHaveBeenCalledTimes(1);   // sign-out is not a sign-in
        } finally { off(); }
      });

      it('a session without an email never matches', async () => {
        await auth.sendEmailLink('me@x.test');
        sbMock.__otp.email = '';
        expect(await auth.completeFromUrl('onepeek://auth?token_hash=h&type=magiclink')).toBe(false);
        expect(callsOf('signOut')).toHaveLength(1);
        expect(await auth.getSession()).toBeNull();
      });

      it('the pending address expires with the OTP lifetime (1 h)', async () => {
        const t0 = Date.now();
        const now = jest.spyOn(Date, 'now');
        try {
          now.mockReturnValue(t0);
          await auth.sendEmailLink('me@x.test');
          now.mockReturnValue(t0 + HOUR + 1);
          expect(await auth.completeFromUrl('onepeek://auth?token_hash=h&type=magiclink')).toBe(false);
          expect(callsOf('verifyOtp')).toEqual([]);
          expect(secureItems.has(PENDING_EMAIL_KEY)).toBe(false);   // expiry removes the SecureStore row too
          // Expired means gone: back in time, the address is still not accepted.
          now.mockReturnValue(t0 + 1);
          expect(await auth.completeFromUrl('onepeek://auth?token_hash=h&type=magiclink')).toBe(false);
          expect(callsOf('verifyOtp')).toEqual([]);
          // Just inside the lifetime is fine.
          await auth.sendEmailLink('me@x.test');
          now.mockReturnValue(t0 + HOUR);
          sbMock.__otp.email = 'me@x.test';
          expect(await auth.completeFromUrl('onepeek://auth?token_hash=h&type=magiclink')).toBe(true);
        } finally {
          now.mockRestore();
        }
        await auth.signOut();
      });

      it('sign-out forgets the pending address (the recovery reset too: see resetThisPhone)', async () => {
        await auth.sendEmailLink('me@x.test');
        expect(secureItems.has(PENDING_EMAIL_KEY)).toBe(true);
        await auth.signOut();
        expect(secureItems.has(PENDING_EMAIL_KEY)).toBe(false);
        expect(await auth.completeFromUrl('onepeek://auth?token_hash=h&type=magiclink')).toBe(false);
        expect(callsOf('verifyOtp')).toEqual([]);
      });

      // W1-1 residual: the address used to live in module memory, so a link tapped after the app had been
      // killed in between asked for a new link. It is now a SecureStore row (this device only).
      describe('survives a cold start (SecureStore, WHEN_UNLOCKED_THIS_DEVICE_ONLY)', () => {
        /** A fresh lib/chat module instance with fresh fakes, as after a kill: only SecureStore carries over. */
        function coldStart(otpEmail: string): { auth: typeof auth; items: Map<string, string> } {
          let fresh: typeof import('../chat') | null = null;
          let items: Map<string, string> | null = null;
          jest.isolateModules(() => {
            // The new process sees the same SecureStore (seeded from the old mock's map; the two maps may
            // be one object or two, depending on how the registry re-creates the mock) and fresh everything else.
            const SS = jest.requireMock('expo-secure-store') as { __items: Map<string, string> };
            for (const [k, v] of secureItems) SS.__items.set(k, v);
            items = SS.__items;
            const sb2 = jest.requireMock('@supabase/supabase-js') as Mocked;
            sb2.__otp.email = otpEmail;
            fresh = jest.requireActual('../chat') as typeof import('../chat');
          });
          return { auth: fresh!.auth, items: items! };
        }

        it('sendEmailLink writes { email, at } under onepeek.pending-email with the this-device-only class, lower-cased', async () => {
          const set = jest.spyOn(SecureStore, 'setItemAsync');
          const t0 = Date.now();
          const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
          try {
            await auth.sendEmailLink('  Me@X.test ');
          } finally { now.mockRestore(); }
          expect(set).toHaveBeenCalledWith(PENDING_EMAIL_KEY, JSON.stringify({ email: 'me@x.test', at: t0 }), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
          expect(PENDING_EMAIL_KEY).toBe('onepeek.pending-email');
          expect(JSON.parse(secureItems.get(PENDING_EMAIL_KEY)!)).toEqual({ email: 'me@x.test', at: t0 });
          // Nothing but the address and the time: no token, no hash, no URL.
          expect(secureItems.get(PENDING_EMAIL_KEY)).not.toMatch(/token|hash|onepeek:\/\//);
          set.mockRestore();
          await auth.signOut();
        });

        it('a matching link completes in a new process (the request was made before the kill); the row is consumed', async () => {
          await auth.sendEmailLink('me@x.test');
          const cold = coldStart('me@x.test');
          expect(await cold.auth.completeFromUrl('onepeek://auth?token_hash=h-after-kill&type=magiclink')).toBe(true);
          expect(await cold.auth.getSession()).toMatchObject({ email: 'me@x.test', isAnonymous: false });
          expect(cold.items.has(PENDING_EMAIL_KEY)).toBe(false);
          // One link per request: the same row is not accepted a second time, in the new process either.
          await cold.auth.signOut();
          expect(await cold.auth.completeFromUrl('onepeek://auth?token_hash=h-after-kill&type=magiclink')).toBe(false);
          // The old process's memory is stale by now; its row is gone too (shared SecureStore).
          secureItems.delete(PENDING_EMAIL_KEY);
          await auth.signOut();
        });

        it("a link for another account is still refused in a new process (login CSRF), signed out again, and the row goes", async () => {
          await auth.sendEmailLink('me@x.test');
          const cold = coldStart('other@evil.test');
          expect(await cold.auth.completeFromUrl('onepeek://auth?token_hash=attackers-hash&type=magiclink')).toBe(false);
          expect(await cold.auth.getSession()).toBeNull();
          expect(cold.items.has(PENDING_EMAIL_KEY)).toBe(false);
          secureItems.delete(PENDING_EMAIL_KEY);
          await auth.signOut();
        });

        it('the 1 h rule applies to the stored timestamp: an old row found at cold start is refused and removed', async () => {
          const t0 = Date.now();
          const now = jest.spyOn(Date, 'now');
          try {
            now.mockReturnValue(t0);
            await auth.sendEmailLink('me@x.test');
            now.mockReturnValue(t0 + HOUR + 1);
            const cold = coldStart('me@x.test');
            expect(await cold.auth.completeFromUrl('onepeek://auth?token_hash=h&type=magiclink')).toBe(false);
            expect(cold.items.has(PENDING_EMAIL_KEY)).toBe(false);
          } finally { now.mockRestore(); }
          secureItems.delete(PENDING_EMAIL_KEY);
          await auth.signOut();
        });

        it('a malformed row is treated as absent', async () => {
          secureItems.set(PENDING_EMAIL_KEY, '{"email":"me@x.test"}');   // no timestamp
          const cold = coldStart('me@x.test');
          expect(await cold.auth.completeFromUrl('onepeek://auth?token_hash=h&type=magiclink')).toBe(false);
          secureItems.set(PENDING_EMAIL_KEY, 'not json');
          const cold2 = coldStart('me@x.test');
          expect(await cold2.auth.completeFromUrl('onepeek://auth?token_hash=h&type=magiclink')).toBe(false);
          secureItems.delete(PENDING_EMAIL_KEY);
        });
      });
    });

    it('P2-1: onSignedIn fires for the Google code exchange, Apple and guest, never from the raw auth event, and unsubscribes', async () => {
      const signedIn = jest.fn((_s: AuthSession) => {});
      const raw = jest.fn();
      const off = auth.onSignedIn(signedIn);
      const offRaw = auth.onChange(raw);
      try {
        expect(await auth.completeFromUrl('onepeek://auth?code=good-code')).toBe(true);
        expect(signedIn).toHaveBeenCalledTimes(1);
        expect(signedIn.mock.calls[0][0]).toMatchObject({ userId: USER.id, email: USER.email, isAnonymous: false });
        await auth.signOut();
        expect(await auth.completeFromUrl('onepeek://auth?code=bad-code')).toBe(false);
        expect(signedIn).toHaveBeenCalledTimes(1);

        await auth.signInWithApple('apple-identity-token', 'nonce-1');
        expect(signedIn).toHaveBeenCalledTimes(2);
        expect(signedIn.mock.calls[1][0]).toMatchObject({ userId: 'apple-user', isAnonymous: false });
        await auth.signOut();

        await auth.signInAsGuest();
        expect(signedIn).toHaveBeenCalledTimes(3);
        expect(signedIn.mock.calls[2][0]).toMatchObject({ userId: 'guest-user', isAnonymous: true });
        await auth.signOut();

        // The signal is this module's, not Supabase's: the fake never fires auth events, and the
        // listener count is exactly the module's own emits (one per completed sign-in).
        expect(raw).not.toHaveBeenCalled();
        off();
        await auth.signInAsGuest();
        expect(signedIn).toHaveBeenCalledTimes(3);
        await auth.signOut();
      } finally { off(); offRaw(); }
    });

    it('P2-1: a throwing onSignedIn listener does not break the sign-in or the other listeners', async () => {
      const bad = jest.fn(() => { throw new Error('listener bug'); });
      const good = jest.fn();
      const offs = [auth.onSignedIn(bad), auth.onSignedIn(good)];
      try {
        await auth.signInAsGuest();
        expect(bad).toHaveBeenCalledTimes(1);
        expect(good).toHaveBeenCalledTimes(1);
        expect(await auth.getSession()).toMatchObject({ isAnonymous: true });
      } finally { offs.forEach(f => f()); await auth.signOut(); }
    });

    it('P2-9: signOut wipes the secrets quota id (onepeek.client) from SecureStore and memory', async () => {
      await auth.signInAsGuest();
      resetClientIdCache();
      const id = await getClientId();
      expect(secureItems.get(CLIENT_ID_KEY)).toBe(id);
      await auth.signOut();
      expect(secureItems.has(CLIENT_ID_KEY)).toBe(false);
      const next = await getClientId();   // a fresh identity, not the cached one
      expect(next).not.toBe(id);
      expect(secureItems.get(CLIENT_ID_KEY)).toBe(next);
      secureItems.delete(CLIENT_ID_KEY); resetClientIdCache();
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

// W1-2: the push token reaches exactly two places (the RPC and the sealed auth store) and is forgotten
// server-side before this phone's session is revoked.
describe('push', () => {
  const PUSH_ROW = 'auth:onepeek.push.token';
  const authRows = () => [...sqliteFake.files.get('onepeek-auth.db')!.sealed.keys()].sort();

  it('register calls register_push_device with the token and keeps it sealed, nowhere else', async () => {
    expect(await auth.completeFromUrl('onepeek://auth?code=good-code')).toBe(true);
    expect(await push.current()).toBe(false);
    await push.register('ios', `  ${PUSH_TOKEN} `);
    expect(rpcsOf('register_push_device').map(c => c.args[1])).toEqual([{ p_platform: 'ios', p_token: PUSH_TOKEN }]);
    expect(await push.current()).toBe(true);
    expect(authRows()).toEqual([PUSH_ROW, 'auth:sb-xyzcompany-auth-token']);
    // Sealed at rest, absent from SecureStore, absent from every non-RPC call into supabase-js.
    const disk = atRest();
    for (const form of [PUSH_TOKEN, hex(PUSH_TOKEN), b64(PUSH_TOKEN)]) expect(disk).not.toContain(form);
    expect([...secureItems.values()].join('\n')).not.toContain(PUSH_TOKEN);
    expect(nonRpcCalls()).not.toContain(PUSH_TOKEN);
    await auth.signOut();
  });

  it('register with a rotated token forgets the previous one', async () => {
    expect(await auth.completeFromUrl('onepeek://auth?code=good-code')).toBe(true);
    await push.register('android', PUSH_TOKEN);
    await push.register('android', PUSH_TOKEN_2);
    expect(rpcsOf('register_push_device').map(c => c.args[1])).toEqual([
      { p_platform: 'android', p_token: PUSH_TOKEN },
      { p_platform: 'android', p_token: PUSH_TOKEN_2 },
    ]);
    expect(rpcsOf('unregister_push_device').map(c => c.args[1])).toEqual([{ p_token: PUSH_TOKEN }]);
    sbMock.__calls.length = 0;
    await push.register('android', PUSH_TOKEN_2);   // same token again: nothing to forget
    expect(rpcsOf('unregister_push_device')).toEqual([]);
    await auth.signOut();
    expect(rpcsOf('unregister_push_device').map(c => c.args[1])).toEqual([{ p_token: PUSH_TOKEN_2 }]);
  });

  it('a failed registration stores nothing', async () => {
    expect(await auth.completeFromUrl('onepeek://auth?code=good-code')).toBe(true);
    sbMock.__failRpc.add('register_push_device');
    await expect(push.register('ios', PUSH_TOKEN)).rejects.toThrow();
    expect(await push.current()).toBe(false);
    expect(authRows()).toEqual(['auth:sb-xyzcompany-auth-token']);
    await auth.signOut();
  });

  it('unregister calls unregister_push_device with the stored token and clears it; a second call is a no-op', async () => {
    expect(await auth.completeFromUrl('onepeek://auth?code=good-code')).toBe(true);
    await push.register('ios', PUSH_TOKEN);
    sbMock.__calls.length = 0;
    await push.unregister();
    expect(rpcsOf('unregister_push_device').map(c => c.args[1])).toEqual([{ p_token: PUSH_TOKEN }]);
    expect(await push.current()).toBe(false);
    expect(authRows()).toEqual(['auth:sb-xyzcompany-auth-token']);
    await push.unregister();
    expect(rpcsOf('unregister_push_device')).toHaveLength(1);
    expect(nonRpcCalls()).not.toContain(PUSH_TOKEN);
    await auth.signOut();
  });

  it('signOut unregisters the token before revoking the session', async () => {
    expect(await auth.completeFromUrl('onepeek://auth?code=good-code')).toBe(true);
    await push.register('ios', PUSH_TOKEN);
    sbMock.__calls.length = 0;
    await auth.signOut();
    const order = sbMock.__calls.map(c => (c.method === 'rpc' ? `rpc:${c.args[0]}` : c.method));
    expect(order.indexOf('rpc:unregister_push_device')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('rpc:unregister_push_device')).toBeLessThan(order.indexOf('signOut'));
    expect(callsOf('signOut')[0].args).toEqual([{ scope: 'local' }]);
    expect(await auth.getSession()).toBeNull();
    expect(await push.current()).toBe(false);
    expect(authRows()).toEqual([]);
    expect(nonRpcCalls()).not.toContain(PUSH_TOKEN);
  });

  it('signOut still signs out when the unregister RPC fails, and the local token is gone', async () => {
    expect(await auth.completeFromUrl('onepeek://auth?code=good-code')).toBe(true);
    await push.register('ios', PUSH_TOKEN);
    sbMock.__failRpc.add('unregister_push_device');
    await auth.signOut();
    expect(rpcsOf('unregister_push_device')).toHaveLength(1);
    expect(callsOf('signOut')[0].args).toEqual([{ scope: 'local' }]);
    expect(await auth.getSession()).toBeNull();
    expect(await push.current()).toBe(false);
  });

  it('signOut with no registered token calls no push RPC', async () => {
    await auth.signInAsGuest();
    sbMock.__calls.length = 0;
    await auth.signOut();
    expect(callsOf('rpc')).toEqual([]);
    expect(callsOf('signOut')).toHaveLength(1);
  });

  it('resetThisPhone unregisters the token before the local sign-out', async () => {
    expect(await auth.completeFromUrl('onepeek://auth?code=good-code')).toBe(true);
    await push.register('ios', PUSH_TOKEN);
    sbMock.__calls.length = 0;
    await resetThisPhone();
    const order = sbMock.__calls.map(c => (c.method === 'rpc' ? `rpc:${c.args[0]}` : c.method));
    expect(order.indexOf('rpc:unregister_push_device')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('rpc:unregister_push_device')).toBeLessThan(order.indexOf('signOut'));
    expect(sqliteFake.files.get('onepeek-auth.db')!.sealed.size).toBe(0);
    expect(await push.current()).toBe(false);
  });
});

describe('resetThisPhone', () => {
  it('signs out locally, wipes both sealed stores and the lock, and the next getChat() rebuilds', async () => {
    const before = getChat();
    expect(await auth.completeFromUrl('onepeek://auth?code=good-code')).toBe(true);
    await auth.sendEmailLink('me@x.test');   // a pending email link: forgotten by the reset
    expect(secureItems.has(PENDING_EMAIL_KEY)).toBe(true);
    stashHandoff('secret', 'https://onepeek.io/s/abcdefgh12#' + 'k'.repeat(43));   // a parked link: dropped by the reset (P3-2)
    await before.keystore.put('room:r1:state', new Uint8Array([1, 2, 3]));
    getLockStore().set();
    expect(sqliteFake.files.get('onepeek-chat.db')!.sealed.size).toBeGreaterThan(0);
    expect(sqliteFake.files.get('onepeek-auth.db')!.sealed.size).toBe(1);
    expect(secureItems.has('onepeek.wrap')).toBe(true);
    expect(secureItems.has('onepeek.wrap.auth')).toBe(true);
    const builds = sbMock.createClient.mock.calls.length;
    mockFiles.clearPickerCaches.mockClear();
    resetClientIdCache();
    const clientId = await getClientId();   // the secrets quota id: wiped by the reset too (P2-9)
    expect(secureItems.get(CLIENT_ID_KEY)).toBe(clientId);

    await resetThisPhone();

    expect(mockFiles.clearPickerCaches).toHaveBeenCalledTimes(1);   // picker copies and viewer temps go too (W2-2 / W2-3)
    expect(secureItems.has(PENDING_EMAIL_KEY)).toBe(false);
    expect(takeHandoff('secret')).toBeNull();
    expect(secureItems.has(CLIENT_ID_KEY)).toBe(false);
    expect(await getClientId()).not.toBe(clientId);
    secureItems.delete(CLIENT_ID_KEY); resetClientIdCache();
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
    expect(await auth.completeFromUrl('onepeek://auth?token_hash=h&type=magiclink')).toBe(false);
    expect(callsOf('verifyOtp')).toEqual([]);
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

  // W1-6: the Supabase host is where the refresh token and every RPC go. Anything but
  // https://<ref>.supabase.co (the fetch lint's pattern) gets no client at all.
  it.each([
    'https://evil.example',
    'https://evil.example/xyzcompany.supabase.co',
    'https://xyzcompany.supabase.co.evil.example',
    'https://xyzcompany.supabase.co/',
    'https://xyzcompany.supabase.co/auth/v1',
    'https://xyzcompany.supabase.co:443',
    'https://xyzcompany.supabase.co?x=1',
    'https://xyzcompany.supabase.co#f',
    'http://xyzcompany.supabase.co',
    'https://user@xyzcompany.supabase.co',
    'https://XYZCOMPANY.supabase.co',
    'https://.supabase.co',
    'xyzcompany.supabase.co',
  ])('%s is not a Supabase URL: no client is built and every call is not_configured', async (bad) => {
    const extra = Constants.expoConfig!.extra as Record<string, string>;
    const saved = { ...extra };
    await resetThisPhone();
    extra.supabaseUrl = bad;
    const builds = sbMock.createClient.mock.calls.length;
    try {
      expect(getChat()).toBeTruthy();
      expect(sbMock.createClient.mock.calls.length).toBe(builds);
      await expect(auth.getSession()).rejects.toThrow('not_configured');
      await expect(auth.sendEmailLink('owner@example.test')).rejects.toThrow('not_configured');
      await expect(getChat().myRooms()).rejects.toThrow('not_configured');
      expect(JSON.stringify(sbMock.__calls)).not.toContain('evil.example');
    } finally {
      Object.assign(extra, saved);
      await resetThisPhone();
    }
  });

  it('the exact project host is accepted, surrounding whitespace trimmed', async () => {
    const extra = Constants.expoConfig!.extra as Record<string, string>;
    const saved = { ...extra };
    await resetThisPhone();
    extra.supabaseUrl = '  https://xyzcompany.supabase.co\n';
    const builds = sbMock.createClient.mock.calls.length;
    try {
      getChat();
      expect(sbMock.createClient.mock.calls.length).toBe(builds + 1);
      expect(sbMock.createClient.mock.calls[builds][0]).toBe(URL);
    } finally {
      Object.assign(extra, saved);
      await resetThisPhone();
    }
  });
});

describe('auth.setForeground', () => {
  it('starts the session auto-refresh when the app is active and stops it in the background', () => {
    getChat();
    sbMock.__calls.length = 0;
    auth.setForeground(true);
    auth.setForeground(false);
    auth.setForeground(true);
    expect(sbMock.__calls.map(c => c.method)).toEqual(['startAutoRefresh', 'stopAutoRefresh', 'startAutoRefresh']);
    // Nothing else is touched: no RPC, no table, no bucket.
    expect(nonRpcCalls()).not.toMatch(/"from"|"storage|"channel"/);
  });
});
