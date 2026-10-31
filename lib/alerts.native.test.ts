// Native push senders (APNs / FCM) with mocked transports and throwaway keys generated at runtime.
// Proves the payloads are the fixed shapes, carry nothing but the room id, clean up dead tokens,
// sign the provider JWTs correctly, do nothing without env, and that web push is unchanged.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';

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
  const admin = {
    from(table: string) {
      expect(table).toBe('push_devices');
      return {
        select: () => ({ eq: async () => ({ data: devices }) }),
        delete: () => ({ eq: (_c: string, owner: string) => ({ in: async (_t: string, tokens: string[]) => { deleted.push({ owner, tokens }); return { data: null }; } }) }),
      };
    },
  };
  return { admin: admin as never, deleted };
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
      aps: { alert: { title: 'OnePeek', body: 'New activity in a chat' }, sound: 'default', 'thread-id': ROOM },
      room: ROOM,
    });
  });

  it('FCM message is exactly the fixed shape plus the room id, no apns block', () => {
    expect(alerts.fcmMessage('tok', { room: ROOM })).toEqual({
      message: {
        token: 'tok',
        notification: { title: 'OnePeek', body: 'New activity in a chat' },
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
