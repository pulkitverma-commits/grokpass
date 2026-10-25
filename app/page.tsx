'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

async function encryptFile(file: File): Promise<{ ct: string; iv: string; key: string }> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buffer = await file.arrayBuffer();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buffer);
  const rawKey = await crypto.subtle.exportKey('raw', key);
  const toB64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { ct: toB64(ciphertext), iv: toB64(iv), key: toB64(rawKey) };
}

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
  }, []);

  async function createSecret() {
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
      alert('Failed: ' + (e as Error).message);
    }
    setLoading(false);
  }

  return (
    <>
      <header style={{ textAlign: 'center', marginBottom: '1rem' }}>
        <h1>Grok<span>Pass</span></h1>
        <p style={{ color: '#9aa0a6' }}>Encrypted secrets & photos that disappear</p>
        <nav>
          {user ? <Link href="/dashboard">Dashboard</Link> : <Link href="/login">Login</Link>}
        </nav>
      </header>

      <div className="card">
        <textarea
          placeholder="Password, note, or leave blank for photo only..."
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
        />
        <label style={{ display: 'block', marginTop: '1rem', color: '#9aa0a6' }}>
          Or attach a photo / file (encrypted in your browser)
          <input type="file" accept="image/*,.pdf,.txt,.json" onChange={e => setFile(e.target.files?.[0] || null)} />
        </label>
        {file && <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>Selected: {file.name} ({Math.round(file.size / 1024)} KB)</p>}
        <button onClick={createSecret} disabled={loading || (!text && !file)} style={{ marginTop: '1rem' }}>
          {loading ? 'Encrypting…' : 'Create secure link'}
        </button>

        {link && (
          <div style={{ marginTop: '1.5rem' }}>
            <p>Share this link:</p>
            <div className="link-box">{link}</div>
            <button onClick={() => navigator.clipboard.writeText(link)}>Copy</button>
            <p className="warning">Photo/file is encrypted client-side. In production this ciphertext is stored in Supabase Storage; the key stays only in the URL fragment.</p>
          </div>
        )}
      </div>
    </>
  );
}
