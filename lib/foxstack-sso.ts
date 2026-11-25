// Server-only federation verification. A dedicated key must be configured on
// both owned services; no FoxStack/Google/Supabase session token is accepted.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const FOXSTACK_ISSUER = 'https://crm.foxnetglobal.com';
export const FOXSTACK_AUDIENCE = 'onepeek:foxstack:shares';
export const FOXSTACK_SCOPE = 'share:create';
const B64URL = /^[A-Za-z0-9_-]+$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FoxStackClaims = {
  iss: typeof FOXSTACK_ISSUER; aud: typeof FOXSTACK_AUDIENCE; sub: string;
  email: string; email_verified: true; name: string; scope: typeof FOXSTACK_SCOPE;
  iat: number; exp: number; jti: string; cnf: { install_secret_sha256: string };
};

export function foxStackSigningKey(value = process.env.ONEPEEK_SSO_SHARED_SECRET): Buffer | null {
  return value && HEX64.test(value) ? Buffer.from(value, 'hex') : null;
}

/** Verification precedes any identity lookup or database mutation. */
export function verifyFoxStackAssertion(
  token: unknown, proof: unknown, key: Buffer, now = Math.floor(Date.now() / 1000),
): FoxStackClaims | null {
  if (typeof token !== 'string' || token.length > 4096 || typeof proof !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(proof) || key.length !== 32) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(p => !B64URL.test(p))) return null;
  const [header, payload, signature] = parts;
  const expected = createHmac('sha256', key).update(`${header}.${payload}`).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.toString('base64url') !== signature || supplied.length !== expected.length ||
      !timingSafeEqual(expected, supplied)) return null;
  try {
    const h = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (h?.alg !== 'HS256' || h?.typ !== 'foxstack-onepeek+jwt' || h?.kid !== 'v1' ||
        c?.iss !== FOXSTACK_ISSUER || c?.aud !== FOXSTACK_AUDIENCE || c?.scope !== FOXSTACK_SCOPE ||
        typeof c.sub !== 'string' || !UUID.test(c.sub) || c.email_verified !== true ||
        typeof c.email !== 'string' || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@foxnetglobal\.com$/.test(c.email) || c.email.length > 254 ||
        typeof c.name !== 'string' || c.name.length > 160 || Array.from(c.name as string).some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127) ||
        !Number.isSafeInteger(c.iat) || !Number.isSafeInteger(c.exp) || c.exp - c.iat !== 60 ||
        c.iat > now + 5 || c.exp <= now || c.exp > now + 65 ||
        typeof c.jti !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(c.jti) ||
        typeof c.cnf?.install_secret_sha256 !== 'string' || !HEX64.test(c.cnf.install_secret_sha256)) return null;
    const proofHash = createHash('sha256').update(proof).digest();
    if (!timingSafeEqual(proofHash, Buffer.from(c.cnf.install_secret_sha256, 'hex'))) return null;
    return c as FoxStackClaims;
  } catch { return null; }
}
