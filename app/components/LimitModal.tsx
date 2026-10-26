'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { REFERRAL_SECRETS, type Quota } from '@/lib/quota';

type Choice = 'plus' | 'refer';

export default function LimitModal({ quota, onClose }: { quota: Quota | null; onClose: () => void }) {
  const [choice, setChoice] = useState<Choice>('plus');
  const [step, setStep] = useState<'choose' | 'refer'>('choose');
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const referLink = quota ? `${typeof window !== 'undefined' ? window.location.origin : ''}/?ref=${quota.ref_code}` : '';
  const alreadyReferred = (quota?.quota ?? 0) >= REFERRAL_SECRETS;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function copy() {
    navigator.clipboard.writeText(referLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  return (
    <div className="lm-backdrop" onClick={onClose}>
      <div className="lm-card" role="dialog" aria-modal="true" aria-labelledby="lm-title" onClick={e => e.stopPropagation()}>
        <button ref={closeRef} type="button" className="lm-close" aria-label="Close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>

        <div className="lm-icon" aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.9 19.1A10 10 0 1 1 19.1 19.1" /><path d="m12 13 3.5-4.5" /><circle cx="12" cy="13" r="1.4" fill="currentColor" /></svg>
        </div>

        {step === 'choose' ? (
          <>
            <h2 id="lm-title" className="lm-title">Free limit reached</h2>
            <p className="lm-sub">
              You’ve used all {quota?.quota ?? 10} free secrets.<br />
              Pick a way to keep sharing.
            </p>

            <div className="lm-options" role="radiogroup" aria-label="Options">
              <button type="button" role="radio" aria-checked={choice === 'refer'} className={`lm-option ${choice === 'refer' ? 'on' : ''}`} onClick={() => setChoice('refer')}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
                <strong>Refer a friend</strong>
                <span>{alreadyReferred ? 'Already unlocked on this browser' : `Unlock ${REFERRAL_SECRETS} secret shares`}</span>
              </button>
              <button type="button" role="radio" aria-checked={choice === 'plus'} className={`lm-option ${choice === 'plus' ? 'on' : ''}`} onClick={() => setChoice('plus')}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="M12 8v6M9 11h6" /></svg>
                <strong>OnePeek+</strong>
                <span>Unlimited secrets, no limits</span>
              </button>
            </div>

            {choice === 'plus' ? (
              <Link href="/plus" className="lm-continue">Continue</Link>
            ) : (
              <button type="button" className="lm-continue" onClick={() => setStep('refer')}>Continue</button>
            )}
          </>
        ) : (
          <>
            <h2 id="lm-title" className="lm-title">Refer a friend</h2>
            <p className="lm-sub">
              Share your link. When a friend starts using OnePeek through it,<br />
              your limit goes up to {REFERRAL_SECRETS} secrets.
            </p>
            <div className="lm-ref">
              <span>{referLink}</span>
              <button type="button" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
            </div>
            <p className="lm-note">{quota?.referred ? `${quota.referred} friend${quota.referred === 1 ? '' : 's'} joined with your link.` : 'No friends have joined yet.'}</p>
            <button type="button" className="lm-continue" onClick={onClose}>Done</button>
          </>
        )}
      </div>
    </div>
  );
}
