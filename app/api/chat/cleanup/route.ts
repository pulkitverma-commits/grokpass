import { NextResponse } from 'next/server';
import { adminClient, isCronRequest } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Daily cron (see vercel.json). pg_cron already reaps expired chat rows every minute; this
// is the backstop for that, and it deletes encrypted chat files whose rows are gone
// (Supabase only allows removing storage objects through the Storage API, not from SQL).
// Idempotent: a retry finds nothing left to do.
export async function GET(req: Request) {
  if (!isCronRequest(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const supabase = adminClient();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const reaped = await supabase.rpc('chat_reap');
  if (reaped.error) return NextResponse.json({ error: reaped.error.message }, { status: 500 });

  let removed = 0;
  for (;;) {
    const { data: rows, error } = await supabase.from('chat_storage_trash').select('object_path').limit(100);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const paths = (rows ?? []).map(r => r.object_path as string);
    if (!paths.length) break;
    // Already-missing objects count as done, so a half-finished earlier run can't wedge the queue.
    const { error: rmErr } = await supabase.storage.from('chat-attachments').remove(paths);
    if (rmErr) return NextResponse.json({ error: rmErr.message, removed }, { status: 500 });
    await supabase.from('chat_storage_trash').delete().in('object_path', paths);
    removed += paths.length;
    if (paths.length < 100) break;
  }
  return NextResponse.json({ ok: true, reaped: reaped.data, files_removed: removed });
}
