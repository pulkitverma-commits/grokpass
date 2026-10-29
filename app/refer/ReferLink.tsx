'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import BrandIcon from '../components/BrandIcon';
import { getClientId, type Quota } from '@/lib/quota';

export default function ReferLink() {
  const [q, setQ] = useState<Quota | null>(null);
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && !!navigator.share);
    supabase?.rpc('get_quota', { p_client_id: getClientId(), p_ref: null }).then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : null;
      if (row) setQ(row as Quota);
    });
  }, []);

  const link = q?.ref_code ? `${window.location.origin}/?ref=${q.ref_code}` : '';
  const text = 'I use OnePeek to send passwords and private files as links that open once. Try it:';

  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  }

  return (
    <div className="refer-box">
      <span className="refer-label">Your referral link</span>
      <div className="dash-ref">
        <code>{link ? link.replace(/^https?:\/\//, '') : 'Loading…'}</code>
        <button type="button" onClick={copy} disabled={!link}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <div className="share-btns">
        <a className="share-btn" href={link ? `https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}` : undefined} target="_blank" rel="noopener noreferrer"><BrandIcon brand="whatsapp" />WhatsApp</a>
        <a className="share-btn" href={link ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}` : undefined} target="_blank" rel="noopener noreferrer"><BrandIcon brand="linkedin" />LinkedIn</a>
        <a className="share-btn" href={link ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}` : undefined} target="_blank" rel="noopener noreferrer"><BrandIcon brand="x" />X</a>
        {canShare && <button type="button" className="share-btn" onClick={() => navigator.share({ title: 'OnePeek', text, url: link }).catch(() => {})}>More…</button>}
      </div>
      {q && <p className="refer-stats">{q.referred} friend{q.referred === 1 ? '' : 's'} joined · {q.quota === null ? 'Unlimited' : `${q.quota} secrets`} a month on this {q.plan === 'free' ? 'browser' : 'account'}</p>}
    </div>
  );
}
