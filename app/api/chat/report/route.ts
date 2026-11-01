import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sessionUserFromRequest } from '@/lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = new Set(['spam', 'abuse', 'illegal', 'other']);

// Secret Chat: a member reports a room for human review. Ids only: the body is { room, reason }
// and exactly those two values reach the database, through the report_chat RPC called with the
// caller's own session (so membership, the reason check and the daily cap are enforced in SQL,
// not here). The server has no message text, nicknames, device ids or file names, and none are
// accepted, forwarded or stored. The reviewer reads chat_reports with the service role and has no
// access to any content either.
export async function POST(req: Request) {
  const user = await sessionUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'not_signed_in' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { room?: unknown; reason?: unknown };
  const room = typeof body.room === 'string' ? body.room : '';
  const reason = typeof body.reason === 'string' ? body.reason : '';
  if (!UUID.test(room)) return NextResponse.json({ error: 'bad_room' }, { status: 400 });
  if (!REASONS.has(reason)) return NextResponse.json({ error: 'bad_reason' }, { status: 400 });

  const sb = sessionClient(req);
  if (!sb) return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  const { error } = await sb.rpc('report_chat', { p_room: room.toLowerCase(), p_reason: reason });
  if (!error) return NextResponse.json({ ok: true });
  const msg = String(error.message || '');
  if (/not_a_member/.test(msg)) return NextResponse.json({ error: 'not_a_member' }, { status: 403 });
  if (/too_many_reports/.test(msg)) return NextResponse.json({ error: 'too_many_reports' }, { status: 429 });
  if (/bad_reason/.test(msg)) return NextResponse.json({ error: 'bad_reason' }, { status: 400 });
  if (/not_signed_in/.test(msg) || /permission denied/i.test(msg)) return NextResponse.json({ error: 'not_signed_in' }, { status: 401 });
  return NextResponse.json({ error: 'report_failed' }, { status: 500 });
}

/** A Supabase client acting as the caller: the anon key plus the request's own bearer token, so
 *  RLS and the RPC's auth.uid() checks apply exactly as they would from the app. */
function sessionClient(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const auth = req.headers.get('authorization') || '';
  if (!url || !anonKey || !/^Bearer\s+\S+/i.test(auth)) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: auth } },
  });
}
