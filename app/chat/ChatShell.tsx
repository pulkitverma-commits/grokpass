'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { isLocked, lock, unlock } from '@/lib/chat/client';

const NAV = [
  { href: '/chat', label: 'Chats' },
  { href: '/chat/new', label: 'New Chat' },
  { href: '/chat/settings', label: 'Settings' },
];

/** Panic Exit: lock this browser's chats and leave for a neutral page, replacing history. */
export function panicExit() {
  lock();
  document.body.innerHTML = '';
  window.location.replace('/');
}

export default function ChatShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || '/chat';
  const [locked, setLocked] = useState(false);
  const [veiled, setVeiled] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [err, setErr] = useState('');
  const inConvo = path.startsWith('/chat/r/');

  useEffect(() => {
    setLocked(isLocked());
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('onepeek-chat');
      bc.onmessage = (e) => { if (e.data?.t === 'lock') setLocked(true); };
    } catch { /* ignore */ }
    // Hide content when the app is backgrounded (app switcher previews, glances).
    const vis = () => setVeiled(document.visibilityState !== 'visible');
    const blur = () => setVeiled(true);
    const focus = () => setVeiled(false);
    // Coming back via the back/forward cache must not show old content.
    const show = (e: PageTransitionEvent) => { if (e.persisted) window.location.reload(); };
    // Shift + Escape twice quickly = Panic Exit.
    let lastEsc = 0;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !e.shiftKey) return;
      const now = Date.now();
      if (now - lastEsc < 600) panicExit();
      lastEsc = now;
    };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    window.addEventListener('pageshow', show);
    window.addEventListener('keydown', key);
    return () => {
      bc?.close();
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
      window.removeEventListener('pageshow', show);
      window.removeEventListener('keydown', key);
    };
  }, []);

  const doUnlock = useCallback(async () => {
    setErr('');
    setUnlocking(true);
    try { await unlock(); setLocked(false); }
    catch { setErr('Couldn’t verify it’s you. Try again.'); }
    finally { setUnlocking(false); }
  }, []);

  return (
    <div className={`chat${veiled ? ' c-veiled' : ''}`}>
      {locked ? (
        <div className="c-lock" role="dialog" aria-label="Chats locked">
          <div>
            <Icon name="lock" size={34} />
            <h1 className="c-h1">Chats locked</h1>
            <p>Unlock to see your conversations on this device.</p>
            <button className="c-btn" onClick={doUnlock} disabled={unlocking}>{unlocking ? 'Checking…' : 'Unlock'}</button>
            {err && <p className="c-error">{err}</p>}
          </div>
        </div>
      ) : inConvo ? children : (
        <div className="c-shell">
          <header className="c-top">
            <Link href="/chat" className="c-brand"><Icon name="shield" size={18} /><span>OnePeek Chat</span></Link>
            <nav className="c-nav" aria-label="Chat">
              {NAV.map(n => (
                <Link key={n.href} href={n.href} aria-current={(n.href === '/chat' ? path === '/chat' : path.startsWith(n.href)) ? 'page' : undefined}>{n.label}</Link>
              ))}
            </nav>
            <button className="c-panic" onClick={panicExit} title="Panic Exit (Shift+Esc twice)">Exit</button>
          </header>
          <main className="c-main">{children}</main>
        </div>
      )}
    </div>
  );
}
