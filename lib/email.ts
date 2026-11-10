// Transactional email via Mandrill (MANDRILL_API_KEY). Resend (RESEND_API_KEY) works as an alternative.
import { escapeHtml } from './server';

type Mail = { to: string; subject: string; html: string; text: string };

const FROM = process.env.EMAIL_FROM || 'OnePeek Secret <secret@onepeek.io>';
const LOGO = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://onepeek.io'}/email-logo.png`;

export function emailConfigured() {
  return !!(process.env.RESEND_API_KEY || process.env.MANDRILL_API_KEY);
}

export async function sendEmail(m: Mail): Promise<{ ok: boolean; error?: string }> {
  const mandrill = process.env.MANDRILL_API_KEY;
  if (mandrill) {
    const match = /^(.*?)\s*<([^>]+)>$/.exec(FROM);
    const res = await fetch('https://mandrillapp.com/api/1.0/messages/send.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: mandrill,
        message: {
          from_email: match ? match[2] : FROM, from_name: match ? match[1] : 'OnePeek Secret',
          to: [{ email: m.to, type: 'to' }], subject: m.subject, html: m.html, text: m.text,
          // Never let the email service rewrite links: a secret link carries its key after the #.
          track_opens: false, track_clicks: false, url_strip_qs: false, view_content_link: false,
        },
      }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok || (Array.isArray(data) && data[0]?.status === 'rejected')) return { ok: false, error: 'mandrill' };
    return { ok: true };
  }
  const resend = process.env.RESEND_API_KEY;
  if (resend) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
    }).catch(() => null);
    if (!res || !res.ok) return { ok: false, error: `resend_${res?.status ?? 'network'}` };
    return { ok: true };
  }
  return { ok: false, error: 'not_configured' };
}

/** Simple branded layout. `body` is trusted HTML built by us; escape any user text before passing it. */
export function layout(opts: { title: string; body: string; button?: { label: string; href: string }; foot?: string }) {
  const btn = opts.button
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(opts.button.href)}" style="display:inline-block;background:#C8F135;color:#0A0C0F;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;">${escapeHtml(opts.button.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f5f6;">
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;color:#14171c;">
    <div style="margin-bottom:20px;"><img src="${LOGO}" alt="OnePeek" height="32" style="display:block;height:32px;width:auto;border:0;" /></div>
    <div style="background:#fff;border-radius:14px;padding:24px;border:1px solid #e3e6ea;">
      <h1 style="font-size:20px;margin:0 0 12px;font-weight:600;">${escapeHtml(opts.title)}</h1>
      ${opts.body}
      ${btn}
    </div>
    <p style="font-size:12px;color:#8a93a0;margin-top:18px;line-height:1.5;">${opts.foot || 'OnePeek · encrypted in the browser. We never see what’s inside a secret.'}</p>
  </div></body></html>`;
}
