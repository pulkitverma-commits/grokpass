import type { Metadata } from 'next';
import Link from 'next/link';
import SiteShell from '../components/SiteShell';
import ReferLink from './ReferLink';

export const metadata: Metadata = {
  title: 'Refer a friend · OnePeek',
  description: 'Share OnePeek with a friend and raise your free limit from 10 to 50 secrets a month.',
  alternates: { canonical: '/refer' },
};

export default function ReferPage() {
  return (
    <SiteShell wide={false}>
      <section className="pg-hero">
        <span className="eyebrow">Refer a friend</span>
        <h1>Get <span>50 free secrets</span> a month</h1>
        <p>Free is 10 secrets a month. When a friend opens OnePeek with your link, your free limit goes up to 50 a month.</p>
      </section>

      <ReferLink />

      <section className="pg-section">
        <h2 className="pg-h2">How it works</h2>
        <ol className="step-list">
          <li><span className="step-num">1</span><span>Copy your link above, or share it straight to WhatsApp, LinkedIn or X.</span></li>
          <li><span className="step-num">2</span><span>Your friend opens OnePeek with it. They don’t need an account.</span></li>
          <li><span className="step-num">3</span><span>Your free limit goes up to 50 secrets a month, starting straight away.</span></li>
        </ol>
        <p className="pg-sub" style={{ marginTop: 20 }}>Need more than 50? <Link href="/pricing">Plus gives you 250 a month</Link>.</p>
      </section>
    </SiteShell>
  );
}
