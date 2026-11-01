// lib/secrets glue: the link gate and the wiring of packages/core/src/secrets.ts to the app's Supabase
// client, fetch, the literal site origin and the SecureStore client id. The byte-level web mapping
// (header JSON, RPC arguments, /api/open body) is pinned in packages/core/src/secrets.test.ts; here
// we check that the glue hands the core the right pieces and nothing else leaves the phone.
import * as SecureStore from 'expo-secure-store';
import { decryptJson, decryptText, importKey, toB64Url, type SecretHeader } from '@onepeek/core';
import {
  CLIENT_ID_KEY, createSecretLink, getClientId, isSecretLink, openSecretLink, peekSecretLink, requestUnlockCode,
  resetClientIdCache, SecretError, verifyUnlockCode,
} from '../secrets';

jest.mock('../files', () => ({ clearPickerCaches: async () => {} }));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { supabaseUrl: 'https://xyzcompany.supabase.co', supabaseAnonKey: 'anon-key-for-tests', siteUrl: 'https://onepeek.io' } } },
}));

jest.mock('expo-device', () => ({ modelName: 'iPhone 15', osName: 'iOS', osVersion: '18.1', deviceName: "Pulkit's iPhone" }));

jest.mock('expo-sqlite', () => {
  const { createFakeSqlite } = jest.requireActual('./fake-sqlite');
  const fake = createFakeSqlite();
  return { __esModule: true, openDatabaseSync: (name: string) => fake.openDatabaseSync(name), __fake: fake };
});

jest.mock('@supabase/supabase-js', () => {
  const { createFakeSupabase } = jest.requireActual('./fake-supabase');
  return createFakeSupabase(jest.fn);
});

type Mocked = {
  __calls: { method: string; args: unknown[] }[];
  __failRpc: Set<string>;
  __rpcAnswers: Map<string, (args: Record<string, unknown>) => unknown>;
};
const sbMock = jest.requireMock('@supabase/supabase-js') as Mocked;
const secureItems = (SecureStore as unknown as { __items: Map<string, string> }).__items;

const KEY43 = toB64Url(new Uint8Array(32).fill(3));
const TEXT = 'api key: sk-live-9f8e7d6c5b4a3f2e1d0c';
const rpcsOf = (fn: string) => sbMock.__calls.filter(c => c.method === 'rpc' && c.args[0] === fn).map(c => c.args[1] as Record<string, unknown>);
const keyOf = (url: string) => url.slice(url.indexOf('#') + 1);
const failsWith = async (p: Promise<unknown>, code: string) => {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(SecretError);
  expect((e as SecretError).code).toBe(code);
  return e as SecretError;
};

/** What `create_secret` stored, so `peek_secret` and the fake `/api/open` can answer from it. */
const stored = new Map<string, { header: string; body: string | null; file_path: string | null }>();
const fetchMock = jest.fn<Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>, [string, { method: string; headers: Record<string, string>; body: string }]>();

beforeEach(() => {
  sbMock.__calls.length = 0;
  sbMock.__failRpc.clear();
  sbMock.__rpcAnswers.clear();
  stored.clear();
  let n = 0;
  sbMock.__rpcAnswers.set('create_secret', args => {
    const id = `TestId${String(++n).padStart(4, '0')}`;
    stored.set(id, { header: args.p_header as string, body: (args.p_body as string | null) ?? null, file_path: (args.p_file_path as string | null) ?? null });
    return id;
  });
  sbMock.__rpcAnswers.set('peek_secret', args => {
    const s = stored.get(args.p_id as string);
    return s ? [{ header: s.header, kind: 'text', max_views: 1, views_left: 1, lock_hint: null, open_after: null, allowed_countries: null }] : [];
  });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url, init) => {
    const body = JSON.parse(init.body) as { id: string };
    const s = stored.get(body.id);
    if (!url.endsWith('/api/open')) return { ok: true, status: 200, json: async () => ({ ok: true, token: 'unlock-token-ok' }) };
    if (!s) return { ok: false, status: 404, json: async () => ({ error: 'gone' }) };
    stored.delete(body.id);
    return { ok: true, status: 200, json: async () => ({ header: s.header, body: s.body, file_path: s.file_path, views_left: 0, final: true, viewer_place: null }) };
  });
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  secureItems.delete(CLIENT_ID_KEY);
  resetClientIdCache();
});

describe('isSecretLink', () => {
  it.each([
    `https://onepeek.io/s/AbCdEfGhIj#${KEY43}`,
    `https://www.onepeek.io/s/AbCdEfGhIj#${KEY43}`,
    `onepeek://s/AbCdEfGhIj#${KEY43}`,
    `HTTPS://ONEPEEK.IO/s/AbCdEfGhIj#${KEY43}`,
  ])('accepts %s', url => expect(isSecretLink(url)).toBe(true));

  it.each([
    `http://onepeek.io/s/AbCdEfGhIj#${KEY43}`,
    `https://onepeek.io:8443/s/AbCdEfGhIj#${KEY43}`,
    `https://onepeek.io.evil.example/s/AbCdEfGhIj#${KEY43}`,
    `https://evil.example/s/AbCdEfGhIj#${KEY43}`,
    `https://onepeek.io/chat/join/AbCdEfGhIj#${KEY43}`,
    `https://onepeek.io/s/AbCdEfGhIj`,
    `https://onepeek.io/s/AbCdEfGhIj#not-a-key`,
    `https://onepeek.io/s/AbCdEfGhIj#${KEY43}=`,
    `https://onepeek.io/s/ab#${KEY43}`,
    `onepeek://auth?code=x#${KEY43}`,
    `onepeek://s/AbCdEfGhIj`,
    'onepeek://s/',
    '',
  ])('rejects %s', url => expect(isSecretLink(url)).toBe(false));

  it('refuses a bad link before anything is parsed or sent', async () => {
    await failsWith(peekSecretLink(`https://evil.example/s/AbCdEfGhIj#${KEY43}`), 'bad_link');
    await failsWith(openSecretLink(`https://onepeek.io/s/AbCdEfGhIj`), 'bad_link');
    await failsWith(requestUnlockCode('nope', 'pat@example.test'), 'bad_link');
    await failsWith(verifyUnlockCode('nope', '123456'), 'bad_link');
    expect(sbMock.__calls.filter(c => c.method === 'rpc')).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('createSecretLink', () => {
  it('calls create_secret through the app client with the phone\'s client id and builds an onepeek.io link', async () => {
    const link = await createSecretLink({ kind: 'text', text: TEXT }, { ttlSeconds: 86400, views: 3, timer: 30, guard: true });
    const [args] = rpcsOf('create_secret');
    expect(args).toMatchObject({ p_ttl_seconds: 86400, p_max_views: 3, p_file_path: null, p_ref: null, p_recipient: null, p_share_location: false, p_size: null });
    expect(args.p_client_id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(link.url).toBe(`https://onepeek.io/s/${link.id}#${keyOf(link.url)}`);
    expect(isSecretLink(link.url)).toBe(true);
    const key = await importKey(keyOf(link.url));
    expect(await decryptJson<SecretHeader>(key, args.p_header as string)).toEqual({ v: 1, type: 'text', timer: 30, guard: true });
    expect(await decryptText(key, args.p_body as string)).toBe(TEXT);
    // Nothing readable reached the fake: not the text, not the key.
    const wire = JSON.stringify(sbMock.__calls);
    expect(wire).not.toContain(TEXT);
    expect(wire).not.toContain(keyOf(link.url));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps one client id per install in SecureStore and reuses it', async () => {
    await createSecretLink({ kind: 'text', text: TEXT }, { ttlSeconds: 3600, views: 1 });
    await createSecretLink({ kind: 'text', text: TEXT }, { ttlSeconds: 3600, views: 1 });
    const [a, b] = rpcsOf('create_secret').map(x => x.p_client_id);
    expect(a).toBe(b);
    expect(secureItems.get(CLIENT_ID_KEY)).toBe(a);
    resetClientIdCache();
    expect(await getClientId()).toBe(a);
    // A stored value that is not a valid id is replaced, never sent.
    secureItems.set(CLIENT_ID_KEY, 'bad id!');
    resetClientIdCache();
    const fresh = await getClientId();
    expect(fresh).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(fresh).not.toBe(a);
  });

  it('maps the server refusals to codes', async () => {
    sbMock.__rpcAnswers.delete('create_secret');
    sbMock.__failRpc.add('create_secret');
    await failsWith(createSecretLink({ kind: 'text', text: TEXT }, { ttlSeconds: 3600, views: 1 }), 'create_failed');
    await failsWith(createSecretLink({ kind: 'text', text: '' }, { ttlSeconds: 3600, views: 1 }), 'empty');
  });

  it('uploads a file\'s ciphertext to the secrets bucket and passes only the path to the RPC', async () => {
    const data = new TextEncoder().encode('scan of a passport');
    const link = await createSecretLink({ kind: 'file', file: { name: 'passport.png', mime: 'image/png', size: data.byteLength, bytes: async () => data } }, { ttlSeconds: 3600, views: 1 });
    const upload = sbMock.__calls.find(c => c.method === 'storage.upload')!;
    expect(upload.args[0]).toBe('secrets');
    expect(upload.args[1]).toMatch(/^f\/[A-Za-z0-9_-]{32}\.bin$/);
    expect(upload.args[2]).toBeInstanceOf(Uint8Array);
    expect(upload.args[3]).toEqual({ contentType: 'application/octet-stream', upsert: false });
    const [args] = rpcsOf('create_secret');
    expect(args).toMatchObject({ p_body: null, p_file_path: upload.args[1], p_size: data.byteLength });
    const wire = JSON.stringify(sbMock.__calls.map(c => c.args.map(a => (a instanceof Uint8Array ? `[bytes:${a.byteLength}]` : a))));
    expect(wire).not.toContain('passport');
    expect(wire).not.toContain(keyOf(link.url));
  });
});

describe('peekSecretLink / openSecretLink', () => {
  it('peeks with peek_secret { p_id } and decrypts the header on the device', async () => {
    const link = await createSecretLink({ kind: 'text', text: TEXT }, { ttlSeconds: 3600, views: 1, timer: 10 });
    const peek = await peekSecretLink(link.url);
    expect(rpcsOf('peek_secret')).toEqual([{ p_id: link.id }]);
    expect(peek).toMatchObject({ header: { v: 1, type: 'text', timer: 10 }, viewsLeft: 1, maxViews: 1, locked: false, lockHint: null, notYet: null });
    expect(JSON.stringify(sbMock.__calls)).not.toContain(keyOf(link.url));
  });

  it('opens through the literal site API with the web body and decrypts the text here', async () => {
    const link = await createSecretLink({ kind: 'text', text: TEXT }, { ttlSeconds: 3600, views: 1 });
    const opened = await openSecretLink(link.url);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://onepeek.io/api/open');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.body).toBe(JSON.stringify({ id: link.id, precise: null }));
    expect(opened).toMatchObject({ kind: 'text', text: TEXT, final: true, viewsLeft: 0 });
    expect(init.body).not.toContain(keyOf(link.url));
    await failsWith(openSecretLink(link.url), 'gone');
  });

  it('passes the unlock token and never the email', async () => {
    const link = await createSecretLink({ kind: 'text', text: TEXT }, { ttlSeconds: 3600, views: 1 });
    await openSecretLink(link.url, { email: 'pat@example.test', token: 'unlock-token-ok' });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ id: link.id, precise: null, unlockToken: 'unlock-token-ok' }));
    expect(init.body).not.toContain('pat@example.test');
  });

  it('wires the unlock routes to the same origin', async () => {
    const link = await createSecretLink({ kind: 'text', text: TEXT }, { ttlSeconds: 3600, views: 1 });
    await requestUnlockCode(link.url, 'pat@example.test');
    expect(await verifyUnlockCode(link.url, '123456')).toBe('unlock-token-ok');
    expect(fetchMock.mock.calls.map(([u, i]) => [u, i.body])).toEqual([
      ['https://onepeek.io/api/unlock/send', JSON.stringify({ id: link.id, email: 'pat@example.test' })],
      ['https://onepeek.io/api/unlock/verify', JSON.stringify({ id: link.id, code: '123456' })],
    ]);
  });
});
