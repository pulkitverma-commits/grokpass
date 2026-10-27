// Server-only Razorpay helpers. Never import from a client component.
import { createHmac, timingSafeEqual } from 'crypto';

export type PaidPlan = 'plus' | 'pro';

export const PLAN_INFO: Record<PaidPlan, { name: string; inr: number }> = {
  plus: { name: 'OnePeek Plus', inr: 99 },
  pro: { name: 'OnePeek Pro', inr: 249 },
};

// Razorpay Dashboard → Subscriptions → Plans: create a monthly ₹99 plan and a monthly ₹249 plan,
// then put their IDs (plan_…) in RAZORPAY_PLAN_PLUS and RAZORPAY_PLAN_PRO.
export function billingConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  const plans: Record<PaidPlan, string> = {
    plus: process.env.RAZORPAY_PLAN_PLUS || '',
    pro: process.env.RAZORPAY_PLAN_PRO || '',
  };
  const enabled = !!(keyId && keySecret && plans.plus && plans.pro);
  return { keyId, keySecret, webhookSecret, plans, enabled };
}

export function planFromRazorpayPlanId(planId: string | null | undefined): PaidPlan | null {
  const { plans } = billingConfig();
  if (!planId) return null;
  if (planId === plans.plus) return 'plus';
  if (planId === plans.pro) return 'pro';
  return null;
}

export async function razorpay<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { keyId, keySecret } = billingConfig();
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: init.method || 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as any)?.error?.description || `Razorpay error ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export function hmacHex(secret: string, payload: string) {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a || '', 'utf8');
  const y = Buffer.from(b || '', 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The fields we keep from a Razorpay subscription entity. */
export function subscriptionRow(sub: any) {
  return {
    plan: planFromRazorpayPlanId(sub?.plan_id) || 'free',
    status: String(sub?.status || 'created'),
    razorpay_subscription_id: String(sub?.id || ''),
    current_period_end: sub?.current_end ? new Date(Number(sub.current_end) * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
}
