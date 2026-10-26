import { NextResponse } from 'next/server';
import { adminClient, sha256Hex, randomUrlToken } from '@/lib/server';

export const dynamic = 'force-dynamic';

const MAX_ATTEMPTS = 5;

// "Lock to a recipient", step 2: check the code and hand back a one-use token for /api/open.
export async function POST(req: Request) {
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  let body: { id?: unknown; code?: unknown } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const id = String(body.id || '');
  const code = String(body.code || '').replace(/\D/g, '');
  if (!/^[A-Za-z0-9]{6,32}$/.test(id) || code.length !== 6) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { data: u } = await admin.from('secret_unlocks').select('code_hash, code_expires, attempts').eq('id', id).maybeSingle();
  if (!u?.code_hash || !u.code_expires || new Date(u.code_expires).getTime() < Date.now()) {
    return NextResponse.json({ error: 'expired' }, { status: 400 });
  }
  if (u.attempts >= MAX_ATTEMPTS) return NextResponse.json({ error: 'too_many' }, { status: 429 });

  if ((await sha256Hex(`${id}:${code}`)) !== u.code_hash) {
    const attempts = u.attempts + 1;
    await admin.from('secret_unlocks').update({ attempts, ...(attempts >= MAX_ATTEMPTS ? { code_hash: null } : {}) }).eq('id', id);
    return NextResponse.json({ error: attempts >= MAX_ATTEMPTS ? 'too_many' : 'wrong_code', left: Math.max(0, MAX_ATTEMPTS - attempts) }, { status: 400 });
  }

  const token = randomUrlToken(32);
  await admin.from('secret_unlocks').update({
    code_hash: null, code_expires: null, attempts: 0,
    token_hash: await sha256Hex(token),
    token_expires: new Date(Date.now() + 15 * 60_000).toISOString(),
  }).eq('id', id);
  return NextResponse.json({ token });
}
