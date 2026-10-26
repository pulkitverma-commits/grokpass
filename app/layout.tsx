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
      <body>
        {/* Logo gradient for icon strokes: stroke: url(#op-grad) */}
        <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
          <defs>
            <linearGradient id="op-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#45BDEB" />
              <stop offset="0.5" stopColor="#89DB96" />
              <stop offset="1" stopColor="#D5FD3A" />
            </linearGradient>
          </defs>
        </svg>
        {children}
      </body>
    </html>
  );
}
