'use client';

import { useEffect, useRef, useState } from 'react';

// Lightweight map built from MapTiler's free raster tiles (no map library).
// The point is approximate (network-based), so a soft radius is drawn around the pin.
const KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || '';
const MAP_ID = process.env.NEXT_PUBLIC_MAPTILER_MAP || 'dataviz-dark';
const TILE = 256;

function project(lat: number, lon: number, z: number) {
  const n = TILE * 2 ** z;
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * n,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n,
  };
}

export default function OpenMap({ lat, lon, label, height = 220 }: { lat: number; lon: number; label?: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(10);

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
        <small>{lat.toFixed(2)}, {lon.toFixed(2)} · map needs a MapTiler key</small>
      </div>
    );
  }

  const { x, y } = project(lat, lon, zoom);
  const left = x - width / 2;
  const top = y - height / 2;
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
  // ~city-level uncertainty (about 10 km), shown as a soft circle.
  const metersPerPx = (40075016 * Math.cos((lat * Math.PI) / 180)) / (TILE * count);
  const radius = Math.max(14, Math.min(Math.min(width, height) / 2 - 6, 10000 / metersPerPx));
  const mapsLink = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;

  return (
    <div className="open-map" ref={ref} style={{ height }} role="img" aria-label={`Map showing approximately ${label || 'where it was opened'}`}>
      {tiles.map(t => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={t.key} src={t.src} alt="" width={TILE} height={TILE} draggable={false} style={{ left: t.dx, top: t.dy }} />
      ))}
      <span className="open-map-radius" style={{ width: radius * 2, height: radius * 2 }} />
      <span className="open-map-pin" aria-hidden="true">
        <svg width="28" height="34" viewBox="0 0 24 30"><path d="M12 29s10-9.2 10-17A10 10 0 0 0 2 12c0 7.8 10 17 10 17Z" fill="#D7FF39" stroke="#0A0C0F" strokeWidth="1.5" /><circle cx="12" cy="12" r="3.6" fill="#0A0C0F" /></svg>
      </span>
      {label && <span className="open-map-label">{label}</span>}
      <div className="open-map-zoom">
        <button type="button" aria-label="Zoom in" onClick={() => setZoom(z => Math.min(14, z + 1))} disabled={zoom >= 14}>+</button>
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
