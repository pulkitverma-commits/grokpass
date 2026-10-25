import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GrokPass — Send a secret that disappears',
  description: 'Zero-knowledge one-time secret sharing',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Questrial&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
