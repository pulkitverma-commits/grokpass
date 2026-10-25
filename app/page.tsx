'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import ProcessAnim from './components/ProcessAnim';

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function encryptFile(file: File): Promise<{ ct: string; iv: string; key: string }> {
  if (file.size > 800 * 1024) throw new Error('File too large for browser demo (max ~800 KB).');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buffer = await file.arrayBuffer();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buffer);
  const rawKey = await crypto.subtle.exportKey('raw', key);
  return { ct: toB64(ciphertext), iv: toB64(iv), key: toB64(rawKey) };
}

const EXPIRIES = [
  { id: '1h', label: '1 hour' },
  { id: '24h', label: '24 hours' },
  { id: '7d', label: '7 days' },
];

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [mode, setMode] = useState<'text' | 'file'>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [expiry, setExpiry] = useState('24h');
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

  async function createSecret() {
    setError('');
    setEmailMsg('');
    if (mode === 'text' && !text.trim()) return;
    if (mode === 'file' && !file) return;
    setLoading(true);
    try {
      let payload: any = { type: 'text', content: text, expiry };
      if (mode === 'file' && file) {
        const enc = await encryptFile(file);
        payload = { type: 'file', name: file.name, mime: file.type, expiry, ...enc };
      }
      const id = crypto.randomUUID().slice(0, 8);
      const share = `${window.location.origin}/s/${id}#${btoa(JSON.stringify(payload))}`;
      setLink(share);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
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
        <Link href="/" className="logo">
          <span className="logo-mark">1</span>
          <span>OnePass</span>
        </Link>
        <nav>
          <a href="#problem">Why OnePass</a>
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          {user ? <Link href="/dashboard">Dashboard</Link> : <Link href="/login">Login</Link>}
          <a href="#send" className="gp-btn">Send a secret →</a>
        </nav>
      </header>

      <section className="hero container" id="top">
        <div className="hero-left anim-slide-left">
          <div className="pill anim-fade-up delay-1">
            <span className="dot" />
            <span>AES-GCM · ZERO-KNOWLEDGE · ONE VIEW ONLY</span>
          </div>
          <h1 className="anim-fade-up delay-2">Send secrets<br />that <span>disappear.</span></h1>
          <p className="anim-fade-up delay-3">Zero-knowledge password and photo sharing. Encrypted in your browser. The key never touches our servers. Every secret burns after one view.</p>
          <ul className="checks anim-fade-up delay-4">
            <li>✓ Encrypted on your device before anything is sent</li>
            <li>✓ We store ciphertext only — never the key</li>
            <li>✓ Opened once, then deleted for good</li>
          </ul>
        </div>

        <div className="tool-card anim-slide-right delay-2" id="send">
          <div className="tool-header">
            <div className="dots"><span /><span /><span /></div>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <span>🔒</span>
              <span>encrypted in this tab</span>
            </div>
          </div>
          <div className="tool-body">
            <div className="tabs" role="group" aria-label="Secret type">
              <button type="button" className={`tab ${mode === 'text' ? 'tab-on' : ''}`} onClick={() => { setMode('text'); setFile(null); }} aria-pressed={mode === 'text'}>Text or password</button>
              <button type="button" className={`tab ${mode === 'file' ? 'tab-on' : ''}`} onClick={() => { setMode('file'); setText(''); }} aria-pressed={mode === 'file'}>Photo or file</button>
            </div>

            {mode === 'text' ? (
              <div>
                <label htmlFor="gp-secret" className="field-label">Your secret</label>
                <textarea id="gp-secret" placeholder="Password, API key, note…" value={text} onChange={e => setText(e.target.value)} />
              </div>
            ) : (
              <div>
                <label className="field-label">Your file</label>
                <div className="dropzone" onClick={() => fileRef.current?.click()} onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag'); }} onDragLeave={e => e.currentTarget.classList.remove('drag')} onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drag'); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#A3ABB6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></svg>
                  {file ? (<><span style={{color:'#E6E8EB', fontSize:15}}>{file.name}</span><span style={{color:'#8A93A0', fontSize:13}}>{Math.round(file.size/1024)} KB · click to change</span></>) : (<><span style={{fontSize:15, color:'#E6E8EB'}}>Drop a photo or file, or <span style={{color:'var(--gp-accent)', textDecoration:'underline'}}>browse</span></span><span style={{fontSize:13, color:'#8A93A0'}}>Max ~800 KB</span></>)}
                  <input ref={fileRef} type="file" accept="image/*,.pdf,.txt,.json" style={{display:'none'}} onChange={e => setFile(e.target.files?.[0] || null)} />
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

            <div className="burn-notice">
              <span>🔥</span>
              <span>Burns after one view — even if it hasn’t expired yet.</span>
            </div>

            <button className="gp-btn" onClick={createSecret} disabled={loading || !canCreate} style={{width:'100%', justifyContent:'center', fontSize:16, padding:'14px 18px'}}>
              {loading ? 'Encrypting…' : <>Create secure link <span className="gp-arrow">→</span></>}
            </button>

            {error && <p className="warning">{error}</p>}
            {link && (
              <div>
                <p style={{marginBottom:8, fontSize:14, color:'#A3ABB6'}}>Share this link:</p>
                <div className="link-box">{link}</div>
                <div style={{display:'flex', gap:8, marginTop:8}}>
                  <button className="gp-btn gp-ghost" onClick={() => navigator.clipboard.writeText(link)} style={{flex:1, justifyContent:'center'}}>Copy link</button>
                </div>
                <div style={{marginTop:14}}>
                  <label className="field-label">Email the link</label>
                  <div style={{display:'flex', gap:8}}>
                    <input type="email" placeholder="recipient@email.com" value={emailTo} onChange={e => setEmailTo(e.target.value)} style={{flex:1, background:'#0A0C0F', border:'1px solid #262C35', borderRadius:8, padding:'10px 12px', color:'#E6E8EB', fontSize:14}} />
                    <button className="gp-btn" onClick={sendEmail} disabled={sending || !emailTo.trim()} style={{whiteSpace:'nowrap'}}>{sending ? 'Sending…' : 'Send'}</button>
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
            <div className="leak-card good"><div className="leak-head"><span style={{color:'var(--gp-accent)'}}>OnePass · secret</span><span className="leak-tag good">BURNED</span></div><p>Prod db login → <span style={{color:'#FF9F5A'}}>🔥 Read once. Gone.</span></p></div>
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
              <div className="feat-icon">🛡️</div>
              <h3>Zero-knowledge</h3>
              <p>Encryption happens in your browser with AES-GCM. We only ever store ciphertext. The decryption key lives only in the link you share.</p>
            </div>
            <div className="feat">
              <div className="feat-icon">🔥</div>
              <h3>Burn after reading</h3>
              <p>One-time links are destroyed the moment they are opened. Set automatic expiry for 1 hour, 24 hours, or 7 days.</p>
            </div>
            <div className="feat">
              <div className="feat-icon">🖼️</div>
              <h3>Photos & files</h3>
              <p>Share screenshots, config files, or short notes. Everything is encrypted client-side before it leaves your device.</p>
            </div>
            <div className="feat wide">
              <div className="feat-icon">👁️</div>
              <h3>Know when it’s opened</h3>
              <p>Your dashboard shows every secret you’ve sent and whether it has been opened — without ever showing the secret itself.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-section">
        <div className="container cta-inner">
          <h2>Your next password shouldn’t outlive the conversation.</h2>
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
              <div className="logo" style={{fontSize:19}}>
                <span className="logo-mark" style={{width:26, height:26, fontSize:16}}>1</span>
                <span>OnePass</span>
              </div>
              <p>Zero-knowledge secret sharing. Encrypted in your browser.</p>
            </div>
            <div className="footer-navs">
              <nav className="footer-nav"><span>PRODUCT</span><a href="#how">How it works</a><a href="#features">Features</a><a href="#send">Send a secret</a></nav>
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
    </div>
  );
}
