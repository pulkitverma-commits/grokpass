import { fail, json, MAX_UPLOAD_BYTES, rateOk, readJson, requireInstall } from '@/lib/appapi';

export const dynamic = 'force-dynamic';

// POST /api/v1/uploads — reserve a storage path for one encrypted file and get a signed upload URL.
// Body: { size: ciphertext bytes } → 201 { path, uploadUrl, expiresInSeconds, maxBytes }.
// The app PUTs the AES-GCM ciphertext (12-byte IV ‖ ciphertext ‖ tag) to uploadUrl with
// Content-Type application/octet-stream. Paths not used by a share within 2 hours are deleted.
export async function POST(req: Request) {
  const ctx = await requireInstall(req);
  if (ctx instanceof Response) return ctx;
  const { admin, installId } = ctx;
  if (!(await rateOk(admin, `upload:${installId}`, 60, 3600))) return fail('rate_limited', 429);
  const body = await readJson<{ size?: unknown }>(req, 1_000);
  const size = Number(body?.size);
  if (!Number.isInteger(size) || size < 29) return fail('invalid_request', 400, 'size must be the ciphertext length in bytes');
  if (size > MAX_UPLOAD_BYTES) return fail('file_too_large', 413, undefined, { maxBytes: MAX_UPLOAD_BYTES });

  const { data: path, error } = await admin.rpc('app_begin_upload', { p_install: installId, p_max_bytes: size });
  if (error) {
    if (/too_many_pending_uploads/.test(error.message)) return fail('too_many_pending_uploads', 429);
    return fail('server_error', 500);
  }
  const { data: signed, error: sErr } = await admin.storage.from('secrets').createSignedUploadUrl(String(path));
  if (sErr || !signed) return fail('storage_unavailable', 503);
  return json({ path, uploadUrl: signed.signedUrl, expiresInSeconds: 7200, maxBytes: size }, 201);
}
