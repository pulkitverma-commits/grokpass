import type { Metadata } from 'next';
import HomeClient from './HomeClient';

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://onepeek.io').replace(/\/$/, '');

export const metadata: Metadata = {
  title: { absolute: 'OnePeek — Send secrets that disappear' },
  description: 'Share passwords, files and private notes as one-time links. Encrypted in your browser, deleted after they’re read. Free for 10 secrets a month, no sign-up.',
  alternates: { canonical: '/' },
};

// Facts only: who we are and what the site is. No ratings or reviews.
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'OnePeek', url: SITE, logo: `${SITE}/icon-192.png`, email: 'secret@onepeek.io' },
    {
      '@type': 'WebSite', '@id': `${SITE}/#site`, name: 'OnePeek', url: SITE, inLanguage: 'en',
      description: 'Zero-knowledge one-time secret sharing. Encrypted in your browser, deleted after it’s viewed.',
      publisher: { '@id': `${SITE}/#org` },
    },
  ],
};

export default function Page() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <HomeClient />
    </>
  );
}
