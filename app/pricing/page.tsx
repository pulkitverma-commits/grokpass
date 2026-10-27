import type { Metadata } from 'next';
import Link from 'next/link';
import SiteShell from '../components/SiteShell';
import Icon from '../components/Icon';
import { PlanButton, EarlyAccessNote } from './PlanButton';

export const metadata: Metadata = {
  title: 'Pricing · OnePeek',
  description: 'OnePeek is free for 10 secrets a month. Plus (₹99/month) and Pro (₹249/month) add files, timers, history, location and advanced controls. Team, business and API plans too.',
  alternates: { canonical: '/pricing' },
};

const PERSONAL = [
  {
    id: 'free' as const, name: 'Free', price: '₹0', per: 'forever',
    blurb: 'For the odd password or note.',
    features: ['10 secrets a month', 'Text and Wi-Fi details', 'Links last up to 24 hours', 'No account needed', 'End-to-end encrypted, deleted after viewing'],
  },
  {
    id: 'plus' as const, name: 'Plus', price: '₹99', per: 'per month', featured: true,
    blurb: 'For people who share secrets every week.',
    features: ['250 secrets a month', 'Photos and files up to 50 MB', 'Viewing timers', 'Opening history and alerts', 'Location controls and geofences', 'Links last up to 30 days'],
  },
  {
    id: 'pro' as const, name: 'Pro', price: '₹249', per: 'per month',
    blurb: 'For professionals who need full control.',
    features: ['1,000 secrets a month', 'Everything in Plus', 'Burn now (revoke any link)', 'Advanced controls: up to 10 views, recipient lock, time lock, country allow-list', 'Sensitive Documents up to 1 GB (coming soon)', 'Priority support'],
  },
];

const TEAMS = [
  { name: 'OnePeek Teams', price: '₹1,499', per: '/month · 5 users included', body: 'Team dashboard, shared administration, secure request links and audit metadata.' },
  { name: 'OnePeek Business', price: '₹4,999', per: '/month · 20 users included', body: 'API access, webhooks, policy management, branded pages and integrations.' },
  { name: 'OnePeek Enterprise', price: '₹25,000+', per: '/month · annual contract', body: 'SSO (Microsoft Entra ID, Google Workspace), advanced policy controls, audit export, contractual support and custom integrations.' },
  { name: 'OnePeek Private / OEM', price: '₹5L–₹25L+', per: '/year', body: 'Private deployment, support, white-label licensing and custom integration packages.' },
];

const FAQ = [
  { q: 'Can I cancel any time?', a: 'Yes. Cancel from your dashboard and your plan stays active until the end of the month you’ve paid for. After that you’re back on Free. Nothing you’ve already sent is affected.' },
  { q: 'How do I pay?', a: 'Payments are handled by Razorpay: UPI, cards, net banking and wallets. Plans renew monthly until you cancel.' },
  { q: 'Do paid plans change the encryption?', a: 'No. Every plan uses the same AES-256-GCM encryption in your browser. We never see your secrets or the keys, whatever you pay.' },
  { q: 'What happens when I hit my monthly limit?', a: 'You can still open secrets sent to you. To send more, wait for the next month, refer a friend (Free plan: up to 50 a month) or upgrade.' },
  { q: 'Do you offer team or company billing?', a: 'Yes. Teams, Business and Enterprise are billed per organisation, with invoices. Email secret@onepeek.io and we’ll set it up.' },
];

export default function PricingPage() {
  return (
    <SiteShell>
      <section className="pg-hero">
        <span className="eyebrow">Pricing</span>
        <h1>Simple plans. <span>Same encryption for everyone.</span></h1>
        <p>Start free with no account. Upgrade when you share secrets often, need files and history, or want full control over every link.</p>
        <EarlyAccessNote />
      </section>

      <section className="plan-grid" aria-label="Personal plans">
        {PERSONAL.map(p => (
          <div key={p.id} className={`plan-card${p.featured ? ' featured' : ''}`}>
            {p.featured && <span className="plan-badge">Most popular</span>}
            <h2>{p.name}</h2>
            <p className="plan-price"><strong>{p.price}</strong> <span>{p.per}</span></p>
            <p className="plan-blurb">{p.blurb}</p>
            <ul>
              {p.features.map(f => <li key={f}><Icon name="check" size={15} strokeWidth={2.4} />{f}</li>)}
            </ul>
            <PlanButton plan={p.id} />
          </div>
        ))}
      </section>

      <section className="pg-section">
        <span className="eyebrow">Teams &amp; companies</span>
        <h2 className="pg-h2">For teams, businesses and partners</h2>
        <p className="pg-sub">Shared administration, secure request links for your clients, policies and audit trails. These plans are in early access: tell us what you need and we’ll set you up.</p>
        <div className="team-grid">
          {TEAMS.map(t => (
            <div key={t.name} className="team-card">
              <h3>{t.name}</h3>
              <p className="plan-price"><strong>{t.price}</strong> <span>{t.per}</span></p>
              <p>{t.body}</p>
              <a className="gp-btn gp-ghost" href={`mailto:secret@onepeek.io?subject=${encodeURIComponent(`${t.name} enquiry`)}`}>Talk to us</a>
            </div>
          ))}
        </div>
      </section>

      <section className="pg-section api-band">
        <div>
          <span className="eyebrow">OnePeek API</span>
          <h2 className="pg-h2">Secure handoff links inside your product</h2>
          <p className="pg-sub">For SaaS apps, CRMs, client portals and ticketing tools that need to send or collect sensitive data. <strong>₹2,999/month</strong> with a usage allowance, then pay as you go.</p>
        </div>
        <Link href="/developers" className="gp-btn">See the developer preview →</Link>
      </section>

      <section className="pg-section">
        <h2 className="pg-h2">Questions</h2>
        <div className="faq">
          {FAQ.map(f => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
        <p className="pg-sub" style={{ marginTop: 24 }}>Want more free secrets? <Link href="/refer">Refer a friend</Link> and your free limit goes up to 50 a month.</p>
      </section>
    </SiteShell>
  );
}
