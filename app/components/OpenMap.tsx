'use client';

import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import type * as Leaflet from 'leaflet';
import { loadLeaflet, addBasemap, pinIcon } from './leaflet-base';

export { distance } from '@/lib/geo';

type Ring = { lat: number; lon: number; radiusMeters: number };

/**
 * One location on a Leaflet map: a pin with its accuracy circle, and optionally a geofence ring.
 * Used for "where it was opened" in the dashboard and the geofence preview.
 */
export default function OpenMap({
  lat, lon, label, height = 240, radiusMeters = 10000, fence, pin = true,
}: {
  lat: number; lon: number; label?: string; height?: number; radiusMeters?: number; fence?: Ring | null; pin?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layers = useRef<Leaflet.LayerGroup | null>(null);

  // Create the map once.
  useEffect(() => {
    let dead = false;
    loadLeaflet().then(L => {
      if (dead || !el.current || map.current) return;
      const m = L.map(el.current, { zoomControl: false, scrollWheelZoom: false, attributionControl: true, minZoom: 2, maxZoom: 19 }).setView([lat, lon], 13);
      L.control.zoom({ position: 'topright' }).addTo(m);
      addBasemap(L, m);
      layers.current = L.layerGroup().addTo(m);
      map.current = m;
      draw(L);
    });
    return () => { dead = true; map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw when the location, accuracy or fence change.
  useEffect(() => {
    if (map.current) loadLeaflet().then(draw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, radiusMeters, fence?.lat, fence?.lon, fence?.radiusMeters, pin]);

  function draw(L: Awaited<ReturnType<typeof loadLeaflet>>) {
    const m = map.current, g = layers.current;
    if (!m || !g) return;
    g.clearLayers();
    const r = Math.max(radiusMeters, 5);
    // Bounds are computed from the geometry (not the drawn layers) so they work before first render.
    let bounds = L.latLng(lat, lon).toBounds(r * 2);
    if (fence) {
      L.circle([fence.lat, fence.lon], { radius: fence.radiusMeters, color: '#C9A7FF', weight: 2, dashArray: '6 6', fillColor: '#C9A7FF', fillOpacity: 0.06 }).addTo(g);
      bounds = bounds.extend(L.latLng(fence.lat, fence.lon).toBounds(fence.radiusMeters * 2));
    }
    if (pin || !fence) {
      L.circle([lat, lon], { radius: r, color: '#D7FF39', weight: 1, fillColor: '#D7FF39', fillOpacity: 0.12 }).addTo(g);
    }
    if (pin) L.marker([lat, lon], { icon: pinIcon(L), keyboard: false }).addTo(g);
    m.invalidateSize();
    m.fitBounds(bounds, { padding: [28, 28], maxZoom: 17 });
  }

  return (
    <div className="open-map lf-wrap" style={{ height }}>
      <div ref={el} className="lf-map" role="img" aria-label={`Map of ${label || 'the location'}`} />
      {label && <span className="open-map-label">{label}</span>}
    </div>
  );
}
