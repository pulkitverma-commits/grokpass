import type { Metadata } from 'next';
import Link from 'next/link';
import SiteShell from '../components/SiteShell';
import { USE_CASES } from '@/lib/content/use-cases';

export const metadata: Metadata = {
  title: 'Use cases · OnePeek',
  description: 'Practical ways to use OnePeek for everyday sharing, HR, developers, support, IT and finance teams, with step-by-step playbooks.',
  alternates: { canonical: '/use-cases' },
};

export default function UseCasesPage() {
  return (
    <SiteShell>
      <section className="pg-hero">
        <span className="eyebrow">Use cases</span>
        <h1>Private details, shared <span>the safe way</span></h1>
        <p>Real situations where a password, document or code gets passed around, and exactly how to send it with OnePeek instead.</p>
      </section>

      <section className="link-grid">
        {USE_CASES.map(u => (
          <Link key={u.slug} href={`/use-cases/${u.slug}`} className="link-card">
            <strong>{u.short}</strong>
            <span>{u.description}</span>
            <em>{u.playbooks.length} playbook{u.playbooks.length === 1 ? '' : 's'} →</em>
          </Link>
        ))}
      </section>

      <section className="pg-section">
        <h2 className="pg-h2">Why a link instead of a message</h2>
        <p className="pg-sub">Passwords, ID scans, bank details and API keys usually travel by chat or email, where they stay in history, backups and search for years. A OnePeek link carries the secret encrypted in your browser with AES-256-GCM. It opens the number of times you choose, then it is gone, and the key never reaches our servers. Each use case above lists the risks for that team, real examples and step-by-step playbooks with the exact settings to use.</p>
      </section>

      <section className="pg-section">
        <p className="pg-sub">Looking for a single checklist? <Link href="/playbooks">See all playbooks on one page</Link>.</p>
      </section>
    </SiteShell>
  );
}
