import { siteUrl } from '@/lib/server';
import { B64URL, fail, HEX64, json, rateOk, readJson, requireInstall } from '@/lib/appapi';

export const dynamic = 'force-dynamic';

type CreateBody = {
  idempotencyKey?: unknown; manageHash?: unknown; header?: unknown; body?: unknown; filePath?: unknown;
  size?: unknown; ttlSeconds?: unknown; maxViews?: unknown;
  passphrase?: { salt?: unknown; authHash?: unknown; serverHalf?: unknown } | null;
};

type ShareRow = {
  id: string; kind: string; status: string; created_at: string; expires_at: string; revoked_at: string | null;
  max_views: number; views_used: number | null; passphrase: boolean; size: number | null;
};

const str = (v: unknown) => (typeof v === 'string' ? v : null);

// POST /api/v1/shares — create a share from content the app has already encrypted.
// Idempotent: repeating a request with the same idempotencyKey (and manageHash) returns the same
// share with replayed: true, so a retry after a network failure never creates a duplicate.
// The response URL has no key: the app appends `#<key>` (or `#p1.<linkPart>`) itself.
export async function POST(req: Request) {
  const ctx = await requireInstall(req);
  if (ctx instanceof Response) return ctx;
  const { admin, installId } = ctx;
  if (!(await rateOk(admin, `create:${installId}`, 120, 3600))) return fail('rate_limited', 429);
  const b = await readJson<CreateBody>(req, 250_000);
  if (!b) return fail('invalid_request', 400);

  const idem = str(b.idempotencyKey), manageHash = str(b.manageHash), header = str(b.header);
  const body = str(b.body), filePath = str(b.filePath);
  const ttl = Number(b.ttlSeconds), views = Number(b.maxViews);
  const size = b.size == null ? null : Number(b.size);
  if (!idem || !/^[A-Za-z0-9_-]{16,64}$/.test(idem)) return fail('invalid_request', 400, 'idempotencyKey: 16–64 base64url characters');
  if (!manageHash || !HEX64.test(manageHash)) return fail('invalid_request', 400, 'manageHash must be a hex SHA-256');
  if (!header || !B64URL.test(header)) return fail('invalid_request', 400, 'header must be base64url ciphertext');
  if ((body === null) === (filePath === null)) return fail('invalid_request', 400, 'send either body or filePath');
  if (body !== null && !B64URL.test(body)) return fail('invalid_request', 400, 'body must be base64url ciphertext');
  if (!Number.isInteger(ttl) || !Number.isInteger(views)) return fail('invalid_request', 400);
  if (size !== null && (!Number.isInteger(size) || size < 0)) return fail('invalid_request', 400);
  const p = b.passphrase ?? null;
  const pass = p ? { salt: str(p.salt), authHash: str(p.authHash), serverHalf: str(p.serverHalf) } : null;

  const { data, error } = await admin.rpc('app_create_share', {
    p_install: installId, p_idempotency_key: idem, p_manage_hash: manageHash,
    p_header: header, p_body: body, p_file_path: filePath, p_size: size,
    p_ttl_seconds: ttl, p_max_views: views,
    p_pass_salt: pass?.salt ?? null, p_pass_auth_hash: pass?.authHash ?? null, p_pass_server_half: pass?.serverHalf ?? null,
  });
  if (error) {
    const m = error.message || '';
    const known: [RegExp, string, number][] = [
      [/idempotency_conflict/, 'idempotency_conflict', 409], [/quota_exceeded/, 'quota_exceeded', 429],
      [/invalid expiry/, 'invalid_expiry', 400], [/invalid views/, 'invalid_views', 400],
      [/upload_missing/, 'upload_missing', 409], [/upload_too_large/, 'upload_too_large', 413],
      [/invalid upload/, 'invalid_upload', 409], [/invalid passphrase/, 'invalid_passphrase_parameters', 400],
      [/invalid (header|body|manage)|provide either/, 'invalid_request', 400],
    ];
    const hit = known.find(([re]) => re.test(m));
    return hit ? fail(hit[1], hit[2]) : fail('server_error', 500);
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.id) return fail('server_error', 500);
  return json({ id: row.id, url: `${siteUrl(req)}/s/${row.id}`, expiresAt: row.expires_at, replayed: !!row.replayed }, row.replayed ? 200 : 201);
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
