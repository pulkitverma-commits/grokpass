import { NextResponse } from 'next/server';
import { adminClient, userFromRequest } from '@/lib/server';
import { billingConfig, razorpay, hmacHex, safeEqualHex, subscriptionRow, PLAN_INFO, planFromRazorpayPlanId, type PaidPlan } from '@/lib/billing';

export const dynamic = 'force-dynamic';

// Razorpay subscriptions for Plus and Pro.
//   GET  /api/billing/config     → is billing switched on (and the public key id)
//   POST /api/billing/subscribe  → start (or switch) a subscription for the signed-in user
//   POST /api/billing/verify     → confirm a payment from Razorpay Checkout (signature checked)
//   POST /api/billing/cancel     → cancel at the end of the current period
//   POST /api/billing/webhook    → Razorpay webhooks (signature checked)
// Plans are only ever written by this server, after a valid Razorpay signature.

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(_req: Request, { params }: { params: { action: string } }) {
  if (params.action !== 'config') return json({ error: 'not_found' }, 404);
  const cfg = billingConfig();
  return json({ enabled: cfg.enabled, keyId: cfg.enabled ? cfg.keyId : null });
}

export async function POST(req: Request, { params }: { params: { action: string } }) {
  const cfg = billingConfig();
  const admin = adminClient();
  if (params.action === 'webhook') return webhook(req, cfg.webhookSecret, admin);
  if (!cfg.enabled || !admin) return json({ error: 'billing_not_configured' }, 503);

  const user = await userFromRequest(req);
  if (!user) return json({ error: 'login_required' }, 401);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const { data: current } = await admin.from('subscriptions').select('*').eq('owner', user.id).maybeSingle();
  const live = current && ['active', 'authenticated', 'pending'].includes(current.status) && current.razorpay_subscription_id;

  try {
    if (params.action === 'subscribe') {
      const plan = body.plan === 'plus' || body.plan === 'pro' ? (body.plan as PaidPlan) : null;
      if (!plan) return json({ error: 'invalid_plan' }, 400);
      if (live && current.plan === plan) return json({ error: 'already_subscribed' }, 409);
      if (live) {
        // Switching between Plus and Pro: change the plan on the existing subscription now.
        const sub = await razorpay(`/subscriptions/${current.razorpay_subscription_id}`, {
          method: 'PATCH', body: { plan_id: cfg.plans[plan], schedule_change_at: 'now', customer_notify: 1 },
        });
        await admin.from('subscriptions').update(subscriptionRow(sub)).eq('owner', user.id);
        return json({ switched: true, plan });
      }
      const sub = await razorpay('/subscriptions', {
        method: 'POST',
        body: { plan_id: cfg.plans[plan], total_count: 120, quantity: 1, customer_notify: 1, notes: { owner: user.id, plan } },
      });
      await admin.from('subscriptions').upsert({ owner: user.id, ...subscriptionRow(sub), plan: 'free', status: 'created', cancel_at_period_end: false });
      return json({
        subscriptionId: sub.id, keyId: cfg.keyId,
        name: PLAN_INFO[plan].name, amount: PLAN_INFO[plan].inr,
        email: user.email || '', fullName: (user.user_metadata as any)?.full_name || (user.user_metadata as any)?.name || '',
      });
    }

    if (params.action === 'verify') {
      const paymentId = String(body.razorpay_payment_id || '');
      const subId = String(body.razorpay_subscription_id || '');
      const signature = String(body.razorpay_signature || '');
      if (!paymentId || !subId || !safeEqualHex(hmacHex(cfg.keySecret, `${paymentId}|${subId}`), signature)) {
        return json({ error: 'bad_signature' }, 400);
      }
      const sub = await razorpay(`/subscriptions/${subId}`);
      if (sub?.notes?.owner !== user.id) return json({ error: 'not_yours' }, 403);
      const row = subscriptionRow(sub);
      // Paid but Razorpay may still say "authenticated" for a moment; treat a verified payment as active.
      const status = ['active', 'authenticated'].includes(row.status) ? 'active' : row.status;
      await admin.from('subscriptions').upsert({ owner: user.id, ...row, status, cancel_at_period_end: false });
      return json({ ok: true, plan: row.plan });
    }

    if (params.action === 'cancel') {
      if (!live) return json({ error: 'no_subscription' }, 404);
      await razorpay(`/subscriptions/${current.razorpay_subscription_id}/cancel`, { method: 'POST', body: { cancel_at_cycle_end: 1 } });
      await admin.from('subscriptions').update({ cancel_at_period_end: true, updated_at: new Date().toISOString() }).eq('owner', user.id);
      return json({ ok: true, until: current.current_period_end });
    }
  } catch (e) {
    return json({ error: 'razorpay_error', message: (e as Error).message }, 502);
  }
  return json({ error: 'not_found' }, 404);
}

async function webhook(req: Request, secret: string, admin: ReturnType<typeof adminClient>) {
  if (!secret || !admin) return json({ error: 'billing_not_configured' }, 503);
  const raw = await req.text();
  const signature = req.headers.get('x-razorpay-signature') || '';
  if (!safeEqualHex(hmacHex(secret, raw), signature)) return json({ error: 'bad_signature' }, 400);
  let evt: any;
  try { evt = JSON.parse(raw); } catch { return json({ error: 'bad_json' }, 400); }
  const sub = evt?.payload?.subscription?.entity;
  if (!sub?.id) return json({ ok: true, ignored: true });

  const owner: string | undefined = sub?.notes?.owner;
  const row = subscriptionRow(sub);
  const ended = ['cancelled', 'completed', 'expired', 'halted'].includes(row.status);
  const update = {
    ...row,
    plan: planFromRazorpayPlanId(sub.plan_id) || row.plan,
    cancel_at_period_end: evt.event === 'subscription.cancelled' ? false : undefined,
    ...(ended ? { plan: 'free' as const } : {}),
  };
  if (update.cancel_at_period_end === undefined) delete (update as any).cancel_at_period_end;

  if (owner && /^[0-9a-f-]{36}$/i.test(owner)) {
    await admin.from('subscriptions').upsert({ owner, ...update });
  } else {
    await admin.from('subscriptions').update(update).eq('razorpay_subscription_id', sub.id);
  }
  return json({ ok: true });
}
