import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// Opens (burns) a secret. Runs on the server so the location can be recorded for
// senders who opted in. Two sources:
//  - "device": the viewer chose to share their device location (browser permission).
//  - "network": otherwise, Vercel's approximate city from the network address.
// The area name (neighbourhood/locality) comes from MapTiler reverse geocoding.
// Nothing here can decrypt the secret: the key never reaches the server.

type Place = { city: string | null; region: string | null; country: string | null; area: string | null };

function networkGeo(req: Request) {
  const h = req.headers;
  const dec = (v: string | null) => { if (!v) return null; try { return decodeURIComponent(v); } catch { return v; } };
  const num = (v: string | null) => { const n = v === null ? NaN : Number(v); return Number.isFinite(n) ? n : null; };
  return {
    city: dec(h.get('x-vercel-ip-city')),
    region: dec(h.get('x-vercel-ip-country-region')),
    country: h.get('x-vercel-ip-country'),
    lat: num(h.get('x-vercel-ip-latitude')),
    lon: num(h.get('x-vercel-ip-longitude')),
  };
}

async function reverseGeocode(lat: number, lon: number, origin: string): Promise<Place | null> {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(`https://api.maptiler.com/geocoding/${lon},${lat}.json?key=${key}&language=en`, {
      headers: { Origin: origin, Referer: `${origin}/` },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json() as { features?: { place_type?: string[]; text?: string; properties?: { country_code?: string } }[] };
    const byType = (...types: string[]) => {
      for (const t of types) {
        const f = data.features?.find(x => x.place_type?.includes(t));
        if (f?.text) return f.text;
      }
      return null;
    };
    const area = byType('neighbourhood', 'municipality', 'municipal_district', 'locality', 'joint_submunicipality');
    const district = byType('subregion', 'county', 'joint_municipality');
    const region = byType('region');
    const countryFeature = data.features?.find(x => x.place_type?.includes('country'));
    const country = countryFeature?.properties?.country_code?.toUpperCase() || null;
    return {
      area: [area, district && district !== area ? district : null].filter(Boolean).join(', ') || null,
      city: district || area,
      region,
      country,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ error: 'not_configured' }, { status: 500 });

  let body: { id?: unknown; precise?: { lat?: unknown; lon?: unknown; accuracy?: unknown } } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const id = String(body?.id || '');
  if (!/^[A-Za-z0-9]{6,32}$/.test(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  const origin = new URL(req.url).origin;
  const net = networkGeo(req);
  const p = body.precise;
  const plat = Number(p?.lat), plon = Number(p?.lon), pacc = Number(p?.accuracy);
  const hasDevice = p && Number.isFinite(plat) && Number.isFinite(plon) && Math.abs(plat) <= 90 && Math.abs(plon) <= 180;

  let args: Record<string, unknown>;
  if (hasDevice) {
    const place = await reverseGeocode(plat, plon, origin);
    args = {
      p_lat: plat, p_lon: plon,
      p_accuracy: Number.isFinite(pacc) ? Math.round(pacc) : null,
      p_source: 'device',
      p_area: place?.area ?? null,
      p_city: place?.city ?? net.city,
      p_region: place?.region ?? net.region,
      p_country: place?.country ?? net.country,
    };
  } else {
    args = {
      p_lat: net.lat, p_lon: net.lon, p_source: 'network', p_area: null,
      p_city: net.city, p_region: net.region, p_country: net.country,
    };
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let { data, error } = await supabase.rpc('open_secret', { p_id: id, ...args });
  const fence = /geofence_(location_required|imprecise|outside)(?::(\d+))?/.exec(error?.message || '');
  if (fence) {
    // Geofenced secret and the viewer isn't (provably) inside the area. Nothing was burned.
    return NextResponse.json({ error: `geofence_${fence[1]}`, meters: fence[2] ? Number(fence[2]) : null }, { status: 403 });
  }
  // Before migration 003 the database doesn't know the new arguments: retry with the old ones.
  if (error && /p_area|p_source|p_accuracy|could not find the function/i.test(error.message || '')) {
    const { p_area, p_source, p_accuracy, ...old } = args;
    void p_area; void p_source; void p_accuracy;
    ({ data, error } = await supabase.rpc('open_secret', { p_id: id, ...old }));
  }
  if (error) return NextResponse.json({ error: 'open_failed' }, { status: 502 });
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return NextResponse.json({ error: 'gone' }, { status: 404 });
  return NextResponse.json(row, { headers: { 'Cache-Control': 'no-store' } });
}
