'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Icon from '../components/Icon';
import SignIn from './SignIn';
import { ensureSession, myRooms, keystore, type RoomSummary } from '@/lib/chat/client';
import { KIND_NAME, countdown, shortId } from './format';

export default function ChatsPage() {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await ensureSession(false);
      setSignedIn(!!s);
      if (!s) return;
      await keystore.sweep();
      setRooms(await myRooms());
    } catch { setErr(true); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (signedIn === false) return <SignIn onDone={load} />;
  if (err) return <p className="c-empty">Chats couldn’t load. Check your connection and try again.</p>;

  return (
    <>
      <h1 className="c-h1">Chats</h1>
      <p className="c-sub">End-to-end encrypted. Gone when the timer runs out.</p>
      {rooms === null ? <p className="c-empty">Loading…</p> : rooms.length === 0 ? (
        <div className="c-card c-empty">
          <Icon name="shield" size={30} />
          <p>No active chats on this device.</p>
          <Link className="c-btn" href="/chat/new">Start a chat</Link>
        </div>
      ) : (
        <ul className="c-card c-list">
          {rooms.map(r => (
            <li key={r.id}>
              <Link className="c-row" href={`/chat/r/${r.id}`}>
                <div className="c-avatar"><Icon name={r.kind === 'secret' ? 'lock' : r.kind === 'business' ? 'shield' : 'clock'} size={18} /></div>
                <div className="c-row-main">
                  <div className="c-row-title">{r.name || `${KIND_NAME[r.kind]} · ${shortId(r.id)}`}</div>
                  <div className="c-row-meta">
                    {r.memberState === 'pending' ? 'Waiting to be let in' : `Ends in ${countdown(new Date(r.expiresAt).getTime() - Date.now())}`}
                  </div>
                </div>
                <span className="c-secure"><Icon name="lock" size={12} />E2EE</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
