'use client';

import { useEffect, useRef, useState } from 'react';

// Lightweight map built from MapTiler's free raster tiles (no map library).
// Draws a pin with an accuracy circle, and optionally a geofence ring.
const KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || '';
const MAP_ID = process.env.NEXT_PUBLIC_MAPTILER_MAP || 'streets-v2-dark';
const TILE = 256;
const EARTH = 40075016;

function project(lat: number, lon: number, z: number) {
  const n = TILE * 2 ** z;
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

function metersPerPx(lat: number, z: number) {
  return (EARTH * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** z);
}

// Zoom level at which `meters` spans about `px` pixels.
function fitZoom(lat: number, meters: number, px: number) {
  const z = Math.log2((px * EARTH * Math.cos((lat * Math.PI) / 180)) / (TILE * Math.max(meters, 20)));
  return Math.max(2, Math.min(17, Math.floor(z)));
}

type Ring = { lat: number; lon: number; radiusMeters: number };

export default function OpenMap({
  lat, lon, label, height = 240, radiusMeters = 10000, fence, pin = true,
}: {
  lat: number; lon: number; label?: string; height?: number; radiusMeters?: number; fence?: Ring | null; pin?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const span = Math.max(radiusMeters, fence ? fence.radiusMeters + (fence ? distance(lat, lon, fence.lat, fence.lon) : 0) : 0);
  const [zoom, setZoom] = useState(() => fitZoom(lat, span, height * 0.38));

  useEffect(() => { setZoom(fitZoom(lat, span, Math.min(width || height * 2, height) * 0.38)); }, [lat, span, width, height]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  if (!KEY) {
    return (
      <div className="open-map open-map-empty" style={{ height }}>
        <span>{label || 'Location'}</span>
        <small>{lat.toFixed(3)}, {lon.toFixed(3)} · map needs a MapTiler key</small>
      </div>
    );
  }

  const c = project(lat, lon, zoom);
  const left = c.x - width / 2;
  const top = c.y - height / 2;
  const count = 2 ** zoom;
  const tiles: { key: string; src: string; dx: number; dy: number }[] = [];
  if (width > 0) {
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
        if (ty < 0 || ty >= count) continue;
        const wx = ((tx % count) + count) % count;
        tiles.push({
          key: `${zoom}-${tx}-${ty}`,
          src: `https://api.maptiler.com/maps/${MAP_ID}/256/${zoom}/${wx}/${ty}@2x.png?key=${KEY}`,
          dx: tx * TILE - left,
          dy: ty * TILE - top,
        });
      }
    }
  }
  const mpp = metersPerPx(lat, zoom);
  const r = Math.max(6, radiusMeters / mpp);
  let ring: { x: number; y: number; r: number } | null = null;
  if (fence) {
    const f = project(fence.lat, fence.lon, zoom);
    ring = { x: f.x - left, y: f.y - top, r: Math.max(6, fence.radiusMeters / metersPerPx(fence.lat, zoom)) };
  }
  const mapsLink = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;

  return (
    <div className="open-map" ref={ref} style={{ height }} role="img" aria-label={`Map of ${label || 'the location'}`}>
      {tiles.map(t => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={t.key} src={t.src} alt="" width={TILE} height={TILE} draggable={false} style={{ left: t.dx, top: t.dy }} />
      ))}
      {ring && <span className="open-map-fence" style={{ left: ring.x, top: ring.y, width: ring.r * 2, height: ring.r * 2 }} />}
      {pin && <span className="open-map-radius" style={{ width: r * 2, height: r * 2 }} />}
      {pin && (
        <span className="open-map-pin" aria-hidden="true">
          <svg width="28" height="34" viewBox="0 0 24 30"><path d="M12 29s10-9.2 10-17A10 10 0 0 0 2 12c0 7.8 10 17 10 17Z" fill="#D7FF39" stroke="#0A0C0F" strokeWidth="1.5" /><circle cx="12" cy="12" r="3.6" fill="#0A0C0F" /></svg>
        </span>
      )}
      {label && <span className="open-map-label">{label}</span>}
      <div className="open-map-zoom">
        <button type="button" aria-label="Zoom in" onClick={() => setZoom(z => Math.min(18, z + 1))} disabled={zoom >= 18}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom(z => Math.max(2, z - 1))} disabled={zoom <= 2}>−</button>
      </div>
      <span className="open-map-attr">
        <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener noreferrer">© MapTiler</a>{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>{' · '}
        <a href={mapsLink} target="_blank" rel="noopener noreferrer">Open map</a>
      </span>
    </div>
  );
}

export function distance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}
