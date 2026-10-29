import { NextResponse } from 'next/server';
import { adminClient, sessionUserFromRequest } from '@/lib/server';
import { pushConfigured, pushTo } from '@/lib/alerts';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Secret Chat: after sending, a member's browser asks us to nudge the other members.
// The push says only that there is a new message. No sender, no text, no file name:
// the server never has any of those.
export async function POST(req: Request) {
  const user = await sessionUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'not_signed_in' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { room?: string };
  const room = String(body.room || '');
  if (!UUID.test(room)) return NextResponse.json({ error: 'bad_room' }, { status: 400 });

  const admin = adminClient();
  if (!admin || !pushConfigured()) return NextResponse.json({ ok: true, sent: 0 });

  const { data: r } = await admin.from('chat_rooms').select('state, expires_at').eq('id', room).maybeSingle();
  if (!r || r.state !== 'active' || new Date(r.expires_at) <= new Date()) return NextResponse.json({ ok: true, sent: 0 });

  const { data: rows } = await admin.from('chat_members').select('user_id, state').eq('room_id', room);
  const members = rows || [];
  if (!members.some(m => m.user_id === user.id && m.state === 'active')) return NextResponse.json({ error: 'not_a_member' }, { status: 403 });

  // At most a few nudges per sender per room per minute; the rest are dropped quietly.
  const { data: allowed } = await admin.rpc('chat_rate_ok', { p_bucket: 'notify', p_key: `${room}:${user.id}`, p_max: 4, p_window: '1 minute' });
  if (allowed === false) return NextResponse.json({ ok: true, sent: 0, throttled: true });

  const recipients = Array.from(new Set(members.filter(m => m.state === 'active' && m.user_id !== user.id).map(m => m.user_id as string)));
  if (!recipients.length) return NextResponse.json({ ok: true, sent: 0 });

  const { data: prefs } = await admin.from('notify_prefs').select('owner, push_on').in('owner', recipients);
  const off = new Set((prefs || []).filter(p => p.push_on === false).map(p => p.owner as string));
  let sent = 0;
  await Promise.allSettled(recipients.filter(id => !off.has(id)).map(async id => {
    sent += await pushTo(admin, id, { title: 'OnePeek', body: 'You have a new message in a private chat.', url: `/chat/r/${room}`, tag: `chat-${room}` });
  }));
  return NextResponse.json({ ok: true, sent });
}
