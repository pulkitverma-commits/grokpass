import { siteUrl } from '@/lib/server';
import { fail, json, rateOk, requireInstall } from '@/lib/appapi';
import { createAppShare } from '@/lib/app-share';

export const dynamic = 'force-dynamic';

type ShareRow = {
  id: string; kind: string; status: string; created_at: string; expires_at: string; revoked_at: string | null;
  max_views: number; views_used: number | null; passphrase: boolean; size: number | null;
};

// POST /api/v1/shares — create a share from content the app has already encrypted.
// Idempotent: repeating a request with the same idempotencyKey (and manageHash) returns the same
// share with replayed: true, so a retry after a network failure never creates a duplicate.
// The response URL has no key: the app appends `#<key>` (or `#p1.<linkPart>`) itself.
export async function POST(req: Request) {
  const ctx = await requireInstall(req);
  if (ctx instanceof Response) return ctx;
  return createAppShare(req, ctx);
}

// GET /api/v1/shares — this install's shares, metadata only (no names, no content, no keys).
export async function GET(req: Request) {
  const ctx = await requireInstall(req);
  if (ctx instanceof Response) return ctx;
  const { admin, installId } = ctx;
  if (!(await rateOk(admin, `list:${installId}`, 600, 3600))) return fail('rate_limited', 429);
  const { data, error } = await admin.rpc('app_list_shares', { p_install: installId, p_limit: 200 });
  if (error) return fail('server_error', 500);
  const site = siteUrl(req);
  return json({
    shares: ((data ?? []) as ShareRow[]).map(r => ({
      id: r.id, url: `${site}/s/${r.id}`, kind: r.kind, status: r.status,
      createdAt: r.created_at, expiresAt: r.expires_at, revokedAt: r.revoked_at,
      maxViews: r.max_views, viewsUsed: r.views_used, passphrase: r.passphrase, size: r.size,
    })),
  });
}
