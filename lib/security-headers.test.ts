import { describe, it, expect, afterEach } from 'vitest';
import { chatCsp, siteCsp, baseHeaders } from './security-headers';
import { isCronRequest } from './server';

const dir = (csp: string, name: string) => csp.split('; ').find(d => d.startsWith(name + ' '))?.slice(name.length + 1).split(' ') ?? [];

describe('chat CSP', () => {
  const csp = chatCsp('abc123');
  it('only runs nonce-carrying scripts', () => {
    const s = dir(csp, 'script-src');
    expect(s).toContain("'nonce-abc123'");
    expect(s).toContain("'strict-dynamic'");
    expect(s).not.toContain("'unsafe-inline'");
    expect(s.some(x => x.startsWith('https:') || x === '*')).toBe(false);
  });
  it('talks only to OnePeek and Supabase', () => {
    const c = dir(csp, 'connect-src');
    expect(c[0]).toBe("'self'");
    expect(c.every(x => x === "'self'" || /supabase\.co$/.test(x))).toBe(true);
  });
  it('cannot be framed, embed plugins or rebase URLs', () => {
    expect(dir(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(dir(csp, 'object-src')).toEqual(["'none'"]);
    expect(dir(csp, 'base-uri')).toEqual(["'none'"]);
  });
});

describe('site CSP (report-only)', () => {
  const csp = siteCsp();
  it('allows the third parties existing pages use', () => {
    expect(dir(csp, 'script-src')).toContain('https://checkout.razorpay.com');
    expect(dir(csp, 'frame-src')).toContain('https://*.razorpay.com');
    expect(dir(csp, 'connect-src')).toEqual(expect.arrayContaining(['https://tiles.openfreemap.org', 'https://photon.komoot.io', 'https://graph.microsoft.com']));
    expect(dir(csp, 'worker-src')).toContain('blob:');
  });
  it('blocks plugins and framing', () => {
    expect(dir(csp, 'object-src')).toEqual(["'none'"]);
    expect(dir(csp, 'frame-ancestors')).toEqual(["'none'"]);
  });
});

describe('base headers', () => {
  it('sets HSTS, nosniff and no framing', () => {
    const h = Object.fromEntries(baseHeaders.map((x: { key: string; value: string }) => [x.key, x.value]));
    expect(h['Strict-Transport-Security']).toMatch(/max-age=\d{8}/);
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
  });
});

describe('cron authorization', () => {
  const orig = process.env.CRON_SECRET;
  afterEach(() => { process.env.CRON_SECRET = orig; });
  const req = (auth?: string) => new Request('https://onepeek.io/api/cleanup', { headers: auth ? { authorization: auth } : {} });
  it('fails closed when CRON_SECRET is not set', () => {
    delete process.env.CRON_SECRET;
    expect(isCronRequest(req('Bearer '))).toBe(false);
    expect(isCronRequest(req())).toBe(false);
  });
  it('accepts only the exact secret', () => {
    process.env.CRON_SECRET = 's'.repeat(32);
    expect(isCronRequest(req('Bearer ' + 's'.repeat(32)))).toBe(true);
    expect(isCronRequest(req('Bearer ' + 's'.repeat(31) + 't'))).toBe(false);
    expect(isCronRequest(req('Bearer ' + 's'.repeat(31)))).toBe(false);
    expect(isCronRequest(req())).toBe(false);
  });
});
