import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import SiteShell from '../../components/SiteShell';
import Icon from '../../components/Icon';
import PlaybookCard from '../PlaybookCard';
import { USE_CASES, useCase } from '@/lib/content/use-cases';

export const dynamicParams = false;

export function generateStaticParams() {
  return USE_CASES.map(u => ({ slug: u.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const u = useCase(params.slug);
  if (!u) return {};
  return {
    title: `${u.title} · OnePeek`,
    description: u.description,
    alternates: { canonical: `/use-cases/${u.slug}` },
    openGraph: { title: u.title, description: u.description, url: `/use-cases/${u.slug}` },
  };
}

export default function UseCasePage({ params }: { params: { slug: string } }) {
  const u = useCase(params.slug);
  if (!u) notFound();
  const others = USE_CASES.filter(o => o.slug !== u.slug);

  return (
    <SiteShell>
      <section className="pg-hero">
        <Link href="/use-cases" className="eyebrow">← Use cases</Link>
        <h1>{u.title}</h1>
        <p>{u.intro}</p>
        <div className="pg-hero-cta">
          <Link href="/#send" className="gp-btn">Send a secret →</Link>
        </div>
      </section>

      <section className="pg-section">
        <h2 className="pg-h2">The problem today</h2>
        <ul className="risk-list">
          {u.risks.map(r => <li key={r}><Icon name="ban" size={16} />{r}</li>)}
        </ul>
      </section>

      <section className="pg-section">
        <h2 className="pg-h2">Examples</h2>
        <div className="card-grid">
          {u.examples.map(e => (
            <div key={e.title} className="info-card">
              <h3>{e.title}</h3>
              <p>{e.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pg-section">
        <h2 className="pg-h2">Playbooks</h2>
        <p className="pg-sub">Step by step, with the settings to use.</p>
        <div className="playbook-list">
          {u.playbooks.map(p => <PlaybookCard key={p.id} p={p} />)}
        </div>
      </section>

      {u.dont.length > 0 && (
        <section className="pg-section">
          <h2 className="pg-h2">Good habits</h2>
          <ul className="risk-list dont">
            {u.dont.map(d => <li key={d}><Icon name="shield" size={16} />{d}</li>)}
          </ul>
        </section>
      )}

      <section className="pg-section">
        <h2 className="pg-h2">More use cases</h2>
        <div className="link-grid">
          {others.map(o => (
            <Link key={o.slug} href={`/use-cases/${o.slug}`} className="link-card">
              <strong>{o.short}</strong>
              <span>{o.description}</span>
            </Link>
          ))}
        </div>
      </section>
    </SiteShell>
  );
}
