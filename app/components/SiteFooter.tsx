import Link from 'next/link';
import { SEO_PAGES } from '@/lib/content/seo';
import { USE_CASES } from '@/lib/content/use-cases';

// The one footer used on every page of the website.
export default function SiteFooter() {
  return (
    <footer className="op-footer">
      <div className="op-footer-inner">
        <div className="op-footer-grid">
          <div className="op-footer-brand">
            <Link href="/" className="logo" aria-label="OnePeek home">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/onepeek-logo.png" alt="OnePeek" className="logo-img logo-img-sm" width={128} height={48} />
            </Link>
            <p>Zero-knowledge secret sharing. Encrypted in your browser, deleted after it’s opened.</p>
            <Link href="/#send" className="gp-btn">Send a secret →</Link>
          </div>

          <nav className="op-footer-col" aria-label="Product">
            <span>Product</span>
            <Link href="/#how">How it works</Link>
            <Link href="/#features">Features</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/integrations">Integrations</Link>
            <Link href="/developers">Developers &amp; API</Link>
            <Link href="/refer">Refer a friend</Link>
          </nav>

          <nav className="op-footer-col" aria-label="Use cases">
            <span>Use cases</span>
            {USE_CASES.map(u => <Link key={u.slug} href={`/use-cases/${u.slug}`}>{u.short}</Link>)}
            <Link href="/playbooks">All playbooks</Link>
          </nav>

          <nav className="op-footer-col" aria-label="Guides">
            <span>Guides</span>
            {SEO_PAGES.map(p => <Link key={p.slug} href={`/${p.slug}`}>{p.short}</Link>)}
          </nav>

          <nav className="op-footer-col" aria-label="Account and trust">
            <span>Account</span>
            <Link href="/login">Log in</Link>
            <Link href="/dashboard">Dashboard</Link>
            <span className="op-footer-sub">Trust</span>
            <Link href="/encryption">How our encryption works</Link>
            <a href="/.well-known/security.txt">security.txt</a>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
            <a href="mailto:secret@onepeek.io">secret@onepeek.io</a>
          </nav>
        </div>

        <div className="op-footer-bottom">
          <span>© {new Date().getFullYear()} OnePeek</span>
          <span>encrypted in your browser · AES-256-GCM</span>
        </div>
      </div>
    </footer>
  );
}
