import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Secret Chat housekeeping (Vercel cron, see vercel.json). pg_cron already runs chat_reap()
// every minute; this is the backstop, and it deletes the encrypted files whose rows are gone.
// When CRON_SECRET is set, Vercel sends it as a Bearer token and anything else is refused.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: 'not_configured' }, { status: 500 });

  const { data: reaped, error } = await admin.rpc('chat_reap');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: trash } = await admin.from('chat_storage_trash').select('object_path').order('queued_at').limit(1000);
  const paths = (trash || []).map(t => t.object_path as string);
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error: rmErr } = await admin.storage.from('chat-attachments').remove(batch);
    if (rmErr) continue;
    await admin.from('chat_storage_trash').delete().in('object_path', batch);
    removed += batch.length;
  }
  return NextResponse.json({ ok: true, reaped, files_removed: removed });
}
