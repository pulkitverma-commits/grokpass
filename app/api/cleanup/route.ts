import { NextResponse } from 'next/server';
import { adminClient, isCronRequest } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Daily cron (see vercel.json): deletes expired secrets and any leftover encrypted files.
// Only Vercel Cron may call it (CRON_SECRET), and it runs with the service role.
export async function GET(req: Request) {
  if (!isCronRequest(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const supabase = adminClient();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const { data, error } = await supabase.rpc('reap_expired_secrets');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const paths = (data as string[] | null) ?? [];
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { data: gone } = await supabase.storage.from('secrets').remove(batch);
    removed += gone?.length ?? 0;
  }
  return NextResponse.json({ ok: true, checked: paths.length, removed });
}
