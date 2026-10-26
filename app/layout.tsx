import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://onepeek.io'),
  title: 'OnePeek — Send secrets that disappear',
  description: 'Zero-knowledge one-time secret sharing. Encrypted in your browser, deleted after it’s viewed.',
  applicationName: 'OnePeek',
  openGraph: { title: 'OnePeek — Send secrets that disappear', description: 'Encrypted in your browser. Read once. Gone for good.', siteName: 'OnePeek', images: ['/icon-512.png'] },
  icons: { icon: [{ url: '/favicon.ico', sizes: 'any' }, { url: '/icon-192.png', type: 'image/png' }], apple: '/apple-touch-icon.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Questrial&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
