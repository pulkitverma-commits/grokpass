'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import SignIn from '../SignIn';
import { ChatError, createRoom, ensureSession, type ExpiryMode, type RoomKind } from '@/lib/chat/client';
import { TIMERS, friendlyError } from '../format';

const KINDS: { kind: RoomKind; title: string; desc: string; icon: 'clock' | 'lock' | 'shield' }[] = [
  { kind: 'quick', title: 'Quick Chat', desc: 'Share a link and talk. Messages vanish a minute after they’re read.', icon: 'clock' },
  { kind: 'secret', title: 'Secret Chat', desc: 'Adds an access code, hidden previews and a 30-second default.', icon: 'lock' },
  { kind: 'business', title: 'Business Room', desc: 'Invite only. You approve each person and verify identities.', icon: 'shield' },
];

const LIFETIMES = [{ s: 3600, label: '1 hour' }, { s: 86400, label: '1 day' }, { s: 604800, label: '7 days' }];

export default function NewChatPage() {
  const router = useRouter();
  const [kind, setKind] = useState<RoomKind>('quick');
  const [ttl, setTtl] = useState(60);
  const [mode, setMode] = useState<ExpiryMode>('on_open');
  const [lifetime, setLifetime] = useState(86400);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [guestOk, setGuestOk] = useState(false);

  useEffect(() => { ensureSession(false).then(s => setSignedIn(!!s)).catch(() => setSignedIn(false)); }, []);
  // Started from the dashboard: /chat/new?kind=secret preselects the chat type.
  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('kind');
    if (k === 'quick' || k === 'secret' || k === 'business') setKind(k);
  }, []);
  useEffect(() => { setTtl(kind === 'secret' ? 30 : kind === 'business' ? 3600 : 60); setMode(kind === 'business' ? 'on_send' : 'on_open'); }, [kind]);

  async function create() {
    setErr('');
    if (kind === 'secret' && code.trim().length < 6) { setErr('Choose an access code of at least 6 characters.'); return; }
    setBusy(true);
    try {
      if (guestOk) await ensureSession(true);
      const id = await createRoom({ kind, ttl, mode, lifetime, accessCode: kind === 'secret' ? code.trim() : null, name });
      router.replace(`/chat/r/${id}?invite=1`);
    } catch (e) {
      setErr(friendlyError(e instanceof ChatError ? e.code : ''));
      setBusy(false);
    }
  }

  if (signedIn === false && !guestOk) return <SignIn onDone={() => setSignedIn(true)} guest={() => { setGuestOk(true); setKind('quick'); }} />;

  return (
    <>
      <h1 className="c-h1">New chat</h1>
      <p className="c-sub">Everything is end-to-end encrypted. Pick how private it should feel.</p>

      <div className="c-kinds" role="group" aria-label="Chat type">
        {KINDS.filter(k => !guestOk || k.kind === 'quick').map(k => (
          <button key={k.kind} className="c-kind" aria-pressed={kind === k.kind} onClick={() => setKind(k.kind)}>
            <div className="c-avatar"><Icon name={k.icon} size={18} /></div>
            <div><strong>{k.title}</strong><span>{k.desc}</span></div>
          </button>
        ))}
      </div>

      <div className="c-section">
        <p className="c-label">Messages disappear after</p>
        <div className="c-seg" role="group" aria-label="Message timer">
          {TIMERS.map(t => <button key={t.s} aria-pressed={ttl === t.s} onClick={() => setTtl(t.s)}>{t.label}</button>)}
        </div>
        <div className="c-seg" role="group" aria-label="Timer starts" style={{ marginTop: 8 }}>
          <button aria-pressed={mode === 'on_open'} onClick={() => setMode('on_open')}>once read</button>
          <button aria-pressed={mode === 'on_send'} onClick={() => setMode('on_send')}>once sent</button>
        </div>
        <p className="c-hint">Unread messages are deleted after 7 days at most.</p>
      </div>

      <div className="c-section">
        <p className="c-label">Chat ends after</p>
        <div className="c-seg" role="group" aria-label="Chat lifetime">
          {LIFETIMES.map(l => <button key={l.s} aria-pressed={lifetime === l.s} onClick={() => setLifetime(l.s)}>{l.label}</button>)}
        </div>
      </div>

      <div className="c-section">
        <label className="c-field"><span>Name (only on your device)</span>
          <input className="c-input" value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="Optional" autoComplete="off" />
        </label>
        {kind === 'secret' && (
          <label className="c-field"><span>Access code</span>
            <input className="c-input" value={code} onChange={e => setCode(e.target.value)} minLength={6} maxLength={64} autoComplete="new-password" placeholder="At least 6 characters" />
            <p className="c-hint">Share it separately from the link — say it, don’t send it in the same place.</p>
          </label>
        )}
      </div>

      <button className="c-btn block" onClick={create} disabled={busy}>{busy ? 'Creating keys…' : 'Create chat'}</button>
      {err && <p className="c-error">{err}</p>}
    </>
  );
}
