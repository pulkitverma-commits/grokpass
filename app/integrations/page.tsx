import type { Metadata } from 'next';
import Link from 'next/link';
import SiteShell from '../components/SiteShell';
import Icon, { type IconName } from '../components/Icon';

export const metadata: Metadata = {
  title: 'Integrations: Slack, Microsoft Teams, WhatsApp and email · OnePeek',
  description: 'Send OnePeek secret links straight to Slack, Microsoft Teams, WhatsApp or email. Slack and Teams apps and the OnePeek API are coming soon.',
  alternates: { canonical: '/integrations' },
};

const LIVE: { icon: IconName; name: string; body: string }[] = [
  { icon: 'send', name: 'Microsoft Teams', body: 'After you create a secret, tap Teams to share the link in a chat or channel. Only the link is posted; the secret stays encrypted.' },
  { icon: 'send', name: 'Slack', body: 'Tap Slack to copy a ready-made message with the link and open Slack. Paste it into any DM or channel.' },
  { icon: 'send', name: 'WhatsApp', body: 'Share the link to any WhatsApp chat in one tap, on phone or desktop.' },
  { icon: 'inbox', name: 'Email', body: 'Type the recipient’s address and OnePeek emails them the link from our domain. Works for secret requests too.' },
  { icon: 'qr', name: 'QR code', body: 'Show the link as a QR code for someone sitting next to you. Great for Wi-Fi and in-person handovers.' },
  { icon: 'bell', name: 'Email alerts', body: 'Signed-in senders get an email when a secret is opened, and can see where on a map.' },
];

const SOON: { name: string; body: string }[] = [
  { name: 'Slack app', body: 'A /onepeek command to create a secret without leaving Slack, plus request links for collecting secrets from teammates.' },
  { name: 'Microsoft Teams app', body: 'Create and request secrets from a Teams message extension, with admin controls for your tenant.' },
  { name: 'OnePeek API & webhooks', body: 'Create links from your own product, CRM or helpdesk, and get a webhook when they’re opened.' },
  { name: 'Browser extension & CLI', body: 'Turn any selected text into a OnePeek link, or pipe a value into a link from your terminal.' },
];

export default function IntegrationsPage() {
  return (
    <SiteShell>
      <section className="pg-hero">
        <span className="eyebrow">Integrations</span>
        <h1>Send secrets <span>where you already talk</span></h1>
        <p>OnePeek fits into the tools your team uses. The secret is encrypted on your device; only a one-time link travels through Slack, Teams, WhatsApp or email.</p>
      </section>

      <section className="pg-section">
        <h2 className="pg-h2">Available now</h2>
        <div className="card-grid">
          {LIVE.map(i => (
            <div key={i.name} className="info-card">
              <Icon name={i.icon} size={18} />
              <h3>{i.name} <span className="badge-live">Live</span></h3>
              <p>{i.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pg-section">
        <h2 className="pg-h2">Coming soon</h2>
        <p className="pg-sub">Want early access for your team? <a href="mailto:secret@onepeek.io?subject=Integrations%20early%20access">Email secret@onepeek.io</a>.</p>
        <div className="card-grid">
          {SOON.map(i => (
            <div key={i.name} className="info-card muted">
              <h3>{i.name} <span className="badge-soon">Soon</span></h3>
              <p>{i.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pg-section api-band">
        <div>
          <span className="eyebrow">For developers</span>
          <h2 className="pg-h2">Build OnePeek into your product</h2>
          <p className="pg-sub">Client portals, CRMs and ticketing tools can create secure handoff links programmatically.</p>
        </div>
        <Link href="/developers" className="gp-btn">Developer preview →</Link>
      </section>
    </SiteShell>
  );
}
