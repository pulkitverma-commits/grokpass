import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { adminClient, siteUrl } from '@/lib/server';
import { notifyAnswered } from '@/lib/alerts';

export const dynamic = 'force-dynamic';

// Stores the answer to a request. The answer arrives already encrypted to the requester's
// public key, so this server can't read it.
export async function POST(req: Request) {
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  let body: { id?: unknown; response?: unknown } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const id = String(body.id || '');
  const response = String(body.response || '');
  if (!/^[A-Za-z0-9]{6,32}$/.test(id) || !/^[A-Za-z0-9_.-]{40,160000}$/.test(response)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const { data: owner, error } = await admin.rpc('respond_request', { p_id: id, p_response: response });
  if (error) return NextResponse.json({ error: 'failed' }, { status: 502 });
  if (!owner) return NextResponse.json({ error: 'gone' }, { status: 409 });

  waitUntil(notifyAnswered(admin, id, String(owner), siteUrl(req)).catch(() => {}));
  return NextResponse.json({ ok: true });
}
