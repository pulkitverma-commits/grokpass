import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import SiteShell from '../components/SiteShell';
import Icon from '../components/Icon';
import { SEO_PAGES, seoPage } from '@/lib/content/seo';
import { useCase } from '@/lib/content/use-cases';

// Only the guide slugs exist at the root; any other path is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return SEO_PAGES.map(p => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const p = seoPage(params.slug);
  if (!p) return {};
  return {
    title: p.title,
    description: p.description,
    alternates: { canonical: `/${p.slug}` },
    openGraph: { title: p.title, description: p.description, url: `/${p.slug}` },
  };
}

export default function GuidePage({ params }: { params: { slug: string } }) {
  const p = seoPage(params.slug);
  if (!p) notFound();

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: p.faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
  const howLd = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: p.h1,
    step: p.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, text: s })),
  };
  const related = p.related.map(useCase).filter(Boolean);

  return (
    <SiteShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify([faqLd, howLd]) }} />
      <section className="pg-hero">
        <span className="eyebrow">Guide</span>
        <h1>{p.h1}</h1>
        <p>{p.intro}</p>
        <div className="pg-hero-cta">
          <Link href="/#send" className="gp-btn">Send a secret now →</Link>
          <Link href="/encryption" className="gp-btn gp-ghost">How the encryption works</Link>
        </div>
      </section>

      <section className="pg-section">
        <h2 className="pg-h2">How to do it</h2>
        <ol className="step-list">
          {p.steps.map((s, i) => <li key={i}><span className="step-num">{i + 1}</span><span>{s}</span></li>)}
        </ol>
      </section>

      <section className="pg-section">
        <h2 className="pg-h2">Why use OnePeek for this</h2>
        <div className="card-grid">
          {p.benefits.map(b => (
            <div key={b.title} className="info-card">
              <Icon name="shield" size={18} />
              <h3>{b.title}</h3>
              <p>{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pg-section">
        <h2 className="pg-h2">Questions</h2>
        <div className="faq">
          {p.faqs.map(f => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {related.length > 0 && (
        <section className="pg-section">
          <h2 className="pg-h2">Playbooks for this</h2>
          <div className="link-grid">
            {related.map(u => (
              <Link key={u!.slug} href={`/use-cases/${u!.slug}`} className="link-card">
                <strong>{u!.short}</strong>
                <span>{u!.description}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </SiteShell>
  );
}
