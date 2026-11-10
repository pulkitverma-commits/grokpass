// /api/chat/report: proves the route needs a session, validates the two ids-only inputs, calls the
// report_chat RPC with the caller's own session (anon key + the request's bearer) and nothing but
// { p_room, p_reason }, and maps the RPC's errors to 401/400/403/429.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ROOM = '11111111-2222-4333-8444-555555555555';
const SENDER = 'aaaaaaaa-0000-4000-8000-000000000001';
// What a client could put in the body, and must never reach the database.
const FORBIDDEN = ['Family chat', 'Alice', 'the wifi password is hunter2', 'passport.pdf', 'device-123', 'bob@example.com'];

let currentUser: { id: string } | null = null;
let rpcError: { message: string } | null = null;
const rpc = vi.fn(async (_name: string, _args: unknown) => ({ data: null, error: rpcError }));
const createClient = vi.fn((_url: string, _key: string, _opts: unknown) => ({ rpc }));

vi.mock('@/lib/server', () => ({ sessionUserFromRequest: async () => currentUser }));
vi.mock('@supabase/supabase-js', () => ({ createClient: (url: string, key: string, opts: unknown) => createClient(url, key, opts) }));

const post = (body: unknown, auth: string | null = 'Bearer session-token') =>
  import('./route').then(m => m.POST(new Request('https://onepeek.io/api/chat/report', {
    method: 'POST', headers: auth ? { authorization: auth } : {}, body: typeof body === 'string' ? body : JSON.stringify(body),
  })));

beforeEach(() => {
  vi.resetModules();
  currentUser = { id: SENDER };
  rpcError = null;
  rpc.mockClear(); createClient.mockClear();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdefghijklmnopqrst.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key-must-not-be-used');
});
afterEach(() => vi.unstubAllEnvs());

describe('/api/chat/report', () => {
  it('401 without a session, before anything reaches the database', async () => {
    currentUser = null;
    const res = await post({ room: ROOM, reason: 'spam' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'not_signed_in' });
    expect(createClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('400 on a bad room or reason, before anything reaches the database', async () => {
    for (const body of [{}, { reason: 'spam' }, { room: 'Family chat', reason: 'spam' }, { room: ROOM.slice(0, 35), reason: 'spam' }, { room: 42, reason: 'spam' }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_room' });
    }
    for (const reason of [undefined, '', 'SPAM', 'harassment', 'the wifi password is hunter2', 7, ['spam']]) {
      const res = await post({ room: ROOM, reason });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_reason' });
    }
    expect((await post('not json')).status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls report_chat as the caller (anon key + the request bearer, never the service key) and returns { ok: true }', async () => {
    const res = await post({ room: ROOM, reason: 'abuse' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(createClient).toHaveBeenCalledTimes(1);
    const [url, key, opts] = createClient.mock.calls[0] as unknown as [string, string, { global: { headers: Record<string, string> } }];
    expect(url).toBe('https://abcdefghijklmnopqrst.supabase.co');
    expect(key).toBe('anon-key');
    expect(opts.global.headers).toEqual({ Authorization: 'Bearer session-token' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual(['report_chat', { p_room: ROOM, p_reason: 'abuse' }]);
  });

  it('forwards exactly { p_room, p_reason }: extra body fields never reach the RPC', async () => {
    const res = await post({
      room: ROOM.toUpperCase(), reason: 'illegal', text: FORBIDDEN[2], nickname: FORBIDDEN[1], name: FORBIDDEN[0],
      file: FORBIDDEN[3], device: FORBIDDEN[4], email: FORBIDDEN[5], reporter: 'someone-else', messages: [{ body: FORBIDDEN[2] }],
    });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(name).toBe('report_chat');
    expect(Object.keys(args).sort()).toEqual(['p_reason', 'p_room']);
    expect(args).toEqual({ p_room: ROOM, p_reason: 'illegal' });
    const wire = JSON.stringify(rpc.mock.calls[0]) + JSON.stringify(createClient.mock.calls[0]);
    for (const f of FORBIDDEN) expect(wire).not.toContain(f);
    expect(wire).not.toContain('someone-else');
    expect(wire).not.toContain(SENDER);
  });

  it('maps RPC errors: not_a_member → 403, too_many_reports → 429, bad_reason → 400, not_signed_in → 401, else 500', async () => {
    const cases: [string, number, string][] = [
      ['not_a_member', 403, 'not_a_member'],
      ['too_many_reports', 429, 'too_many_reports'],
      ['bad_reason', 400, 'bad_reason'],
      ['not_signed_in', 401, 'not_signed_in'],
      ['permission denied for function report_chat', 401, 'not_signed_in'],
      ['connection reset', 500, 'report_failed'],
    ];
    for (const [message, status, error] of cases) {
      rpcError = { message };
      const res = await post({ room: ROOM, reason: 'spam' });
      expect(res.status).toBe(status);
      const json = await res.json();
      expect(json).toEqual({ error });
      // The raw database message never leaks to the client.
      expect(JSON.stringify(json)).not.toContain('connection reset');
    }
  });

  it('503 when Supabase is not configured, without calling anything', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    const res = await post({ room: ROOM, reason: 'spam' });
    expect(res.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
});
