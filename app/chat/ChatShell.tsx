'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Icon from '../components/Icon';
import SiteFooter from '../components/SiteFooter';
import { chatsLocked, lock, unlockChats, keystore } from '@/lib/chat/client';
import { KEYSTORE_TAB_ID } from '@/lib/chat/keystore';

/** Passkey-locked keys are forgotten after this long in the background. */
const IDLE_RELOCK_MS = 10 * 60 * 1000;

const NAV = [
  { href: '/chat', label: 'Chats' },
  { href: '/chat/new', label: 'New Chat' },
  { href: '/chat/settings', label: 'Settings' },
];

/** Fired on window when a screenshot shortcut is pressed; the open conversation tells the room. */
export const SHOT_EVENT = 'onepeek:screenshot';

/** True for the usual screenshot shortcuts: Print Screen, macOS Cmd+Shift(+3/4/5), Windows Win+Shift+S, Ctrl+Shift+S. */
function isScreenshotKey(e: KeyboardEvent) {
  const k = e.key;
  return k === 'PrintScreen' || k === 'Snapshot'
    || ((e.metaKey || k === 'Meta' || k === 'OS') && e.shiftKey)
    || (e.ctrlKey && e.shiftKey && /^[sS]$/.test(k));
}

/** Panic Exit: lock this browser's chats and leave for a neutral page, replacing history. */
export function panicExit() {
  lock();
  document.body.innerHTML = '';
  window.location.replace('/');
}

export default function ChatShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || '/chat';
  // null while checking: nothing renders until we know whether the chat keys are usable.
  const [locked, setLocked] = useState<boolean | null>(null);
  const [keysLocked, setKeysLocked] = useState(false);
  const [veiled, setVeiled] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [err, setErr] = useState('');
  const inConvo = path.startsWith('/chat/r/');

  useEffect(() => {
    chatsLocked().then(async l => {
      setLocked(l);
      setKeysLocked((await keystore.passkey.status()) === 'locked');
    }).catch(() => setLocked(true)); // fail closed: if the lock state can't be read, show the lock screen
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('onepeek-chat');
      bc.onmessage = (e) => {
        if (e.data?.t === 'lock') { keystore.passkey.lockNow(); setLocked(true); }
        // Another tab turned the passkey lock on or off: reload to pick up the new state.
        if (e.data?.t === 'keystore' && e.data.from !== KEYSTORE_TAB_ID) window.location.reload();
      };
    } catch { /* ignore */ }
    // Hide content when the app is backgrounded (app switcher previews, glances).
    // Long enough in the background and the passkey-unlocked key is dropped.
    let hiddenAt = 0;
    const vis = () => {
      const hidden = document.visibilityState !== 'visible';
      setVeiled(hidden);
      if (hidden) { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > IDLE_RELOCK_MS) {
        keystore.passkey.status().then(st => {
          if (st !== 'unlocked') return;
          keystore.passkey.lockNow();
          setKeysLocked(true);
          setLocked(true);
        }).catch(() => {});
      }
    };
    const blur = () => setVeiled(true);
    const focus = () => setVeiled(false);
    // Coming back via the back/forward cache must not show old content.
    const show = (e: PageTransitionEvent) => { if (e.persisted) window.location.reload(); };
    // Screenshot shortcuts: blur everything at once (the keys reach the page before the capture
    // when they're held down), clear a Print Screen copy, and let the conversation tell the room.
    let unveil: ReturnType<typeof setTimeout> | undefined;
    let lastShot = 0;
    const shot = (e: KeyboardEvent) => {
      if (!isScreenshotKey(e)) return;
      setVeiled(true);
      if (unveil) clearTimeout(unveil);
      unveil = setTimeout(() => setVeiled(document.visibilityState !== 'visible' || !document.hasFocus()), 3000);
      if (e.key === 'PrintScreen' || e.key === 'Snapshot') navigator.clipboard?.writeText('').catch(() => {});
      const now = Date.now();
      if (e.type === 'keydown' && now - lastShot > 2000) { lastShot = now; window.dispatchEvent(new Event(SHOT_EVENT)); }
    };
    // Shift + Escape twice quickly = Panic Exit.
    let lastEsc = 0;
    const key = (e: KeyboardEvent) => {
      shot(e);
      if (e.key !== 'Escape' || !e.shiftKey) return;
      const now = Date.now();
      if (now - lastEsc < 600) panicExit();
      lastEsc = now;
    };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    window.addEventListener('pageshow', show);
    window.addEventListener('keydown', key, true);
    window.addEventListener('keyup', shot, true);
    return () => {
      if (unveil) clearTimeout(unveil);
      window.removeEventListener('keyup', shot, true);
      bc?.close();
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
      window.removeEventListener('pageshow', show);
      window.removeEventListener('keydown', key, true);
    };
  }, []);

  const doUnlock = useCallback(async () => {
    setErr('');
    setUnlocking(true);
    try { await unlockChats(); setLocked(false); setKeysLocked(false); }
    catch (e) {
      const code = e instanceof Error ? e.message : '';
      setErr(code === 'cancelled' ? 'Unlock was cancelled.'
        : code === 'wrong_passkey' ? 'That passkey doesn’t unlock the chats on this device. Use the one you turned the lock on with.'
        : code === 'prf_unsupported' ? 'This passkey can’t unlock chats in this browser.'
        : 'Couldn’t verify it’s you. Try again.');
    }
    finally { setUnlocking(false); }
  }, []);

  return (
    <div className={`chat${veiled ? ' c-veiled' : ''}`}>
      {locked === null ? null : locked ? (
        <div className="c-lock" role="dialog" aria-label="Chats locked">
          <div>
            <Icon name="lock" size={34} />
            <h1 className="c-h1">Chats locked</h1>
            <p>{keysLocked
              ? 'Your chat keys on this device are locked with your passkey. Use Face ID, Touch ID or your device PIN to open them.'
              : 'Unlock to see your conversations on this device.'}</p>
            <button className="c-btn" onClick={doUnlock} disabled={unlocking}>{unlocking ? 'Checking…' : keysLocked ? 'Unlock with passkey' : 'Unlock'}</button>
            {err && <p className="c-error">{err}</p>}
            {keysLocked && (
              <p className="c-hint" style={{ marginTop: 18 }}>
                Passkey gone?{' '}
                <button className="c-link" onClick={async () => {
                  if (!confirm('Erase the chat keys on this device? You won’t be able to read these chats in this browser again. This can’t be undone. The device stays listed in your account until you sign it out from Chat Settings on another device.')) return;
                  await keystore.wipe();
                  window.location.reload();
                }}>Erase chat keys on this device</button>
              </p>
            )}
          </div>
        </div>
      ) : (
        <>
        <div className="bg-layer" aria-hidden="true">
          <div className="gp-grid" />
          <div className="gp-glow gp-glow-a" />
          <div className="gp-glow gp-glow-b" />
        </div>
        <div className={`c-shell${inConvo ? ' is-convo' : ''}`}>
          <header className="c-top">
            <Link href="/" className="c-brand" aria-label="OnePeek home">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/onepeek-logo.svg" alt="OnePeek" width={91} height={24} />
              <span className="c-brand-tag">Chat</span>
            </Link>
            <nav className="c-nav" aria-label="Chat">
              {NAV.map(n => (
                <Link key={n.href} href={n.href} aria-current={(n.href === '/chat' ? path === '/chat' : path.startsWith(n.href)) ? 'page' : undefined}>{n.label}</Link>
              ))}
            </nav>
            <button className="c-panic" onClick={panicExit} title="Panic Exit (Shift+Esc twice)">Exit</button>
          </header>
          <main className={inConvo ? 'c-main c-window' : 'c-main'}>{children}</main>
        </div>
        {!inConvo && <SiteFooter />}
        </>
      )}
    </div>
  );
}
