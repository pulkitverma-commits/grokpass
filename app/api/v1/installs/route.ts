import { adminClient } from '@/lib/server';
import { clientIp, fail, HEX64, json, rateOk, readJson } from '@/lib/appapi';

export const dynamic = 'force-dynamic';

// POST /api/v1/installs — register an app install.
// Body: { secretHash: hex SHA-256 of a 32-byte random secret the app keeps in its keychain,
//         platform: 'macos' | 'ios' | 'web' | 'other', appVersion?: string }
// → 201 { installId }. The secret itself is never sent here.
export async function POST(req: Request) {
  const admin = adminClient();
  if (!admin) return fail('not_configured', 503);
  if (!(await rateOk(admin, `install:${clientIp(req)}`, 10, 3600))) return fail('rate_limited', 429);
  const body = await readJson<{ secretHash?: unknown; platform?: unknown; appVersion?: unknown }>(req, 2_000);
  if (!body) return fail('invalid_request', 400);
  const secretHash = typeof body.secretHash === 'string' ? body.secretHash : '';
  const platform = ['macos', 'ios', 'web', 'other'].includes(String(body.platform)) ? String(body.platform) : 'other';
  const appVersion = typeof body.appVersion === 'string' ? body.appVersion.slice(0, 40) : null;
  if (!HEX64.test(secretHash)) return fail('invalid_request', 400, 'secretHash must be a hex SHA-256');
  const { data, error } = await admin.rpc('app_register_install', { p_secret_hash: secretHash, p_platform: platform, p_app_version: appVersion });
  if (error || typeof data !== 'string') return fail('server_error', 500);
  return json({ installId: data }, 201);
}
