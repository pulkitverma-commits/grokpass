import Link from 'next/link';
import SiteFooter from './SiteFooter';

// Header and footer for content pages (pricing, use cases, guides, integrations, developers).
export default function SiteShell({ children, wide = true }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="site-page">
      <div className="bg-layer" aria-hidden="true">
        <div className="gp-grid" />
        <div className="gp-glow gp-glow-a" />
        <div className="gp-glow gp-glow-b" />
      </div>

      <header className="container site-header">
        <Link href="/" className="logo" aria-label="OnePeek home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/onepeek-logo.svg" alt="OnePeek" className="logo-img" width={129} height={34} />
        </Link>
        <nav className="site-nav" aria-label="Main">
          <Link href="/secret-chat">Secret Chat</Link>
          <Link href="/use-cases">Use cases</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/encryption">Security</Link>
          <Link href="/developers">Developers</Link>
          <Link href="/#send" className="gp-btn">Send a secret →</Link>
        </nav>
      </header>

      <main className={`container site-main${wide ? '' : ' narrow'}`}>{children}</main>

      <SiteFooter />
    </div>
  );
}
