import type { Metadata } from 'next';
import './chat.css';
import ChatShell from './ChatShell';

export const metadata: Metadata = {
  title: 'OnePeek Chat',
  description: 'Private, end-to-end encrypted chats that disappear.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <ChatShell>{children}</ChatShell>;
}
