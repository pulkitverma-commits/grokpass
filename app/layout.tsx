import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GrokPass — Send a secret that disappears',
  description: 'Zero-knowledge one-time secret sharing',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
