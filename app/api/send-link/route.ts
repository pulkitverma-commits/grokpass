import { NextResponse } from 'next/server';
import { sendEmail, layout, emailConfigured } from '@/lib/email';

export const dynamic = 'force-dynamic';

// Emails a OnePeek link (a secret or a request) to someone. Only links to this site are
// accepted, so the endpoint can't be used to send arbitrary links from our domain.
export async function POST(req: Request) {
  if (!emailConfigured()) return NextResponse.json({ error: 'Email isn’t set up yet' }, { status: 503 });
  let body: { to?: unknown; link?: unknown } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const to = String(body.to || '').trim();
  const link = String(body.link || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || to.length > 254) return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });

  const origin = new URL(req.url).origin;
  let parsed: URL;
  try { parsed = new URL(link); } catch { return NextResponse.json({ error: 'Invalid link' }, { status: 400 }); }
  const kind = /^\/s\/[A-Za-z0-9]{6,32}$/.test(parsed.pathname) ? 'secret' : /^\/r\/[A-Za-z0-9]{6,32}$/.test(parsed.pathname) ? 'request' : null;
  if (parsed.origin !== origin || !kind || (kind === 'secret' && !parsed.hash)) {
    return NextResponse.json({ error: 'Only OnePeek links can be sent' }, { status: 400 });
  }

  const isReq = kind === 'request';
  const subject = isReq ? 'You’ve been asked to share a secret on OnePeek' : 'Someone sent you a secret on OnePeek';
  const sent = await sendEmail({
    to,
    subject,
    text: isReq
      ? `Someone asked you to share a password or secret securely.\n\nAnswer here (it's encrypted in your browser, only they can read it):\n${link}`
      : `Someone sent you a secret on OnePeek.\n\nOpen it here (it deletes itself after viewing):\n${link}`,
    html: layout({
      title: isReq ? 'You’ve been asked for a secret' : 'You have a secret waiting',
      body: `<p style="color:#3a414b;line-height:1.55;margin:0;">${isReq
        ? 'Someone asked you to share a password or secret. Type it on the page: it’s encrypted in your browser and only they can read it.'
        : 'Someone sent you a secure link. It deletes itself after it’s viewed, so open it when you’re ready.'}</p>
        <p style="font-size:12px;color:#8a93a0;word-break:break-all;margin:16px 0 0;">${link.replace(/[<>"]/g, '')}</p>`,
      button: { label: isReq ? 'Share the secret' : 'Open secret', href: link },
    }),
  });
  if (!sent.ok) return NextResponse.json({ error: 'Couldn’t send the email' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
