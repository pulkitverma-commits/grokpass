// Server-only helpers for the app API (/api/v1/*), used by TopShelf "Send Securely".
// Never import this from a client component.
//
// Auth: apps register once (POST /api/v1/installs) with SHA-256 of a random secret they keep in
// their keychain, and then send `Authorization: OnePeek-Install <installId>.<secret>` on every
// call. Only the hash is stored. An install sees and manages only its own shares, and revoking a
// share additionally needs that share's manage token (also stored as a hash only).
//
// Nothing secret is ever logged: no request bodies, tokens or ciphertext — only error codes.
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, sha256Hex } from '@/lib/server';

export const API_VERSION = 'v1';
export const MAX_UPLOAD_BYTES = Math.min(Number(process.env.APP_MAX_UPLOAD_BYTES) || 52_428_800, 52_428_800);

const NO_STORE = { 'Cache-Control': 'no-store' };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** A stable error envelope: `{ error: { code, message } }`. Messages never echo user input. */
export function fail(code: string, status: number, message?: string, extra: Record<string, unknown> = {}) {
  return json({ error: { code, message: message ?? code.replace(/_/g, ' '), ...extra } }, status,
    status === 429 ? { 'Retry-After': '60' } : {});
}

/** The client IP as seen by Vercel (x-forwarded-for is set by Vercel's edge, not the client). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  return (fwd.split(',')[0] || req.headers.get('x-real-ip') || 'unknown').trim().slice(0, 64);
}

export async function rateOk(admin: SupabaseClient, bucket: string, limit: number, windowSeconds: number) {
  const { data, error } = await admin.rpc('api_rate_ok', { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds });
  // Fail closed: if the limiter can't be checked, refuse rather than allow unlimited calls.
  return !error && data === true;
}

export type InstallContext = { admin: SupabaseClient; installId: string };

/** Resolves the calling install, or returns an error response. */
export async function requireInstall(req: Request): Promise<InstallContext | NextResponse> {
  const admin = adminClient();
  if (!admin) return fail('not_configured', 503);
  const m = /^OnePeek-Install\s+([A-Za-z0-9]{22})\.([A-Za-z0-9_-]{43})$/.exec(req.headers.get('authorization') || '');
  if (!m) return fail('unauthorized', 401);
  const [, installId, secret] = m;
  // Throttle by IP before touching the install, so secrets can't be guessed at speed.
  if (!(await rateOk(admin, `auth:${clientIp(req)}`, 600, 60))) return fail('rate_limited', 429);
  const { data, error } = await admin.rpc('app_auth', { p_install: installId, p_secret_hash: await sha256Hex(secret) });
  if (error || data !== true) return fail('unauthorized', 401);
  return { admin, installId };
}

export async function readJson<T>(req: Request, maxBytes = 300_000): Promise<T | null> {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > maxBytes) return null;
  try {
    const text = await req.text();
    if (text.length > maxBytes) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export const B64URL = /^[A-Za-z0-9_-]+$/;
export const HEX64 = /^[0-9a-f]{64}$/;
