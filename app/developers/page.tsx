import type { Metadata } from 'next';
import Link from 'next/link';
import SiteShell from '../components/SiteShell';
import Icon, { type IconName } from '../components/Icon';

export const metadata: Metadata = {
  title: 'OnePeek API for developers (private beta) · OnePeek',
  description: 'Create zero-knowledge, self-destructing secret links from your SaaS product, CRM, client portal or helpdesk. OnePeek API is in private beta at ₹2,999/month.',
  alternates: { canonical: '/developers' },
};

const USES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'user', title: 'Client portals', body: 'Hand over account credentials and documents to clients with a link that opens once.' },
  { icon: 'inbox', title: 'Helpdesks & ticketing', body: 'Ask customers for passwords or keys with a request link instead of plain-text replies in the ticket.' },
  { icon: 'key', title: 'Onboarding & provisioning', body: 'Send each new user their first password automatically when an account is created.' },
  { icon: 'file', title: 'CRMs & HR systems', body: 'Collect bank details, ID documents and contracts without storing them in your own database.' },
];

const CREATE = `// Encrypt on your side, then store only ciphertext with OnePeek
import { createSecret } from '@onepeek/sdk';

const { url, id, expiresAt } = await createSecret({
  apiKey: process.env.ONEPEEK_API_KEY,
  text: 'db-password-here',
  views: 1,
  expiresIn: '24h',
  recipientEmail: 'dev@client.com',   // optional email-code lock
});

// url => https://onepeek.io/s/AbC123xyZ#<key that never reaches us>`;

const WEBHOOK = `POST https://your-app.com/hooks/onepeek
X-OnePeek-Signature: sha256=...

{
  "event": "secret.opened",
  "id": "AbC123xyZ",
  "opened_at": "2026-10-27T09:12:44Z",
  "country": "IN"
}`;

export default function DevelopersPage() {
  return (
    <SiteShell>
      <section className="pg-hero">
        <span className="eyebrow">Developers · Private beta</span>
        <h1>OnePeek API: <span>secure handoff links</span> in your product</h1>
        <p>Create self-destructing, end-to-end encrypted links from your own app. Your users get the same zero-knowledge protection as onepeek.io, and you never have to store their secrets.</p>
        <div className="pg-hero-cta">
          <a className="gp-btn" href="mailto:secret@onepeek.io?subject=OnePeek%20API%20private%20beta">Request beta access →</a>
          <Link href="/encryption" className="gp-btn gp-ghost">Security model</Link>
        </div>
        <p className="early-note">The API is not publicly available yet. The examples below show the planned interface and may change before launch.</p>
      </section>

      <section className="pg-section">
        <h2 className="pg-h2">What teams build with it</h2>
        <div className="card-grid">
          {USES.map(u => (
            <div key={u.title} className="info-card">
              <Icon name={u.icon} size={18} />
              <h3>{u.title}</h3>
              <p>{u.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pg-section">
        <h2 className="pg-h2">Create a link</h2>
        <p className="pg-sub">The SDK encrypts on your server or in the browser before anything is sent. OnePeek stores ciphertext only; the key lives in the link fragment.</p>
        <pre className="code-block"><code>{CREATE}</code></pre>
      </section>

      <section className="pg-section">
        <h2 className="pg-h2">Know when it’s opened</h2>
        <p className="pg-sub">Signed webhooks for <code>secret.opened</code>, <code>secret.expired</code>, <code>secret.burned</code> and <code>request.fulfilled</code>.</p>
        <pre className="code-block"><code>{WEBHOOK}</code></pre>
      </section>

      <section className="pg-section">
        <h2 className="pg-h2">Planned for launch</h2>
        <ul className="risk-list dont">
          {[
            'REST API with per-workspace API keys and scopes',
            'JavaScript/TypeScript SDK and a CLI (onepeek send < file)',
            'Request links for collecting secrets from your users',
            'All controls from the web app: views, expiry, recipient lock, countries, time windows',
            'Webhooks signed with HMAC-SHA256',
            'Audit log export for your workspace',
          ].map(x => <li key={x}><Icon name="check" size={16} />{x}</li>)}
        </ul>
      </section>

      <section className="pg-section api-band">
        <div>
          <span className="eyebrow">Pricing</span>
          <h2 className="pg-h2">₹2,999/month with a usage allowance</h2>
          <p className="pg-sub">Then pay as you go for extra links. Volume and OEM pricing available.</p>
        </div>
        <Link href="/pricing" className="gp-btn gp-ghost">See all plans</Link>
      </section>
    </SiteShell>
  );
}
