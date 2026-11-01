// Android App Links: lets the OnePeek app claim https://onepeek.io/s/* and /chat/join. Google
// verifies the file at install time. Fingerprints come from env (comma-separated SHA-256 of the
// signing certificates: upload key and Play App Signing key); without them we return 404 so a
// misconfigured deploy fails verification instead of silently serving an empty list.
export const dynamic = 'force-dynamic';

export const PACKAGE_NAME = 'io.onepeek.app';

const FINGERPRINT = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;

export function parseFingerprints(raw: string | undefined) {
  return (raw || '').split(',').map(s => s.trim().toUpperCase()).filter(s => FINGERPRINT.test(s));
}

export function assetLinks(fingerprints: string[]) {
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: PACKAGE_NAME, sha256_cert_fingerprints: fingerprints },
  }];
}

export async function GET() {
  const fps = parseFingerprints(process.env.ANDROID_SHA256_CERT_FINGERPRINTS);
  if (!fps.length) return new Response(null, { status: 404 });
  return new Response(JSON.stringify(assetLinks(fps)), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
  });
}
