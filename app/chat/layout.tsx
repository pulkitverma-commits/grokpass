import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './chat.css';
import ChatShell from './ChatShell';

export const metadata: Metadata = {
  title: 'OnePeek Chat',
  description: 'Private, end-to-end encrypted chats that disappear.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  // Reading request headers renders /chat per request, so each response gets a fresh CSP nonce.
  headers();
  return <ChatShell>{children}</ChatShell>;
}
