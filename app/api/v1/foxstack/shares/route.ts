import { clientIp, fail, rateOk } from '@/lib/appapi';
import { createAppShare } from '@/lib/app-share';
import { adminClient, sha256Hex } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// These credentials are intentionally not accepted by /api/v1/shares, uploads,
// history, revoke, or the OnePeek account APIs. They authorize creation only.
export async function POST(req: Request) {
  const admin = adminClient();
  if (!admin) return fail('not_configured', 503);
  const match = /^OnePeek-FoxStack ([A-Za-z0-9]{22})\.([A-Za-z0-9_-]{43})$/.exec(req.headers.get('authorization') || '');
  if (!match) return fail('unauthorized', 401);
  if (!(await rateOk(admin, `foxstack-auth:${clientIp(req)}`, 600, 60))) return fail('rate_limited', 429);
  const { data, error } = await admin.rpc('foxstack_auth_session', {
    p_session: match[1], p_secret_hash: await sha256Hex(match[2]),
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row?.install_id) return fail('unauthorized', 401);
  return createAppShare(req, { admin, installId: row.install_id });
}
