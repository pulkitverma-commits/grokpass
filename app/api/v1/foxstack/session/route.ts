import { clientIp, fail, json, rateOk, readJson } from '@/lib/appapi';
import { foxStackSigningKey, verifyFoxStackAssertion } from '@/lib/foxstack-sso';
import { adminClient } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const key = foxStackSigningKey();
  const admin = adminClient();
  if (!key || !admin) return fail('sso_not_configured', 503);
  if (!(await rateOk(admin, `foxstack-sso:${clientIp(req)}`, 30, 60))) return fail('rate_limited', 429);
  const body = await readJson<{ assertion?: unknown; secret?: unknown }>(req, 8192);
  const claims = verifyFoxStackAssertion(body?.assertion, body?.secret, key);
  if (!claims) return fail('invalid_assertion', 401);

  // Nonce consumption, identity binding, and credential creation are one DB
  // transaction. A concurrent replay cannot create a second session.
  const { data, error } = await admin.rpc('foxstack_exchange_session', {
    p_subject: claims.sub, p_email: claims.email, p_name: claims.name,
    p_secret_hash: claims.cnf.install_secret_sha256, p_nonce: claims.jti,
    p_assertion_expires_at: new Date(claims.exp * 1000).toISOString(),
  });
  if (error) {
    if (/assertion_replayed/.test(error.message || '')) return fail('assertion_replayed', 409);
    if (/assertion_expired/.test(error.message || '')) return fail('invalid_assertion', 401);
    if (/identity_revoked/.test(error.message || '')) return fail('identity_revoked', 403);
    return fail('sso_unavailable', 503);
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.id || !row.expires_at) return fail('sso_unavailable', 503);
  return json({
    sessionId: row.id, expiresAt: row.expires_at, scope: 'share:create',
    identity: { id: claims.sub, email: claims.email, name: claims.name },
  }, 201);
}
