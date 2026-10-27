'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import ProcessAnim from './components/ProcessAnim';
import LimitModal from './components/LimitModal';
import Icon from './components/Icon';
import TypeWord from './components/TypeWord';
import { getClientId, captureRef, isPaid, PLAN_NAME, type Quota } from '@/lib/quota';
import UserAvatar from './components/UserAvatar';
import GeofencePicker, { type Geofence } from './components/GeofencePicker';
import MoreControls, { DEFAULT_CONTROLS, toMinutes, type Controls } from './components/MoreControls';
import { localTz, offsetTz } from '@/lib/time';
import QrCode from './components/QrCode';
import {
  newKey, encryptBytes, encryptJson, encryptText, randomToken,
  MAX_FILE_BYTES, MAX_TEXT_CHARS, type SecretHeader, type WifiSecret,
} from '@/lib/crypto';

const EXPIRIES = [
  { id: '1h', label: '1 hour', seconds: 3600 },
  { id: '24h', label: '24 hours', seconds: 86400 },
  { id: '7d', label: '7 days', seconds: 604800 },
];
const VIEWS = [1, 2, 3, 5, 10];
const FREE_MAX_TTL = 604800;
const PLUS_MAX_TTL = 2592000;

function toLocalInput(ms: number) {
  const d = new Date(ms);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

const TIMERS = [
  { id: 0, label: 'Off' },
  { id: 10, label: '10s' },
  { id: 30, label: '30s' },
  { id: 60, label: '60s' },
];

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [mode, setMode] = useState<'text' | 'file' | 'wifi'>('text');
  const [wifi, setWifi] = useState<WifiSecret>({ ssid: '', password: '', security: 'WPA', hidden: false });
  const [views, setViews] = useState(1);
  const [customExpiry, setCustomExpiry] = useState('');
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS);
  const [showQr, setShowQr] = useState(false);
  const [linkViews, setLinkViews] = useState(1);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [expiry, setExpiry] = useState('24h');
  const [timerMode, setTimerMode] = useState<number | 'custom'>(0);
  const [customSeconds, setCustomSeconds] = useState('20');
  const [copied, setCopied] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [showLimit, setShowLimit] = useState(false);
  const refCode = useRef<string | null>(null);
  const [link, setLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [sending, setSending] = useState(false);
  const [emailMsg, setEmailMsg] = useState('');
  const [recipient, setRecipient] = useState('');
  const [shareLoc, setShareLoc] = useState(false);
  const [geofence, setGeofence] = useState<Geofence | null>(null);
  const [fenceOn, setFenceOn] = useState(false);
  const [lastSecret, setLastSecret] = useState<{ id: string; recipient: string } | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [slackCopied, setSlackCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    }
  }, []);

  async function loadQuota() {
    if (!supabase) return null;
    const { data } = await supabase.rpc('get_quota', { p_client_id: getClientId(), p_ref: refCode.current });
    const q = (Array.isArray(data) ? data[0] : null) as Quota | null;
    if (q) setQuota(q);
    return q;
  }

  useEffect(() => { setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function'); }, []);

  useEffect(() => {
    refCode.current = captureRef();
    loadQuota();
    try { if (new URLSearchParams(window.location.search).get('limit') === '1') setShowLimit(true); } catch {}
  }, []);

  const outOfSecrets = !!quota && quota.quota !== null && quota.used >= quota.quota;
  const secretsLeft = quota && quota.quota !== null ? Math.max(0, quota.quota - quota.used) : null;

  const timerSeconds = timerMode === 'custom'
    ? Math.max(0, Math.min(3600, Math.floor(Number(customSeconds) || 0)))
    : timerMode;

  function pickFile(f: File | null) {
    setError('');
    if (f && f.size > MAX_FILE_BYTES) {
      setFile(null);
      setError(`That file is ${formatBytes(f.size)}. The limit is 50 MB.`);
      return;
    }
    setFile(f);
  }

  async function createSecret() {
    setError('');
    setEmailMsg('');
    setCopied(false);
    if (mode === 'text' && !text.trim()) return;
    if (mode === 'file' && !file) return;
    if (mode === 'wifi' && !wifi.ssid.trim()) return;
    if (mode === 'wifi' && wifi.security !== 'nopass' && !wifi.password) { setError('Enter the Wi-Fi password, or choose “No password”.'); return; }
    if (!supabase) { setError('Secure storage is not configured yet.'); return; }
    if (mode === 'text' && text.length > MAX_TEXT_CHARS) { setError('That secret is too long (max 50,000 characters).'); return; }
    if (mode === 'file' && file && file.size > MAX_FILE_BYTES) { setError('Files can be up to 50 MB.'); return; }
    if (outOfSecrets) { setShowLimit(true); return; }
    if (fenceOn && !geofence) { setError('Choose a place for the geofence, or turn it off.'); return; }

    // Expiry and extra protections
    const maxTtl = isPaid(quota?.plan) ? PLUS_MAX_TTL : FREE_MAX_TTL;
    let ttl = EXPIRIES.find(e => e.id === expiry)?.seconds ?? 86400;
    if (expiry === 'custom') {
      const at = Date.parse(customExpiry);
      if (!customExpiry || !Number.isFinite(at)) { setError('Pick a date and time for the link to expire.'); return; }
      ttl = Math.round((at - Date.now()) / 1000);
      if (ttl < 300) { setError('The expiry needs to be at least 5 minutes from now.'); return; }
      if (ttl > maxTtl) { setError(isPaid(quota?.plan) ? 'Links can last up to 30 days.' : 'Free links can last up to 7 days. Plus and Pro allow 30 days.'); return; }
    }
    const lockEmail = controls.lockEmail.trim();
    if (lockEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lockEmail)) { setError('Enter a valid recipient email, or turn off “Lock to a recipient”.'); return; }
    let openAfter: string | null = null;
    if (controls.openAfter) {
      const at = Date.parse(controls.openAfter);
      if (!Number.isFinite(at)) { setError('Pick when the secret should start opening.'); return; }
      if (at > Date.now() + 60_000) {
        if (at >= Date.now() + ttl * 1000) { setError('The secret would expire before it can be opened. Pick an earlier time or a later expiry.'); return; }
        openAfter = new Date(at).toISOString();
      }
    }
    const wStart = controls.windowOn ? toMinutes(controls.windowStart) : null;
    const wEnd = controls.windowOn ? toMinutes(controls.windowEnd) : null;
    if (controls.windowOn && (wStart === null || wEnd === null || wStart === wEnd)) { setError('Set different start and end times for the daily window.'); return; }
    setLoading(true);
    try {
      // Everything is encrypted with AES-256-GCM in this tab before it leaves the device.
      const { key, keyB64 } = await newKey();
      const guard = controls.guard || undefined;
      const header: SecretHeader = mode === 'file' && file
        ? { v: 1, type: 'file', name: file.name, mime: file.type || 'application/octet-stream', size: file.size, timer: timerSeconds, guard }
        : mode === 'wifi'
          ? { v: 1, type: 'text', tpl: 'wifi', timer: timerSeconds, guard }
          : { v: 1, type: 'text', timer: timerSeconds, guard };
      if (!controls.allowCopy) header.noCopy = true;
      if (!controls.allowSave) header.noSave = true;
      const encHeader = await encryptJson(key, header);

      let body: string | null = null;
      let filePath: string | null = null;
      if (mode === 'file' && file) {
        const ct = await encryptBytes(key, await file.arrayBuffer());
        filePath = `f/${randomToken(24)}.bin`;
        const { error: upErr } = await supabase.storage.from('secrets').upload(
          filePath,
          ct,
          { contentType: 'application/octet-stream', upsert: false },
        );
        if (upErr) throw new Error('Upload failed. Please try again.');
      } else if (mode === 'wifi') {
        body = await encryptText(key, JSON.stringify({ ssid: wifi.ssid.trim(), password: wifi.security === 'nopass' ? '' : wifi.password, security: wifi.security, hidden: !!wifi.hidden }));
      } else {
        body = await encryptText(key, text);
      }

      const args = (tz: string) => ({
        p_header: encHeader, p_body: body, p_file_path: filePath, p_ttl_seconds: ttl,
        p_client_id: getClientId(), p_ref: refCode.current,
        p_recipient: user ? recipient.trim() || null : null,
        p_share_location: !!user && shareLoc,
        p_size: mode === 'file' && file ? file.size : null,
        ...(geofence ? { p_fence_lat: geofence.lat, p_fence_lon: geofence.lon, p_fence_radius: geofence.radius, p_fence_label: geofence.label } : {}),
        ...(views > 1 ? { p_max_views: views } : {}),
        ...(lockEmail ? { p_lock_email: lockEmail } : {}),
        ...(openAfter ? { p_open_after: openAfter } : {}),
        ...(wStart !== null && wEnd !== null ? { p_window_start: wStart, p_window_end: wEnd, p_window_tz: tz } : {}),
        ...(controls.countries.length ? { p_countries: controls.countries } : {}),
      });
      let { data: id, error: rpcErr } = await supabase.rpc('create_secret', args(localTz()));
      // Unknown time-zone name in the database: fall back to the current UTC offset.
      if (rpcErr && wStart !== null && /invalid time window/.test(rpcErr.message || '')) {
        ({ data: id, error: rpcErr } = await supabase.rpc('create_secret', args(offsetTz())));
      }
      if (rpcErr && /quota_exceeded/.test(rpcErr.message || '')) {
        if (filePath) supabase.storage.from('secrets').remove([filePath]).catch(() => {});
        await loadQuota();
        setShowLimit(true);
        setLoading(false);
        return;
      }
      if (rpcErr && /invalid geofence/.test(rpcErr.message || '')) throw new Error('Pick a place and a radius for the geofence.');
      if (rpcErr && geofence && /could not find the function|p_fence/i.test(rpcErr.message || '')) throw new Error('Geofencing isn’t switched on yet. Turn it off or try again later.');
      if (rpcErr && /could not find the function|p_max_views|p_lock_email|p_open_after|p_window|p_countries/i.test(rpcErr.message || '')) throw new Error('These protections aren’t switched on yet. Turn them off or try again later.');
      if (rpcErr && /expiry_too_long/.test(rpcErr.message || '')) throw new Error('That expiry is longer than your plan allows. See /pricing to upgrade.');
      if (rpcErr && /plan_required:(plus|pro)/.test(rpcErr.message || '')) {
        if (filePath) supabase.storage.from('secrets').remove([filePath]).catch(() => {});
        const need = /plan_required:pro/.test(rpcErr.message || '') ? 'Pro' : 'Plus';
        throw new Error(`That option is part of OnePeek ${need}. Turn it off, or upgrade at onepeek.io/pricing.`);
      }
      if (rpcErr && /invalid recipient email/.test(rpcErr.message || '')) throw new Error('Enter a valid recipient email.');
      if (rpcErr && /invalid time window|open_after_past_expiry/.test(rpcErr.message || '')) throw new Error('Check the time lock settings.');
      if (rpcErr || !id) throw new Error('Could not create the link. Please try again.');
      setQuota(q => (q ? { ...q, used: q.used + 1 } : q));
      setLastSecret({ id: String(id), recipient: user ? recipient.trim() : '' });
      setRecipient('');

      setLink(`${window.location.origin}/s/${id}#${keyB64}`);
      setLinkViews(views);
      setShowQr(false);
      setText('');
      setFile(null);
      setWifi(w => ({ ...w, password: '' }));
    } catch (e) {
      setError((e as Error).message || 'Something went wrong.');
    }
    setLoading(false);
  }

  function copyLink() {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const shareText = 'I’ve sent you a secret on OnePeek. It opens once, then it’s deleted:';

  async function shareNative() {
    try { await navigator.share({ title: 'A secret for you', text: shareText, url: link }); } catch { /* cancelled */ }
  }

  function shareSlack() {
    // Slack has no "share to" link, so copy the link and open Slack for the user to paste it into a DM.
    navigator.clipboard.writeText(`${shareText} ${link}`).then(() => {
      setSlackCopied(true);
      setTimeout(() => setSlackCopied(false), 6000);
    });
  }

  async function sendEmail() {
    if (!emailTo.trim() || !link) return;
    setSending(true);
    setEmailMsg('');
    try {
      const res = await fetch('/api/send-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: emailTo.trim(), link }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setEmailMsg('Sent');
      if (user && supabase && lastSecret && !lastSecret.recipient) {
        supabase.rpc('set_secret_recipient', { p_id: lastSecret.id, p_recipient: emailTo.trim() }).then(() => {});
        setLastSecret({ ...lastSecret, recipient: emailTo.trim() });
      }
      setEmailTo('');
    } catch (e) {
      setEmailMsg((e as Error).message);
    }
    setSending(false);
  }

  const canCreate = mode === 'text' ? !!text.trim() : mode === 'wifi' ? !!wifi.ssid.trim() : !!file;
  const maxTtlNow = isPaid(quota?.plan) ? PLUS_MAX_TTL : FREE_MAX_TTL;

  return (
    <div style={{position:'relative', minHeight:'100vh'}}>
      {/* Animated background */}
      <div className="bg-layer" aria-hidden="true">
        <div className="gp-grid" />
        <div className="gp-glow gp-glow-a" />
        <div className="gp-glow gp-glow-b" />
        <div className="gp-scan" />
      </div>

      <header className="container" style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'16px 24px'}}>
        <Link href="/" className="logo" aria-label="OnePeek home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/onepeek-logo.png" alt="OnePeek" className="logo-img" width={149} height={56} />
        </Link>
        <nav>
          <a href="#how">How it works</a>
          <Link href="/use-cases">Use cases</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/encryption">Encryption</Link>
          <Link href={user ? '/dashboard' : '/login'} className={`nav-icon${user ? ' has-user' : ''}`} aria-label={user ? 'Dashboard' : 'Log in'} title={user ? 'Dashboard' : 'Log in'}>
            {user ? <UserAvatar user={user} size={40} /> : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
            )}
          </Link>
          <a href="#send" className="gp-btn">Send a secret →</a>
        </nav>
      </header>

      <section className="hero container" id="top">
        <div className="hero-left anim-slide-left">
          <div className="pill anim-fade-up delay-1">
            <span className="dot" />
            <span>AES-256-GCM · ZERO-KNOWLEDGE · ONE VIEW ONLY</span>
          </div>
          <h1 className="anim-fade-up delay-2">Send secrets<br />that <TypeWord word="disappear." /></h1>
          <p className="anim-fade-up delay-3">Zero-knowledge password and photo sharing. Encrypted in your browser. The key never touches our servers. Every secret burns after one view.</p>
          <ul className="checks anim-fade-up delay-4">
            <li><Icon name="check" className="ic-accent" />Encrypted on your device before anything is sent</li>
            <li><Icon name="check" className="ic-accent" />We store ciphertext only — never the key</li>
            <li><Icon name="check" className="ic-accent" />Opened once, then deleted for good</li>
          </ul>
        </div>

        <div className="tool-card anim-slide-right delay-2" id="send">
          <div className="tool-header">
            <div className="dots"><span /><span /><span /></div>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <Icon name="lock" size={13} strokeWidth={2} />
              <span>encrypted in this tab</span>
            </div>
          </div>
          <div className="tool-body">
            <div className="tabs" role="group" aria-label="Secret type">
              <button type="button" className={`tab ${mode === 'text' ? 'tab-on' : ''}`} onClick={() => { setMode('text'); setFile(null); setError(''); }} aria-pressed={mode === 'text'}>Text or password</button>
              <button type="button" className={`tab ${mode === 'file' ? 'tab-on' : ''}`} onClick={() => { setMode('file'); setText(''); setError(''); }} aria-pressed={mode === 'file'}>Photo or file</button>
              <button type="button" className={`tab ${mode === 'wifi' ? 'tab-on' : ''}`} onClick={() => { setMode('wifi'); setFile(null); setText(''); setError(''); }} aria-pressed={mode === 'wifi'}>Wi-Fi</button>
            </div>

            {mode === 'text' ? (
              <div>
                <label htmlFor="gp-secret" className="field-label">Your secret</label>
                <textarea id="gp-secret" placeholder="Password, API key, note…" value={text} onChange={e => setText(e.target.value)} />
              </div>
            ) : mode === 'wifi' ? (
              <div className="wifi-form">
                <div>
                  <label htmlFor="gp-ssid" className="field-label">Network name</label>
                  <input id="gp-ssid" className="field-input" type="text" autoComplete="off" maxLength={64} placeholder="e.g. Office-5G" value={wifi.ssid} onChange={e => setWifi({ ...wifi, ssid: e.target.value })} />
                </div>
                {wifi.security !== 'nopass' && (
                  <div>
                    <label htmlFor="gp-wpass" className="field-label">Password</label>
                    <input id="gp-wpass" className="field-input mono" type="text" autoComplete="off" spellCheck={false} maxLength={128} placeholder="Wi-Fi password" value={wifi.password} onChange={e => setWifi({ ...wifi, password: e.target.value })} />
                  </div>
                )}
                <div className="pills" role="group" aria-label="Security">
                  {([['WPA', 'WPA/WPA2/WPA3'], ['WEP', 'WEP'], ['nopass', 'No password']] as const).map(([v, l]) => (
                    <button key={v} type="button" className={`pill-btn ${wifi.security === v ? 'pill-on' : ''}`} aria-pressed={wifi.security === v} onClick={() => setWifi({ ...wifi, security: v })}>{l}</button>
                  ))}
                  <label className="wifi-hidden"><input type="checkbox" checked={!!wifi.hidden} onChange={e => setWifi({ ...wifi, hidden: e.target.checked })} /> Hidden network</label>
                </div>
                <p className="field-hint">The viewer gets the password and a QR code their phone can scan to join.</p>
              </div>
            ) : (
              <div>
                <label className="field-label">Your file</label>
                <div className="dropzone" onClick={() => fileRef.current?.click()} onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag'); }} onDragLeave={e => e.currentTarget.classList.remove('drag')} onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drag'); const f = e.dataTransfer.files?.[0]; if (f) pickFile(f); }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#A3ABB6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></svg>
                  {file ? (<><span style={{color:'#E6E8EB', fontSize:15}}>{file.name}</span><span style={{color:'#8A93A0', fontSize:13}}>{formatBytes(file.size)} · click to change</span></>) : (<><span style={{fontSize:15, color:'#E6E8EB'}}>Drop a photo or file, or <span style={{color:'var(--gp-accent)', textDecoration:'underline'}}>browse</span></span><span style={{fontSize:13, color:'#8A93A0'}}>Images, PDF, TXT or JSON · up to 50 MB</span></>)}
                  <input ref={fileRef} type="file" accept="image/*,.pdf,.txt,.json" style={{display:'none'}} onChange={e => pickFile(e.target.files?.[0] || null)} />
                </div>
              </div>
            )}

            <div>
              <div className="field-label">Expires after</div>
              <div className="pills">
                {EXPIRIES.map(o => (
                  <button key={o.id} type="button" className={`pill-btn ${expiry === o.id ? 'pill-on' : ''}`} onClick={() => setExpiry(o.id)}>{o.label}</button>
                ))}
                <button type="button" className={`pill-btn ${expiry === 'custom' ? 'pill-on' : ''}`} onClick={() => { setExpiry('custom'); if (!customExpiry) setCustomExpiry(toLocalInput(Date.now() + 3 * 86400_000)); }}>Custom</button>
              </div>
              {expiry === 'custom' && (
                <div className="timer-custom">
                  <label htmlFor="gp-exp">Expires on</label>
                  <input id="gp-exp" type="datetime-local" className="field-input" min={toLocalInput(Date.now() + 5 * 60_000)} max={toLocalInput(Date.now() + maxTtlNow * 1000)} value={customExpiry} onChange={e => setCustomExpiry(e.target.value)} />
                  <span>{isPaid(quota?.plan) ? 'up to 30 days' : 'up to 7 days · 30 with Plus or Pro'}</span>
                </div>
              )}
            </div>

            <div>
              <div className="field-label">Views allowed</div>
              <div className="pills" role="group" aria-label="Views allowed">
                {VIEWS.map(v => (
                  <button key={v} type="button" className={`pill-btn ${views === v ? 'pill-on' : ''}`} aria-pressed={views === v} onClick={() => setViews(v)}>{v === 1 ? '1 view' : v}</button>
                ))}
              </div>
              {views > 1 && <p className="field-hint">The link works {views} times, then it’s deleted.</p>}
            </div>

            <div>
              <div className="field-label">Viewer timer</div>
              <div className="pills">
                {TIMERS.map(t => (
                  <button key={t.id} type="button" className={`pill-btn ${timerMode === t.id ? 'pill-on' : ''}`} onClick={() => setTimerMode(t.id)} aria-pressed={timerMode === t.id}>{t.label}</button>
                ))}
                <button type="button" className={`pill-btn ${timerMode === 'custom' ? 'pill-on' : ''}`} onClick={() => setTimerMode('custom')} aria-pressed={timerMode === 'custom'}>Custom</button>
              </div>
              {timerMode === 'custom' && (
                <div className="timer-custom">
                  <label htmlFor="gp-seconds">Seconds</label>
                  <input id="gp-seconds" type="number" inputMode="numeric" min={1} max={3600} step={1} value={customSeconds} onChange={e => setCustomSeconds(e.target.value)} />
                  <span>1–3600</span>
                </div>
              )}
              <p className="field-hint">
                {timerSeconds > 0
                  ? `Once opened, the secret vanishes after ${timerSeconds} second${timerSeconds === 1 ? '' : 's'}.`
                  : 'No countdown — the secret stays on screen until the viewer leaves.'}
              </p>
            </div>

            {user ? (
              <div className="track-box">
                <div>
                  <label className="field-label" htmlFor="gp-recipient">Who is it for? <span className="field-opt">optional · only you see this</span></label>
                  <input id="gp-recipient" className="field-input" type="text" maxLength={200} placeholder="e.g. Rahul, finance team, rahul@company.com" value={recipient} onChange={e => setRecipient(e.target.value)} />
                </div>
                <label className="loc-toggle">
                  <input type="checkbox" checked={shareLoc} onChange={e => setShareLoc(e.target.checked)} />
                  <span className="loc-switch" aria-hidden="true" />
                  <span className="loc-text">
                    <strong><Icon name="pin" size={14} strokeWidth={2} />Show me where it’s opened</strong>
                    <small>Approximate city on a map in your dashboard. The viewer is told before they open it.</small>
                  </span>
                </label>
              </div>
            ) : (
              <p className="track-hint"><Icon name="pin" size={14} strokeWidth={2} /><span><Link href="/login">Log in</Link> to keep a history of who you sent secrets to and see where they were opened.</span></p>
            )}

            <MoreControls value={controls} onChange={setControls} fenceOn={fenceOn}>
              <div className="more-item">
                <GeofencePicker value={geofence} onChange={setGeofence} onActiveChange={setFenceOn} />
              </div>
            </MoreControls>

            {quota && (
              <div className="quota-row">
                <span>{isPaid(quota.plan) ? `${PLAN_NAME[quota.plan]} · ${secretsLeft ?? '∞'} of ${quota.quota ?? '∞'} secrets left this month` : `${secretsLeft} of ${quota.quota} free secrets left this month`}</span>
                {quota.plan !== 'pro' && <button type="button" onClick={() => setShowLimit(true)}>Get more</button>}
              </div>
            )}

            <div className="burn-notice">
              <Icon name="flame" size={16} className="ic-burn" />
              <span>{views > 1 ? `Burns after ${views} views — even if it hasn’t expired yet.` : 'Burns after one view — even if it hasn’t expired yet.'}</span>
            </div>

            <button className="gp-btn" onClick={createSecret} disabled={loading || !canCreate || (timerMode === 'custom' && timerSeconds < 1)} style={{width:'100%', justifyContent:'center', fontSize:16, padding:'14px 18px'}}>
              {loading ? 'Encrypting…' : <>Create secure link <span className="gp-arrow">→</span></>}
            </button>

            {error && <p className="warning">{error}</p>}
            {link && (
              <div className="link-result">
                <p style={{marginBottom:8, fontSize:14, color:'#A3ABB6'}}>{linkViews > 1 ? `Share this link — it works ${linkViews} times:` : 'Share this link — it works once:'}</p>
                <div className="link-box" title={link}>{link}</div>
                <div style={{display:'flex', gap:8, marginTop:8}}>
                  <button className="gp-btn gp-ghost" onClick={copyLink} style={{flex:1, justifyContent:'center'}}>{copied ? 'Copied ✓' : 'Copy link'}</button>
                  <button className="gp-btn gp-ghost" onClick={() => setShowQr(q => !q)} aria-expanded={showQr} style={{justifyContent:'center'}}><Icon name="qr" size={16} strokeWidth={2} />{showQr ? 'Hide QR' : 'QR code'}</button>
                </div>
                {showQr && (
                  <div className="qr-wrap">
                    <QrCode value={link} size={220} label="Scan with a phone camera to open. Works for in-person handovers." />
                  </div>
                )}
                <div className="share-row">
                  <span className="field-label">Send it with</span>
                  <div className="share-btns">
                    {canShare && <button type="button" className="share-btn" onClick={shareNative}><Icon name="send" size={14} strokeWidth={2} />Share…</button>}
                    <a className="share-btn" href={`https://teams.microsoft.com/share?href=${encodeURIComponent(link)}&msgText=${encodeURIComponent(shareText)}&preview=false`} target="_blank" rel="noopener noreferrer">Microsoft Teams</a>
                    <button type="button" className="share-btn" onClick={shareSlack}>Slack</button>
                    <a className="share-btn" href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${link}`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                  </div>
                  {slackCopied && (
                    <p className="field-hint" role="status" style={{marginTop:6}}>
                      Copied. Paste it into a Slack direct message. <a href="slack://open">Open Slack</a> · <a href="https://app.slack.com/client" target="_blank" rel="noopener noreferrer">Slack in browser</a>
                    </p>
                  )}
                </div>
                <div style={{marginTop:14}}>
                  <label className="field-label" htmlFor="gp-email">Email the link</label>
                  <div style={{display:'flex', gap:8}}>
                    <input id="gp-email" type="email" placeholder="recipient@email.com" value={emailTo} onChange={e => setEmailTo(e.target.value)} style={{flex:1, background:'#0A0C0F', border:'1px solid #262C35', borderRadius:8, padding:'10px 12px', color:'#E6E8EB', fontSize:14}} />
                    <button type="button" className={`send-icon ${sending ? 'sending' : ''}`} onClick={sendEmail} disabled={sending || !emailTo.trim()} aria-label={sending ? 'Sending' : 'Send link by email'} title="Send">
                      <svg viewBox="0 0 110 100" width="34" height="31" aria-hidden="true"><polygon points="4,14 108,2 58,98 50,44" fill="currentColor" /></svg>
                    </button>
                  </div>
                  {emailMsg && <p style={{marginTop:6, fontSize:13, color: emailMsg === 'Sent' ? 'var(--gp-accent)' : 'var(--danger)'}}>{emailMsg}</p>}
                </div>
              </div>
            )}
            <p className="tool-foot">Encrypted in your browser before anything is sent.</p>
          </div>
        </div>
      </section>

      <section id="problem" className="section-pad" style={{borderTop:'1px solid rgba(255,255,255,0.07)', borderBottom:'1px solid rgba(255,255,255,0.07)', background:'rgba(13,16,20,0.6)'}}>
        <div className="container problem-grid">
          <div className="problem-copy anim-slide-left">
            <span className="eyebrow">THE PROBLEM</span>
            <h2 className="section-title" style={{marginTop:12}}>A password you paste is a password you keep sharing.</h2>
            <p className="section-sub" style={{marginBottom:0, maxWidth:480}}>Drop it into Slack, an email or a support ticket and it stays there — searchable, forwardable and backed up long after anyone needs it. OnePeek gives every secret exactly one reading. Then there’s nothing left to find.</p>
          </div>
          <div className="leak-stack anim-slide-right">
            <div className="leak-card"><div className="leak-head"><span>#devops · chat</span><span className="leak-tag bad">STILL SEARCHABLE</span></div><p>here’s the prod db login → <code>Pr0d!x92</code></p></div>
            <div className="leak-card"><div className="leak-head"><span>Re: server access · email</span><span className="leak-tag bad">FORWARDED 3×</span></div><p>Admin password is <code>Adm1n#2026</code> — don’t share it</p></div>
            <div className="leak-card"><div className="leak-head"><span>SUP-1042 · ticket</span><span className="leak-tag bad">IN EVERY BACKUP</span></div><p>API key for the vendor: <code>sk_live_9fA2…</code></p></div>
            <div className="leak-card good"><div className="leak-head"><span style={{color:'var(--gp-accent)'}}>OnePeek · secret</span><span className="leak-tag good">BURNED</span></div><p>Prod db login → <span className="grad-text" style={{display:'inline-flex', alignItems:'center', gap:6, verticalAlign:'middle'}}><Icon name="flame" size={14} className="ic-grad" />Read once. Gone.</span></p></div>
          </div>
        </div>
      </section>

      <section id="how" className="section-pad container">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 32 }}>
          <div>
            <span className="eyebrow">HOW IT WORKS</span>
            <h2 className="section-title" style={{ marginTop: 8 }}>Follow one secret from paste to burn.</h2>
            <p className="section-sub" style={{ marginBottom: 0 }}>Six steps, start to finish. Watch where the secret goes — and where the key never does.</p>
          </div>
        </div>
        <ProcessAnim />
      </section>

      <section id="features" className="section-pad" style={{borderTop:'1px solid rgba(255,255,255,0.07)'}}>
        <div className="container">
          <div className="features-head">
            <div>
              <span className="eyebrow">WHY TEAMS CHOOSE ONEPEEK</span>
              <h2 className="section-title" style={{marginTop:12}}>Built so there’s nothing to leak.</h2>
            </div>
            <p className="features-sub">Every design decision removes something an attacker — or a careless inbox — could get hold of.</p>
          </div>

          <div className="features-grid">
            <div className="feat">
              <div className="feat-icon"><Icon name="shield" size={26} strokeWidth={1.8} /></div>
              <h3>Zero-knowledge</h3>
              <p>Encryption happens in your browser with AES-GCM. We only ever store ciphertext. The decryption key lives only in the link you share.</p>
            </div>
            <div className="feat">
              <div className="feat-icon ic-burn"><Icon name="flame" size={26} strokeWidth={1.8} /></div>
              <h3>Burn after reading</h3>
              <p>Links are destroyed the moment they’re opened, or after the number of views you choose. Set expiry from 5 minutes up to 7 days (30 with Plus or Pro).</p>
            </div>
            <div className="feat">
              <div className="feat-icon"><Icon name="image" size={26} strokeWidth={1.8} /></div>
              <h3>Photos & files</h3>
              <p>Share screenshots, config files, or short notes. Everything is encrypted client-side before it leaves your device.</p>
            </div>
            <div className="feat">
              <div className="feat-icon"><Icon name="lock" size={26} strokeWidth={1.8} /></div>
              <h3>Lock it down</h3>
              <p>Only for one email address, only after a set time, only during office hours, only from chosen countries or inside a geofence. Blur until held to deter screenshots.</p>
            </div>
            <div className="feat">
              <div className="feat-icon"><Icon name="inbox" size={26} strokeWidth={1.8} /></div>
              <h3>Ask for a secret</h3>
              <p>Send a request link. They type the password, it’s encrypted to a key only you hold, and you read it once. No account needed on their side.</p>
            </div>
            <div className="feat">
              <div className="feat-icon"><Icon name="bell" size={26} strokeWidth={1.8} /></div>
              <h3>Know when it’s opened</h3>
              <p>Get an email or browser alert the moment a secret is opened, with the area if you asked for it. Burn any live link from your dashboard.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="encryption" className="section-pad enc-section">
        <div className="container">
          <div className="enc-grid">
            <div className="enc-copy">
              <span className="eyebrow">END-TO-END ENCRYPTION</span>
              <h2 className="section-title" style={{marginTop:12}}>Locked on your device.<br />Unreadable everywhere else.</h2>
              <p className="section-sub" style={{marginBottom:0}}>Every password, API key, note, photo and file is encrypted with AES-256-GCM in your browser before a single byte is uploaded. OnePeek only ever stores scrambled ciphertext — we couldn’t read your secrets even if we wanted to.</p>
              <ul className="enc-list">
                <li><Icon name="key" className="ic-accent" /><span><strong>A fresh 256-bit key for every secret.</strong> Generated in your browser, never reused.</span></li>
                <li><Icon name="lock" className="ic-accent" /><span><strong>Key travels only in the link.</strong> It sits after the #, which browsers never send to any server.</span></li>
                <li><Icon name="shield" className="ic-accent" /><span><strong>Tamper-proof.</strong> GCM authentication rejects any ciphertext that has been altered.</span></li>
                <li><Icon name="flame" className="ic-burn" /><span><strong>Deleted on first view.</strong> The ciphertext is erased the moment it’s opened, or when it expires.</span></li>
              </ul>
            </div>
            <div className="enc-visual" aria-hidden="true">
              <div className="enc-row">
                <span className="enc-label">YOU TYPE</span>
                <code className="enc-plain">db_pass = Pr0d!x92</code>
              </div>
              <div className="enc-arrow"><Icon name="lock" size={16} strokeWidth={2} /><span>AES-256-GCM · in your browser</span></div>
              <div className="enc-row">
                <span className="enc-label">WE STORE</span>
                <code className="enc-cipher">9f3a e1c0 77b2 04d9 c1b8 5e2f a07d 13c6 b94e 2d81 f6a3 …</code>
              </div>
              <div className="enc-row">
                <span className="enc-label">WE NEVER SEE</span>
                <code className="enc-none"><Icon name="ban" size={14} strokeWidth={2} />the key · the text · the file</code>
              </div>
              <div className="enc-stats">
                <div><strong>256-bit</strong><span>key per secret</span></div>
                <div><strong>0</strong><span>keys on our servers</span></div>
                <div><strong>1</strong><span>view, then deleted</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-section">
        <div className="container cta-inner">
          <h2>Your next password shouldn’t<br />outlive the conversation.</h2>
          <p>Encrypted in your browser. Read once. Gone for good.</p>
          <div className="cta-btns">
            <a href="#send" className="gp-btn">Send a secret →</a>
            <Link href={user ? '/dashboard' : '/login'} className="gp-btn gp-ghost">Log in to your dashboard</Link>
          </div>
        </div>
      </section>

      <footer className="anim-fade-up">
        <div className="footer-inner">
          <div className="footer-top">
            <div className="footer-brand">
              <div className="logo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/onepeek-logo.png" alt="OnePeek" className="logo-img logo-img-sm" width={128} height={48} />
              </div>
              <p>Zero-knowledge secret sharing. Encrypted in your browser.</p>
            </div>
            <div className="footer-navs">
              <nav className="footer-nav"><span>PRODUCT</span><a href="#how">How it works</a><a href="#features">Features</a><Link href="/pricing">Pricing</Link><Link href="/integrations">Integrations</Link><Link href="/developers">Developers &amp; API</Link><a href="#send">Send a secret</a></nav>
              <nav className="footer-nav"><span>USE CASES</span><Link href="/use-cases/hr">HR teams</Link><Link href="/use-cases/developers">Developers</Link><Link href="/use-cases/support">Support teams</Link><Link href="/playbooks">Playbooks</Link><Link href="/share-passwords-securely">Share passwords securely</Link></nav>
              <nav className="footer-nav"><span>ACCOUNT</span><Link href="/login">Login</Link><Link href="/dashboard">Dashboard</Link><Link href="/refer">Refer a friend</Link></nav>
              <nav className="footer-nav"><span>TRUST</span><Link href="/encryption">How encryption works</Link><a href="/.well-known/security.txt">security.txt</a><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} OnePeek</span>
            <span>encrypted in your browser · AES-GCM</span>
          </div>
        </div>
      </footer>

      {showLimit && <LimitModal quota={quota} onClose={() => setShowLimit(false)} />}
    </div>
  );
}
