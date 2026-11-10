import { NextResponse } from 'next/server';
import { adminClient, sha256Hex, randomUrlToken } from '@/lib/server';
import { clientIp, rateOk } from '@/lib/appapi';

export const dynamic = 'force-dynamic';

// "Lock to a recipient", step 2 (5 attempts per code): check the code and hand back a one-use token for /api/open.
// The attempt counter is checked and incremented atomically in the database
// (unlock_check_code, migration 011); it used to be read-then-write here, so parallel guesses
// could get past the 5-attempt limit.
export async function POST(req: Request) {
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  if (!(await rateOk(admin, `unlock:${clientIp(req)}`, 30, 600))) return NextResponse.json({ error: 'too_many' }, { status: 429 });

  let body: { id?: unknown; code?: unknown } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const id = String(body.id || '');
  const code = String(body.code || '').replace(/\D/g, '');
  if (!/^[A-Za-z0-9]{6,32}$/.test(id) || code.length !== 6) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const token = randomUrlToken(32);
  const { data, error } = await admin.rpc('unlock_check_code', {
    p_id: id, p_code_hash: await sha256Hex(`${id}:${code}`), p_token_hash: await sha256Hex(token),
  });
  if (error) return NextResponse.json({ error: 'server_error' }, { status: 500 });
  const result = String(data || 'expired');
  if (result === 'ok') return NextResponse.json({ token });
  if (result === 'too_many') return NextResponse.json({ error: 'too_many' }, { status: 429 });
  if (result.startsWith('wrong:')) {
    return NextResponse.json({ error: 'wrong_code', left: Math.max(0, Number(result.split(':')[1]) || 0) }, { status: 400 });
  }
  return NextResponse.json({ error: 'expired' }, { status: 400 });
}
