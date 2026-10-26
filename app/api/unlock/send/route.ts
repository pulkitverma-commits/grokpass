import { NextResponse } from 'next/server';
import { adminClient, sha256Hex } from '@/lib/server';
import { emailConfigured, sendEmail, layout } from '@/lib/email';

export const dynamic = 'force-dynamic';

// "Lock to a recipient", step 1: email a 6-digit code to the address the sender chose.
// The reply is the same whether or not the address matches, so it can't be used to guess it.
export async function POST(req: Request) {
  const admin = adminClient();
  if (!admin || !emailConfigured()) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  let body: { id?: unknown; email?: unknown } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const id = String(body.id || '');
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[A-Za-z0-9]{6,32}$/.test(id) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const { data: s } = await admin.from('secrets').select('lock_email, expires_at').eq('id', id).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (!s) return NextResponse.json({ error: 'gone' }, { status: 404 });
  if (!s.lock_email) return NextResponse.json({ error: 'not_locked' }, { status: 400 });

  const { data: u } = await admin.from('secret_unlocks').select('sends, last_sent_at').eq('id', id).maybeSingle();
  const sends = u?.sends ?? 0;
  if (sends >= 6) return NextResponse.json({ error: 'too_many' }, { status: 429 });
  if (u?.last_sent_at && Date.now() - new Date(u.last_sent_at).getTime() < 30_000) {
    return NextResponse.json({ error: 'wait', retryIn: 30 }, { status: 429 });
  }

  if (email !== s.lock_email) {
    // Count the attempt so the address can't be brute-forced, but don't reveal the mismatch.
    await admin.from('secret_unlocks').upsert({ id, sends: sends + 1, last_sent_at: new Date().toISOString() });
    return NextResponse.json({ ok: true });
  }

  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const code = String(n).padStart(6, '0');
  await admin.from('secret_unlocks').upsert({
    id,
    code_hash: await sha256Hex(`${id}:${code}`),
    code_expires: new Date(Date.now() + 10 * 60_000).toISOString(),
    attempts: 0,
    sends: sends + 1,
    last_sent_at: new Date().toISOString(),
  });
  const sent = await sendEmail({
    to: email,
    subject: `${code} is your OnePeek code`,
    text: `Your OnePeek code is ${code}\n\nEnter it on the page to open the secret someone sent you. It expires in 10 minutes. If you didn't ask for this, you can ignore this email.`,
    html: layout({
      title: 'Your one-time code',
      body: `<p style="color:#3a414b;line-height:1.55;margin:0 0 16px;">Enter this code on the page to open the secret someone sent you. It expires in 10 minutes.</p>
        <div style="font-family:ui-monospace,Menlo,monospace;font-size:30px;letter-spacing:8px;font-weight:700;background:#f4f5f6;border-radius:10px;padding:14px 18px;text-align:center;">${code}</div>
        <p style="color:#8a93a0;font-size:13px;line-height:1.5;margin:16px 0 0;">Didn’t ask for this? Ignore this email. Nobody can open the secret without this code.</p>`,
    }),
  });
  if (!sent.ok) return NextResponse.json({ error: 'send_failed' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
