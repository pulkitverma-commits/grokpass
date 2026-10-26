import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { adminClient, anonClient, siteUrl } from '@/lib/server';
import { notifyOpened } from '@/lib/alerts';
import { reversePlace } from '@/lib/geo';

export const dynamic = 'force-dynamic';

// Opens a secret (counting a view, burning it on the last one). Runs on the server so that
// the country allow-list and time lock can't be skipped, the location can be recorded for
// senders who opted in, and the sender can be alerted. Location sources:
//  - "device": the viewer chose to share their device location (browser permission, GPS-level).
//  - "network": otherwise, the city Vercel's edge works out from the viewer's IP address.
//    Vercel sets the x-vercel-ip-* headers itself from the real client IP (proxies and
//    x-forwarded-for are already handled), so a viewer can't spoof them. IP location is only
//    ever city-level: an IP address belongs to an ISP's network, not to a building.
// The area name (sector/neighbourhood) comes from Photon / OpenStreetMap reverse geocoding.
// Nothing here can decrypt the secret: the key never reaches the server.

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

const LOCK_ERRORS = /(geofence_location_required|geofence_imprecise|geofence_outside|timelock_until|timelock_window|country_blocked|recipient_locked)(?::([A-Z0-9]*))?/;

export async function POST(req: Request) {
  const admin = adminClient();
  const supabase = admin || anonClient();
  if (!supabase) return NextResponse.json({ error: 'not_configured' }, { status: 500 });

  let body: { id?: unknown; precise?: { lat?: unknown; lon?: unknown; accuracy?: unknown }; unlockToken?: unknown } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const id = String(body?.id || '');
  if (!/^[A-Za-z0-9]{6,32}$/.test(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  const unlockToken = typeof body.unlockToken === 'string' && /^[A-Za-z0-9_-]{20,80}$/.test(body.unlockToken) ? body.unlockToken : null;

  const net = networkGeo(req);
  const p = body.precise;
  const plat = Number(p?.lat), plon = Number(p?.lon), pacc = Number(p?.accuracy);
  const hasDevice = p && Number.isFinite(plat) && Number.isFinite(plon) && Math.abs(plat) <= 90 && Math.abs(plon) <= 180;

  let args: Record<string, unknown>;
  if (hasDevice) {
    const place = await reversePlace(plat, plon, true);
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

  let { data, error } = await supabase.rpc('open_secret', { p_id: id, ...args, p_ip_country: net.country, p_unlock_token: unlockToken });
  const lock = LOCK_ERRORS.exec(error?.message || '');
  if (lock) {
    // A lock stopped it. Nothing was opened or burned.
    const extra = lock[2] || '';
    const name = lock[1];
    return NextResponse.json({
      error: name,
      meters: name.startsWith('geofence') && extra ? Number(extra) : null,
      at: name === 'timelock_until' && extra ? Number(extra) * 1000 : null,
      country: name === 'country_blocked' ? (extra || null) : null,
    }, { status: 403 });
  }
  // Older database (before migration 004/003): retry with the arguments it knows.
  if (error && /p_ip_country|p_unlock_token|could not find the function/i.test(error.message || '')) {
    ({ data, error } = await supabase.rpc('open_secret', { p_id: id, ...args }));
    const fence = /geofence_(location_required|imprecise|outside)(?::(\d+))?/.exec(error?.message || '');
    if (fence) return NextResponse.json({ error: `geofence_${fence[1]}`, meters: fence[2] ? Number(fence[2]) : null }, { status: 403 });
    if (error && /p_area|p_source|p_accuracy|could not find the function/i.test(error.message || '')) {
      const { p_area, p_source, p_accuracy, ...old } = args;
      void p_area; void p_source; void p_accuracy;
      ({ data, error } = await supabase.rpc('open_secret', { p_id: id, ...old }));
    }
  }
  if (error) return NextResponse.json({ error: 'open_failed' }, { status: 502 });
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return NextResponse.json({ error: 'gone' }, { status: 404 });

  if (admin) waitUntil(notifyOpened(admin, id, siteUrl(req)).catch(() => {}));

  // Approximate place for the optional on-screen watermark (never stored by this step).
  const viewerPlace = [net.city, net.country].filter(Boolean).join(', ') || null;
  return NextResponse.json({
    header: row.header, body: row.body, file_path: row.file_path,
    views_left: typeof row.views_left === 'number' ? row.views_left : 0,
    final: typeof row.final === 'boolean' ? row.final : true,
    viewer_place: viewerPlace,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
