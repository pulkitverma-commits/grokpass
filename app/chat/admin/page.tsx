'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Stats = {
  active_rooms: number; messages_held: number; messages_24h: number; attachments_bytes: number;
  storage_trash: number; rate_limited_24h: number; security_24h: Record<string, number>;
};

const LABELS: Record<string, string> = {
  room_burned: 'Chats burned', invite_redeemed: 'Invites used', invite_invalid: 'Invalid invite attempts',
  access_code_wrong: 'Wrong access codes', device_registered: 'New devices', device_revoked: 'Devices signed out',
};

function bytes(n: number) {
  return n < 1048576 ? `${Math.round(n / 1024)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`;
}

// Health at a glance. Counts only: no rooms, people, messages or files are visible here.
export default function ChatAdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [state, setState] = useState<'loading' | 'forbidden' | 'error' | 'ok'>('loading');

  useEffect(() => {
    const load = async () => {
      if (!supabase) { setState('error'); return; }
      const { data, error } = await supabase.rpc('chat_admin_stats');
      if (error) { setState(/forbidden/.test(error.message) ? 'forbidden' : 'error'); return; }
      setStats(data as Stats); setState('ok');
    };
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  if (state === 'loading') return <p className="c-empty">Loading…</p>;
  if (state === 'forbidden') return (
    <div className="c-card c-empty"><p>This page is for OnePeek administrators.</p><Link className="c-btn" href="/chat">Back to chats</Link></div>
  );
  if (state === 'error' || !stats) return <p className="c-empty">Stats couldn’t load. Try again shortly.</p>;

  const cards: [string, string][] = [
    ['Active chats', stats.active_rooms.toLocaleString()],
    ['Messages waiting', stats.messages_held.toLocaleString()],
    ['Messages, last 24 h', stats.messages_24h.toLocaleString()],
    ['Encrypted files stored', bytes(stats.attachments_bytes)],
    ['Files waiting to be deleted', stats.storage_trash.toLocaleString()],
    ['Rate limits hit, 24 h', stats.rate_limited_24h.toLocaleString()],
  ];
  const events = Object.entries(stats.security_24h || {}).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <h1 className="c-h1">Chat health</h1>
      <p className="c-sub">Totals only. OnePeek can’t see who is talking, what they say, or what files contain. Refreshes every 30 seconds.</p>
      <div className="c-stats">
        {cards.map(([k, v]) => <div key={k} className="c-card c-stat"><b>{v}</b><span>{k}</span></div>)}
      </div>
      <section className="c-section">
        <p className="c-label">Security events, last 24 hours</p>
        <ul className="c-card c-list">
          {events.length === 0 && <li className="c-row c-row-meta">Nothing to report.</li>}
          {events.map(([k, n]) => (
            <li key={k} className="c-row"><div className="c-row-main"><div className="c-row-title">{LABELS[k] || k.replace(/_/g, ' ')}</div></div><span className="c-pill">{n}</span></li>
          ))}
        </ul>
      </section>
    </>
  );
}
