'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase, accountUser } from '@/lib/supabase';
import { startCheckout, billingCall } from '@/lib/checkout';
import { getClientId, type Plan } from '@/lib/quota';

function useAccount() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      if (!supabase) { setSignedIn(false); return; }
      const { data } = await supabase.auth.getSession();
      if (!live) return;
      setSignedIn(!!accountUser(data.session));
      const { data: q } = await supabase.rpc('get_quota', { p_client_id: getClientId(), p_ref: null });
      const row = Array.isArray(q) ? q[0] : null;
      if (live && row?.plan) setPlan(row.plan as Plan);
    })();
    return () => { live = false; };
  }, []);
  return { signedIn, plan, setPlan };
}

export function PlanButton({ plan }: { plan: Plan }) {
  const { signedIn, plan: current, setPlan } = useAccount();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  if (plan === 'free') {
    return <Link href="/#send" className="gp-btn gp-ghost plan-cta">{current === 'free' || !current ? 'Start free' : 'Send a secret'}</Link>;
  }
  if (current === plan) {
    return <div className="plan-cta-wrap"><span className="plan-current">Your current plan</span><Link href="/dashboard" className="plan-manage">Manage in dashboard</Link></div>;
  }

  async function go() {
    setMsg('');
    if (signedIn === false) { window.location.href = '/login?next=/pricing'; return; }
    setBusy(true);
    const res = await startCheckout(plan as 'plus' | 'pro');
    setBusy(false);
    if (res.message === 'login') { window.location.href = '/login?next=/pricing'; return; }
    if (res.ok) setPlan(plan);
    setMsg(res.message);
  }

  return (
    <div className="plan-cta-wrap">
      <button type="button" className={`gp-btn plan-cta${plan === 'pro' ? '' : ''}`} onClick={go} disabled={busy}>
        {busy ? 'Opening checkout…' : current && current !== 'free' ? `Switch to ${plan === 'pro' ? 'Pro' : 'Plus'}` : `Get ${plan === 'pro' ? 'Pro' : 'Plus'}`}
      </button>
      {msg && <p className="plan-msg" role="status">{msg}</p>}
    </div>
  );
}

/** Shown while paid plans aren't enforced yet, so the page stays truthful. */
export function EarlyAccessNote() {
  const [enforced, setEnforced] = useState<boolean | null>(null);
  useEffect(() => {
    supabase?.rpc('plans_enforced').then(({ data, error }) => setEnforced(error ? false : !!data));
  }, []);
  if (enforced !== false) return null;
  return <p className="early-note">Early access: everything in Plus and Pro is free for everyone until paid plans launch. Only the monthly secret limits apply.</p>;
}

/** Dashboard card: current plan, renewal and cancel. */
export function PlanCard() {
  const { plan } = useAccount();
  const [sub, setSub] = useState<{ status: string; current_period_end: string | null; cancel_at_period_end: boolean } | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    supabase?.from('subscriptions').select('status,current_period_end,cancel_at_period_end').maybeSingle().then(({ data }) => setSub(data as typeof sub));
  }, []);
  const name = plan === 'pro' ? 'Pro' : plan === 'plus' ? 'Plus' : 'Free';
  const renew = sub?.current_period_end ? new Date(sub.current_period_end).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  async function cancel() {
    if (!confirm(`Cancel ${name}? It stays active until ${renew || 'the end of this billing period'}.`)) return;
    const r = await billingCall('cancel');
    setMsg(r.ok ? `Cancelled. ${name} stays active until ${renew || 'the end of this period'}.` : 'Couldn’t cancel right now. Please email secret@onepeek.io.');
    if (r.ok) setSub(s => (s ? { ...s, cancel_at_period_end: true } : s));
  }

  return (
    <>
      <strong className="dash-big">{name}</strong>
      {plan === 'free' || !plan ? (
        <Link href="/pricing" className="dash-link">See plans →</Link>
      ) : (
        <span className="dash-muted">
          {sub?.cancel_at_period_end ? `Ends ${renew || 'soon'}` : renew ? `Renews ${renew}` : 'Active'}
          {' · '}<Link href="/pricing" className="dash-link">Change</Link>
          {!sub?.cancel_at_period_end && sub?.status === 'active' && <>{' · '}<button type="button" className="dash-clear" onClick={cancel}>Cancel</button></>}
        </span>
      )}
      {msg && <span className="dash-muted">{msg}</span>}
    </>
  );
}
