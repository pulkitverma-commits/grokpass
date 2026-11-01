/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
// lib/report: the report call carries the room id and a reason word, authenticated, and nothing else.
import { reportRoom } from '../report';
import { chat, resetChatMock, supabaseHolder } from '../../test/chat-mock';

jest.mock('../chat', () => require('../../test/chat-mock').chatMock);

const mockFetch = jest.fn(async () => ({ ok: true, status: 200 }));

beforeEach(() => {
  resetChatMock();
  mockFetch.mockClear().mockResolvedValue({ ok: true, status: 200 });
  (globalThis as { fetch: unknown }).fetch = mockFetch;
});

test('POSTs {room, reason} to onepeek.io with the session bearer and nothing else', async () => {
  await reportRoom('11111111-2222-3333-4444-555555555555', 'abuse');
  expect(chat.ensureSession).toHaveBeenCalledWith(false);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [url, init] = (mockFetch.mock.calls as unknown as [string, RequestInit][])[0]!;
  expect(url).toBe('https://onepeek.io/api/chat/report');
  expect(init.method).toBe('POST');
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer session-bearer-for-tests');
  expect(JSON.parse(String(init.body))).toEqual({ room: '11111111-2222-3333-4444-555555555555', reason: 'abuse' });
});

test('no session: not_signed_in before any request; a non-2xx answer is report_failed', async () => {
  chat.ensureSession.mockResolvedValueOnce(null);
  await expect(reportRoom('r', 'spam')).rejects.toMatchObject({ code: 'not_signed_in' });
  expect(mockFetch).not.toHaveBeenCalled();
  mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
  await expect(reportRoom('r', 'spam')).rejects.toMatchObject({ code: 'report_failed' });
});

test('with core-crypto’s getSupabase() present, the bearer comes from the Supabase session instead', async () => {
  supabaseHolder.getSupabase = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'supabase-bearer' } } }) } });
  try {
    await reportRoom('r', 'other');
    const [, init] = (mockFetch.mock.calls as unknown as [string, RequestInit][])[0]!;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer supabase-bearer');
    expect(chat.ensureSession).not.toHaveBeenCalled();
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    await expect(reportRoom('r', 'other')).rejects.toMatchObject({ code: 'rate_limited' });
  } finally { supabaseHolder.getSupabase = undefined; }
});
