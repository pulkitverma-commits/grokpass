'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { toB64Url, randomToken } from '@/lib/crypto';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Characters settle left to right, the rest flicker as random base64 - purely visual.
function Scramble({ value, className }: { value: string; className?: string }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(value); return; }
    let raf = 0;
    const start = performance.now();
    const dur = 650;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const fixed = Math.floor(value.length * p);
      let s = value.slice(0, fixed);
      for (let i = fixed; i < value.length; i++) s += B64[(Math.random() * 64) | 0];
      setShown(s);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={className}>{shown}</span>;
}

export default function CryptoDemo() {
  const [text, setText] = useState('Wi-Fi password: sunflower-42');
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [keyB64, setKeyB64] = useState('');
  const [id, setId] = useState('');
  const [iv, setIv] = useState('');
  const [ct, setCt] = useState('');
  const [ok, setOk] = useState<boolean | null>(null);
  const seq = useRef(0);

  const newKey = useCallback(async () => {
    const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    setKeyB64(toB64Url(await crypto.subtle.exportKey('raw', k)));
    setId(randomToken(8).replace(/[-_]/g, 'x').slice(0, 10));
    setKey(k);
  }, []);

  useEffect(() => { newKey(); }, [newKey]);

  useEffect(() => {
    if (!key) return;
    const n = ++seq.current;
    (async () => {
      const ivBytes = crypto.getRandomValues(new Uint8Array(12));
      const data = new TextEncoder().encode(text);
      const out = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBytes }, key, data));
      const back = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, out));
      if (n !== seq.current) return;
      setIv(toB64Url(ivBytes));
      setCt(toB64Url(out));
      setOk(back === text);
    })().catch(() => setOk(false));
  }, [key, text]);

  const bytes = new TextEncoder().encode(text).length;

  return (
    <div className="ex-demo">
      <div className="ex-demo-head">
        <span className="ex-live"><span className="dot" /> Live, in this browser</span>
        <button type="button" className="ex-chip-btn" onClick={newKey}><Icon name="key" size={14} /> New key</button>
      </div>

      <label className="ex-demo-label" htmlFor="ex-demo-input">1 · Type something secret</label>
      <textarea id="ex-demo-input" className="ex-demo-input" value={text} maxLength={400} rows={2}
        onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <p className="ex-demo-note"><Icon name="ban" size={13} /> Nothing you type here is sent anywhere. This uses the same Web Crypto API OnePeek uses.</p>

      <div className="ex-demo-grid">
        <div className="ex-demo-cell">
          <span className="ex-demo-label">2 · Your 256-bit key</span>
          <code className="ex-mono ex-key">{keyB64 ? <Scramble value={keyB64} /> : '…'}</code>
        </div>
        <div className="ex-demo-cell">
          <span className="ex-demo-label">3 · Random 96-bit IV</span>
          <code className="ex-mono">{iv ? <Scramble value={iv} /> : '…'}</code>
        </div>
      </div>

      <span className="ex-demo-label">4 · AES-256-GCM ciphertext <em>({bytes} bytes in → {bytes + 16} out, incl. tamper tag)</em></span>
      <code className="ex-mono ex-cipher-out">{ct ? <Scramble value={ct} /> : '…'}</code>

      <span className="ex-demo-label">5 · The link you’d share</span>
      <div className="ex-url">
        <span className="ex-url-part ex-url-server">
          <span className="ex-mono">https://onepeek.io/s/{id || '…'}</span>
          <small><Icon name="send" size={12} /> Sent to our server, finds the ciphertext</small>
        </span>
        <span className="ex-url-part ex-url-key">
          <span className="ex-mono">#{keyB64 ? keyB64.slice(0, 18) + '…' : '…'}</span>
          <small><Icon name="lock" size={12} /> Never leaves the browser</small>
        </span>
      </div>

      <p className={`ex-roundtrip ${ok ? 'ok' : ''}`}>
        <Icon name={ok ? 'check' : 'clock'} size={15} />
        {ok === null ? 'Encrypting…' : ok ? 'Decrypted back with the key: matches exactly.' : 'Could not decrypt.'}
      </p>
    </div>
  );
}
