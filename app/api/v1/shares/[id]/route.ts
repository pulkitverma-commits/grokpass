import { sha256Hex } from '@/lib/server';
import { fail, json, rateOk, requireInstall } from '@/lib/appapi';

export const dynamic = 'force-dynamic';

// DELETE /api/v1/shares/:id — revoke now. Needs the install's credentials AND the share's manage
// token in the X-Manage-Token header (never in the URL). Deletes the secret, any passphrase
// server half, and the encrypted file. Copies a recipient already opened are out of reach.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireInstall(req);
  if (ctx instanceof Response) return ctx;
  const { admin, installId } = ctx;
  if (!(await rateOk(admin, `revoke:${installId}`, 300, 3600))) return fail('rate_limited', 429);
  const id = String(params?.id || '');
  const token = req.headers.get('x-manage-token') || '';
  if (!/^[A-Za-z0-9]{6,32}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(token)) return fail('invalid_request', 400);
  const { data, error } = await admin.rpc('app_revoke_share', { p_install: installId, p_id: id, p_manage_hash: await sha256Hex(token) });
  if (error) return fail('server_error', 500);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.revoked) return fail('not_found', 404);
  if (row.file_path) {
    const { error: rmErr } = await admin.storage.from('secrets').remove([row.file_path]);
    // The secret row (and key half) is already gone; a failed delete is retried by the daily reaper.
    if (rmErr) return json({ revoked: true, fileDeleted: false });
  }
  return json({ revoked: true, fileDeleted: !!row.file_path });
}
