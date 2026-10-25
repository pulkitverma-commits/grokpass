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
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    }
  }, []);

  async function createSecret() {
    setError('');
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
            {/* Tabs */}
            <div className="tabs" role="group" aria-label="Secret type">
              <button
                type="button"
                className={`tab ${mode === 'text' ? 'tab-on' : ''}`}
                onClick={() => { setMode('text'); setFile(null); }}
                aria-pressed={mode === 'text'}
              >
                Text or password
              </button>
              <button
                type="button"
                className={`tab ${mode === 'file' ? 'tab-on' : ''}`}
                onClick={() => { setMode('file'); setText(''); }}
                aria-pressed={mode === 'file'}
              >
                Photo or file
              </button>
            </div>

            {mode === 'text' ? (
              <div>
                <label htmlFor="gp-secret" className="field-label">Your secret</label>
                <textarea
                  id="gp-secret"
                  placeholder="Password, API key, note…"
                  value={text}
                  onChange={e => setText(e.target.value)}
                />
              </div>
            ) : (
              <div>
                <label className="field-label">Your file</label>
                <div
                  className="dropzone"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag'); }}
                  onDragLeave={e => e.currentTarget.classList.remove('drag')}
                  onDrop={e => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('drag');
                    const f = e.dataTransfer.files?.[0];
                    if (f) setFile(f);
                  }}
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#A3ABB6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <path d="m17 8-5-5-5 5" />
                    <path d="M12 3v12" />
                  </svg>
                  {file ? (
                    <>
                      <span style={{color:'#E6E8EB', fontSize:15}}>{file.name}</span>
                      <span style={{color:'#8A93A0', fontSize:13}}>{Math.round(file.size/1024)} KB · click to change</span>
                    </>
                  ) : (
                    <>
                      <span style={{fontSize:15, color:'#E6E8EB'}}>Drop a photo or file, or <span style={{color:'var(--gp-accent)', textDecoration:'underline'}}>browse</span></span>
                      <span style={{fontSize:13, color:'#8A93A0'}}>Max ~800 KB</span>
                    </>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*,.pdf,.txt,.json"
                    style={{display:'none'}}
                    onChange={e => setFile(e.target.files?.[0] || null)}
                  />
                </div>
              </div>
            )}

            {/* Expiry */}
            <div>
              <div className="field-label">Expires after</div>
              <div className="pills">
                {EXPIRIES.map(o => (
                  <button
                    key={o.id}
                    type="button"
                    className={`pill-btn ${expiry === o.id ? 'pill-on' : ''}`}
                    onClick={() => setExpiry(o.id)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Burn notice */}
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
                <button className="gp-btn gp-ghost" onClick={() => navigator.clipboard.writeText(link)} style={{marginTop:8, width:'100%', justifyContent:'center'}}>
                  Copy link
                </button>
              </div>
            )}

            <p className="tool-foot">Encrypted in your browser before anything is sent.</p>
          </div>
        </div>
      </section>

      <section id="problem" className="section-pad" style={{borderTop:'1px solid rgba(255,255,255,0.07)', borderBottom:'1px solid rgba(255,255,255,0.07)', background:'rgba(13,16,20,0.6)'}}>
        <div className="container anim-fade-up">
          <h2 className="section-title">A password you paste is a password you keep sharing.</h2>
          <p className="section-sub">Slack, email, tickets — they all keep a copy. OnePass doesn’t.</p>
        </div>
      </section>

      <section id="how" className="section-pad container">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 32 }}>
          <div>
            <span style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 13, letterSpacing: 1, color: 'var(--gp-accent)' }}>HOW IT WORKS</span>
            <h2 className="section-title" style={{ marginTop: 8 }}>Follow one secret from paste to burn.</h2>
            <p className="section-sub" style={{ marginBottom: 0 }}>Six steps, start to finish. Watch where the secret goes — and where the key never does.</p>
          </div>
        </div>
        <ProcessAnim />
      </section>

      <section id="features" className="section-pad" style={{borderTop:'1px solid rgba(255,255,255,0.07)'}}>
        <div className="container">
          <h2 className="section-title anim-fade-up">Why teams choose OnePass</h2>
          <div className="grid">
            <div className="feature-card anim-fade-up"><h3>Zero-knowledge</h3><p>AES-GCM encryption in your browser. We only ever see ciphertext.</p></div>
            <div className="feature-card anim-fade-up"><h3>Burn after reading</h3><p>One-time links destroyed on open. Optional expiry windows.</p></div>
            <div className="feature-card anim-fade-up"><h3>Photos & files</h3><p>Share screenshots or configs. Encrypted before they leave your device.</p></div>
            <div className="feature-card anim-fade-up"><h3>No accounts required</h3><p>Send in seconds. Optional login for a dashboard of sent secrets.</p></div>
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
              <nav className="footer-nav">
                <span>PRODUCT</span>
                <a href="#how">How it works</a>
                <a href="#features">Features</a>
                <a href="#send">Send a secret</a>
              </nav>
              <nav className="footer-nav">
                <span>ACCOUNT</span>
                <Link href="/login">Login</Link>
                <Link href="/dashboard">Dashboard</Link>
              </nav>
              <nav className="footer-nav">
                <span>LEGAL</span>
                <a href="#">Privacy</a>
                <a href="#">Terms</a>
              </nav>
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
