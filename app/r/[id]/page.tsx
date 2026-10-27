'use client';

import { useEffect, useState } from 'react';
import SiteFooter from '@/app/components/SiteFooter';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { encryptToPublicKey, MAX_TEXT_CHARS } from '@/lib/crypto';
import Icon from '@/app/components/Icon';

type Req = { note: string; requester: string | null; public_key: string; expires_at: string; answered: boolean };
type Phase = 'loading' | 'ready' | 'sending' | 'sent' | 'error';

export default function RespondPage() {
  const params = useParams();
  const id = String(params?.id || '');
  const [phase, setPhase] = useState<Phase>('loading');
  const [req, setReq] = useState<Req | null>(null);
  const [text, setText] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      if (!supabase || !/^[A-Za-z0-9]{6,32}$/.test(id)) { setError('This request link isn’t valid.'); setPhase('error'); return; }
      const { data, error: e } = await supabase.rpc('peek_request', { p_id: id });
      const row = (Array.isArray(data) ? data[0] : null) as Req | null;
      if (e || !row) { setError('This request has expired or was cancelled.'); setPhase('error'); return; }
      if (row.answered) { setError('This request has already been answered. Each request can be answered once.'); setPhase('error'); return; }
      setReq(row);
      setPhase('ready');
    })();
  }, [id]);

  async function submit() {
    if (!req || !text.trim()) return;
    if (text.length > MAX_TEXT_CHARS) { setError('That’s too long (max 50,000 characters).'); return; }
    setError('');
    setPhase('sending');
    try {
      // Encrypted here, to the requester's public key. We can't read it, and neither can anyone else.
      const response = await encryptToPublicKey(req.public_key, text);
      const res = await fetch('/api/request/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, response }) });
      if (res.status === 409) { setError('This request has already been answered or has expired.'); setPhase('error'); return; }
      if (!res.ok) throw new Error('send');
      setText('');
      setPhase('sent');
    } catch {
      setError('We couldn’t send it. Please try again.');
      setPhase('ready');
    }
  }

  const who = req?.requester || 'Someone';
  const expires = req ? new Date(req.expires_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#0A0C0F' }}>
      <div className="bg-layer" aria-hidden="true">
        <div className="gp-grid" />
        <div className="gp-glow gp-glow-a" />
        <div className="gp-glow gp-glow-b" />
      </div>

      <header className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', position: 'relative', zIndex: 10 }}>
        <Link href="/" className="logo" aria-label="OnePeek home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/onepeek-logo.png" alt="OnePeek" className="logo-img" width={149} height={56} />
        </Link>
        <Link href="/encryption" className="gp-btn gp-ghost" style={{ textDecoration: 'none' }}>How it’s encrypted</Link>
      </header>

      <main style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 80px)', padding: '40px 24px' }}>
        <div className="tool-card" style={{ width: '100%', maxWidth: 620 }}>
          <div className="tool-header">
            <div className="dots"><span /><span /><span /></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="lock" size={13} strokeWidth={2} />
              <span>secret request · end-to-end encrypted</span>
            </div>
          </div>
          <div className="tool-body" style={{ gap: 16 }}>
            {phase === 'loading' && <p style={{ color: '#A3ABB6', textAlign: 'center', margin: 0 }}>Checking the request…</p>}

            {phase === 'error' && (
              <>
                <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 400, color: '#F4F5F6' }}>Request unavailable</h2>
                <p className="warning" style={{ margin: 0 }}>{error}</p>
                <Link href="/" className="gp-btn" style={{ justifyContent: 'center', textDecoration: 'none' }}>Go to OnePeek</Link>
              </>
            )}

            {(phase === 'ready' || phase === 'sending') && req && (
              <>
                <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 400, color: '#F4F5F6' }}>{who} is asking you for a secret</h2>
                <div className="req-note">
                  <span>They asked for</span>
                  <strong>{req.note}</strong>
                </div>
                <div>
                  <label htmlFor="gp-answer" className="field-label">Your answer</label>
                  <div className="answer-wrap">
                    <textarea id="gp-answer" className={show ? '' : 'masked'} placeholder="Type or paste the password, key or note" value={text} onChange={e => setText(e.target.value)} autoComplete="off" spellCheck={false} />
                    <button type="button" className="dash-ghost answer-eye" onClick={() => setShow(s => !s)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
                  </div>
                </div>
                <ul className="req-facts">
                  <li><Icon name="lock" size={14} strokeWidth={2} />Encrypted in your browser so only {who} can read it. OnePeek can’t.</li>
                  <li><Icon name="flame" size={14} strokeWidth={2} />They can read it once, then it’s deleted.</li>
                  <li><Icon name="clock" size={14} strokeWidth={2} />This request expires {expires}. You don’t need an account.</li>
                </ul>
                {error && <p className="warning" style={{ margin: 0 }}>{error}</p>}
                <button className="gp-btn" onClick={submit} disabled={phase === 'sending' || !text.trim()} style={{ width: '100%', justifyContent: 'center' }}>
                  {phase === 'sending' ? 'Encrypting…' : <>Encrypt &amp; send <span className="gp-arrow">→</span></>}
                </button>
              </>
            )}

            {phase === 'sent' && (
              <>
                <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 400, color: '#F4F5F6' }}>Sent securely</h2>
                <p style={{ color: '#C9CED6', margin: 0 }}>{who} has been told it’s ready. Only they can open it, and only once. You can close this page.</p>
                <Link href="/" className="gp-btn gp-ghost" style={{ justifyContent: 'center', textDecoration: 'none' }}>Send your own secret</Link>
              </>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
