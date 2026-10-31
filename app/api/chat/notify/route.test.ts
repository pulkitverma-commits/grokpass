// /api/chat/notify: proves the native pushes added for the mobile app carry no room name, sender,
// nickname or text (only the room id as a routing key), that the web push payload is unchanged,
// and that the authorisation checks still gate everything.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

const ROOM = '11111111-2222-4333-8444-555555555555';
const SENDER = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALICE = 'aaaaaaaa-0000-4000-8000-000000000002';
const BOB = 'aaaaaaaa-0000-4000-8000-000000000003';
const QUIET = 'aaaaaaaa-0000-4000-8000-000000000004';

// What the route could in principle see, and must never forward.
const FORBIDDEN = ['Family chat', SENDER, 'Alice', 'the wifi password is hunter2', 'passport.pdf'];
const expectClean = (s: string) => { for (const f of FORBIDDEN) expect(s).not.toContain(f); };

const sendNotification = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('web-push', () => ({ default: { sendNotification: (...a: unknown[]) => sendNotification(...a), setVapidDetails: vi.fn() } }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(), layout: vi.fn() }));

let currentUser: { id: string } | null = null;
let adminAvailable = true;
let deletedDevices: unknown[] = [];
const rateOk = vi.fn(async () => true);

function admin() {
  const members = [
    { user_id: SENDER, state: 'active' }, { user_id: ALICE, state: 'active' }, { user_id: BOB, state: 'active' },
    { user_id: QUIET, state: 'active' }, { user_id: 'aaaaaaaa-0000-4000-8000-000000000009', state: 'pending' },
  ];
  const devices: Record<string, { platform: string; token: string }[]> = {
    [ALICE]: [{ platform: 'ios', token: 'alice-iphone' }],
    [BOB]: [{ platform: 'android', token: 'bob-pixel' }, { platform: 'ios', token: 'bob-ipad-gone' }],
    [QUIET]: [{ platform: 'ios', token: 'quiet-iphone' }],
  };
  const subs: Record<string, { endpoint: string; p256dh: string; auth: string }[]> = {
    [ALICE]: [{ endpoint: 'https://push/alice', p256dh: 'k', auth: 'a' }],
  };
  return {
    rpc: (name: string, args: unknown) => { expect(name).toBe('chat_rate_ok'); return rateOk().then(ok => ({ data: ok, error: null, args })); },
    from(table: string) {
      switch (table) {
        case 'chat_rooms': return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { state: 'active', expires_at: new Date(Date.now() + 60_000).toISOString(), name: 'Family chat' } }) }) }) };
        case 'chat_members': return { select: () => ({ eq: async () => ({ data: members }) }) };
        case 'notify_prefs': return { select: () => ({ in: async () => ({ data: [{ owner: QUIET, push_on: false }] }) }) };
        case 'push_subscriptions': return { select: () => ({ eq: async (_c: string, owner: string) => ({ data: subs[owner] || [] }) }), delete: () => ({ eq: async () => ({}) }) };
        case 'push_devices': return {
          select: () => ({ eq: async (_c: string, owner: string) => ({ data: devices[owner] || [] }) }),
          delete: () => ({ eq: (_c: string, owner: string) => ({ in: async (_t: string, tokens: string[]) => { deletedDevices.push({ owner, tokens }); return {}; } }) }),
        };
        default: throw new Error(`unexpected table ${table}`);
      }
    },
  };
}
vi.mock('@/lib/server', () => ({
  adminClient: () => (adminAvailable ? admin() : null),
  sessionUserFromRequest: async () => currentUser,
}));

const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

const http2Request = vi.fn(async (req: { path: string }) => req.path.endsWith('-gone') ? { status: 410, body: '{"reason":"Unregistered"}' } : { status: 200, body: '' });
const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const body = String(url).includes('oauth2') ? { access_token: 'ya29.t', expires_in: 3600 } : { name: 'ok', sent: init?.body };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
});

const post = (body: unknown, auth = 'Bearer session-token') =>
  import('./route').then(m => m.POST(new Request('https://onepeek.io/api/chat/notify', { method: 'POST', headers: { authorization: auth }, body: JSON.stringify(body) })));

beforeEach(async () => {
  vi.resetModules();
  currentUser = { id: SENDER };
  adminAvailable = true;
  deletedDevices = [];
  sendNotification.mockClear(); http2Request.mockClear(); fetchMock.mockClear(); rateOk.mockClear();
  vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'pub');
  vi.stubEnv('VAPID_PRIVATE_KEY', 'priv');
  vi.stubEnv('APNS_KEY_ID', 'KEY1234567');
  vi.stubEnv('APNS_TEAM_ID', 'TEAM123456');
  vi.stubEnv('APNS_PRIVATE_KEY', ec);
  vi.stubEnv('FCM_SERVICE_ACCOUNT_JSON', JSON.stringify({ project_id: 'onepeek-test', client_email: 'push@test.iam.gserviceaccount.com', private_key: rsa }));
  const alerts = await import('@/lib/alerts');
  alerts.configureNativeTransports({ http2Request, fetch: fetchMock });
});
afterEach(() => vi.unstubAllEnvs());

describe('/api/chat/notify', () => {
  it('still requires a session and a uuid room', async () => {
    currentUser = null;
    expect((await post({ room: ROOM })).status).toBe(401);
    currentUser = { id: SENDER };
    expect((await post({ room: 'Family chat' })).status).toBe(400);
    expect(http2Request).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('still refuses a non-member', async () => {
    currentUser = { id: 'aaaaaaaa-0000-4000-8000-0000000000ee' };
    expect((await post({ room: ROOM })).status).toBe(403);
    expect(http2Request).not.toHaveBeenCalled();
  });

  it('still throttles via chat_rate_ok before sending anything', async () => {
    rateOk.mockResolvedValueOnce(false);
    const res = await post({ room: ROOM });
    expect(await res.json()).toEqual({ ok: true, sent: 0, throttled: true });
    expect(http2Request).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('sends web and native pushes to the other active members, skipping the sender and opted-out users', async () => {
    const res = await post({ room: ROOM, text: FORBIDDEN[3], nickname: 'Alice' });
    const json = await res.json();
    // web: Alice's one subscription. native: Alice iPhone + Bob Pixel (Bob's iPad is gone).
    expect(json).toEqual({ ok: true, sent: 3 });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const apnsTokens = http2Request.mock.calls.map(c => c[0].path.replace('/3/device/', '')).sort();
    expect(apnsTokens).toEqual(['alice-iphone', 'bob-ipad-gone']);
    const fcmSends = fetchMock.mock.calls.filter(c => String(c[0]).includes('messages:send'));
    expect(fcmSends).toHaveLength(1);
    expect(JSON.parse(String(fcmSends[0][1]!.body)).message.token).toBe('bob-pixel');
    expect(deletedDevices).toEqual([{ owner: BOB, tokens: ['bob-ipad-gone'] }]);
  });

  it('native payloads carry only fixed strings and the room id; the web payload is unchanged', async () => {
    await post({ room: ROOM, text: FORBIDDEN[3], nickname: 'Alice', file: 'passport.pdf' });
    for (const [req] of http2Request.mock.calls) {
      const r = req as unknown as { body: string; headers: Record<string, string> };
      expect(JSON.parse(r.body)).toEqual({ aps: { alert: { title: 'OnePeek', body: 'You have a new message in a private chat.' }, sound: 'default', 'thread-id': ROOM }, room: ROOM });
      expectClean(r.body); expectClean(JSON.stringify(r.headers));
      expect(JSON.parse(r.body).aps).not.toHaveProperty('mutable-content');
      expect(JSON.parse(r.body).aps.alert).not.toHaveProperty('subtitle');
    }
    for (const [url, init] of fetchMock.mock.calls) {
      if (!String(url).includes('messages:send')) continue;
      const m = JSON.parse(String(init!.body)).message;
      expect(m).toEqual({ token: 'bob-pixel', notification: { title: 'OnePeek', body: 'You have a new message in a private chat.' }, data: { room: ROOM }, android: { priority: 'high', notification: { tag: `chat-${ROOM}` } } });
      expect(Object.keys(m.data)).toEqual(['room']);
      expect(m.notification).not.toHaveProperty('image');
      expectClean(String(init!.body));
    }
    const [sub, payload, opts] = sendNotification.mock.calls[0] as unknown as [unknown, string, unknown];
    expect(sub).toEqual({ endpoint: 'https://push/alice', keys: { p256dh: 'k', auth: 'a' } });
    expect(JSON.parse(payload)).toEqual({ title: 'OnePeek', body: 'You have a new message in a private chat.', url: `/chat/r/${ROOM}`, tag: `chat-${ROOM}` });
    expect(opts).toEqual({ TTL: 3600 });
    expectClean(payload);
  });

  it('still sends native pushes when only APNs/FCM are configured (no VAPID)', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '');
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    vi.resetModules();
    (await import('@/lib/alerts')).configureNativeTransports({ http2Request, fetch: fetchMock });
    const json = await (await post({ room: ROOM })).json();
    expect(json).toEqual({ ok: true, sent: 2 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('is a no-op without any push configuration or admin client', async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    expect(await (await post({ room: ROOM })).json()).toEqual({ ok: true, sent: 0 });
    adminAvailable = false;
    expect(await (await post({ room: ROOM })).json()).toEqual({ ok: true, sent: 0 });
    expect(http2Request).not.toHaveBeenCalled();
  });
});
