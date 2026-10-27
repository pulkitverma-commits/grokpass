'use client';

import { supabase } from './supabase';

declare global { interface Window { Razorpay?: any } }

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Razorpay Checkout.'));
    document.body.appendChild(s);
  });
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = (await supabase?.auth.getSession()) || { data: { session: null } };
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function billingCall(action: 'subscribe' | 'verify' | 'cancel', body: unknown = {}) {
  const res = await fetch(`/api/billing/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** Starts Razorpay Checkout for Plus or Pro. Resolves with a message for the user. */
export async function startCheckout(plan: 'plus' | 'pro'): Promise<{ ok: boolean; message: string }> {
  const start = await billingCall('subscribe', { plan });
  if (start.status === 401) return { ok: false, message: 'login' };
  if (start.status === 503) return { ok: false, message: 'Payments are being set up. Email secret@onepeek.io and we’ll upgrade you by hand.' };
  if (start.status === 409) return { ok: true, message: 'You’re already on this plan.' };
  if (!start.ok) return { ok: false, message: start.data?.message || 'Could not start checkout. Please try again.' };
  if (start.data?.switched) return { ok: true, message: 'Your plan has been changed.' };

  await loadScript();
  return new Promise((resolve) => {
    const rzp = new window.Razorpay({
      key: start.data.keyId,
      subscription_id: start.data.subscriptionId,
      name: 'OnePeek',
      description: `${start.data.name} · ₹${start.data.amount}/month`,
      prefill: { email: start.data.email, name: start.data.fullName },
      theme: { color: '#C8F135' },
      handler: async (resp: Record<string, string>) => {
        const v = await billingCall('verify', resp);
        resolve(v.ok ? { ok: true, message: 'Payment received. Your plan is active.' } : { ok: false, message: 'We couldn’t confirm the payment yet. If you were charged, it will show up within a few minutes.' });
      },
      modal: { ondismiss: () => resolve({ ok: false, message: '' }) },
    });
    rzp.open();
  });
}
