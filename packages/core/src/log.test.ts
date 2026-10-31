import { describe, it, expect, vi } from 'vitest';
import { log, redact, REDACTED, MAX_STRING, MAX_DEPTH, SENSITIVE_KEY } from './log';

describe('redact', () => {
  it('replaces the value of every sensitive key, at any depth and in any case', () => {
    const out = redact({
      roomId: 'r1',
      Body: 'The launch code is 4471',
      nested: { accessCode: 'blue-river-42', ok: 2, deeper: { FILE_NAME: 'passport.txt', nick: 'Sam' } },
      list: [{ token: 'abc' }, 7],
    }) as Record<string, unknown>;
    expect(out).toEqual({
      roomId: 'r1',
      Body: REDACTED,
      nested: { accessCode: REDACTED, ok: 2, deeper: { FILE_NAME: REDACTED, nick: REDACTED } },
      list: [{ token: REDACTED }, 7],
    });
    expect(JSON.stringify(out)).not.toContain('4471');
    expect(JSON.stringify(out)).not.toContain('blue-river');
    expect(JSON.stringify(out)).not.toContain('passport');
    expect(JSON.stringify(out)).not.toContain('Sam');
  });

  it('matches every identifier name the lint treats as sensitive', () => {
    for (const k of ['message', 'body', 'plaintext', 'token', 'accessCode', 'code', 'secret', 'key', 'nick', 'fileName', 'name', 'email', 'password', 'sessionToken', 'inviteLink', 'url']) {
      expect(SENSITIVE_KEY.test(k), k).toBe(true);
    }
    for (const k of ['roomId', 'count', 'ttl', 'ok', 'platform']) expect(SENSITIVE_KEY.test(k), k).toBe(false);
  });

  it('keeps numbers, booleans, null and short strings under safe keys; caps long strings', () => {
    const long = 'x'.repeat(MAX_STRING + 10);
    expect(redact({ n: 1, b: false, z: null, u: undefined, s: 'short', l: long })).toEqual({
      n: 1, b: false, z: null, u: undefined, s: 'short', l: `${'x'.repeat(MAX_STRING)}…[${MAX_STRING + 10}]`,
    });
  });

  it('redacts a bare string whole, since there is no key to judge it by', () => {
    expect(redact('The launch code is 4471')).toBe(REDACTED);
  });

  it('turns byte buffers into their length and never their contents', () => {
    const bytes = new TextEncoder().encode('passport scan: P1234567');
    const out = JSON.stringify(redact({ ct: bytes, buf: bytes.buffer, view: new DataView(bytes.buffer) }));
    expect(out).toBe(JSON.stringify({ ct: `[bytes:${bytes.byteLength}]`, buf: `[bytes:${bytes.byteLength}]`, view: `[bytes:${bytes.byteLength}]` }));
    expect(out).not.toContain('P1234567');
  });

  it('keeps only the name and trailing code of an error, as ChatError derives its code', () => {
    const e = new Error('redeem failed for Sam Okonkwo: access_code_wrong');
    e.name = 'ChatError';
    expect(redact({ e })).toEqual({ e: { error: 'ChatError', code: 'access_code_wrong' } });
    expect(redact(new Error('no trailing code here!'))).toEqual({ error: 'Error', code: null });
  });

  it('stops at MAX_DEPTH, summarises maps, sets, dates and functions', () => {
    let deep: Record<string, unknown> = { leaf: 'v' };
    for (let i = 0; i < MAX_DEPTH + 2; i++) deep = { d: deep };
    expect(JSON.stringify(redact(deep))).toContain('[depth]');
    expect(redact({ m: new Map([['k', 'v']]), s: new Set([1, 2]), f: () => 1, t: new Date(0) })).toEqual({
      m: '[map:1]', s: '[set:2]', f: '[function]', t: '1970-01-01T00:00:00.000Z',
    });
  });
});

describe('log', () => {
  it('is a no-op: returns undefined, throws on nothing and prints nothing', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => {}));
    expect(log('room_open', redact({ roomId: 'r1', body: 'x' }) as Record<string, unknown>)).toBeUndefined();
    expect(log('empty')).toBeUndefined();
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    spies.forEach(s => s.mockRestore());
  });
});
