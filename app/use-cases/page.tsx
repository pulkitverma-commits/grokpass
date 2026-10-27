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
        <p className="pg-sub">Looking for a single checklist? <Link href="/playbooks">See all playbooks on one page</Link>.</p>
      </section>
    </SiteShell>
  );
}
