import { NextResponse } from 'next/server';
import { adminClient, userFromRequest, siteUrl } from '@/lib/server';
import { pushTo, pushConfigured } from '@/lib/alerts';
import { emailConfigured, sendEmail, layout } from '@/lib/email';

export const dynamic = 'force-dynamic';

// GET: which alert channels the server can use. POST: send a test alert to the signed-in user.
export async function GET() {
  return NextResponse.json({ email: emailConfigured(), push: pushConfigured(), server: !!adminClient() });
}

export async function POST(req: Request) {
  const admin = adminClient();
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'login_required' }, { status: 401 });
  if (!admin) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const url = `${siteUrl(req)}/dashboard`;
  const title = 'Test alert from OnePeek';
  const body = 'Alerts are working. You’ll hear from us like this when a secret is opened or a request is answered.';
  const pushed = await pushTo(admin, user.id, { title, body, url, tag: 'test' });
  let emailed = false;
  if (user.email && emailConfigured()) {
    emailed = (await sendEmail({
      to: user.email, subject: title, text: `${body}\n\n${url}`,
      html: layout({ title, body: `<p style="color:#3a414b;line-height:1.55;margin:0;">${body}</p>`, button: { label: 'Open dashboard', href: url } }),
    })).ok;
  }
  return NextResponse.json({ pushed, emailed });
}
