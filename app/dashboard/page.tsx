'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PlanCard } from '../pricing/PlanButton';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { getClientId, type Quota } from '@/lib/quota';
import Icon from '@/app/components/Icon';
import { tzLabel } from '@/lib/time';
import UserAvatar from '@/app/components/UserAvatar';
import OpenMap from '@/app/components/OpenMap';
import OpensMap, { type OpenPoint } from '@/app/components/OpensMap';
import RequestsPanel from '@/app/components/RequestsPanel';
import AlertsPanel from '@/app/components/AlertsPanel';
import { countryName } from '@/lib/countries';

type Status = 'waiting' | 'opened' | 'expired' | 'burned';
type LogRow = {
  id: string;
  kind: 'text' | 'file';
  size: number | null;
  recipient: string | null;
  share_location: boolean;
  created_at: string;
  expires_at: string;
  opened_at: string | null;
  open_city: string | null;
  open_region: string | null;
  open_country: string | null;
  open_lat: number | null;
  open_lon: number | null;
  open_area?: string | null;
  open_accuracy_m?: number | null;
  open_source?: 'device' | 'network' | null;
  fence_radius_m?: number | null;
  fence_label?: string | null;
  fence_lat?: number | null;
  fence_lon?: number | null;
  max_views?: number | null;
  views_used?: number | null;
  last_opened_at?: string | null;
  burned_at?: string | null;
  lock_email?: string | null;
  open_after?: string | null;
  window_start?: number | null;
  window_end?: number | null;
  window_tz?: string | null;
  allowed_countries?: string[] | null;
};

function statusOf(r: LogRow, now: number): Status {
  const max = r.max_views || 1;
  const used = r.views_used ?? (r.opened_at ? 1 : 0);
  if (r.burned_at) return 'burned';
  if (r.opened_at && used >= max) return 'opened';
  if (new Date(r.expires_at).getTime() <= now) return r.opened_at ? 'opened' : 'expired';
  return 'waiting';
}

function hhmm(min: number) {
  return new Date(2000, 0, 1, Math.floor(min / 60), min % 60).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
type Row = LogRow & { status: Status };
type Filter = 'all' | Status;

function rel(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`;
}

function timeLeft(iso: string) {
  const s = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
  const h = Math.floor(s / 3600);
  if (h >= 24) return `${Math.round(h / 24)} days left`;
  if (h >= 1) return `${h} h left`;
  return `${Math.max(1, Math.round(s / 60))} min left`;
}

function fullDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatBytes(n?: number | null) {
  if (!n && n !== 0) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function place(r: LogRow) {
  let country = r.open_country || '';
  try { if (country) country = new Intl.DisplayNames(undefined, { type: 'region' }).of(country) || country; } catch { /* keep code */ }
  const parts = [...(r.open_area ? r.open_area.split(', ') : []), r.open_city, r.open_region, country]
    .filter((x): x is string => !!x);
  return parts.filter((x, i) => parts.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i).join(', ');
}

function dist(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${+(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

const STATUS_LABEL: Record<Status, string> = { waiting: 'Waiting', opened: 'Opened', expired: 'Expired', burned: 'Burned' };

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [openMap, setOpenMap] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmBurn, setConfirmBurn] = useState<string | null>(null);
  const [burnMsg, setBurnMsg] = useState('');
  const [burnRow, setBurnRow] = useState<{ id: string; msg: string } | null>(null);
  const [burning, setBurning] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    supabase.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadHistory = useCallback(async () => {
    if (!supabase) return;
    setLoadErr('');
    const { data, error } = await supabase.from('secret_log').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) { setLoadErr('Could not load your history.'); setRows([]); return; }
    const now = Date.now();
    setRows((data as LogRow[]).map(r => ({ ...r, status: statusOf(r, now) })));
  }, []);

  const userId = user?.id;
  const loadQuota = useCallback(() => {
    supabase?.rpc('get_quota', { p_client_id: getClientId(), p_ref: null }).then(({ data }) => {
      const q = (Array.isArray(data) ? data[0] : null) as Quota | null;
      if (q) setQuota(q);
    });
  }, []);
  useEffect(() => {
    if (!userId || !supabase) return;
    loadQuota();
    loadHistory();
  }, [userId, loadHistory, loadQuota]);

  const counts = useMemo(() => {
    const list = rows || [];
    return {
      all: list.length,
      waiting: list.filter(r => r.status === 'waiting').length,
      opened: list.filter(r => r.status === 'opened').length,
      expired: list.filter(r => r.status === 'expired' || r.status === 'burned').length,
      burned: list.filter(r => r.status === 'burned').length,
    };
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows || []).filter(r =>
      (filter === 'all' || r.status === filter || (filter === 'expired' && r.status === 'burned')) &&
      (!q || (r.recipient || '').toLowerCase().includes(q) || place(r).toLowerCase().includes(q)));
  }, [rows, filter, query]);

  const points = useMemo<OpenPoint[]>(() => (rows || [])
    .filter(r => r.opened_at && r.open_lat != null && r.open_lon != null)
    .map(r => ({
      id: r.id, lat: r.open_lat as number, lon: r.open_lon as number,
      accuracy: r.open_accuracy_m ?? null, precise: r.open_source === 'device',
      title: r.recipient ? `To ${r.recipient}` : 'Secret', place: place(r), when: r.last_opened_at || r.opened_at as string,
    })), [rows]);

  function jumpTo(id: string) {
    setFilter('all'); setQuery(''); setOpenMap(id);
    setTimeout(() => document.getElementById(`row-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }

  const meta = (user?.user_metadata || {}) as Record<string, string>;
  const name = meta.full_name || meta.name || (user?.email || '').split('@')[0];
  const firstRaw = name.split(/[\s._-]+/)[0] || name;
  const firstName = firstRaw.charAt(0).toUpperCase() + firstRaw.slice(1);
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

  async function removeRow(id: string) {
    if (!supabase) return;
    setRows(rs => (rs || []).filter(r => r.id !== id));
    await supabase.from('secret_log').delete().eq('id', id);
  }

  async function burnNow(id: string) {
    if (!supabase) return;
    setConfirmBurn(null);
    setBurnMsg('');
    setBurnRow(null);
    setBurning(id);
    // Make sure the sign-in is fresh: an expired session would look like "not yours".
    await supabase.auth.getSession();
    const { data, error } = await supabase.rpc('burn_secret', { p_id: id });
    setBurning(null);
    const res = (Array.isArray(data) ? data[0] : null) as { burned: boolean; file_path: string | null; reason?: string } | null;
    if (error) {
      setBurnRow({ id, msg: /plan_required/.test(error.message || '') ? 'Burn now is part of OnePeek Pro.' : 'Couldn’t burn that secret. Please try again.' });
      return;
    }
    if (res?.file_path) supabase.storage.from('secrets').remove([res.file_path]).catch(() => {});
    if (!res?.burned) {
      const why = res?.reason === 'not_signed_in' ? 'Your sign-in has expired. Refresh the page, sign in again and try once more.'
        : res?.reason === 'not_found' ? 'This secret isn’t in your account.'
        : 'That link was already opened, expired or removed, so there was nothing left to burn.';
      setBurnRow({ id, msg: why });
    }
    loadHistory();
  }

  async function clearAll() {
    if (!supabase || !userId) return;
    setConfirmClear(false);
    setRows([]);
    await supabase.from('secret_log').delete().eq('owner', userId);
  }

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#0A0C0F' }}>
      <div className="bg-layer" aria-hidden="true">
        <div className="gp-grid" />
        <div className="gp-glow gp-glow-a" />
        <div className="gp-glow gp-glow-b" />
      </div>

      <header className="container dash-header">
        <Link href="/" className="logo" aria-label="OnePeek home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/onepeek-logo.png" alt="OnePeek" className="logo-img" width={149} height={56} />
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
            <p>Every secret you’ve sent, who it went to, and where it was opened.</p>
            <Link href="/login" className="gp-btn" style={{ textDecoration: 'none', justifyContent: 'center' }}>Log in →</Link>
          </div>
        ) : (
          <>
            <section className="dash-hello">
              <span className="eyebrow">DASHBOARD</span>
              <h1>Welcome back, {firstName}.</h1>
              <p className="dash-muted">Signed in with {providerLabel} as {user.email}</p>
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
                <PlanCard />
              </div>
            </section>

            <section className="dash-grid">
              <div className="dash-main">
              {points.length > 0 && (
                <div className="dash-panel">
                  <div className="dash-panel-head">
                    <div>
                      <h2>Where your secrets were opened</h2>
                      <p className="dash-muted">{points.length} open{points.length === 1 ? '' : 's'} with a location. Nearby ones are grouped; click a number to zoom in, or a pin for details.</p>
                    </div>
                  </div>
                  <OpensMap points={points} onSelect={jumpTo} />
                </div>
              )}
              <div className="dash-panel">
                <div className="dash-panel-head">
                  <div>
                    <h2>History</h2>
                    <p className="dash-muted">Every secret you’ve sent while signed in. Content and keys are never stored.</p>
                  </div>
                  <button type="button" className="dash-ghost" onClick={loadHistory}>Refresh</button>
                </div>

                {rows && rows.length > 0 && (
                  <div className="hist-tools">
                    <div className="hist-filters" role="group" aria-label="Filter by status">
                      {(['all', 'waiting', 'opened', 'expired'] as Filter[]).map(f => (
                        <button key={f} type="button" className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                          {f === 'all' ? 'All' : f === 'expired' ? 'Expired & burned' : STATUS_LABEL[f]} <span>{counts[f]}</span>
                        </button>
                      ))}
                    </div>
                    <input className="hist-search" type="search" placeholder="Search recipient or place" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search history" />
                  </div>
                )}

                {loadErr && <p className="auth-msg err">{loadErr}</p>}
                {burnMsg && <p className="auth-msg">{burnMsg}</p>}

                {rows === null ? (
                  <p className="dash-muted" style={{ padding: '24px 0' }}>Loading history…</p>
                ) : rows.length === 0 ? (
                  <div className="dash-empty">
                    <Icon name="shield" size={26} />
                    <p>No secrets yet. Send one while signed in and it’ll appear here with who it went to and whether it was opened.</p>
                    <Link href="/#send" className="gp-btn" style={{ textDecoration: 'none' }}>Send your first secret →</Link>
                  </div>
                ) : visible.length === 0 ? (
                  <p className="dash-muted" style={{ padding: '24px 0', textAlign: 'center' }}>Nothing matches this filter.</p>
                ) : (
                  <ul className="dash-list">
                    {visible.map(r => {
                      const where = place(r);
                      const hasMap = !!r.opened_at && r.open_lat != null && r.open_lon != null;
                      const fenced = !!(r.fence_radius_m && r.fence_lat != null && r.fence_lon != null);
                      const fenceRing = fenced ? { lat: r.fence_lat as number, lon: r.fence_lon as number, radiusMeters: (r.fence_radius_m as number) * 1.05 } : null;
                      const precise = r.open_source === 'device';
                      const maxV = r.max_views || 1;
                      const usedV = r.views_used ?? (r.opened_at ? 1 : 0);
                      const extras = [
                        r.lock_email ? `Locked to ${r.lock_email}` : null,
                        r.open_after ? `Opens after ${fullDate(r.open_after)}` : null,
                        r.window_start != null && r.window_end != null ? `Only ${hhmm(r.window_start)}–${hhmm(r.window_end)}${r.window_tz ? ` ${tzLabel(r.window_tz)}` : ''}` : null,
                        r.allowed_countries?.length ? `Only from ${r.allowed_countries.map(c => countryName(c)).join(', ')}` : null,
                      ].filter(Boolean) as string[];
                      return (
                        <li key={r.id} id={`row-${r.id}`} className="hist-item">
                          <div className="hist-row">
                            <span className={`dash-type ${r.kind}`}><Icon name={r.kind === 'file' ? 'image' : 'key'} size={17} /></span>
                            <div className="dash-item">
                              <strong className={r.recipient ? '' : 'hist-norecip'}>
                                {r.recipient ? <>To {r.recipient}</> : 'No recipient noted'}
                              </strong>
                              <span title={fullDate(r.created_at)}>
                                {r.kind === 'file' ? `File${r.size ? ` · ${formatBytes(r.size)}` : ''}` : 'Text'}
                                {' · sent '}{rel(r.created_at)}
                                {maxV > 1 && ` · ${usedV} of ${maxV} views`}
                                {r.status === 'waiting' && ` · ${timeLeft(r.expires_at)}`}
                                {r.status === 'opened' && r.opened_at && ` · opened ${rel(r.last_opened_at || r.opened_at)}`}
                                {r.status === 'burned' && r.burned_at && ` · burned ${rel(r.burned_at)}`}
                              </span>
                              {extras.length > 0 && (
                                <span className="hist-extras">{extras.map(x => <em key={x}>{x}</em>)}</span>
                              )}
                              {r.share_location && (
                                hasMap ? (
                                  <button type="button" className="hist-place" onClick={() => setOpenMap(m => (m === r.id ? null : r.id))} aria-expanded={openMap === r.id}>
                                    <Icon name="pin" size={13} strokeWidth={2} />{where || 'View on map'}
                                    <span className={`hist-acc ${precise ? 'precise' : ''}`}>{precise ? `precise ±${dist(r.open_accuracy_m || 110)}` : 'approx. city'}</span>
                                    <em>{openMap === r.id ? 'Hide map' : 'Show map'}</em>
                                  </button>
                                ) : (
                                  <span className="hist-place muted"><Icon name="pin" size={13} strokeWidth={2} />
                                    {r.status === 'waiting' ? 'Location will show when opened' : r.status === 'opened' ? 'Location unavailable' : 'Never opened'}
                                  </span>
                                )
                              )}
                              {fenced && (
                                <button type="button" className="hist-place fence" onClick={() => setOpenMap(m => (m === r.id ? null : r.id))} aria-expanded={openMap === r.id}>
                                  <Icon name="lock" size={13} strokeWidth={2} />Geofenced · {dist(r.fence_radius_m as number)} around {r.fence_label || 'a set place'}
                                  {!hasMap && <em>{openMap === r.id ? 'Hide map' : 'Show area'}</em>}
                                </button>
                              )}
                              {burnRow?.id === r.id && <p className="burn-note" role="status">{burnRow.msg}</p>}
                            </div>
                            {r.status === 'waiting' && (
                              confirmBurn === r.id ? (
                                <span className="burn-confirm">
                                  <button type="button" className="danger" onClick={() => burnNow(r.id)} disabled={burning === r.id}>{burning === r.id ? 'Burning…' : 'Burn'}</button>
                                  <button type="button" onClick={() => setConfirmBurn(null)}>Keep</button>
                                </span>
                              ) : (
                                <button type="button" className="burn-btn" onClick={() => setConfirmBurn(r.id)} title="Destroy this link now">
                                  <Icon name="flame" size={13} strokeWidth={2.1} />Burn now
                                </button>
                              )
                            )}
                            <span className={`dash-chip ${r.status}`}>
                              {(r.status === 'opened' || r.status === 'burned') && <Icon name="flame" size={13} strokeWidth={2.1} />}
                              {r.status === 'waiting' && <Icon name="clock" size={13} strokeWidth={2.1} />}
                              {r.status === 'waiting' && usedV > 0 ? `Viewed ${usedV}/${maxV}` : STATUS_LABEL[r.status]}
                            </span>
                            <button type="button" className="hist-del" onClick={() => removeRow(r.id)} aria-label="Remove from history" title="Remove from history">
                              <Icon name="trash" size={15} />
                            </button>
                          </div>
                          {openMap === r.id && (hasMap || fenceRing) && (
                            <div className="hist-map">
                              {hasMap ? (
                                <OpenMap lat={r.open_lat as number} lon={r.open_lon as number} label={where} radiusMeters={r.open_accuracy_m || (precise ? 110 : 10000)} fence={fenceRing} />
                              ) : (
                                <OpenMap lat={fenceRing!.lat} lon={fenceRing!.lon} label={r.fence_label || 'Geofence'} radiusMeters={fenceRing!.radiusMeters} />
                              )}
                              <p className="dash-muted">
                                {hasMap
                                  ? (precise
                                    ? `From the viewer’s device, accurate to about ${dist(r.open_accuracy_m || 110)}. Opened ${r.opened_at ? fullDate(r.opened_at) : ''}.`
                                    : `Approximate city from the viewer’s network. Opened ${r.opened_at ? fullDate(r.opened_at) : ''}.`)
                                  : `Only opens within ${dist(r.fence_radius_m as number)} (+5%) of ${r.fence_label || 'this place'}.`}
                                {hasMap && fenceRing ? ' Dashed ring: the geofence.' : ''}
                              </p>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {rows && rows.length > 0 && (
                  confirmClear ? (
                    <div className="hist-confirm">
                      <span>Delete your whole history? Live links keep working (burn them first if needed).</span>
                      <button type="button" className="danger" onClick={clearAll}>Delete history</button>
                      <button type="button" onClick={() => setConfirmClear(false)}>Cancel</button>
                    </div>
                  ) : (
                    <button type="button" className="dash-clear" onClick={() => setConfirmClear(true)}>Clear history</button>
                  )
                )}
              </div>

              <RequestsPanel userId={user.id} onQuota={loadQuota} />
              </div>

              <aside className="dash-side">
                <AlertsPanel user={user} />

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
                  <Icon name="pin" size={20} />
                  <div>
                    <h3>See where it was opened</h3>
                    <p className="dash-muted">Turn on “Show me where it’s opened” when you create a secret. You’ll get the approximate city on a map. The viewer is told before they open it.</p>
                  </div>
                </div>

                <div className="dash-panel dash-secure">
                  <Icon name="shield" size={20} />
                  <div>
                    <h3>Zero-knowledge by design</h3>
                    <p className="dash-muted">Secrets are encrypted in your browser with AES-256-GCM. OnePeek can see whether a secret was opened, never what it says.</p>
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
