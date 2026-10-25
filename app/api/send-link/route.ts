import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { to, link } = await req.json();
    if (!to || !link) {
      return NextResponse.json({ error: 'Missing to or link' }, { status: 400 });
    }

    const key = process.env.MANDRILL_API_KEY;
    if (!key) {
      return NextResponse.json({ error: 'Email not configured' }, { status: 500 });
    }

    const res = await fetch('https://mandrillapp.com/api/1.0/messages/send.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        message: {
          from_email: process.env.MANDRILL_FROM || 'noreply@onepass.example',
          from_name: 'OnePass',
          to: [{ email: to, type: 'to' }],
          subject: 'Someone sent you a secret on OnePass',
          html: `
            <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="margin:0 0 12px;">You have a one-time secret</h2>
              <p style="color:#444;line-height:1.5;">Someone sent you a secure link. It can be opened only once and then it burns.</p>
              <p style="margin:20px 0;"><a href="${link}" style="display:inline-block;background:#C8F135;color:#0A0C0F;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Open secret</a></p>
              <p style="font-size:13px;color:#888;word-break:break-all;">${link}</p>
              <p style="font-size:12px;color:#aaa;margin-top:24px;">Encrypted in the browser. The key never leaves the link.</p>
            </div>
          `,
          text: `Someone sent you a one-time secret on OnePass.\n\nOpen it once (it burns after):\n${link}`,
        },
      }),
    });

    const data = await res.json();
    if (!res.ok || (Array.isArray(data) && data[0]?.status === 'rejected')) {
      return NextResponse.json({ error: 'Failed to send', detail: data }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
