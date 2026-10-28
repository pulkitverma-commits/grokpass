'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import { ChatError, peekInvite, redeemInvite, type RoomKind } from '@/lib/chat/client';
import { KIND_NAME, friendlyError } from '../format';

// The invite token arrives in the #fragment, which browsers never send to a server.
// It is read once, then removed from the address bar and history.
export default function JoinPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<{ needs_code: boolean; kind: RoomKind } | null | undefined>(undefined);
  const [nick, setNick] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const t = window.location.hash.slice(1);
    history.replaceState(null, '', '/chat/join');
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(t)) { setInfo(null); return; }
    setToken(t);
    peekInvite(t).then(setInfo).catch(() => setInfo(null));
  }, []);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setErr(''); setBusy(true);
    try {
      const room = await redeemInvite(token, nick, info?.needs_code ? code : undefined);
      router.replace(`/chat/r/${room}`);
    } catch (e) {
      setErr(friendlyError(e instanceof ChatError ? e.code : ''));
      setBusy(false);
    }
  }

  if (info === undefined) return <p className="c-empty">Checking invite…</p>;
  if (info === null) return (
    <div className="c-card c-empty">
      <Icon name="ban" size={30} />
      <p>This invite isn’t valid any more. It may have expired, been used, or been revoked.</p>
    </div>
  );

  return (
    <form className="c-card" style={{ padding: 22 }} onSubmit={join}>
      <span className="c-pill secure"><Icon name="lock" size={12} />End-to-end encrypted</span>
      <h1 className="c-h1" style={{ marginTop: 12 }}>Join {KIND_NAME[info.kind]}</h1>
      <p className="c-sub">No account needed. Keys are created on this device.</p>
      {info.needs_code && (
        <label className="c-field"><span>Access code</span>
          <input className="c-input" value={code} onChange={e => setCode(e.target.value)} required autoComplete="off" autoFocus />
        </label>
      )}
      <label className="c-field"><span>Your name in this chat</span>
        <input className="c-input" value={nick} onChange={e => setNick(e.target.value)} maxLength={40} placeholder="Optional" autoComplete="off" autoFocus={!info.needs_code} />
        <p className="c-hint">Sent encrypted to the other members only.</p>
      </label>
      <button className="c-btn block" disabled={busy}>{busy ? 'Joining…' : 'Join chat'}</button>
      {err && <p className="c-error">{err}</p>}
    </form>
  );
}
