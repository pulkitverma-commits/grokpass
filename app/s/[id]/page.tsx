'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { importKey, decryptJson, decryptText, decryptBytes, wifiQrPayload, type SecretHeader, type WifiSecret } from '@/lib/crypto';
import { countryName, countryFlag } from '@/lib/countries';
import Icon from '@/app/components/Icon';
import { tzLabel } from '@/lib/time';
import { bestPosition } from '@/lib/geo';
import QrCode from '@/app/components/QrCode';

type Phase = 'loading' | 'ready' | 'opening' | 'revealed' | 'vanished' | 'error';
type Peek = {
  header: string; share_location?: boolean; fence_radius_m?: number | null; fence_label?: string | null;
  max_views?: number | null; views_left?: number | null; lock_hint?: string | null;
  open_after?: string | null; window_start?: number | null; window_end?: number | null; window_tz?: string | null;
  allowed_countries?: string[] | null;
};

function formatDistance(m: number) {
  return m < 1000 ? `${Math.max(1, Math.round(m))} m` : `${+(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

function formatBytes(n?: number) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function hhmm(min: number) {
  const d = new Date(2000, 0, 1, Math.floor(min / 60), min % 60);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function untilText(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export default function RevealPage() {
  const params = useParams();
  const id = String(params?.id || '');
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [header, setHeader] = useState<SecretHeader | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [text, setText] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [remaining, setRemaining] = useState(0);
  const [fading, setFading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoMsg, setGeoMsg] = useState('');
  const [now, setNow] = useState(Date.now());
  const [fixAcc, setFixAcc] = useState<number | null>(null);
  // Recipient lock
  const [lockEmail, setLockEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [lockBusy, setLockBusy] = useState(false);
  const [lockMsg, setLockMsg] = useState('');
  const [unlockToken, setUnlockToken] = useState('');
  // After opening
  const [viewsLeft, setViewsLeft] = useState(0);
  const [finalView, setFinalView] = useState(true);
  const [watermark, setWatermark] = useState('');
  const [holding, setHolding] = useState(false);
  const [shielded, setShielded] = useState(false);
  const [copied, setCopied] = useState(false);
  const keyRef = useRef<CryptoKey | null>(null);
  const urlRef = useRef('');

  // Load: read the key from the #fragment and peek at the (encrypted) header. Peeking does not burn.
  useEffect(() => {
    (async () => {
      const keyB64 = window.location.hash.slice(1);
      if (!id || !keyB64) {
        setError('This link is incomplete. Ask the sender to share the full link.');
        setPhase('error');
        return;
      }
      if (!supabase) {
        setError('Secure storage is not configured.');
        setPhase('error');
        return;
      }
      try {
        keyRef.current = await importKey(keyB64);
      } catch {
        setError('This link is damaged. Ask the sender to share it again.');
        setPhase('error');
        return;
      }
      const { data, error: peekErr } = await supabase.rpc('peek_secret', { p_id: id });
      const row = (Array.isArray(data) ? data[0] : null) as Peek | null;
      if (peekErr || !row) {
        setError('This secret has already been opened, or it has expired.');
        setPhase('error');
        return;
      }
      try {
        setHeader(await decryptJson<SecretHeader>(keyRef.current, row.header));
        setPeek(row);
        setPhase('ready');
      } catch {
        setError('This link’s key doesn’t match the secret. Ask the sender to share it again.');
        setPhase('error');
      }
    })();
  }, [id]);

  // Wipe decrypted data from memory when leaving the page.
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  // Tick for the time-lock countdown.
  const openAfterMs = peek?.open_after ? Date.parse(peek.open_after) : 0;
  useEffect(() => {
    if (phase !== 'ready' || !openAfterMs || openAfterMs <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase, openAfterMs]);

  // Guard mode: re-blur whenever the page loses focus.
  useEffect(() => {
    if (!header?.guard) return;
    const off = () => setHolding(false);
    window.addEventListener('blur', off);
    document.addEventListener('visibilitychange', off);
    return () => { window.removeEventListener('blur', off); document.removeEventListener('visibilitychange', off); };
  }, [header]);

  // Screen shield: while a secret is on screen, hide it whenever the page loses focus, the tab
  // is hidden (app switcher, screen recorders that steal focus) or a screenshot shortcut is
  // pressed. A website can't block screenshots outright; this makes them much harder.
  useEffect(() => {
    if (phase !== 'revealed') return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const hide = (ms?: number) => { setShielded(true); if (t) clearTimeout(t); if (ms) t = setTimeout(() => { if (document.hasFocus()) setShielded(false); }, ms); };
    const onBlur = () => hide();
    const onFocus = () => setShielded(false);
    const onVis = () => (document.hidden ? hide() : document.hasFocus() && setShielded(false));
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      const shot = k === 'PrintScreen' || k === 'Snapshot'
        || ((e.metaKey || k === 'Meta' || k === 'OS') && e.shiftKey)   // macOS Cmd+Shift+3/4/5, Windows Win+Shift+S
        || (e.ctrlKey && e.shiftKey && /^[sS]$/.test(k));
      if (!shot) return;
      hide(3000);
      if (k === 'PrintScreen' || k === 'Snapshot') navigator.clipboard?.writeText('').catch(() => {});
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, [phase]);

  const sharesLocation = !!peek?.share_location;
  const fence = peek?.fence_radius_m ? { radius: peek.fence_radius_m, label: peek.fence_label || null } : null;
  const maxViews = peek?.max_views || 1;
  const peekViewsLeft = peek?.views_left ?? 1;
  const lockHint = peek?.lock_hint || null;
  const waiting = openAfterMs > now;
  const windowText = peek?.window_start != null && peek?.window_end != null
    ? `${hhmm(peek.window_start)}–${hhmm(peek.window_end)}${peek.window_tz ? ` (${tzLabel(peek.window_tz)})` : ''}`
    : '';
  const countries = peek?.allowed_countries || [];

  // GPS-level fix: watch for up to 10 s and keep the most accurate reading (≤ 20 m stops early).
  function getDevicePosition() {
    setFixAcc(null);
    return bestPosition({ timeoutMs: 10000, goodEnough: 20, onUpdate: f => setFixAcc(Math.round(f.accuracy)) });
  }

  async function sendCode() {
    setLockMsg('');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lockEmail.trim())) { setLockMsg('Enter your email address.'); return; }
    setLockBusy(true);
    try {
      const res = await fetch('/api/unlock/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, email: lockEmail.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setCodeSent(true); setLockMsg('If that’s the address the sender chose, a 6-digit code is on its way. Check your inbox and spam folder.'); }
      else if (data.error === 'wait') setLockMsg('Please wait 30 seconds before asking for another code.');
      else if (data.error === 'too_many') setLockMsg('Too many codes were requested for this secret. Ask the sender for a new link.');
      else if (data.error === 'not_configured') setLockMsg('Email codes aren’t available right now. Please try again later.');
      else if (data.error === 'gone') { setError('This secret has already been opened, or it has expired.'); setPhase('error'); }
      else setLockMsg('We couldn’t send a code. Please try again.');
    } catch { setLockMsg('We couldn’t send a code. Check your connection and try again.'); }
    setLockBusy(false);
  }

  async function verifyCode() {
    setLockMsg('');
    setLockBusy(true);
    try {
      const res = await fetch('/api/unlock/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, code }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) { setUnlockToken(data.token); setLockMsg(''); }
      else if (data.error === 'wrong_code') setLockMsg(`That code isn’t right. ${data.left} ${data.left === 1 ? 'try' : 'tries'} left.`);
      else if (data.error === 'too_many') { setLockMsg('Too many wrong codes. Ask for a new code.'); setCodeSent(false); setCode(''); }
      else if (data.error === 'expired') { setLockMsg('That code has expired. Ask for a new one.'); setCodeSent(false); setCode(''); }
      else setLockMsg('We couldn’t check the code. Please try again.');
    } catch { setLockMsg('We couldn’t check the code. Check your connection and try again.'); }
    setLockBusy(false);
  }

  async function reveal(mode: 'precise' | 'approx' = 'approx') {
    if (!supabase || !keyRef.current || !header) return;
    setGeoMsg('');
    setPhase('opening');
    let precise: { lat: number; lon: number; accuracy: number } | null = null;
    if (fence || mode === 'precise') {
      setLocating(true);
      try { precise = await getDevicePosition(); } catch { precise = null; }
      setLocating(false);
      if (!precise && fence) {
        setGeoMsg('This secret only opens inside a set area, so we need your location. Allow location access for this site and try again. Nothing has been opened or deleted.');
        setPhase('ready');
        return;
      }
    }
    let row: { body?: string | null; file_path?: string | null; views_left?: number; final?: boolean; viewer_place?: string | null } | null = null;
    try {
      const res = await fetch('/api/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, precise, unlockToken: unlockToken || undefined }) });
      if (res.status === 403) {
        const info = await res.json().catch(() => ({})) as { error?: string; meters?: number | null; at?: number | null; country?: string | null };
        const kept = ' Nothing has been opened or deleted.';
        switch (info.error) {
          case 'geofence_outside': setGeoMsg(`You’re about ${formatDistance(info.meters || 0)} outside the area where this secret can be opened. Move closer and try again.${kept}`); break;
          case 'geofence_imprecise': setGeoMsg(`Your location is too rough to check (±${formatDistance(info.meters || 0)}). Turn on precise location or GPS and try again.`); break;
          case 'timelock_until': setGeoMsg(`This secret can’t be opened yet. It unlocks ${info.at ? new Date(info.at).toLocaleString() : 'later'}.${kept}`); break;
          case 'timelock_window': setGeoMsg(`This secret only opens ${windowText ? `between ${windowText}` : 'during set hours'}. Try again then.${kept}`); break;
          case 'country_blocked': setGeoMsg(`This secret can’t be opened from ${info.country ? countryName(info.country) : 'where you are'}. If you’re using a VPN, turn it off and try again.${kept}`); break;
          case 'recipient_locked': setUnlockToken(''); setCodeSent(false); setCode(''); setGeoMsg(`Confirm your email with a new code first.${kept}`); break;
          default: setGeoMsg(`We couldn’t confirm your location. Allow location access and try again.${kept}`);
        }
        setPhase('ready');
        return;
      }
      if (res.ok) row = await res.json();
      else if (res.status !== 404) {
        // Server or network trouble: nothing was opened or burned, so keep the key and let them retry.
        setGeoMsg('We couldn’t open this secret right now. Nothing has been opened or deleted. Please try again in a moment.');
        setPhase('ready');
        return;
      }
    } catch {
      setGeoMsg('We couldn’t reach OnePeek. Check your connection and try again. Nothing has been opened or deleted.');
      setPhase('ready');
      return;
    }
    // Drop the key from the address bar so it isn't left in history.
    history.replaceState(null, '', window.location.pathname);
    if (!row) {
      setError('This secret has already been opened, or it has expired.');
      setPhase('error');
      return;
    }
    const isFinal = row.final !== false;
    setFinalView(isFinal);
    setViewsLeft(row.views_left || 0);
    const stamp = new Date().toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    setWatermark(`${(unlockToken && lockEmail.trim()) || row.viewer_place || 'OnePeek viewer'} · ${stamp}`);
    try {
      if (row.body) {
        setText(await decryptText(keyRef.current, row.body));
      } else if (row.file_path) {
        const { data: blob, error: dlErr } = await supabase.storage.from('secrets').download(row.file_path);
        if (dlErr || !blob) throw new Error('download');
        const plain = await decryptBytes(keyRef.current, new Uint8Array(await blob.arrayBuffer()));
        const url = URL.createObjectURL(new Blob([plain], { type: header.mime || 'application/octet-stream' }));
        urlRef.current = url;
        setFileUrl(url);
        // Last view: the ciphertext isn't needed anywhere any more, so delete it now.
        if (isFinal) supabase.storage.from('secrets').remove([row.file_path]).catch(() => {});
      }
      setPhase('revealed');
      if (header.timer && header.timer > 0) setRemaining(header.timer);
    } catch {
      setError('We couldn’t decrypt this secret. The link may be damaged.');
      setPhase('error');
    }
  }

  // Viewer timer: count down, then make the secret vanish.
  useEffect(() => {
    if (phase !== 'revealed' || !header?.timer) return;
    if (remaining <= 0) {
      setFading(true);
      const t = setTimeout(() => {
        setText('');
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = '';
        setFileUrl('');
        setFading(false);
        setPhase('vanished');
      }, 600);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setRemaining(r => r - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, remaining, header]);

  const isImage = !!header?.mime?.startsWith('image/');
  const timer = header?.timer || 0;
  const low = timer > 0 && remaining <= Math.min(5, Math.ceil(timer / 3));
  const guard = !!header?.guard;
  const noCopy = !!header?.noCopy;
  const noSave = !!header?.noSave && !!header?.mime?.startsWith('image/');
  const blockCopy = noCopy ? { onCopy: (e: React.ClipboardEvent) => e.preventDefault(), onCut: (e: React.ClipboardEvent) => e.preventDefault(), onContextMenu: (e: React.MouseEvent) => e.preventDefault(), onDragStart: (e: React.DragEvent) => e.preventDefault() } : {};
  const needsCode = !!lockHint && !unlockToken;
  let wifi: WifiSecret | null = null;
  if (header?.tpl === 'wifi' && text) { try { wifi = JSON.parse(text) as WifiSecret; } catch { wifi = null; } }

  const holdProps = guard ? {
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); setHolding(true); },
    onPointerUp: () => setHolding(false),
    onPointerLeave: () => setHolding(false),
    onPointerCancel: () => setHolding(false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setHolding(true); } },
    onKeyUp: () => setHolding(false),
    tabIndex: 0,
    role: 'button',
    'aria-label': 'Press and hold to reveal',
  } : {};

  const content = (
    <>
      {header?.type === 'text' && !wifi && (
        <pre className="secret-text">{text}</pre>
      )}
      {wifi && (
        <div className="wifi-card">
          <div className="wifi-rows">
            <div><span>Network</span><strong>{wifi.ssid}</strong></div>
            {wifi.security !== 'nopass' && <div><span>Password</span><strong className="mono">{wifi.password}</strong></div>}
            <div><span>Security</span><strong>{wifi.security === 'nopass' ? 'Open network' : wifi.security}{wifi.hidden ? ' · hidden' : ''}</strong></div>
          </div>
          <QrCode value={wifiQrPayload(wifi)} size={180} label="Scan with your phone camera to join" />
        </div>
      )}
      {header?.type === 'file' && fileUrl && isImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fileUrl} alt={header.name || 'Secret image'} className="reveal-image" draggable={false} onContextMenu={e => e.preventDefault()} />
      )}
      {header?.type === 'file' && fileUrl && !isImage && (
        <div className="file-card">
          <Icon name="file" size={24} style={{ color: '#A3ABB6' }} />
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ color: '#F4F5F6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{header.name}</span>
            <span style={{ color: '#8A93A0', fontSize: 13 }}>{formatBytes(header.size)}</span>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#0A0C0F' }}>
      <div className="bg-layer" aria-hidden="true">
        <div className="gp-grid" />
        <div className="gp-glow gp-glow-a" />
        <div className="gp-glow gp-glow-b" />
        <div className="gp-scan" />
      </div>

      <header className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', position: 'relative', zIndex: 10 }}>
        <Link href="/" className="logo" aria-label="OnePeek home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/onepeek-logo.png" alt="OnePeek" className="logo-img" width={149} height={56} />
        </Link>
        <Link href="/" className="gp-btn gp-ghost" style={{ textDecoration: 'none' }}>
          Send your own →
        </Link>
      </header>

      <main style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 80px)', padding: '40px 24px' }}>
        <div className="tool-card" style={{ width: '100%', maxWidth: 620 }}>
          <div className="tool-header">
            <div className="dots"><span /><span /><span /></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="lock" size={13} strokeWidth={2} />
              <span>{maxViews > 1 ? 'limited-view secret' : 'one-time secret'} · AES-256-GCM</span>
            </div>
          </div>

          <div className="tool-body" style={{ gap: 18 }}>
            {(phase === 'loading') && (
              <p style={{ color: '#A3ABB6', textAlign: 'center', margin: 0 }}>Checking your link…</p>
            )}

            {phase === 'error' && (
              <>
                <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 400, color: '#F4F5F6' }}>Nothing to reveal</h2>
                <p className="warning" style={{ margin: 0 }}>{error}</p>
                <p style={{ color: '#A3ABB6', fontSize: '0.95rem', margin: 0 }}>
                  OnePeek secrets can be opened a set number of times. After that, they’re permanently deleted.
                </p>
                <Link href="/" className="gp-btn" style={{ justifyContent: 'center', textDecoration: 'none', marginTop: 8 }}>
                  Send a new secret
                </Link>
              </>
            )}

            {(phase === 'ready' || phase === 'opening') && header && (
              <>
                <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 400, color: '#F4F5F6' }}>Someone sent you {header.tpl === 'wifi' ? 'Wi-Fi details' : 'a secret'}</h2>
                <div className="reveal-meta">
                  <span className="reveal-chip">{header.tpl === 'wifi' ? <><Icon name="wifi" size={13} strokeWidth={2} />Wi-Fi</> : header.type === 'file' ? (isImage ? 'Image' : 'File') : 'Text'}</span>
                  {header.type === 'file' && header.size ? <span className="reveal-chip">{formatBytes(header.size)}</span> : null}
                  {timer > 0 && <span className="reveal-chip accent"><Icon name="clock" size={13} strokeWidth={2} />vanishes {timer}s after opening</span>}
                  <span className="reveal-chip">{maxViews > 1 ? `${peekViewsLeft} of ${maxViews} views left` : '1 view'}</span>
                  {lockHint && <span className="reveal-chip loc"><Icon name="user" size={13} strokeWidth={2} />recipient only</span>}
                  {peek?.open_after && <span className="reveal-chip loc"><Icon name="clock" size={13} strokeWidth={2} />{waiting ? `opens in ${untilText(openAfterMs - now)}` : 'time-locked'}</span>}
                  {windowText && <span className="reveal-chip loc"><Icon name="clock" size={13} strokeWidth={2} />{windowText}</span>}
                  {countries.length > 0 && <span className="reveal-chip loc"><Icon name="globe" size={13} strokeWidth={2} />{countries.length <= 3 ? countries.map(c => `${countryFlag(c)} ${c}`).join(' ') : `${countries.length} countries`}</span>}
                  {guard && <span className="reveal-chip"><Icon name="eye" size={13} strokeWidth={2} />hold to view</span>}
                  {sharesLocation && <span className="reveal-chip loc"><Icon name="pin" size={13} strokeWidth={2} />shares location</span>}
                  {fence && <span className="reveal-chip loc"><Icon name="lock" size={13} strokeWidth={2} />geofenced · {formatDistance(fence.radius)}</span>}
                </div>
                <p style={{ color: '#C9CED6', margin: 0, fontSize: '0.95rem' }}>
                  It will be decrypted in your browser. {maxViews > 1
                    ? `This link can be opened ${peekViewsLeft} more time${peekViewsLeft === 1 ? '' : 's'}, then it’s deleted from OnePeek.`
                    : 'As soon as you open it, it’s deleted from OnePeek — this link won’t work again.'}
                  {timer > 0 && ` You’ll have ${timer} second${timer === 1 ? '' : 's'} to view it.`}
                </p>

                {(windowText || countries.length > 0) && (
                  <p className="loc-notice">
                    <Icon name="lock" size={15} strokeWidth={2} />
                    <span>
                      {windowText && <>Opens only between <strong>{windowText}</strong>. </>}
                      {countries.length > 0 && <>Opens only from {countries.map(c => countryName(c)).join(', ')}.</>}
                    </span>
                  </p>
                )}
                {fence && (
                  <p className="loc-notice fence">
                    <Icon name="lock" size={15} strokeWidth={2} />
                    <span><strong>Locked to an area.</strong> This secret only opens within {formatDistance(fence.radius)} of {fence.label || 'a location set by the sender'}. Your browser will ask for your location to check.{sharesLocation ? ' The sender will also see where it was opened.' : ' Your location is only used for this check.'}</span>
                  </p>
                )}
                {sharesLocation && !fence && (
                  <p className="loc-notice">
                    <Icon name="pin" size={15} strokeWidth={2} />
                    <span>The sender asked to see where this is opened. You choose how: your precise location (your browser will ask), or just an approximate city from your network.</span>
                  </p>
                )}

                {needsCode && (
                  <div className="lock-step">
                    <p><Icon name="user" size={15} strokeWidth={2} /><span>This secret is for <strong>{lockHint}</strong>. Confirm it’s you with a one-time code.</span></p>
                    {!codeSent ? (
                      <div className="lock-row">
                        <input className="field-input" type="email" inputMode="email" autoComplete="email" placeholder="Your email address" value={lockEmail} onChange={e => setLockEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') sendCode(); }} aria-label="Your email address" />
                        <button type="button" className="gp-btn" onClick={sendCode} disabled={lockBusy || !lockEmail.trim()}>{lockBusy ? 'Sending…' : 'Email me a code'}</button>
                      </div>
                    ) : (
                      <div className="lock-row">
                        <input className="field-input mono code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={e => { if (e.key === 'Enter' && code.length === 6) verifyCode(); }} aria-label="6-digit code" />
                        <button type="button" className="gp-btn" onClick={verifyCode} disabled={lockBusy || code.length !== 6}>{lockBusy ? 'Checking…' : 'Confirm'}</button>
                        <button type="button" className="dash-ghost" onClick={() => { setCodeSent(false); setCode(''); setLockMsg(''); }}>Use another email</button>
                      </div>
                    )}
                    {lockMsg && <p className="field-hint" role="status">{lockMsg}</p>}
                  </div>
                )}
                {lockHint && unlockToken && (
                  <p className="loc-notice ok"><Icon name="check" size={15} strokeWidth={2} /><span>Email confirmed. You can open the secret now.</span></p>
                )}

                {geoMsg && <p className="warning" role="alert" style={{ margin: 0 }}>{geoMsg}</p>}
                {waiting ? (
                  <button className="gp-btn" disabled style={{ width: '100%', justifyContent: 'center' }}>
                    Opens in {untilText(openAfterMs - now)}
                  </button>
                ) : sharesLocation && !fence ? (
                  <div className="reveal-actions">
                    <button className="gp-btn" onClick={() => reveal('precise')} disabled={phase === 'opening' || needsCode} style={{ justifyContent: 'center' }}>
                      {phase === 'opening' ? (locating ? `Getting a precise fix…${fixAcc ? ` ±${fixAcc} m` : ''}` : 'Decrypting…') : 'Reveal & share precise location'}
                    </button>
                    <button className="gp-btn gp-ghost" onClick={() => reveal('approx')} disabled={phase === 'opening' || needsCode} style={{ justifyContent: 'center' }}>
                      Reveal with approximate location
                    </button>
                  </div>
                ) : (
                  <button className="gp-btn" onClick={() => reveal(fence ? 'precise' : 'approx')} disabled={phase === 'opening' || needsCode} style={{ width: '100%', justifyContent: 'center' }}>
                    {phase === 'opening' ? (locating ? `Checking your location…${fixAcc ? ` ±${fixAcc} m` : ''}` : 'Decrypting…') : fence ? 'Check my location & reveal' : 'Reveal secret'}
                  </button>
                )}
              </>
            )}

            {phase === 'revealed' && header && (
              <>
                {timer > 0 && (
                  <div className="countdown" role="timer" aria-live="polite">
                    <div className="countdown-row">
                      <span>Vanishes in</span>
                      <strong className={low ? 'low' : ''}>{Math.max(0, remaining)}s</strong>
                    </div>
                    <div className="countdown-track">
                      <div className={`countdown-fill ${low ? 'low' : ''}`} style={{ width: `${(Math.max(0, remaining) / timer) * 100}%` }} />
                    </div>
                  </div>
                )}

                <div className={fading ? 'vanishing' : ''} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className={`shield${shielded ? ' shielded' : ''}${noCopy ? ' no-copy' : ''}`} {...blockCopy}>
                    <div className="shield-inner">
                      {guard ? (
                        <div className={`guard ${holding ? 'show' : ''}`} {...holdProps}>
                          <div className="guard-content">{content}</div>
                          <div className="guard-mark" aria-hidden="true">
                            {Array.from({ length: 18 }).map((_, i) => <span key={i}>{watermark}</span>)}
                          </div>
                          {!holding && <div className="guard-hint"><Icon name="eye" size={16} strokeWidth={2} />Press and hold to view</div>}
                        </div>
                      ) : content}
                    </div>
                    <div className="shield-cover" aria-live="polite" onClick={() => setShielded(false)}>
                      <Icon name="eye" size={16} strokeWidth={2} />
                      <span>Hidden while this page isn’t in front. Click here to show it again.</span>
                    </div>
                  </div>

                  {(noCopy || noSave) && (
                    <p className="field-hint" style={{ margin: 0 }}>
                      The sender turned off {noCopy && noSave ? 'copying and downloading' : noCopy ? 'copying' : 'downloading'} for this secret.
                    </p>
                  )}

                  {header.type === 'text' && !noCopy && (
                    <button className="gp-btn gp-ghost" onClick={() => { navigator.clipboard.writeText(wifi ? (wifi.password || wifi.ssid) : text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }} style={{ justifyContent: 'center' }}>
                      <Icon name="copy" size={15} strokeWidth={2} />{copied ? 'Copied' : wifi ? 'Copy password' : 'Copy secret'}
                    </button>
                  )}
                  {header.type === 'file' && fileUrl && !(guard && isImage) && !noSave && (
                    <a href={fileUrl} download={header.name || 'secret-file'} className="gp-btn" style={{ justifyContent: 'center', textDecoration: 'none' }}>
                      Download {isImage ? 'image' : 'file'}
                    </a>
                  )}
                </div>

                <p className="warning" style={{ margin: 0 }}>
                  {finalView
                    ? 'This secret has been deleted from OnePeek. The link won’t work again.'
                    : `This link can be opened ${viewsLeft} more time${viewsLeft === 1 ? '' : 's'}. After that it’s deleted.`}
                </p>
              </>
            )}

            {phase === 'vanished' && (
              <>
                <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 400, color: '#F4F5F6' }}>The secret has vanished</h2>
                <p style={{ color: '#A3ABB6', fontSize: '0.95rem', margin: 0 }}>
                  The viewing time set by the sender ran out. It’s gone from this page{finalView ? ' and from OnePeek' : ''}.
                </p>
                <Link href="/" className="gp-btn gp-ghost" style={{ justifyContent: 'center', textDecoration: 'none' }}>
                  Send your own secret
                </Link>
              </>
            )}
          </div>
        </div>
      </main>

      <footer style={{ position: 'relative', zIndex: 1, borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(10,12,15,0.85)', padding: '24px 0' }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, fontSize: 13.5, color: '#8A93A0' }}>
          <span>© {new Date().getFullYear()} OnePeek</span>
          <Link href="/encryption" style={{ color: '#8A93A0' }}>How our encryption works</Link>
        </div>
      </footer>
    </div>
  );
}
