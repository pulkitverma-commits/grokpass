import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), configured: true }));
vi.mock('@/lib/server', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server')>(),
  adminClient: () => mocks.configured ? { rpc: mocks.rpc } : null,
}));
const KEY = '11'.repeat(32);
const SECRET = 's'.repeat(43);
const SUBJECT = '11111111-2222-4333-8444-555555555555';
const SESSION = 'S'.repeat(22);
const INSTALL = 'I'.repeat(22);
const auth = `OnePeek-FoxStack ${SESSION}.${SECRET}`;
function assertion() {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: 'https://crm.foxnetglobal.com', aud: 'onepeek:foxstack:shares', sub: SUBJECT,
    email: 'employee@foxnetglobal.com', email_verified: true, name: 'Example Employee', scope: 'share:create',
    iat: now, exp: now + 60, jti: 'n'.repeat(43),
    cnf: { install_secret_sha256: createHash('sha256').update(SECRET).digest('hex') },
  };
  const unsigned = [{ alg: 'HS256', typ: 'foxstack-onepeek+jwt', kid: 'v1' }, claims]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return `${unsigned}.${createHmac('sha256', Buffer.from(KEY, 'hex')).update(unsigned).digest('base64url')}`;
}
const request = (path: string, body: unknown, authorization?: string) => new Request(`https://onepeek.io/api/v1/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body),
});
const exchange = async (body: unknown = { assertion: assertion(), secret: SECRET }) => (await import('./session/route')).POST(request('foxstack/session', body));
const shareBody = { idempotencyKey: 'i'.repeat(24), manageHash: 'a'.repeat(64), header: 'ciphertextHeader', body: 'ciphertextBody', size: 20, ttlSeconds: 3600, maxViews: 1 };
const share = async (credential: string | undefined = auth) => (await import('./shares/route')).POST(request('foxstack/shares', shareBody, credential));

beforeEach(() => {
  mocks.configured = true;
  vi.stubEnv('ONEPEEK_SSO_SHARED_SECRET', KEY);
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://onepeek.io');
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'api_rate_ok') return { data: true, error: null };
    if (name === 'foxstack_exchange_session') return { data: [{ id: SESSION, expires_at: new Date(Date.now() + 600_000).toISOString() }], error: null };
    if (name === 'foxstack_auth_session') return { data: [{ install_id: INSTALL }], error: null };
    if (name === 'app_create_share') return { data: [{ id: 'abcdef1234', expires_at: new Date(Date.now() + 3600_000).toISOString(), replayed: false }], error: null };
    throw new Error('Unexpected RPC');
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('scoped OnePeek HTTP boundary', () => {
  it('exchanges only a verified proof and returns visible identity, scope and expiry without secrets', async () => {
    const response = await exchange();
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const json = await response.json();
    expect(json).toMatchObject({ sessionId: SESSION, scope: 'share:create', identity: { id: SUBJECT, email: 'employee@foxnetglobal.com', name: 'Example Employee' } });
    expect(JSON.stringify(json)).not.toContain(SECRET);
    const call = mocks.rpc.mock.calls.find(([name]) => name === 'foxstack_exchange_session');
    expect(call?.[1]).toMatchObject({ p_subject: SUBJECT, p_secret_hash: createHash('sha256').update(SECRET).digest('hex') });
    expect(JSON.stringify(call)).not.toContain(SECRET);
    expect(JSON.stringify(call)).not.toContain(assertion());
  });

  it('rejects wrong proof, a raw FoxStack bearer, unconfigured federation and replay', async () => {
    expect((await exchange({ assertion: assertion(), secret: 'x'.repeat(43) })).status).toBe(401);
    expect((await exchange({ assertion: 'raw-foxstack-access-token', secret: SECRET })).status).toBe(401);
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'foxstack_exchange_session')).toBe(false);
    vi.stubEnv('ONEPEEK_SSO_SHARED_SECRET', '');
    expect((await exchange()).status).toBe(503);
    vi.stubEnv('ONEPEEK_SSO_SHARED_SECRET', KEY);
    mocks.rpc.mockImplementation(async (name: string) => name === 'api_rate_ok'
      ? { data: true, error: null } : { data: null, error: { message: 'assertion_replayed' } });
    expect((await exchange()).status).toBe(409);
  });

  it('authenticates a dedicated creation credential, then forwards ciphertext only and returns a fragment-free URL', async () => {
    const response = await share();
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.url).toBe('https://onepeek.io/s/abcdef1234');
    expect(json.url).not.toContain('#');
    expect(mocks.rpc).toHaveBeenCalledWith('foxstack_auth_session', { p_session: SESSION, p_secret_hash: createHash('sha256').update(SECRET).digest('hex') });
    const call = mocks.rpc.mock.calls.find(([name]) => name === 'app_create_share');
    expect(call?.[1]).toMatchObject({ p_install: INSTALL, p_body: shareBody.body, p_header: shareBody.header, p_max_views: 1 });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(SECRET);
  });

  it('does not accept install or FoxStack bearer credentials at the scoped endpoint', async () => {
    for (const credential of ['', `OnePeek-Install ${INSTALL}.${SECRET}`, 'Bearer raw-foxstack-access-token']) {
      expect((await share(credential)).status).toBe(401);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not let a scoped credential access the general create or history API', async () => {
    const general = await import('../shares/route');
    expect((await general.POST(request('shares', shareBody, auth))).status).toBe(401);
    expect((await general.GET(new Request('https://onepeek.io/api/v1/shares', { headers: { authorization: auth } }))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('fails closed on session or rate-limit storage failures before creating a share', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private database detail' } });
    const response = await share();
    expect(response.status).toBe(429);
    expect(await response.text()).not.toContain('private database detail');
    mocks.rpc.mockImplementation(async (name: string) => name === 'api_rate_ok'
      ? { data: true, error: null } : { data: null, error: { message: 'private database detail' } });
    expect((await share()).status).toBe(401);
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'app_create_share')).toBe(false);
  });
});
