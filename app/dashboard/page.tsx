'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { getClientId, type Quota } from '@/lib/quota';
import { getHistory, clearHistory, type SentSecret } from '@/lib/history';
import Icon from '@/app/components/Icon';
import UserAvatar from '@/app/components/UserAvatar';

type Status = 'waiting' | 'opened' | 'expired' | 'checking';
type Row = SentSecret & { status: Status };

function timeAgo(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`;
}

function timeLeft(ms: number) {
  const s = Math.max(0, Math.round((ms - Date.now()) / 1000));
  const h = Math.floor(s / 3600);
  if (h >= 24) return `${Math.round(h / 24)} days left`;
  if (h >= 1) return `${h} h left`;
  return `${Math.max(1, Math.round(s / 60))} min left`;
}

function formatBytes(n?: number) {
  if (!n && n !== 0) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_LABEL: Record<Status, string> = { waiting: 'Waiting', opened: 'Opened', expired: 'Expired', checking: 'Checking…' };

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    supabase.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const refreshStatuses = useCallback(async () => {
    const list = getHistory();
    setRows(list.map(x => ({ ...x, status: 'checking' as Status })));
    if (!supabase || !list.length) return;
    const client = supabase;
    const results = await Promise.all(list.slice(0, 50).map(async item => {
      const { data } = await client.rpc('peek_secret', { p_id: item.id });
      const alive = Array.isArray(data) && data.length > 0;
      const status: Status = alive ? 'waiting' : item.expiresAt > Date.now() ? 'opened' : 'expired';
      return { ...item, status };
    }));
    setRows([...results, ...list.slice(50).map(x => ({ ...x, status: (x.expiresAt > Date.now() ? 'opened' : 'expired') as Status }))]);
  }, []);

  useEffect(() => {
    if (!user || !supabase) return;
    supabase.rpc('get_quota', { p_client_id: getClientId(), p_ref: null }).then(({ data }) => {
      const q = (Array.isArray(data) ? data[0] : null) as Quota | null;
      if (q) setQuota(q);
    });
    refreshStatuses();
  }, [user, refreshStatuses]);

  const counts = useMemo(() => ({
    waiting: rows.filter(r => r.status === 'waiting').length,
    opened: rows.filter(r => r.status === 'opened').length,
  }), [rows]);

  const meta = (user?.user_metadata || {}) as Record<string, string>;
  const name = meta.full_name || meta.name || (user?.email || '').split('@')[0];
  const firstName = name.split(' ')[0];
  const provider = (user?.app_metadata?.provider as string) || 'email';
  const providerLabel = provider === 'google' ? 'Google' : provider === 'azure' ? 'Microsoft' : 'Email';

  const used = quota?.used ?? 0;
  const limit = quota?.quota ?? null;
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const refLink = quota?.ref_code && typeof window !== 'undefined' ? `${window.location.origin}/?ref=${quota.ref_code}` : '';

  async function signOut() {
    await supabase?.auth.signOut();
    router.push('/');
  }

  function copyRef() {
    if (!refLink) return;
    navigator.clipboard.writeText(refLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#0A0C0F' }}>
      <div className="bg-layer" aria-hidden="true">
        <div className="gp-grid" />
        <div className="gp-glow gp-glow-a" />
        <div className="gp-glow gp-glow-b" />
      </div>

      <header className="container dash-header">
        <Link href="/" className="logo" aria-label="OnePass home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/onepass-logo.png" alt="OnePass" className="logo-img" width={139} height={56} />
        </Link>
        {user && (
          <div className="dash-header-right">
            <Link href="/#send" className="gp-btn" style={{ textDecoration: 'none' }}>New secret →</Link>
            <div className="dash-user">
              <button type="button" className="dash-avatar" onClick={() => setMenuOpen(o => !o)} aria-expanded={menuOpen} aria-label="Account menu">
                <UserAvatar user={user} size={40} />
              </button>
              {menuOpen && (
                <div className="dash-menu" role="menu">
                  <div className="dash-menu-who">
                    <strong>{name}</strong>
                    <span>{user.email}</span>
                  </div>
                  <button type="button" role="menuitem" onClick={signOut}>Sign out</button>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="container dash" style={{ position: 'relative', zIndex: 1 }}>
        {!ready ? (
          <p className="dash-muted" style={{ padding: '80px 0', textAlign: 'center' }}>Loading your dashboard…</p>
        ) : !user ? (
          <div className="dash-gate">
            <Icon name="lock" size={28} />
            <h1>Sign in to see your dashboard</h1>
            <p>Track every secret you’ve sent and see the moment it’s opened.</p>
            <Link href="/login" className="gp-btn" style={{ textDecoration: 'none', justifyContent: 'center' }}>Log in →</Link>
          </div>
        ) : (
          <>
            <section className="dash-hello">
              <div>
                <span className="eyebrow">DASHBOARD</span>
                <h1>Welcome back, {firstName}.</h1>
                <p className="dash-muted">Signed in with {providerLabel} as {user.email}</p>
              </div>
            </section>

            <section className="dash-stats" aria-label="Overview">
              <div className="dash-card">
                <span className="dash-label">Secrets used</span>
                <strong className="dash-big">{used}<small>{limit !== null ? ` / ${limit}` : ''}</small></strong>
                {limit !== null ? (
                  <div className="dash-bar" aria-hidden="true"><div style={{ width: `${pct}%` }} className={pct >= 90 ? 'hot' : ''} /></div>
                ) : <span className="dash-muted">Unlimited</span>}
              </div>
              <div className="dash-card">
                <span className="dash-label">Waiting to be opened</span>
                <strong className="dash-big">{counts.waiting}</strong>
                <span className="dash-muted">Links still live</span>
              </div>
              <div className="dash-card">
                <span className="dash-label">Opened &amp; burned</span>
                <strong className="dash-big">{counts.opened}</strong>
                <span className="dash-muted">Read once, then deleted</span>
              </div>
              <div className="dash-card">
                <span className="dash-label">Plan</span>
                <strong className="dash-big">{quota?.plan === 'plus' ? 'OnePass+' : 'Free'}</strong>
                {quota?.plan === 'plus' ? <span className="dash-muted">No limits</span> : <Link href="/plus" className="dash-link">Upgrade to OnePass+ →</Link>}
              </div>
            </section>

            <section className="dash-grid">
              <div className="dash-panel">
                <div className="dash-panel-head">
                  <div>
                    <h2>Your secrets</h2>
                    <p className="dash-muted">Sent from this browser. Links and keys are never stored.</p>
                  </div>
                  {rows.length > 0 && (
                    <button type="button" className="dash-ghost" onClick={refreshStatuses}>Refresh</button>
                  )}
                </div>

                {rows.length === 0 ? (
                  <div className="dash-empty">
                    <Icon name="shield" size={26} />
                    <p>No secrets yet. Your sent secrets and their status will show up here.</p>
                    <Link href="/#send" className="gp-btn" style={{ textDecoration: 'none' }}>Send your first secret →</Link>
                  </div>
                ) : (
                  <ul className="dash-list">
                    {rows.map(r => (
                      <li key={r.id}>
                        <span className={`dash-type ${r.type}`}><Icon name={r.type === 'file' ? 'image' : 'key'} size={17} /></span>
                        <div className="dash-item">
                          <strong>{r.type === 'file' ? `File${r.size ? ` · ${formatBytes(r.size)}` : ''}` : 'Text secret'}</strong>
                          <span>
                            Sent {timeAgo(r.createdAt)}
                            {r.timer ? ` · ${r.timer}s viewer timer` : ''}
                            {r.status === 'waiting' ? ` · ${timeLeft(r.expiresAt)}` : ''}
                          </span>
                        </div>
                        <span className={`dash-chip ${r.status}`}>
                          {r.status === 'opened' && <Icon name="flame" size={13} strokeWidth={2.1} />}
                          {r.status === 'waiting' && <Icon name="clock" size={13} strokeWidth={2.1} />}
                          {STATUS_LABEL[r.status]}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {rows.length > 0 && (
                  <button type="button" className="dash-clear" onClick={() => { clearHistory(); setRows([]); }}>Clear this list</button>
                )}
              </div>

              <aside className="dash-side">
                <div className="dash-panel">
                  <h2>Refer a friend</h2>
                  <p className="dash-muted">When a friend joins with your link, your limit goes up to 50 secrets.</p>
                  <div className="dash-ref">
                    <code>{refLink ? refLink.replace(/^https?:\/\//, '') : '…'}</code>
                    <button type="button" onClick={copyRef} disabled={!refLink}>{copied ? 'Copied' : 'Copy'}</button>
                  </div>
                  <span className="dash-muted">{quota?.referred ?? 0} friend{quota?.referred === 1 ? '' : 's'} joined</span>
                </div>

                <div className="dash-panel dash-secure">
                  <Icon name="shield" size={20} />
                  <div>
                    <h3>Zero-knowledge by design</h3>
                    <p className="dash-muted">Secrets are encrypted in your browser with AES-256-GCM. OnePass can see whether a secret was opened, never what it says.</p>
                  </div>
                </div>
              </aside>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
