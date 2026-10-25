'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

export default function RevealPage() {
  const params = useParams();
  const [secret, setSecret] = useState<any>(null);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) {
      setError('Invalid or expired link');
      return;
    }
    try {
      const data = JSON.parse(atob(hash));
      setSecret(data);
    } catch {
      setError('Could not parse secret');
    }
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
    }
    setRevealed(true);
    history.replaceState(null, '', window.location.pathname);
  }

  if (error) return <div className="card"><p className="warning">{error}</p></div>;
  if (!secret) return <div className="card">Loading…</div>;

  return (
    <div className="card">
      <h2>Someone sent you a secret</h2>
      {!revealed ? (
        <button onClick={reveal} style={{ marginTop: '1rem' }}>Reveal</button>
      ) : (
        <>
          {secret.type === 'text' && <pre style={{ whiteSpace: 'pre-wrap', marginTop: '1rem' }}>{secret.content}</pre>}
          {secret.type === 'file' && (
            <>
              <p>Downloaded: {secret.name}</p>
              {secret.preview && <img src={secret.preview} alt="preview" style={{ maxWidth: '100%', marginTop: '1rem', borderRadius: 8 }} />}
            </>
          )}
          <p className="warning">This link has been destroyed.</p>
        </>
      )}
    </div>
  );
}
