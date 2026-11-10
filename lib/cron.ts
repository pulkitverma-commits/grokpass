// Vercel cron requests carry `Authorization: Bearer <CRON_SECRET>`. Fail closed: without a
// configured secret, cron routes refuse every caller (they used to be open to anyone).
import { timingSafeEqual } from 'node:crypto';

export function isCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET || '';
  if (secret.length < 16) return false;
  const got = Buffer.from(req.headers.get('authorization') || '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
