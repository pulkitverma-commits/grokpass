'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

export default function RevealPage() {
  const params = useParams();
  const [secret, setSecret] = useState<any>(null);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) {
      setError('This link is invalid or has already been destroyed.');
      setLoading(false);
      return;
    }
    try {
      const data = JSON.parse(atob(hash));
      setSecret(data);
    } catch {
      setError('Could not read this secret. The link may be corrupted.');
    }
    setLoading(false);
  }, []);

  async function reveal() {
    if (!secret) return;
    if (secret.type === 'file') {
      const fromB64 = (s: string) => {
        s = s.replace(/-/g, '+').replace(/_/g, '/');
        while (s.length % 4) s += '=';
        const bin = atob(s);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return buf;
      };
      try {
        const ct = fromB64(secret.ct);
        const iv = fromB64(secret.iv);
        const rawKey = fromB64(secret.key);
        const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
        const blob = new Blob([plain], { type: secret.mime || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = secret.name || 'secret-file';
        a.click();
        URL.revokeObjectURL(url);
        if (secret.mime?.startsWith('image/')) {
          setSecret({ ...secret, preview: url });
        }
      } catch {
        setError('Failed to decrypt the file.');
        return;
      }
    }
    setRevealed(true);
    history.replaceState(null, '', window.location.pathname);
  }

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#0A0C0F' }}>
      {/* Animated background */}
      <div className="bg-layer" aria-hidden="true">
        <div className="gp-grid" />
        <div className="gp-glow gp-glow-a" />
        <div className="gp-glow gp-glow-b" />
        <div className="gp-scan" />
      </div>

      <header className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', position: 'relative', zIndex: 10 }}>
        <Link href="/" className="logo">
          <span className="logo-mark">1</span>
          <span>OnePass</span>
        </Link>
        <Link href="/" className="gp-btn gp-ghost" style={{ textDecoration: 'none' }}>
          Send your own →
        </Link>
      </header>

      <main style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 80px)', padding: '40px 24px' }}>
        <div className="tool-card" style={{ width: '100%', maxWidth: 560 }}>
          <div className="tool-header">
            <div className="dots"><span /><span /><span /></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🔒</span>
              <span>one-time secret</span>
            </div>
          </div>

          <div className="tool-body" style={{ gap: 20 }}>
            {loading && (
              <p style={{ color: '#A3ABB6', textAlign: 'center' }}>Loading…</p>
            )}

            {!loading && error && (
              <>
                <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 400, color: '#F4F5F6' }}>Link destroyed</h2>
                <p className="warning" style={{ margin: 0 }}>{error}</p>
                <p style={{ color: '#A3ABB6', fontSize: '0.95rem', margin: 0 }}>
                  OnePass links can only be opened once. After the secret is revealed, the link is permanently destroyed.
                </p>
                <Link href="/" className="gp-btn" style={{ justifyContent: 'center', textDecoration: 'none', marginTop: 8 }}>
                  Send a new secret
                </Link>
              </>
            )}

            {!loading && secret && !error && (
              <>
                <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 400, color: '#F4F5F6' }}>
                  Someone sent you a secret
                </h2>
                <p style={{ color: '#A3ABB6', margin: 0, fontSize: '0.95rem' }}>
                  {secret.type === 'file' ? `File: ${secret.name}` : 'Text or password'}
                </p>

                {!revealed ? (
                  <>
                    <p style={{ color: '#C9CED6', margin: 0, fontSize: '0.95rem' }}>
                      This secret is encrypted in your browser. Click below to reveal it. The link will be destroyed immediately after.
                    </p>
                    <button className="gp-btn" onClick={reveal} style={{ width: '100%', justifyContent: 'center' }}>
                      Reveal secret
                    </button>
                  </>
                ) : (
                  <>
                    {secret.type === 'text' && (
                      <pre style={{
                        whiteSpace: 'pre-wrap',
                        background: '#0A0C0F',
                        border: '1px solid #262C35',
                        borderRadius: 10,
                        padding: 16,
                        fontFamily: "'Geist Mono', ui-monospace, monospace",
                        fontSize: 14,
                        color: '#E6E8EB',
                        margin: 0,
                        overflowX: 'auto'
                      }}>
                        {secret.content}
                      </pre>
                    )}
                    {secret.type === 'file' && (
                      <div>
                        <p style={{ color: '#C9CED6', margin: '0 0 12px' }}>Downloaded: <strong>{secret.name}</strong></p>
                        {secret.preview && (
                          <img src={secret.preview} alt="preview" style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #262C35' }} />
                        )}
                      </div>
                    )}
                    <p className="warning" style={{ margin: 0 }}>
                      This link has been destroyed. You cannot open it again.
                    </p>
                    <Link href="/" className="gp-btn gp-ghost" style={{ justifyContent: 'center', textDecoration: 'none' }}>
                      Send your own secret
                    </Link>
                  </>
                )}
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
