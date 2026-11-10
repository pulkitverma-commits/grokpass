'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Icon from './Icon';
import type { RoomSummary } from '@/lib/chat/client';
import { KIND_NAME, countdown, friendlyError, shortId } from '../chat/format';

// The chat client (with its encryption library) is loaded only when this panel needs it,
// so it doesn't slow down the rest of the dashboard.
const loadChat = () => import('@/lib/chat/client');

const STARTS = [
  { kind: 'quick' as const, title: 'Quick Chat', note: 'Start now, share a link', icon: 'clock' as const },
  { kind: 'secret' as const, title: 'Secret Chat', note: 'Access code, hidden previews', icon: 'lock' as const },
  { kind: 'business' as const, title: 'Business Room', note: 'You approve each person', icon: 'shield' as const },
];

/** Dashboard panel: start an encrypted chat in one click, and jump back into active ones. */
export default function DashboardChat() {
  const router = useRouter();
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    loadChat().then(async chat => {
      if (chat.isLocked()) { if (alive) { setLocked(true); setRooms([]); } return; }
      const list = await chat.myRooms();
      if (alive) setRooms(list.filter(r => new Date(r.expiresAt).getTime() > Date.now()));
    }).catch(() => { if (alive) setRooms([]); });
    return () => { alive = false; };
  }, []);

  async function startQuick() {
    setErr('');
    setBusy(true);
    try {
      const chat = await loadChat();
      const id = await chat.createRoom({ kind: 'quick', ttl: 60, mode: 'on_open', lifetime: 86400 });
      router.push(`/chat/r/${id}?invite=1`);
    } catch (e) {
      const chat = await loadChat().catch(() => null);
      setErr(friendlyError(chat && e instanceof chat.ChatError ? e.code : ''));
      setBusy(false);
    }
  }

  return (
    <div className="dash-panel dash-chat">
      <div className="dash-panel-head">
        <div>
          <span className="dash-label">Secret Chat</span>
          <h2>Start a private chat</h2>
        </div>
        <Link href="/chat" className="dash-ghost" style={{ textDecoration: 'none' }}>All chats</Link>
      </div>
      <p className="dash-muted">End-to-end encrypted. Messages disappear on a timer.</p>

      <div className="dash-chat-starts">
        {STARTS.map(s => s.kind === 'quick' ? (
          <button key={s.kind} type="button" className="dash-chat-start primary" onClick={startQuick} disabled={busy}>
            <Icon name={s.icon} size={18} />
            <span><strong>{busy ? 'Creating keys…' : s.title}</strong><small>{s.note}</small></span>
          </button>
        ) : (
          <Link key={s.kind} href={`/chat/new?kind=${s.kind}`} className="dash-chat-start">
            <Icon name={s.icon} size={18} />
            <span><strong>{s.title}</strong><small>{s.note}</small></span>
          </Link>
        ))}
      </div>
      {err && <p className="dash-chat-err">{err}</p>}

      {locked ? (
        <p className="dash-muted"><Icon name="lock" size={13} /> Chats are locked on this device. <Link href="/chat" className="dash-link">Unlock</Link></p>
      ) : rooms && rooms.length > 0 && (
        <ul className="dash-chat-list" aria-label="Active chats">
          {rooms.slice(0, 4).map(r => (
            <li key={r.id}>
              <Link href={`/chat/r/${r.id}`}>
                <Icon name={r.kind === 'secret' ? 'lock' : r.kind === 'business' ? 'shield' : 'clock'} size={15} />
                <span className="dash-chat-name">{r.name || `${KIND_NAME[r.kind]} · ${shortId(r.id)}`}</span>
                <small>{r.memberState === 'pending' ? 'Waiting' : `ends ${countdown(new Date(r.expiresAt).getTime() - Date.now())}`}</small>
              </Link>
            </li>
          ))}
          {rooms.length > 4 && <li><Link href="/chat" className="dash-link">+{rooms.length - 4} more</Link></li>}
        </ul>
      )}
    </div>
  );
}
