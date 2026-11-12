import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Log in · OnePeek',
  description: 'Log in to OnePeek to see when your secrets were opened, manage requests and burn links that haven’t been read.',
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
