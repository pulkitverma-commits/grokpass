// Server-only helpers. Never import this file from a client component.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

/** Service-role client: bypasses row-level security. Null when the key isn't configured. */
export function adminClient(): SupabaseClient | null {
  return url && serviceKey ? createClient(url, serviceKey, opts) : null;
}

export function anonClient(): SupabaseClient | null {
  return url && anonKey ? createClient(url, anonKey, opts) : null;
}

/** The signed-in user behind a request's "Authorization: Bearer <access token>" header. */
export async function userFromRequest(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const sb = anonClient();
  if (!token || !sb) return null;
  const { data, error } = await sb.auth.getUser(token);
  return error ? null : data.user;
}

export function siteUrl(req?: Request) {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/$/, '');
  return req ? new URL(req.url).origin : 'https://onepeek.io';
}

export async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function randomUrlToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return Buffer.from(b).toString('base64url');
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
