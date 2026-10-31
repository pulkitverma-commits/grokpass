// Universal Links (AASA) and App Links (assetlinks.json) handlers: env-driven, JSON, 404 without env.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { GET as aasa } from './apple-app-site-association/route';
import { GET as assetlinks } from './assetlinks.json/route';

const FP1 = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, '0').toUpperCase()).join(':');
const FP2 = Array.from({ length: 32 }, (_, i) => (255 - i).toString(16).padStart(2, '0').toUpperCase()).join(':');

afterEach(() => vi.unstubAllEnvs());

describe('/.well-known/apple-app-site-association', () => {
  it('404s without APPLE_TEAM_ID (and with a malformed one)', async () => {
    vi.stubEnv('APPLE_TEAM_ID', '');
    expect((await aasa()).status).toBe(404);
    vi.stubEnv('APPLE_TEAM_ID', 'not a team id');
    expect((await aasa()).status).toBe(404);
  });

  it('serves JSON listing /s/* and /chat/join for the app id, plus webcredentials', async () => {
    vi.stubEnv('APPLE_TEAM_ID', 'ABCDE12345');
    const res = await aasa();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('location')).toBeNull();
    const body = await res.json();
    const detail = body.applinks.details[0];
    expect(detail.appIDs).toEqual(['ABCDE12345.io.onepeek.app']);
    const paths = detail.components.map((c: { '/': string }) => c['/']);
    expect(paths).toContain('/s/*');
    expect(paths).toContain('/chat/join');
    expect(detail.components.some((c: { '/': string; '#'?: string }) => c['/'] === '/chat/join' && c['#'] === '*')).toBe(true);
    expect(body.webcredentials.apps).toEqual(['ABCDE12345.io.onepeek.app']);
  });
});

describe('/.well-known/assetlinks.json', () => {
  it('404s without fingerprints (and with garbage)', async () => {
    vi.stubEnv('ANDROID_SHA256_CERT_FINGERPRINTS', '');
    expect((await assetlinks()).status).toBe(404);
    vi.stubEnv('ANDROID_SHA256_CERT_FINGERPRINTS', 'abc, not-a-fingerprint');
    expect((await assetlinks()).status).toBe(404);
  });

  it('serves the handle_all_urls statement for io.onepeek.app with every fingerprint', async () => {
    vi.stubEnv('ANDROID_SHA256_CERT_FINGERPRINTS', ` ${FP1.toLowerCase()} ,${FP2}`);
    const res = await assetlinks();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    const body = await res.json();
    expect(body).toEqual([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'io.onepeek.app', sha256_cert_fingerprints: [FP1, FP2] },
    }]);
  });
});
