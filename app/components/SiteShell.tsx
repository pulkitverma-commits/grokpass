import Link from 'next/link';
import { SEO_PAGES } from '@/lib/content/seo';
import { USE_CASES } from '@/lib/content/use-cases';

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
          <img src="/onepeek-logo.png" alt="OnePeek" className="logo-img" width={149} height={56} />
        </Link>
        <nav className="site-nav" aria-label="Main">
          <Link href="/use-cases">Use cases</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/encryption">Security</Link>
          <Link href="/developers">Developers</Link>
          <Link href="/#send" className="gp-btn">Send a secret →</Link>
        </nav>
      </header>

      <main className={`container site-main${wide ? '' : ' narrow'}`}>{children}</main>

      <footer className="site-footer">
        <div className="container site-footer-grid">
          <div>
            <strong>Product</strong>
            <Link href="/#send">Send a secret</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/integrations">Integrations</Link>
            <Link href="/developers">Developers &amp; API</Link>
            <Link href="/refer">Refer a friend</Link>
          </div>
          <div>
            <strong>Use cases</strong>
            {USE_CASES.map(u => <Link key={u.slug} href={`/use-cases/${u.slug}`}>{u.short}</Link>)}
            <Link href="/playbooks">All playbooks</Link>
          </div>
          <div>
            <strong>Guides</strong>
            {SEO_PAGES.map(p => <Link key={p.slug} href={`/${p.slug}`}>{p.short}</Link>)}
          </div>
          <div>
            <strong>Trust</strong>
            <Link href="/encryption">How our encryption works</Link>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
            <a href="mailto:secret@onepeek.io">secret@onepeek.io</a>
          </div>
        </div>
        <p className="container site-copy">© {new Date().getFullYear()} OnePeek</p>
      </footer>
    </div>
  );
}
