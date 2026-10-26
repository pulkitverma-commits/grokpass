import Link from 'next/link';

export default function LegalPage({ title, updated, children, eyebrow = 'LEGAL' }: { title: string; updated: string; children: React.ReactNode; eyebrow?: string }) {
  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#0A0C0F' }}>
      <div className="bg-layer" aria-hidden="true">
        <div className="gp-grid" />
        <div className="gp-glow gp-glow-a" />
      </div>

      <header className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', position: 'relative', zIndex: 10 }}>
        <Link href="/" className="logo" aria-label="OnePeek home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/onepeek-logo.png" alt="OnePeek" className="logo-img" width={149} height={56} />
        </Link>
        <Link href="/#send" className="gp-btn gp-ghost" style={{ textDecoration: 'none' }}>Send a secret →</Link>
      </header>

      <main className="container legal" style={{ position: 'relative', zIndex: 1 }}>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="legal-updated">Last updated {updated}</p>
        {children}
        <p className="legal-links"><Link href="/encryption">How our encryption works</Link> · <Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms of Service</Link> · <Link href="/">Home</Link></p>
      </main>
    </div>
  );
}
