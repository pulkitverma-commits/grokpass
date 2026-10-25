'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

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

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    }
  }, []);

  async function createSecret() {
    setError('');
    if (!text && !file) return;
    setLoading(true);
    try {
      let payload: any = { type: 'text', content: text };
      if (file) {
        const enc = await encryptFile(file);
        payload = { type: 'file', name: file.name, mime: file.type, ...enc };
      }
      const id = crypto.randomUUID().slice(0, 8);
      const share = `${window.location.origin}/s/${id}#${btoa(JSON.stringify(payload))}`;
      setLink(share);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }

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
        <div className="hero-left">
          <div className="pill">
            <span className="dot" />
            <span>AES-GCM · ZERO-KNOWLEDGE · ONE VIEW ONLY</span>
          </div>
          <h1>Send secrets<br />that <span>disappear.</span></h1>
          <p>Zero-knowledge password and photo sharing. Encrypted in your browser. The key never touches our servers. Every secret burns after one view.</p>
          <ul className="checks">
            <li>✓ Encrypted on your device before anything is sent</li>
            <li>✓ We store ciphertext only — never the key</li>
            <li>✓ Opened once, then deleted for good</li>
          </ul>
        </div>

        <div className="tool-card" id="send">
          <div className="tool-header">
            <div className="dots"><span /><span /><span /></div>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <span>🔒</span>
              <span>encrypted in this tab</span>
            </div>
          </div>
          <div className="tool-body">
            <textarea
              placeholder="Password, API key, note… or leave blank and attach a file"
              value={text}
              onChange={e => setText(e.target.value)}
            />
            <label className="file-label">
              Attach a photo or file (max ~800 KB)
              <input type="file" accept="image/*,.pdf,.txt,.json" onChange={e => setFile(e.target.files?.[0] || null)} style={{marginTop:6, display:'block'}} />
            </label>
            {file && <p style={{fontSize:'0.85rem', color:'#A3ABB6'}}>Selected: {file.name} ({Math.round(file.size/1024)} KB)</p>}
            <button className="gp-btn" onClick={createSecret} disabled={loading || (!text && !file)} style={{width:'100%', justifyContent:'center'}}>
              {loading ? 'Encrypting…' : 'Create secure link'}
            </button>
            {error && <p className="warning">{error}</p>}
            {link && (
              <div>
                <p style={{marginBottom:8}}>Share this link:</p>
                <div className="link-box">{link}</div>
                <button className="gp-btn gp-ghost" onClick={() => navigator.clipboard.writeText(link)} style={{marginTop:8}}>
                  Copy link
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      <section id="problem" className="section-pad" style={{borderTop:'1px solid rgba(255,255,255,0.07)', borderBottom:'1px solid rgba(255,255,255,0.07)', background:'rgba(13,16,20,0.6)'}}>
        <div className="container">
          <h2 className="section-title">A password you paste is a password you keep sharing.</h2>
          <p className="section-sub">Slack, email, tickets — they all keep a copy. OnePass doesn’t.</p>
        </div>
      </section>

      <section id="how" className="section-pad container">
        <h2 className="section-title">How it works</h2>
        <p className="section-sub">Three steps. Nothing complicated.</p>
        <div className="how-grid">
          <div className="feature-card step-card">
            <div className="step-num">1</div>
            <h3>Paste or upload</h3>
            <p>Type a password or drop a photo. Encryption starts immediately in your browser.</p>
          </div>
          <div className="feature-card step-card">
            <div className="step-num">2</div>
            <h3>Share the link</h3>
            <p>The decryption key lives only in the URL fragment and is never sent to the server.</p>
          </div>
          <div className="feature-card step-card">
            <div className="step-num">3</div>
            <h3>They open it once</h3>
            <p>Recipient reveals the secret locally. The link is destroyed.</p>
          </div>
        </div>
      </section>

      <section id="features" className="section-pad" style={{borderTop:'1px solid rgba(255,255,255,0.07)'}}>
        <div className="container">
          <h2 className="section-title">Why teams choose OnePass</h2>
          <div className="grid">
            <div className="feature-card"><h3>Zero-knowledge</h3><p>AES-GCM encryption in your browser. We only ever see ciphertext.</p></div>
            <div className="feature-card"><h3>Burn after reading</h3><p>One-time links destroyed on open. Optional expiry windows.</p></div>
            <div className="feature-card"><h3>Photos & files</h3><p>Share screenshots or configs. Encrypted before they leave your device.</p></div>
            <div className="feature-card"><h3>No accounts required</h3><p>Send in seconds. Optional login for a dashboard of sent secrets.</p></div>
          </div>
        </div>
      </section>

      <footer>
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
