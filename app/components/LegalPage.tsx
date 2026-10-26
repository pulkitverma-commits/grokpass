import Link from 'next/link';

export default function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#0A0C0F' }}>
      <div className="bg-layer" aria-hidden="true">
        <div className="gp-grid" />
        <div className="gp-glow gp-glow-a" />
      </div>

      <header className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', position: 'relative', zIndex: 10 }}>
        <Link href="/" className="logo" aria-label="OnePass home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/onepass-logo.png" alt="OnePass" className="logo-img" width={139} height={56} />
        </Link>
        <Link href="/#send" className="gp-btn gp-ghost" style={{ textDecoration: 'none' }}>Send a secret →</Link>
      </header>

      <main className="container legal" style={{ position: 'relative', zIndex: 1 }}>
        <span className="eyebrow">LEGAL</span>
        <h1>{title}</h1>
        <p className="legal-updated">Last updated {updated}</p>
        {children}
        <p className="legal-links"><Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms of Service</Link> · <Link href="/">Home</Link></p>
      </main>
    </div>
  );
}
