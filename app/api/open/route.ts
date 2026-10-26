import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// Opens (burns) a secret. Runs on the server so the approximate, network-based
// location from Vercel's edge can be recorded for senders who opted in.
// Nothing here can decrypt the secret: the key never reaches the server.
function geo(req: Request) {
  const h = req.headers;
  const dec = (v: string | null) => { if (!v) return null; try { return decodeURIComponent(v); } catch { return v; } };
  const num = (v: string | null) => { const n = v === null ? NaN : Number(v); return Number.isFinite(n) ? n : null; };
  return {
    p_city: dec(h.get('x-vercel-ip-city')),
    p_region: dec(h.get('x-vercel-ip-country-region')),
    p_country: h.get('x-vercel-ip-country'),
    p_lat: num(h.get('x-vercel-ip-latitude')),
    p_lon: num(h.get('x-vercel-ip-longitude')),
  };
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ error: 'not_configured' }, { status: 500 });

  let id = '';
  try { id = String((await req.json())?.id || ''); } catch { /* ignore */ }
  if (!/^[A-Za-z0-9]{6,32}$/.test(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc('open_secret', { p_id: id, ...geo(req) });
  if (error) return NextResponse.json({ error: 'open_failed' }, { status: 502 });
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return NextResponse.json({ error: 'gone' }, { status: 404 });
  return NextResponse.json(row, { headers: { 'Cache-Control': 'no-store' } });
}
