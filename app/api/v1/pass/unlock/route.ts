import { adminClient, randomUrlToken } from '@/lib/server';
import { clientIp, fail, json, rateOk, readJson } from '@/lib/appapi';
import { fromB64Url, sha256Hex } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

// POST /api/v1/pass/unlock — the viewer proves the passphrase for a passphrase share.
// Body: { id, authKey } where authKey = first 32 bytes of PBKDF2(passphrase) (base64url).
// → 200 { token, serverHalf }: a one-use token for /api/open and the server's key half.
// Each share allows 5 wrong guesses in total; the 5th deletes it. Also limited per IP.
export async function POST(req: Request) {
  const admin = adminClient();
  if (!admin) return fail('not_configured', 503);
  if (!(await rateOk(admin, `pass:${clientIp(req)}`, 30, 600))) return fail('rate_limited', 429);
  const b = await readJson<{ id?: unknown; authKey?: unknown }>(req, 1_000);
  const id = String(b?.id || '');
  const authKey = String(b?.authKey || '');
  if (!/^[A-Za-z0-9]{6,32}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(authKey)) return fail('invalid_request', 400);
  const token = randomUrlToken(32);
  const { data, error } = await admin.rpc('pass_unlock', {
    p_id: id, p_auth_hash: await sha256Hex(fromB64Url(authKey)), p_token_hash: await sha256Hex(token),
  });
  if (error) return fail('server_error', 500);
  const row = Array.isArray(data) ? data[0] : null;
  const status: string = row?.status || 'gone';
  if (status === 'ok') return json({ token, serverHalf: row.server_half });
  if (status.startsWith('wrong:')) return fail('wrong_passphrase', 403, 'wrong passphrase', { attemptsLeft: Number(status.split(':')[1]) });
  if (status === 'locked') return fail('locked', 410, 'too many wrong passphrases; the share was deleted');
  return fail('not_found', 404);
}
