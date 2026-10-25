import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// Daily cron (see vercel.json): deletes expired secrets and any leftover encrypted files.
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false } });
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
