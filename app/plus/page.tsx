import Link from 'next/link';

export const metadata = { title: 'OnePass+ — Unlimited secrets' };

const FREE = ['10 secrets per browser', '50 secrets when you refer a friend', 'AES-256 encryption in your browser', 'Images & files up to 10 MB', 'Viewer timer & one-time links'];
const PLUS = ['Unlimited secrets', 'No sharing limits, ever', 'AES-256 encryption in your browser', 'Images & files up to 10 MB', 'Viewer timer & one-time links'];

function Check() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>;
}

export default function PlusPage() {
  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#0A0C0F' }}>
      <div className="bg-layer" aria-hidden="true">
        <div className="gp-grid" />
        <div className="gp-glow gp-glow-a" />
        <div className="gp-glow gp-glow-b" />
      </div>
      <header className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', position: 'relative', zIndex: 10 }}>
        <Link href="/" className="logo" aria-label="OnePass home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/onepass-logo.png" alt="OnePass" className="logo-img" width={139} height={56} />
        </Link>
        <Link href="/#send" className="gp-btn gp-ghost" style={{ textDecoration: 'none' }}>Send a secret →</Link>
      </header>

      <main className="container" style={{ position: 'relative', zIndex: 1, padding: '64px 24px 96px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 40 }}>
        <div style={{ textAlign: 'center', maxWidth: 640 }}>
          <span className="eyebrow">ONEPASS+</span>
          <h1 style={{ margin: '12px 0 14px', fontSize: 'clamp(2.4rem, 5vw, 3.8rem)', lineHeight: 1.05, fontWeight: 400, letterSpacing: '-1px', color: '#F4F5F6' }}>
            Share without <span style={{ color: 'var(--gp-accent)' }}>limits.</span>
          </h1>
          <p style={{ margin: 0, fontSize: 18, color: '#A3ABB6' }}>OnePass+ removes the cap on secrets. Same zero-knowledge encryption, as many one-time links as you need.</p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, width: '100%', maxWidth: 860, justifyContent: 'center' }}>
          <div className="tool-card" style={{ flex: '1 1 340px', maxWidth: 420, padding: 28, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <div style={{ fontSize: 15, color: '#A3ABB6' }}>Free</div>
              <div style={{ fontSize: 34, color: '#F4F5F6', marginTop: 4 }}>10 secrets</div>
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10, color: '#C9CED6', fontSize: 15 }}>
              {FREE.map(f => <li key={f} style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span style={{ color: '#8A93A0' }}><Check /></span>{f}</li>)}
            </ul>
            <Link href="/#send" className="gp-btn gp-ghost" style={{ justifyContent: 'center', textDecoration: 'none', marginTop: 'auto' }}>Keep using Free</Link>
          </div>

          <div className="tool-card" style={{ flex: '1 1 340px', maxWidth: 420, padding: 28, display: 'flex', flexDirection: 'column', gap: 18, borderColor: 'var(--gp-accent)', boxShadow: '0 0 0 4px color-mix(in srgb, var(--gp-accent) 12%, transparent), 0 24px 64px rgba(0,0,0,.5)' }}>
            <div>
              <div style={{ fontSize: 15, color: 'var(--gp-accent)' }}>OnePass+</div>
              <div style={{ fontSize: 34, color: '#F4F5F6', marginTop: 4 }}>Unlimited</div>
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10, color: '#E6E8EB', fontSize: 15 }}>
              {PLUS.map(f => <li key={f} style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span style={{ color: 'var(--gp-accent)' }}><Check /></span>{f}</li>)}
            </ul>
            <button type="button" className="gp-btn" disabled style={{ justifyContent: 'center', marginTop: 'auto', opacity: 0.85, cursor: 'default' }}>Upgrades opening soon</button>
          </div>
        </div>

        <p style={{ margin: 0, color: '#8A93A0', fontSize: 14, textAlign: 'center' }}>
          Can’t wait? <Link href="/?limit=1#send" style={{ color: 'var(--gp-accent)' }}>Refer a friend</Link> to unlock 50 secret shares for free.
        </p>
      </main>
    </div>
  );
}
