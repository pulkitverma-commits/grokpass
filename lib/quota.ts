// Anonymous per-browser identity used for the free quota and referrals.
import { randomToken } from './crypto';

// Storage keys keep the original names so existing browsers keep their free-secret count.
const CLIENT_KEY = 'onepass.client';
const REF_KEY = 'onepass.ref';

export const FREE_SECRETS = 10;
export const REFERRAL_SECRETS = 50;

export type Plan = 'free' | 'plus' | 'pro';
export type Quota = { used: number; quota: number | null; plan: Plan; ref_code: string; referred: number };

export const PLAN_NAME: Record<Plan, string> = { free: 'Free', plus: 'Plus', pro: 'Pro' };
export const isPaid = (p?: Plan | null) => p === 'plus' || p === 'pro';

function safeGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

export function getClientId(): string {
  let id = safeGet(CLIENT_KEY);
  if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
    id = randomToken(18);
    safeSet(CLIENT_KEY, id);
  }
  return id;
}

/** Remembers a ?ref=CODE from the URL so the referral counts when this browser is first registered. */
export function captureRef(): string | null {
  try {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref && /^[A-Za-z0-9]{8}$/.test(ref)) safeSet(REF_KEY, ref);
  } catch { /* ignore */ }
  return safeGet(REF_KEY);
}
