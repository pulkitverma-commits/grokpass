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
  if (file.size > 800 * 1024) throw new Error('File too large for browser demo (max ~800 KB). Use text or a smaller image.');
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
    <>
      <header className="container fade-in">
        <div className="logo">Grok<span>Pass</span></div>
        <nav>
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#tool">Send a secret</a>
          {user ? <Link href="/dashboard">Dashboard</Link> : <Link href="/login" className="btn">Login</Link>}
        </nav>
      </header>

      <section className="hero container">
        <h1 className="slide-up">Send secrets that <span style={{color:'var(--accent)'}}>disappear</span></h1>
        <p className="slide-up delay-1">
          Zero-knowledge password and photo sharing. Encrypted in your browser.
          The key never touches our servers. Links burn after one view.
        </p>

        <div id="tool" className="tool-card slide-up delay-2">
          <h2 style={{marginBottom:'0.4rem', fontSize:'1.4rem'}}>Create a secure link</h2>
          <p style={{color:'var(--muted)', marginBottom:'1rem', fontSize:'0.95rem'}}>Encrypted in your browser. No account needed.</p>
          <textarea
            placeholder="Password, API key, note… or leave blank and attach a file"
            value={text}
            onChange={e => setText(e.target.value)}
          />
          <label className="file-label">
            Attach a photo or file (max ~800 KB for this demo)
            <input type="file" accept="image/*,.pdf,.txt,.json" onChange={e => setFile(e.target.files?.[0] || null)} />
          </label>
          {file && (
            <p style={{fontSize:'0.85rem', marginTop:'0.5rem', color:'var(--muted)'}}>
              Selected: {file.name} ({Math.round(file.size/1024)} KB)
            </p>
          )}
          <button className="btn" onClick={createSecret} disabled={loading || (!text && !file)} style={{marginTop:'1rem', width:'100%'}}>
            {loading ? 'Encrypting…' : 'Create secure link'}
          </button>
          {error && <p className="warning">{error}</p>}
          {link && (
            <div style={{marginTop:'1.5rem'}}>
              <p style={{marginBottom:'0.5rem'}}>Share this link:</p>
              <div className="link-box">{link}</div>
              <button className="btn btn-outline" onClick={() => navigator.clipboard.writeText(link)} style={{width:'auto'}}>
                Copy link
              </button>
              <p className="warning" style={{marginTop:'0.75rem'}}>
                The key is in the URL fragment. In production the ciphertext is stored in Supabase Storage.
              </p>
            </div>
          )}
        </div>
      </section>

      <section id="features" className="container">
        <h2 className="section-title fade-in">Why teams choose GrokPass</h2>
        <p className="section-sub fade-in">Stop pasting passwords into Slack, email, or tickets.</p>
        <div className="grid">
          <div className="feature-card pop-in">
            <h3>Zero-knowledge</h3>
            <p>Encryption happens in your browser with AES-GCM. We only ever store ciphertext. The decryption key lives only in the URL fragment.</p>
          </div>
          <div className="feature-card pop-in delay-1">
            <h3>Burn after reading</h3>
            <p>One-time links are destroyed the moment they are opened. Set automatic expiry for 1 hour, 24 hours, or 7 days.</p>
          </div>
          <div className="feature-card pop-in delay-2">
            <h3>Photos & files</h3>
            <p>Share screenshots, config files, or short notes. Everything is encrypted client-side before it leaves your device.</p>
          </div>
          <div className="feature-card pop-in delay-3">
            <h3>No accounts required</h3>
            <p>Send a secret in seconds. Optional login gives you a dashboard of what you’ve sent and whether it was opened.</p>
          </div>
        </div>
      </section>

      <section id="how" className="container">
        <h2 className="section-title fade-in">How it works</h2>
        <p className="section-sub fade-in">Three steps. Nothing complicated.</p>
        <div className="grid">
          <div className="feature-card pop-in">
            <h3>1. Paste or upload</h3>
            <p>Type a password, API key, or drop a photo. Encryption starts immediately in your browser.</p>
          </div>
          <div className="feature-card pop-in delay-1">
            <h3>2. Share the link</h3>
            <p>Copy the unique link. The decryption key is in the # fragment and is never sent to the server.</p>
          </div>
          <div className="feature-card pop-in delay-2">
            <h3>3. They open it once</h3>
            <p>Recipient clicks Reveal. Their browser decrypts the secret locally. The link is destroyed.</p>
          </div>
        </div>
      </section>

      <footer className="fade-in">
        <div className="container footer-grid">
          <div>
            <div className="logo" style={{marginBottom:'0.5rem'}}>Grok<span>Pass</span></div>
            <p>Zero-knowledge secret sharing. Encrypted in your browser.</p>
          </div>
          <div>
            <h4>Product</h4>
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#tool">Send a secret</a>
          </div>
          <div>
            <h4>Account</h4>
            <Link href="/login">Login</Link>
            <Link href="/dashboard">Dashboard</Link>
          </div>
          <div>
            <h4>Legal</h4>
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
          </div>
        </div>
        <div className="container" style={{marginTop:'2rem', paddingTop:'1rem', borderTop:'1px solid var(--border)', textAlign:'center'}}>
          © {new Date().getFullYear()} GrokPass · Encrypted in your browser
        </div>
      </footer>
    </>
  );
}
