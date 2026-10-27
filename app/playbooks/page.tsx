import type { Metadata } from 'next';
import Link from 'next/link';
import SiteShell from '../components/SiteShell';
import PlaybookCard from '../use-cases/PlaybookCard';
import { USE_CASES } from '@/lib/content/use-cases';

export const metadata: Metadata = {
  title: 'Playbooks: how to share secrets safely, step by step · OnePeek',
  description: 'Step-by-step playbooks for sharing passwords, ID documents, API keys, payroll details and customer credentials with OnePeek.',
  alternates: { canonical: '/playbooks' },
};

export default function PlaybooksPage() {
  return (
    <SiteShell>
      <section className="pg-hero">
        <span className="eyebrow">Playbooks</span>
        <h1>Step-by-step <span>playbooks</span></h1>
        <p>Copy these into your team wiki or onboarding docs. Each one lists the steps and the exact OnePeek settings to use.</p>
        <nav className="chip-row" aria-label="Jump to a team">
          {USE_CASES.map(u => <a key={u.slug} href={`#${u.slug}`} className="chip">{u.short}</a>)}
        </nav>
      </section>

      {USE_CASES.map(u => (
        <section key={u.slug} className="pg-section" id={u.slug}>
          <h2 className="pg-h2">{u.short}</h2>
          <p className="pg-sub">{u.description} <Link href={`/use-cases/${u.slug}`}>Read the full guide →</Link></p>
          <div className="playbook-list">
            {u.playbooks.map(p => <PlaybookCard key={p.id} p={p} />)}
          </div>
        </section>
      ))}
    </SiteShell>
  );
}
