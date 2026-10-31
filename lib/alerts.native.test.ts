// Native push senders (APNs / FCM) with mocked transports and throwaway keys generated at runtime.
// Proves the payloads are the fixed shapes, carry nothing but the room id, clean up dead tokens,
// sign the provider JWTs correctly, do nothing without env, and that web push is unchanged.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { BODY, BODY2, FILE_NAME, FILE_BODY, ACCESS_CODE, NICK, OWNER_NICK, ROOM_NAME, forbidden, expectClean as expectCleanForms, type Forbidden } from '../packages/core/test/fixtures';

const sendNotification = vi.fn();
const setVapidDetails = vi.fn();
vi.mock('web-push', () => ({ default: { sendNotification: (...a: unknown[]) => sendNotification(...a), setVapidDetails: (...a: unknown[]) => setVapidDetails(...a) } }));
vi.mock('./email', () => ({ sendEmail: vi.fn(), layout: vi.fn() }));

const ROOM = '11111111-2222-4333-8444-555555555555';
const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ecPem = ec.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const rsaPem = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

// Things a push must never carry, from a decoy that mimics what the notify route knows.
const FORBIDDEN = ['the wifi password is hunter2', 'Alice', 'passport.pdf', '4821', 'inv_tok_abcdef0123456789', 'Family chat', '99999999-aaaa-4bbb-8ccc-dddddddddddd'];
const DECOY = {
  room: ROOM, text: FORBIDDEN[0], nickname: FORBIDDEN[1], file: FORBIDDEN[2], access_code: FORBIDDEN[3],
  invite: FORBIDDEN[4], name: FORBIDDEN[5], sender: FORBIDDEN[6], aps: { alert: { body: FORBIDDEN[0] } }, notification: { image: 'x' },
} as unknown as { room: string };
const expectClean = (s: string) => { for (const f of FORBIDDEN) expect(s).not.toContain(f); };

// Fixture-based sweep (test-plan §1.5 items 1, 2, 8): every fixture string, the ids a notify route knows,
// and every credential, each as text, hex, base64 and base64url, over every captured request.
const SENDER = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
const RECIPIENT = '88888888-aaaa-4bbb-8ccc-eeeeeeeeeeee';
const INVITE = 'inv_tok_abcdef0123456789';
const ATTACHMENT_KEY = 'att_key_0123456789abcdef';
const APNS_KEY_ID = 'KEY1234567';
const APNS_TEAM_ID = 'TEAM123456';
const FCM_EMAIL = 'push@onepeek-test.iam.gserviceaccount.com';
const pemBody = (p: string) => p.replace(/-----[^-]+-----|\s/g, '');
const CONTENT_FORBIDDEN: Forbidden[] = [
  ['BODY', BODY], ['BODY2', BODY2], ['FILE_NAME', FILE_NAME], ['FILE_BODY', FILE_BODY], ['ACCESS_CODE', ACCESS_CODE],
  ['NICK', NICK], ['OWNER_NICK', OWNER_NICK], ['ROOM_NAME', ROOM_NAME], ['SENDER', SENDER], ['RECIPIENT', RECIPIENT],
  ['INVITE', INVITE], ['ATTACHMENT_KEY', ATTACHMENT_KEY], ...FORBIDDEN.map((f, i) => [`decoy${i}`, f] as [string, string]),
].map(([l, v]) => forbidden(l, v));
const CREDENTIALS: Forbidden[] = [
  forbidden('APNS_KEY_ID', APNS_KEY_ID), forbidden('APNS_TEAM_ID', APNS_TEAM_ID),
  forbidden('APNS_PRIVATE_KEY (EC pem)', ecPem), forbidden('APNS_PRIVATE_KEY (EC pem, env-escaped)', ecPem.replace(/\n/g, '\\n')), forbidden('APNS_PRIVATE_KEY (EC der b64)', pemBody(ecPem)),
  forbidden('FCM private_key (RSA pem)', rsaPem), forbidden('FCM private_key (RSA pem, env-escaped)', rsaPem.replace(/\n/g, '\\n')), forbidden('FCM private_key (RSA der b64)', pemBody(rsaPem)),
  forbidden('FCM client_email', FCM_EMAIL),
];
// The provider JWTs legitimately name the key id / team id / client_email (inside base64url JSON claims), so the
// authorization header and the token-exchange body are swept with the key material and message content only.
const KEY_MATERIAL = CREDENTIALS.filter(f => /pem|der/.test(f.label));
const serialise = (calls: unknown[][]) => calls.map(c => JSON.stringify(c)).join('\n');
const sweep = (calls: unknown[][], where: string) => {
  expect(calls.length, `${where}: nothing captured`).toBeGreaterThan(0);
  const all = serialise(calls);
  expectCleanForms(all, CONTENT_FORBIDDEN, `${where} (content)`);
  expectCleanForms(all, KEY_MATERIAL, `${where} (key material)`);
  // The non-JWT parts (URL, every header but authorization, body) must not carry ids either.
  const stripped = JSON.stringify(calls.map(c => JSON.parse(JSON.stringify(c, (k, v) => (k === 'authorization' || k === 'assertion') ? '[jwt]' : v))));
  const noJwt = stripped.replace(/assertion=[^"&]+/g, 'assertion=[jwt]');
  expectCleanForms(noJwt, CREDENTIALS, `${where} (credentials)`);
};
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

type Alerts = typeof import('./alerts');
let alerts: Alerts;

function setApnsEnv() {
  vi.stubEnv('APNS_KEY_ID', 'KEY1234567');
  vi.stubEnv('APNS_TEAM_ID', 'TEAM123456');
  vi.stubEnv('APNS_PRIVATE_KEY', ecPem.replace(/\n/g, '\\n'));  // as pasted into Vercel
  vi.stubEnv('APNS_BUNDLE_ID', 'io.onepeek.app');
}
function setFcmEnv() {
  vi.stubEnv('FCM_SERVICE_ACCOUNT_JSON', JSON.stringify({ project_id: 'onepeek-test', client_email: 'push@onepeek-test.iam.gserviceaccount.com', private_key: rsaPem }));
}
type Http2Req = Parameters<Alerts['sendApns']>[2] extends infer T ? T extends { http2Request?: infer R } ? R extends (r: infer A) => unknown ? A : never : never : never;
const http2Mock = (status: number, body = '') => vi.fn(async (_req: Http2Req) => ({ status, body }));
const fetchMock = (routes: (url: string, init?: RequestInit) => { status: number; body: unknown }) =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const r = routes(String(url), init);
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => JSON.parse(text), text: async () => text } as Response;
  });
const fcmOk = (url: string) => url.includes('oauth2') ? { status: 200, body: { access_token: 'ya29.test', expires_in: 3600 } } : { status: 200, body: { name: 'projects/x/messages/1' } };

function fakeAdmin(devices: { platform: string; token: string }[]) {
  const deleted: { owner: string; tokens: string[] }[] = [];
  const reads: { order: [string, { ascending: boolean }]; limit: number }[] = [];
  const admin = {
    from(table: string) {
      expect(table).toBe('push_devices');
      return {
        select: () => ({
          eq: () => ({
            order: (col: string, o: { ascending: boolean }) => ({
              limit: async (n: number) => { reads.push({ order: [col, o], limit: n }); return { data: devices.slice(0, n) }; },
            }),
          }),
        }),
        delete: () => ({ eq: (_c: string, owner: string) => ({ in: async (_t: string, tokens: string[]) => { deleted.push({ owner, tokens }); return { data: null }; } }) }),
      };
    },
  };
  return { admin: admin as never, deleted, reads };
}

beforeEach(async () => {
  vi.resetModules();
  sendNotification.mockReset();
  setVapidDetails.mockReset();
  alerts = await import('./alerts');
  alerts.configureNativeTransports(null);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('native push: payload shapes', () => {
  it('APNs payload is exactly the fixed shape plus the room id', () => {
    expect(alerts.apnsPayload({ room: ROOM })).toEqual({
      aps: { alert: { title: 'OnePeek', body: 'You have a new message in a private chat.' }, sound: 'default', 'thread-id': ROOM },
      room: ROOM,
    });
  });

  it('FCM message is exactly the fixed shape plus the room id, no apns block', () => {
    expect(alerts.fcmMessage('tok', { room: ROOM })).toEqual({
      message: {
        token: 'tok',
        notification: { title: 'OnePeek', body: 'You have a new message in a private chat.' },
        data: { room: ROOM },
        android: { priority: 'high', notification: { tag: `chat-${ROOM}` } },
      },
    });
    expect(alerts.fcmMessage('tok', { room: ROOM }).message).not.toHaveProperty('apns');
  });

  it('carries none of the forbidden strings even from a decoy object', () => {
    const apns = JSON.stringify(alerts.apnsPayload(DECOY));
    const fcm = JSON.stringify(alerts.fcmMessage('tok', DECOY));
    expectClean(apns); expectClean(fcm);
    expect(JSON.parse(apns)).toEqual(alerts.apnsPayload({ room: ROOM }));
    expect(JSON.parse(fcm)).toEqual(alerts.fcmMessage('tok', { room: ROOM }));
    // The only uuid present is the room id.
    for (const s of [apns, fcm]) expect(s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)!.every(u => u === ROOM)).toBe(true);
  });

  it('refuses a room that is not a uuid (nothing can be smuggled through the routing key)', () => {
    expect(() => alerts.apnsPayload({ room: FORBIDDEN[0] })).toThrow(/bad_room/);
    expect(() => alerts.fcmMessage('tok', { room: 'Family chat' })).toThrow(/bad_room/);
  });
});

describe('native push: fixture sweep over every captured request (§1.5 items 1, 2)', () => {
  it('APNs: URL, headers and body of every request are clean as text, hex, base64 and base64url', async () => {
    setApnsEnv();
    const h = http2Mock(200);
    await alerts.sendApns(['tokA', 'tokB'], DECOY, { http2Request: h });
    sweep(h.mock.calls, 'APNs request');
    expect(h.mock.calls).toHaveLength(2);
  });

  it('FCM: token-exchange URL/headers/body and every send URL/headers/body are clean', async () => {
    setFcmEnv();
    const f = fetchMock(fcmOk);
    await alerts.sendFcm(['tokA', 'tokB'], DECOY, { fetch: f });
    expect(f).toHaveBeenCalledTimes(3);
    sweep(f.mock.calls, 'FCM request');
    for (const [url, init] of f.mock.calls.slice(1)) {
      expect(String(url)).toBe('https://fcm.googleapis.com/v1/projects/onepeek-test/messages:send');
      expect(Object.keys(init!.headers as object).sort()).toEqual(['authorization', 'content-type']);
    }
  });

  it('pushToNative on both transports: nothing but the fixed shapes goes out', async () => {
    setApnsEnv(); setFcmEnv();
    const { admin } = fakeAdmin([{ platform: 'ios', token: 'iosA' }, { platform: 'android', token: 'andA' }]);
    const h = http2Mock(200), f = fetchMock(fcmOk);
    expect(await alerts.pushToNative(admin, RECIPIENT, ROOM, { http2Request: h, fetch: f })).toBe(2);
    sweep(h.mock.calls, 'pushToNative APNs'); sweep(f.mock.calls, 'pushToNative FCM');
  });

  it('the sweep itself catches a leak (a body carrying BODY in any encoding is flagged)', () => {
    for (const enc of [(s: string) => s, (s: string) => Buffer.from(s).toString('hex'), (s: string) => Buffer.from(s).toString('base64'), (s: string) => Buffer.from(s).toString('base64url')]) {
      expect(() => sweep([[{ body: `x${enc(BODY)}y` }]], 'canary')).toThrow();
    }
    expect(() => sweep([[{ headers: { 'x-leak': APNS_KEY_ID } }]], 'canary')).toThrow();
    expect(() => sweep([[{ body: ecPem }]], 'canary')).toThrow();
    expect(() => sweep([[{ url: `https://x/?e=${FCM_EMAIL}` }]], 'canary')).toThrow();
  });
});

describe('native push: no-op without env', () => {
  it('returns 0 and touches no transport', async () => {
    const h = http2Mock(200), f = fetchMock(fcmOk);
    expect(alerts.apnsConfigured()).toBe(false);
    expect(alerts.fcmConfigured()).toBe(false);
    expect(alerts.nativePushConfigured()).toBe(false);
    expect(await alerts.sendApns(['t'], { room: ROOM }, { http2Request: h })).toEqual({ sent: 0, dead: [] });
    expect(await alerts.sendFcm(['t'], { room: ROOM }, { fetch: f })).toEqual({ sent: 0, dead: [] });
    const { admin } = fakeAdmin([{ platform: 'ios', token: 't' }]);
    expect(await alerts.pushToNative(admin, 'owner', ROOM, { http2Request: h, fetch: f })).toBe(0);
    expect(h).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });
});

describe('native push: APNs', () => {
  beforeEach(setApnsEnv);

  it('posts the fixed payload per token with an ES256 provider token (kid, iss, iat) and caches it 50 minutes', async () => {
    let now = 1_800_000_000_000;
    const h = http2Mock(200);
    const r = await alerts.sendApns(['tokA', 'tokB'], DECOY, { http2Request: h, now: () => now });
    expect(r).toEqual({ sent: 2, dead: [] });
    expect(h).toHaveBeenCalledTimes(2);
    const [req] = h.mock.calls[0];
    expect(req.authority).toBe('api.push.apple.com');
    expect(req.path).toBe('/3/device/tokA');
    expect(req.headers['apns-topic']).toBe('io.onepeek.app');
    expect(req.headers['apns-push-type']).toBe('alert');
    expect(JSON.parse(req.body)).toEqual(alerts.apnsPayload({ room: ROOM }));
    expectClean(req.body); expectClean(JSON.stringify(req.headers));

    const jwt = req.headers.authorization.replace(/^bearer /, '');
    const [h64, c64, s64] = jwt.split('.');
    expect(decode(h64)).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
    expect(decode(c64)).toEqual({ iss: 'TEAM123456', iat: Math.floor(now / 1000) });
    expect(cryptoVerify('sha256', Buffer.from(`${h64}.${c64}`), { key: ec.publicKey.export({ type: 'spki', format: 'pem' }) as string, dsaEncoding: 'ieee-p1363' }, Buffer.from(s64, 'base64url'))).toBe(true);

    now += 49 * 60 * 1000;
    await alerts.sendApns(['tokA'], { room: ROOM }, { http2Request: h, now: () => now });
    expect(h.mock.calls[2][0].headers.authorization).toBe(`bearer ${jwt}`);
    now += 2 * 60 * 1000;
    await alerts.sendApns(['tokA'], { room: ROOM }, { http2Request: h, now: () => now });
    expect(h.mock.calls[3][0].headers.authorization).not.toBe(`bearer ${jwt}`);
  });

  it('uses the sandbox host when APNS_USE_SANDBOX=1', async () => {
    vi.stubEnv('APNS_USE_SANDBOX', '1');
    const h = http2Mock(200);
    await alerts.sendApns(['t'], { room: ROOM }, { http2Request: h });
    expect(h.mock.calls[0][0].authority).toBe('api.sandbox.push.apple.com');
  });

  it('reports 410 / BadDeviceToken / Unregistered as dead and keeps other failures', async () => {
    const h = vi.fn(async (req: { path: string }) => {
      if (req.path.endsWith('/gone')) return { status: 410, body: '{"reason":"Unregistered"}' };
      if (req.path.endsWith('/bad')) return { status: 400, body: '{"reason":"BadDeviceToken"}' };
      if (req.path.endsWith('/busy')) return { status: 503, body: '{"reason":"ServiceUnavailable"}' };
      return { status: 200, body: '' };
    });
    const r = await alerts.sendApns(['ok', 'gone', 'bad', 'busy'], { room: ROOM }, { http2Request: h });
    expect(r.sent).toBe(1);
    expect(r.dead.sort()).toEqual(['bad', 'gone']);
  });
});

describe('native push: FCM v1', () => {
  beforeEach(setFcmEnv);

  it('exchanges an RS256 JWT bearer assertion with the messaging scope, caches it, then posts one message per token', async () => {
    const f = fetchMock(fcmOk);
    const r = await alerts.sendFcm(['tokA', 'tokB'], DECOY, { fetch: f, now: () => 1_800_000_000_000 });
    expect(r).toEqual({ sent: 2, dead: [] });
    expect(f).toHaveBeenCalledTimes(3);
    const [tokenUrl, tokenInit] = f.mock.calls[0];
    expect(String(tokenUrl)).toBe('https://oauth2.googleapis.com/token');
    const params = new URLSearchParams(String(tokenInit!.body));
    expect(params.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [h64, c64, s64] = params.get('assertion')!.split('.');
    expect(decode(h64)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decode(c64)).toMatchObject({ iss: 'push@onepeek-test.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: 1_800_000_000 });
    expect(decode(c64).exp - decode(c64).iat).toBe(3600);
    expect(cryptoVerify('sha256', Buffer.from(`${h64}.${c64}`), rsa.publicKey, Buffer.from(s64, 'base64url'))).toBe(true);

    const [sendUrl, sendInit] = f.mock.calls[1];
    expect(String(sendUrl)).toBe('https://fcm.googleapis.com/v1/projects/onepeek-test/messages:send');
    expect((sendInit!.headers as Record<string, string>).authorization).toBe('Bearer ya29.test');
    expect(JSON.parse(String(sendInit!.body))).toEqual(alerts.fcmMessage('tokA', { room: ROOM }));
    expectClean(String(sendInit!.body));

    await alerts.sendFcm(['tokC'], { room: ROOM }, { fetch: f, now: () => 1_800_000_000_000 + 60_000 });
    expect(f.mock.calls.filter(c => String(c[0]).includes('oauth2'))).toHaveLength(1);
  });

  it('reports UNREGISTERED / NOT_FOUND as dead', async () => {
    const f = fetchMock((url, init) => {
      if (url.includes('oauth2')) return fcmOk(url);
      const tok = JSON.parse(String(init!.body)).message.token;
      if (tok === 'gone') return { status: 404, body: { error: { code: 404, status: 'NOT_FOUND', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } } };
      if (tok === 'quota') return { status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } } };
      return { status: 200, body: {} };
    });
    const r = await alerts.sendFcm(['ok', 'gone', 'quota'], { room: ROOM }, { fetch: f });
    expect(r).toEqual({ sent: 1, dead: ['gone'] });
  });

  it('sends nothing when the token exchange fails', async () => {
    const f = fetchMock(url => url.includes('oauth2') ? { status: 401, body: { error: 'invalid_grant' } } : { status: 200, body: {} });
    expect(await alerts.sendFcm(['t'], { room: ROOM }, { fetch: f })).toEqual({ sent: 0, dead: [] });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('native push: pushToNative fan-out', () => {
  it('reads push_devices, sends per platform and deletes dead rows for that owner only', async () => {
    setApnsEnv(); setFcmEnv();
    const { admin, deleted } = fakeAdmin([{ platform: 'ios', token: 'iosA' }, { platform: 'ios', token: 'iosGone' }, { platform: 'android', token: 'andA' }, { platform: 'android', token: 'andGone' }]);
    const h = vi.fn(async (req: { path: string }) => req.path.endsWith('Gone') ? { status: 410, body: '{"reason":"Unregistered"}' } : { status: 200, body: '' });
    const f = fetchMock((url, init) => url.includes('oauth2') ? fcmOk(url)
      : JSON.parse(String(init!.body)).message.token === 'andGone' ? { status: 404, body: { error: { status: 'NOT_FOUND' } } } : { status: 200, body: {} });
    const sent = await alerts.pushToNative(admin, 'owner-1', ROOM, { http2Request: h, fetch: f });
    expect(sent).toBe(2);
    expect(deleted).toEqual([{ owner: 'owner-1', tokens: expect.arrayContaining(['iosGone', 'andGone']) }]);
    expect(deleted[0].tokens).toHaveLength(2);
  });

  it('with only APNs configured, android tokens are skipped quietly', async () => {
    setApnsEnv();
    const { admin, deleted } = fakeAdmin([{ platform: 'ios', token: 'iosA' }, { platform: 'android', token: 'andA' }]);
    const h = http2Mock(200), f = fetchMock(fcmOk);
    expect(await alerts.pushToNative(admin, 'o', ROOM, { http2Request: h, fetch: f })).toBe(1);
    expect(f).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });

  it('reads at most the 10 most recently seen tokens per owner, even if the table holds more (W1-3)', async () => {
    setApnsEnv();
    const many = Array.from({ length: 25 }, (_, i) => ({ platform: 'ios', token: `tok${i}` }));
    const { admin, reads } = fakeAdmin(many);
    const h = http2Mock(200);
    expect(await alerts.pushToNative(admin, 'o', ROOM, { http2Request: h })).toBe(10);
    expect(reads).toEqual([{ order: ['last_seen', { ascending: false }], limit: 10 }]);
    expect(h).toHaveBeenCalledTimes(10);
    expect(alerts.MAX_TOKENS_PER_OWNER).toBe(10);
  });
});

describe('native push: bounded concurrency (W1-3)', () => {
  // A transport that resolves only when released, so the test can count what is in flight.
  function gate() {
    let inFlight = 0, peak = 0, started = 0;
    const pending: (() => void)[] = [];
    const h = vi.fn((_req: Http2Req) => new Promise<{ status: number; body: string }>(resolve => {
      inFlight++; started++; peak = Math.max(peak, inFlight);
      pending.push(() => { inFlight--; resolve({ status: 200, body: '' }); });
    }));
    const releaseAll = async () => { while (pending.length) { pending.shift()!(); await Promise.resolve(); } await new Promise(r => setImmediate(r)); };
    return { h, releaseAll, inFlight: () => inFlight, peak: () => peak, started: () => started };
  }

  it('APNs: 25 tokens go out 10 at a time, never more than 10 in flight', async () => {
    setApnsEnv();
    const g = gate();
    const tokens = Array.from({ length: 25 }, (_, i) => `tok${i}`);
    const p = alerts.sendApns(tokens, { room: ROOM }, { http2Request: g.h });
    await new Promise(r => setImmediate(r));
    expect(g.inFlight()).toBe(10);
    expect(g.started()).toBe(10);
    await g.releaseAll();
    expect(g.started()).toBe(20);
    expect(g.inFlight()).toBe(10);
    await g.releaseAll();
    expect(g.started()).toBe(25);
    await g.releaseAll();
    expect(await p).toEqual({ sent: 25, dead: [] });
    expect(g.peak()).toBe(10);
    expect(alerts.SEND_CONCURRENCY).toBe(10);
  });

  it('FCM: 25 tokens go out 10 at a time as well', async () => {
    setFcmEnv();
    let inFlight = 0, peak = 0;
    const f = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('oauth2')) return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.test', expires_in: 3600 }), text: async () => '' } as Response;
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 2));
      inFlight--;
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as Response;
    });
    const tokens = Array.from({ length: 25 }, (_, i) => `tok${i}`);
    expect(await alerts.sendFcm(tokens, { room: ROOM }, { fetch: f })).toEqual({ sent: 25, dead: [] });
    expect(peak).toBe(10);
    expect(f).toHaveBeenCalledTimes(26);
  });
});

describe('native push: nodeHttp2Request always settles (W1-5)', () => {
  const REQ = { authority: 'api.push.apple.com', path: '/3/device/t', headers: { 'content-type': 'application/json' }, body: '{}' };

  function fakeHttp2() {
    const stream = Object.assign(new EventEmitter(), {
      setTimeout: vi.fn(), end: vi.fn(), close: vi.fn(),
    });
    const session = Object.assign(new EventEmitter(), {
      setTimeout: vi.fn(), destroy: vi.fn(), close: vi.fn(),
      request: vi.fn(() => stream),
    });
    const connect = vi.fn(() => session) as unknown as Alerts['nodeHttp2Request'] extends (r: unknown, o?: { connect?: infer C }) => unknown ? C : never;
    return { stream, session, connect };
  }

  it('resolves on a normal response and destroys the session', async () => {
    const { stream, session, connect } = fakeHttp2();
    const p = alerts.nodeHttp2Request(REQ, { connect });
    stream.emit('response', { ':status': 200 });
    stream.emit('data', Buffer.from('ok'));
    stream.emit('end');
    expect(await p).toEqual({ status: 200, body: 'ok' });
    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(stream.end).toHaveBeenCalledWith('{}');
    expect(stream.setTimeout).toHaveBeenCalledWith(alerts.HTTP2_IDLE_MS);
    expect(session.setTimeout).toHaveBeenCalledWith(alerts.HTTP2_IDLE_MS);
    expect(connect).toHaveBeenCalledWith('https://api.push.apple.com');
  });

  it('rejects when the stream emits only close (the old code hung here)', async () => {
    const { stream, session, connect } = fakeHttp2();
    const p = alerts.nodeHttp2Request(REQ, { connect });
    stream.emit('close');
    await expect(p).rejects.toThrow(/http2_stream_closed/);
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it('resolves with the status seen when close arrives without end', async () => {
    const { stream, connect } = fakeHttp2();
    const p = alerts.nodeHttp2Request(REQ, { connect });
    stream.emit('response', { ':status': 410 });
    stream.emit('data', Buffer.from('{"reason":"Unregistered"}'));
    stream.emit('close');
    expect(await p).toEqual({ status: 410, body: '{"reason":"Unregistered"}' });
  });

  it('rejects on a stream or session timeout and on session close', async () => {
    for (const [target, event, why] of [['stream', 'timeout', 'http2_stream_timeout'], ['session', 'timeout', 'http2_session_timeout'], ['session', 'close', 'http2_session_closed']] as const) {
      const f = fakeHttp2();
      const p = alerts.nodeHttp2Request(REQ, { connect: f.connect });
      f[target].emit(event);
      await expect(p).rejects.toThrow(why);
      expect(f.session.destroy).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects by the hard deadline when nothing is ever emitted, and settles only once', async () => {
    vi.useFakeTimers();
    try {
      const { stream, session, connect } = fakeHttp2();
      const p = alerts.nodeHttp2Request(REQ, { connect });
      let settled = false;
      p.then(() => { settled = true; }, () => { settled = true; });
      await vi.advanceTimersByTimeAsync(alerts.HTTP2_DEADLINE_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(p).rejects.toThrow(/http2_deadline/);
      expect(session.destroy).toHaveBeenCalledTimes(1);
      // A late 'end' after the deadline changes nothing.
      stream.emit('response', { ':status': 200 });
      stream.emit('end');
      expect(session.destroy).toHaveBeenCalledTimes(1);
      expect(alerts.HTTP2_DEADLINE_MS).toBe(15_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects when connect itself throws', async () => {
    const connect = (() => { throw new Error('ENOTFOUND'); }) as unknown as Parameters<Alerts['nodeHttp2Request']>[1] extends { connect?: infer C } | undefined ? C : never;
    await expect(alerts.nodeHttp2Request(REQ, { connect })).rejects.toThrow(/ENOTFOUND/);
  });

  it('sendApns keeps a token whose request rejected (not dead) and still returns', async () => {
    setApnsEnv();
    const h = vi.fn(async (req: { path: string }) => { if (req.path.endsWith('/slow')) throw new Error('http2_deadline'); return { status: 200, body: '' }; });
    expect(await alerts.sendApns(['ok', 'slow'], { room: ROOM }, { http2Request: h })).toEqual({ sent: 1, dead: [] });
  });
});

describe('native push: credentials never surface in an error (§1.5 item 8)', () => {
  // sendApns / sendFcm swallow transport failures by design ("kept, try next time"). What an operator or a
  // client could ever see is the return value, a thrown message, or log output; sweep all three.
  async function observe(run: () => Promise<unknown>) {
    const logs: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(x => x instanceof Error ? `${x.message}\n${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); }));
    let returned: unknown, thrown = '';
    try { returned = await run(); } catch (e) { thrown = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : String(e); }
    finally { spies.forEach(s => s.mockRestore()); }
    const surfaced = [JSON.stringify(returned ?? null), thrown, ...logs].join('\n');
    expectCleanForms(surfaced, CREDENTIALS, 'returned value / thrown error / console');
    expectCleanForms(surfaced, CONTENT_FORBIDDEN, 'returned value / thrown error / console');
    return { returned, thrown, logs };
  }
  // A failure whose message tries to carry everything it was given, like a careless HTTP client would.
  const nasty = (req: unknown) => new Error(`transport failed for ${JSON.stringify(req)} with ${ecPem} ${rsaPem} ${APNS_KEY_ID} ${APNS_TEAM_ID} ${FCM_EMAIL}`);

  it('APNs answering 500 (with a body echoing the request) returns a clean, non-dead result', async () => {
    setApnsEnv();
    const h = vi.fn(async (req: Http2Req) => ({ status: 500, body: JSON.stringify({ reason: 'InternalServerError', echo: req.headers }) }));
    const { returned, thrown } = await observe(() => alerts.sendApns(['tokA'], DECOY, { http2Request: h }));
    expect(returned).toEqual({ sent: 0, dead: [] });
    expect(thrown).toBe('');
  });

  it('APNs transport that throws an error full of secrets: swallowed, nothing surfaces', async () => {
    setApnsEnv();
    const h = vi.fn(async (req: Http2Req) => { throw nasty(req); });
    const { returned, thrown, logs } = await observe(() => alerts.sendApns(['tokA', 'tokB'], DECOY, { http2Request: h }));
    expect(h).toHaveBeenCalledTimes(2);
    expect(returned).toEqual({ sent: 0, dead: [] });
    expect(thrown).toBe('');
    expect(logs).toEqual([]);
  });

  it('FCM send answering 500 returns a clean result', async () => {
    setFcmEnv();
    const f = fetchMock(url => url.includes('oauth2') ? fcmOk(url) : { status: 500, body: { error: { code: 500, status: 'INTERNAL', message: `echo ${ecPem} ${FCM_EMAIL}` } } });
    const { returned, thrown } = await observe(() => alerts.sendFcm(['tokA'], DECOY, { fetch: f }));
    expect(returned).toEqual({ sent: 0, dead: [] });
    expect(thrown).toBe('');
  });

  it('FCM token exchange answering 500, and fetch rejecting with secrets in the message: swallowed', async () => {
    setFcmEnv();
    const f500 = fetchMock(url => url.includes('oauth2') ? { status: 500, body: 'oops' } : { status: 200, body: {} });
    const a = await observe(() => alerts.sendFcm(['tokA'], DECOY, { fetch: f500 }));
    expect(a.returned).toEqual({ sent: 0, dead: [] });
    vi.resetModules(); alerts = await import('./alerts'); alerts.configureNativeTransports(null);
    const fThrow = vi.fn(async (url: string | URL | Request, init?: RequestInit) => { throw nasty({ url: String(url), init }); });
    const b = await observe(() => alerts.sendFcm(['tokA'], DECOY, { fetch: fThrow as never }));
    expect(b.returned).toEqual({ sent: 0, dead: [] });
    expect(b.thrown).toBe('');
    // And a send (not exchange) that throws after a good exchange.
    vi.resetModules(); alerts = await import('./alerts'); alerts.configureNativeTransports(null);
    const fSendThrows = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('oauth2')) return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.test', expires_in: 3600 }), text: async () => '' } as Response;
      throw nasty({ url: String(url), init });
    });
    const c = await observe(() => alerts.sendFcm(['tokA'], DECOY, { fetch: fSendThrows as never }));
    expect(c.returned).toEqual({ sent: 0, dead: [] });
    expect(c.thrown).toBe('');
  });

  it('pushToNative with both transports failing returns 0 and surfaces nothing', async () => {
    setApnsEnv(); setFcmEnv();
    const { admin, deleted } = fakeAdmin([{ platform: 'ios', token: 'iosA' }, { platform: 'android', token: 'andA' }]);
    const h = vi.fn(async (req: Http2Req) => { throw nasty(req); });
    const f = fetchMock(url => url.includes('oauth2') ? fcmOk(url) : { status: 500, body: 'boom' });
    const { returned, thrown } = await observe(() => alerts.pushToNative(admin, RECIPIENT, ROOM, { http2Request: h, fetch: f }));
    expect(returned).toBe(0);
    expect(thrown).toBe('');
    expect(deleted).toEqual([]);
  });

  it('nodeHttp2Request rejection messages are fixed strings, free of the request it was handed', async () => {
    setApnsEnv();
    const req = { authority: 'api.push.apple.com', path: '/3/device/t', headers: { authorization: `bearer ${APNS_KEY_ID}.${APNS_TEAM_ID}`, 'x-key': ecPem }, body: JSON.stringify({ k: rsaPem, e: FCM_EMAIL }) };
    const reasons: string[] = [];
    for (const [target, event] of [['stream', 'close'], ['stream', 'timeout'], ['session', 'timeout'], ['session', 'close']] as const) {
      const stream = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), end: vi.fn(), close: vi.fn() });
      const session = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), destroy: vi.fn(), close: vi.fn(), request: vi.fn(() => stream) });
      const p = alerts.nodeHttp2Request(req, { connect: (() => session) as never });
      ({ stream, session })[target].emit(event);
      reasons.push(await p.then(() => 'resolved', (e: Error) => `${e.message}\n${e.stack ?? ''}`));
    }
    vi.useFakeTimers();
    try {
      const stream = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), end: vi.fn(), close: vi.fn() });
      const session = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), destroy: vi.fn(), close: vi.fn(), request: vi.fn(() => stream) });
      const p = alerts.nodeHttp2Request(req, { connect: (() => session) as never });
      const settled = p.then(() => 'resolved', (e: Error) => `${e.message}\n${e.stack ?? ''}`);
      await vi.advanceTimersByTimeAsync(alerts.HTTP2_DEADLINE_MS);
      reasons.push(await settled);
    } finally { vi.useRealTimers(); }
    expect(reasons).toHaveLength(5);
    expectCleanForms(reasons.join('\n'), CREDENTIALS, 'nodeHttp2Request rejection');
    expectCleanForms(reasons.join('\n'), CONTENT_FORBIDDEN, 'nodeHttp2Request rejection');
  });

  it('a malformed key never lands in an error: the sender stays inert and says nothing', async () => {
    vi.stubEnv('APNS_KEY_ID', APNS_KEY_ID); vi.stubEnv('APNS_TEAM_ID', APNS_TEAM_ID);
    vi.stubEnv('APNS_PRIVATE_KEY', `-----BEGIN PRIVATE KEY-----\\nnot-a-key-${APNS_KEY_ID}\\n-----END PRIVATE KEY-----`);
    const h = http2Mock(200);
    const { returned, thrown } = await observe(() => alerts.sendApns(['t'], { room: ROOM }, { http2Request: h }));
    expect(returned).toEqual({ sent: 0, dead: [] });
    expect(thrown).toBe('');
    expect(h).not.toHaveBeenCalled();
  });

  it('the bad_room guard throws a fixed message without echoing the input', () => {
    const msgs: string[] = [];
    for (const room of [`${APNS_KEY_ID} ${FCM_EMAIL}`, ecPem, BODY]) {
      for (const run of [() => alerts.apnsPayload({ room }), () => alerts.fcmMessage('tok', { room })]) {
        try { run(); } catch (e) { msgs.push((e as Error).message); }
      }
    }
    expect(msgs).toHaveLength(6);
    expect(new Set(msgs)).toEqual(new Set(['bad_room']));
  });
});

describe('web push regression: pushTo is unchanged', () => {
  it('sends the alert JSON as before with TTL 3600 and drops 404/410 subscriptions', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'pub');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'priv');
    vi.resetModules();
    alerts = await import('./alerts');
    expect(alerts.pushConfigured()).toBe(true);
    const removed: string[] = [];
    const subs = [{ endpoint: 'https://p/1', p256dh: 'k1', auth: 'a1' }, { endpoint: 'https://p/2', p256dh: 'k2', auth: 'a2' }];
    const admin = {
      from(table: string) {
        expect(table).toBe('push_subscriptions');
        return {
          select: () => ({ eq: async () => ({ data: subs }) }),
          delete: () => ({ eq: async (_c: string, endpoint: string) => { removed.push(endpoint); return { data: null }; } }),
        };
      },
    } as never;
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => { if (sub.endpoint.endsWith('/2')) throw Object.assign(new Error('gone'), { statusCode: 410 }); });
    const alert = { title: 'OnePeek', body: 'You have a new message in a private chat.', url: `/chat/r/${ROOM}`, tag: `chat-${ROOM}` };
    const sent = await alerts.pushTo(admin, 'owner', alert);
    expect(sent).toBe(1);
    expect(setVapidDetails).toHaveBeenCalledWith('mailto:secret@onepeek.io', 'pub', 'priv');
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(sendNotification.mock.calls[0]).toEqual([{ endpoint: 'https://p/1', keys: { p256dh: 'k1', auth: 'a1' } }, JSON.stringify(alert), { TTL: 3600 }]);
    expect(removed).toEqual(['https://p/2']);
  });

  it('returns 0 without VAPID env', async () => {
    expect(alerts.pushConfigured()).toBe(false);
    expect(await alerts.pushTo({} as never, 'o', { title: 't', body: 'b', url: '/', tag: 'x' })).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
