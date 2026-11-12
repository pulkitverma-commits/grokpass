import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard · OnePeek',
  description: 'Your OnePeek secrets, requests and opening history.',
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
