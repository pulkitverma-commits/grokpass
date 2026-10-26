'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { importKey, decryptJson, decryptText, decryptBytes, type SecretHeader } from '@/lib/crypto';
import Icon from '@/app/components/Icon';

type Phase = 'loading' | 'ready' | 'opening' | 'revealed' | 'vanished' | 'error';

function formatDistance(m: number) {
  return m < 1000 ? `${Math.max(1, Math.round(m))} m` : `${+(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

function formatBytes(n?: number) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function RevealPage() {
  const params = useParams();
  const id = String(params?.id || '');
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [header, setHeader] = useState<SecretHeader | null>(null);
  const [text, setText] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [remaining, setRemaining] = useState(0);
  const [fading, setFading] = useState(false);
  const [sharesLocation, setSharesLocation] = useState(false);
  const [fence, setFence] = useState<{ radius: number; label: string | null } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoMsg, setGeoMsg] = useState('');
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
      const row = Array.isArray(data) ? data[0] : null;
      if (peekErr || !row) {
        setError('This secret has already been opened, or it has expired.');
        setPhase('error');
        return;
      }
      try {
        setHeader(await decryptJson<SecretHeader>(keyRef.current, row.header));
        setSharesLocation(!!row.share_location);
        if (row.fence_radius_m) setFence({ radius: row.fence_radius_m, label: row.fence_label || null });
        setPhase('ready');
      } catch {
        setError('This link’s key doesn’t match the secret. Ask the sender to share it again.');
        setPhase('error');
      }
    })();
  }, [id]);

  // Wipe decrypted data from memory when leaving the page.
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  function getDevicePosition(): Promise<{ lat: number; lon: number; accuracy: number }> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('unsupported')); return; }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        err => reject(err),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
      );
    });
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
    let row: { body?: string | null; file_path?: string | null } | null = null;
    try {
      const res = await fetch('/api/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, precise }) });
      if (res.status === 403) {
        const info = await res.json().catch(() => ({})) as { error?: string; meters?: number | null };
        if (info.error === 'geofence_outside') {
          setGeoMsg(`You’re about ${formatDistance(info.meters || 0)} outside the area where this secret can be opened. Move closer and try again. Nothing has been opened or deleted.`);
        } else if (info.error === 'geofence_imprecise') {
          setGeoMsg(`Your location is too rough to check (±${formatDistance(info.meters || 0)}). Turn on precise location or GPS and try again.`);
        } else {
          setGeoMsg('We couldn’t confirm your location. Allow location access and try again.');
        }
        setPhase('ready');
        return;
      }
      if (res.ok) row = await res.json();
    } catch { /* handled below */ }
    // Drop the key from the address bar so it isn't left in history.
    history.replaceState(null, '', window.location.pathname);
    if (!row) {
      setError('This secret has already been opened, or it has expired.');
      setPhase('error');
      return;
    }
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
        // Ciphertext is no longer needed anywhere: delete it from storage now.
        supabase.storage.from('secrets').remove([row.file_path]).catch(() => {});
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

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#0A0C0F' }}>
      <div className="bg-layer" aria-hidden="true">
        <div className="gp-grid" />
        <div className="gp-glow gp-glow-a" />
        <div className="gp-glow gp-glow-b" />
        <div className="gp-scan" />
      </div>

      <header className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', position: 'relative', zIndex: 10 }}>
        <Link href="/" className="logo" aria-label="OnePass home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/onepass-logo.png" alt="OnePass" className="logo-img" width={139} height={56} />
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
              <span>one-time secret · AES-256-GCM</span>
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
                  OnePass secrets can be opened only once. After that, they’re permanently deleted.
                </p>
                <Link href="/" className="gp-btn" style={{ justifyContent: 'center', textDecoration: 'none', marginTop: 8 }}>
                  Send a new secret
                </Link>
              </>
            )}

            {(phase === 'ready' || phase === 'opening') && header && (
              <>
                <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 400, color: '#F4F5F6' }}>Someone sent you a secret</h2>
                <div className="reveal-meta">
                  <span className="reveal-chip">{header.type === 'file' ? (isImage ? 'Image' : 'File') : 'Text'}</span>
                  {header.type === 'file' && header.size ? <span className="reveal-chip">{formatBytes(header.size)}</span> : null}
                  {timer > 0 && <span className="reveal-chip accent"><Icon name="clock" size={13} strokeWidth={2} />vanishes {timer}s after opening</span>}
                  <span className="reveal-chip">1 view</span>
                  {sharesLocation && <span className="reveal-chip loc"><Icon name="pin" size={13} strokeWidth={2} />shares location</span>}
                  {fence && <span className="reveal-chip loc"><Icon name="lock" size={13} strokeWidth={2} />geofenced · {formatDistance(fence.radius)}</span>}
                </div>
                <p style={{ color: '#C9CED6', margin: 0, fontSize: '0.95rem' }}>
                  It will be decrypted in your browser. As soon as you open it, it’s deleted from OnePass — this link won’t work again.
                  {timer > 0 && ` You’ll have ${timer} second${timer === 1 ? '' : 's'} to view it.`}
                </p>
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
                {geoMsg && <p className="warning" role="alert" style={{ margin: 0 }}>{geoMsg}</p>}
                {sharesLocation && !fence ? (
                  <div className="reveal-actions">
                    <button className="gp-btn" onClick={() => reveal('precise')} disabled={phase === 'opening'} style={{ justifyContent: 'center' }}>
                      {phase === 'opening' ? (locating ? 'Getting your location…' : 'Decrypting…') : 'Reveal & share precise location'}
                    </button>
                    <button className="gp-btn gp-ghost" onClick={() => reveal('approx')} disabled={phase === 'opening'} style={{ justifyContent: 'center' }}>
                      Reveal with approximate location
                    </button>
                  </div>
                ) : (
                  <button className="gp-btn" onClick={() => reveal(fence ? 'precise' : 'approx')} disabled={phase === 'opening'} style={{ width: '100%', justifyContent: 'center' }}>
                    {phase === 'opening' ? (locating ? 'Checking your location…' : 'Decrypting…') : fence ? 'Check my location & reveal' : 'Reveal secret'}
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
                  {header.type === 'text' && (
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#0A0C0F', border: '1px solid #262C35', borderRadius: 10, padding: 16, fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 14, color: '#E6E8EB', margin: 0, maxHeight: '50vh', overflow: 'auto' }}>
                      {text}
                    </pre>
                  )}
                  {header.type === 'text' && (
                    <button className="gp-btn gp-ghost" onClick={() => navigator.clipboard.writeText(text)} style={{ justifyContent: 'center' }}>
                      Copy secret
                    </button>
                  )}

                  {header.type === 'file' && fileUrl && isImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileUrl} alt={header.name || 'Secret image'} className="reveal-image" draggable={false} onContextMenu={e => e.preventDefault()} />
                  )}
                  {header.type === 'file' && fileUrl && !isImage && (
                    <div className="file-card">
                      <Icon name="file" size={24} style={{ color: '#A3ABB6' }} />
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ color: '#F4F5F6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{header.name}</span>
                        <span style={{ color: '#8A93A0', fontSize: 13 }}>{formatBytes(header.size)}</span>
                      </div>
                    </div>
                  )}
                  {header.type === 'file' && fileUrl && (
                    <a href={fileUrl} download={header.name || 'secret-file'} className="gp-btn" style={{ justifyContent: 'center', textDecoration: 'none' }}>
                      Download {isImage ? 'image' : 'file'}
                    </a>
                  )}
                </div>

                <p className="warning" style={{ margin: 0 }}>
                  This secret has been deleted from OnePass. The link won’t work again.
                </p>
              </>
            )}

            {phase === 'vanished' && (
              <>
                <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 400, color: '#F4F5F6' }}>The secret has vanished</h2>
                <p style={{ color: '#A3ABB6', fontSize: '0.95rem', margin: 0 }}>
                  The viewing time set by the sender ran out. It’s gone from this page and from OnePass.
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
          <span>© {new Date().getFullYear()} OnePass</span>
          <span style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 12.5 }}>encrypted in your browser · AES-GCM</span>
        </div>
      </footer>
    </div>
  );
}
