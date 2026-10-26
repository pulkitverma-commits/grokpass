// Location helpers shared by the browser and the server. 100% free services, no API keys:
//  * Photon (komoot, OpenStreetMap data) for place search and reverse geocoding.
//  * Nominatim (OpenStreetMap Foundation) as a reverse-geocoding fallback on the server.
// Map tiles come from OpenFreeMap (see app/components/LeafletMap.tsx).

export type Place = { area: string | null; city: string | null; region: string | null; country: string | null };
export type Hit = { id: string; name: string; lat: number; lon: number };

const PHOTON = 'https://photon.komoot.io';
const UA = 'OnePeek/1.0 (+https://onepeek.io; secret@onepeek.io)';

type PhotonProps = {
  osm_id?: number; osm_type?: string; type?: string; name?: string; street?: string; housenumber?: string;
  district?: string; locality?: string; city?: string; county?: string; state?: string; country?: string; countrycode?: string;
};
type PhotonFeature = { properties: PhotonProps; geometry: { coordinates: [number, number] } };

const uniq = (xs: (string | null | undefined)[]) => {
  const out: string[] = [];
  for (const x of xs) if (x && !out.some(o => o.toLowerCase() === x.toLowerCase())) out.push(x);
  return out;
};

function placeFromPhoton(p: PhotonProps): Place {
  // Most specific named area first (a suburb, sector or neighbourhood), then the district.
  const area = uniq([p.type === 'house' || p.type === 'street' ? null : p.name, p.locality, p.district]).slice(0, 2);
  const city = p.city || p.county || null;
  return {
    area: uniq([...area, city]).join(', ') || null,
    city,
    region: p.state || null,
    country: p.countrycode ? p.countrycode.toUpperCase() : null,
  };
}

function headers(server: boolean): HeadersInit {
  // Browsers set their own User-Agent; servers must identify themselves to OSM services.
  return server ? { 'User-Agent': UA, Accept: 'application/json' } : { Accept: 'application/json' };
}

async function getJson<T>(url: string, server: boolean, ms = 3000): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: headers(server), signal: ctrl.signal, cache: 'no-store' });
    return res.ok ? await res.json() as T : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Place search for the geofence picker. Photon supports search-as-you-type (Nominatim does not allow it). */
export async function searchPlaces(q: string, near?: { lat: number; lon: number }): Promise<Hit[]> {
  if (q.trim().length < 3) return [];
  const bias = near ? `&lat=${near.lat}&lon=${near.lon}` : '';
  const data = await getJson<{ features?: PhotonFeature[] }>(`${PHOTON}/api/?q=${encodeURIComponent(q.trim())}&limit=6&lang=en${bias}`, false);
  return (data?.features || []).map(f => {
    const p = f.properties;
    const name = uniq([p.name || (p.street ? `${p.street}${p.housenumber ? ' ' + p.housenumber : ''}` : null), p.district, p.city || p.county, p.state, p.country]).join(', ');
    return { id: `${p.osm_type}${p.osm_id}`, name, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
  }).filter(h => h.name);
}

/** Area name for a coordinate. On the server, falls back to Nominatim. */
export async function reversePlace(lat: number, lon: number, server = false): Promise<Place | null> {
  const ph = await getJson<{ features?: PhotonFeature[] }>(`${PHOTON}/reverse?lat=${lat}&lon=${lon}&lang=en&limit=1`, server);
  const f = ph?.features?.[0];
  if (f) return placeFromPhoton(f.properties);
  if (!server) return null;
  type Nom = { address?: Record<string, string> };
  const nm = await getJson<Nom>(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16&accept-language=en`, true);
  const a = nm?.address;
  if (!a) return null;
  const city = a.city || a.town || a.village || a.county || null;
  return {
    area: uniq([a.neighbourhood || a.suburb || a.quarter, a.city_district, city]).join(', ') || null,
    city,
    region: a.state || null,
    country: a.country_code ? a.country_code.toUpperCase() : null,
  };
}

export function placeLabel(p: Place | null, lat: number, lon: number) {
  return p?.area || uniq([p?.city, p?.region]).join(', ') || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

export function distance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

export type Fix = { lat: number; lon: number; accuracy: number };

/**
 * Best device position within `timeoutMs`. The first fix a phone returns is often a coarse
 * Wi-Fi/cell estimate; GPS needs a few seconds to settle. We watch the position, keep the most
 * accurate reading, and stop early once it's better than `goodEnough` metres.
 */
export function bestPosition({ timeoutMs = 10000, goodEnough = 25, onUpdate }: { timeoutMs?: number; goodEnough?: number; onUpdate?: (f: Fix) => void } = {}): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { reject(new Error('unsupported')); return; }
    let best: Fix | null = null;
    let done = false;
    const finish = (err?: unknown) => {
      if (done) return;
      done = true;
      navigator.geolocation.clearWatch(watch);
      clearTimeout(timer);
      if (best) resolve(best); else reject(err || new Error('timeout'));
    };
    const watch = navigator.geolocation.watchPosition(
      pos => {
        const f = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
        if (!best || f.accuracy < best.accuracy) { best = f; onUpdate?.(f); }
        if (f.accuracy <= goodEnough) finish();
      },
      err => { if (err.code === err.PERMISSION_DENIED || !best) finish(err); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );
    const timer = setTimeout(() => finish(), timeoutMs);
  });
}
