'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import ProcessAnim from './components/ProcessAnim';
import LimitModal from './components/LimitModal';
import Icon from './components/Icon';
import { getClientId, captureRef, type Quota } from '@/lib/quota';
import {
  newKey, encryptBytes, encryptJson, encryptText, randomToken,
  MAX_FILE_BYTES, MAX_TEXT_CHARS, type SecretHeader,
} from '@/lib/crypto';

const EXPIRIES = [
  { id: '1h', label: '1 hour', seconds: 3600 },
  { id: '24h', label: '24 hours', seconds: 86400 },
  { id: '7d', label: '7 days', seconds: 604800 },
];

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
  const [mode, setMode] = useState<'text' | 'file'>('text');
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
      setError(`That file is ${formatBytes(f.size)}. The limit is 10 MB.`);
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
    if (!supabase) { setError('Secure storage is not configured yet.'); return; }
    if (mode === 'text' && text.length > MAX_TEXT_CHARS) { setError('That secret is too long (max 50,000 characters).'); return; }
    if (mode === 'file' && file && file.size > MAX_FILE_BYTES) { setError('Files can be up to 10 MB.'); return; }
    if (outOfSecrets) { setShowLimit(true); return; }
    setLoading(true);
    try {
      // Everything is encrypted with AES-256-GCM in this tab before it leaves the device.
      const { key, keyB64 } = await newKey();
      const ttl = EXPIRIES.find(e => e.id === expiry)?.seconds ?? 86400;
      const header: SecretHeader = mode === 'file' && file
        ? { v: 1, type: 'file', name: file.name, mime: file.type || 'application/octet-stream', size: file.size, timer: timerSeconds }
        : { v: 1, type: 'text', timer: timerSeconds };
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
      } else {
        body = await encryptText(key, text);
      }

      const { data: id, error: rpcErr } = await supabase.rpc('create_secret', {
        p_header: encHeader, p_body: body, p_file_path: filePath, p_ttl_seconds: ttl,
        p_client_id: getClientId(), p_ref: refCode.current,
      });
      if (rpcErr && /quota_exceeded/.test(rpcErr.message || '')) {
        if (filePath) supabase.storage.from('secrets').remove([filePath]).catch(() => {});
        await loadQuota();
        setShowLimit(true);
        setLoading(false);
        return;
      }
      if (rpcErr || !id) throw new Error('Could not create the link. Please try again.');
      setQuota(q => (q ? { ...q, used: q.used + 1 } : q));

      setLink(`${window.location.origin}/s/${id}#${keyB64}`);
      setText('');
      setFile(null);
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
      setEmailTo('');
    } catch (e) {
      setEmailMsg((e as Error).message);
    }
    setSending(false);
  }

  const canCreate = mode === 'text' ? !!text.trim() : !!file;

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
        <Link href="/" className="logo" aria-label="OnePass home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/onepass-logo.png" alt="OnePass" className="logo-img" width={139} height={56} />
        </Link>
        <nav>
          <a href="#problem">Why OnePass</a>
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#encryption">Encryption</a>
          <Link href={user ? '/dashboard' : '/login'} className="nav-icon" aria-label={user ? 'Dashboard' : 'Log in'} title={user ? 'Dashboard' : 'Log in'}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
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
          <h1 className="anim-fade-up delay-2">Send secrets<br />that <span>disappear.</span></h1>
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
            </div>

            {mode === 'text' ? (
              <div>
                <label htmlFor="gp-secret" className="field-label">Your secret</label>
                <textarea id="gp-secret" placeholder="Password, API key, note…" value={text} onChange={e => setText(e.target.value)} />
              </div>
            ) : (
              <div>
                <label className="field-label">Your file</label>
                <div className="dropzone" onClick={() => fileRef.current?.click()} onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag'); }} onDragLeave={e => e.currentTarget.classList.remove('drag')} onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drag'); const f = e.dataTransfer.files?.[0]; if (f) pickFile(f); }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#A3ABB6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></svg>
                  {file ? (<><span style={{color:'#E6E8EB', fontSize:15}}>{file.name}</span><span style={{color:'#8A93A0', fontSize:13}}>{formatBytes(file.size)} · click to change</span></>) : (<><span style={{fontSize:15, color:'#E6E8EB'}}>Drop a photo or file, or <span style={{color:'var(--gp-accent)', textDecoration:'underline'}}>browse</span></span><span style={{fontSize:13, color:'#8A93A0'}}>Images, PDF, TXT or JSON · up to 10 MB</span></>)}
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
              </div>
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

            {quota && (
              <div className="quota-row">
                <span>{quota.plan === 'plus' ? 'OnePass+ · unlimited secrets' : `${secretsLeft} of ${quota.quota} free secrets left`}</span>
                {quota.plan !== 'plus' && <button type="button" onClick={() => setShowLimit(true)}>Get more</button>}
              </div>
            )}

            <div className="burn-notice">
              <Icon name="flame" size={16} className="ic-burn" />
              <span>Burns after one view — even if it hasn’t expired yet.</span>
            </div>

            <button className="gp-btn" onClick={createSecret} disabled={loading || !canCreate || (timerMode === 'custom' && timerSeconds < 1)} style={{width:'100%', justifyContent:'center', fontSize:16, padding:'14px 18px'}}>
              {loading ? 'Encrypting…' : <>Create secure link <span className="gp-arrow">→</span></>}
            </button>

            {error && <p className="warning">{error}</p>}
            {link && (
              <div className="link-result">
                <p style={{marginBottom:8, fontSize:14, color:'#A3ABB6'}}>Share this link — it works once:</p>
                <div className="link-box" title={link}>{link}</div>
                <div style={{display:'flex', gap:8, marginTop:8}}>
                  <button className="gp-btn gp-ghost" onClick={copyLink} style={{flex:1, justifyContent:'center'}}>{copied ? 'Copied ✓' : 'Copy link'}</button>
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
            <p className="section-sub" style={{marginBottom:0, maxWidth:480}}>Drop it into Slack, an email or a support ticket and it stays there — searchable, forwardable and backed up long after anyone needs it. OnePass gives every secret exactly one reading. Then there’s nothing left to find.</p>
          </div>
          <div className="leak-stack anim-slide-right">
            <div className="leak-card"><div className="leak-head"><span>#devops · chat</span><span className="leak-tag bad">STILL SEARCHABLE</span></div><p>here’s the prod db login → <code>Pr0d!x92</code></p></div>
            <div className="leak-card"><div className="leak-head"><span>Re: server access · email</span><span className="leak-tag bad">FORWARDED 3×</span></div><p>Admin password is <code>Adm1n#2026</code> — don’t share it</p></div>
            <div className="leak-card"><div className="leak-head"><span>SUP-1042 · ticket</span><span className="leak-tag bad">IN EVERY BACKUP</span></div><p>API key for the vendor: <code>sk_live_9fA2…</code></p></div>
            <div className="leak-card good"><div className="leak-head"><span style={{color:'var(--gp-accent)'}}>OnePass · secret</span><span className="leak-tag good">BURNED</span></div><p>Prod db login → <span style={{color:'#FF9F5A', display:'inline-flex', alignItems:'center', gap:6, verticalAlign:'middle'}}><Icon name="flame" size={14} />Read once. Gone.</span></p></div>
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
              <span className="eyebrow">WHY TEAMS CHOOSE ONEPASS</span>
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
              <p>One-time links are destroyed the moment they are opened. Set automatic expiry for 1 hour, 24 hours, or 7 days.</p>
            </div>
            <div className="feat">
              <div className="feat-icon"><Icon name="image" size={26} strokeWidth={1.8} /></div>
              <h3>Photos & files</h3>
              <p>Share screenshots, config files, or short notes. Everything is encrypted client-side before it leaves your device.</p>
            </div>
            <div className="feat wide">
              <div className="feat-icon"><Icon name="eye" size={26} strokeWidth={1.8} /></div>
              <h3>Know when it’s opened</h3>
              <p>Your dashboard shows every secret you’ve sent and whether it has been opened — without ever showing the secret itself.</p>
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
              <p className="section-sub" style={{marginBottom:0}}>Every password, API key, note, photo and file is encrypted with AES-256-GCM in your browser before a single byte is uploaded. OnePass only ever stores scrambled ciphertext — we couldn’t read your secrets even if we wanted to.</p>
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
                <img src="/onepass-logo.png" alt="OnePass" className="logo-img logo-img-sm" width={119} height={48} />
              </div>
              <p>Zero-knowledge secret sharing. Encrypted in your browser.</p>
            </div>
            <div className="footer-navs">
              <nav className="footer-nav"><span>PRODUCT</span><a href="#how">How it works</a><a href="#features">Features</a><a href="#encryption">Encryption</a><a href="#send">Send a secret</a></nav>
              <nav className="footer-nav"><span>ACCOUNT</span><Link href="/login">Login</Link><Link href="/dashboard">Dashboard</Link></nav>
              <nav className="footer-nav"><span>LEGAL</span><a href="#">Privacy</a><a href="#">Terms</a></nav>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} OnePass</span>
            <span>encrypted in your browser · AES-GCM</span>
          </div>
        </div>
      </footer>

      {showLimit && <LimitModal quota={quota} onClose={() => setShowLimit(false)} />}
    </div>
  );
}
