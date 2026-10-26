'use client';

import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { useEffect, useRef } from 'react';
import type * as Leaflet from 'leaflet';
import { loadLeaflet, addBasemap, pinIcon, escapeHtml } from './leaflet-base';

export type OpenPoint = {
  id: string;
  lat: number;
  lon: number;
  accuracy: number | null;   // metres
  precise: boolean;          // device GPS vs network estimate
  title: string;             // e.g. "To Rahul"
  place: string;             // area, city, country
  when: string;              // ISO timestamp
};

/**
 * Every "where it was opened" in one map. Nearby opens are grouped with Leaflet.markercluster,
 * so hundreds of points stay readable; click a cluster to zoom in, click a pin for details.
 */
export default function OpensMap({ points, height = 380, onSelect }: { points: OpenPoint[]; height?: number; onSelect?: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const group = useRef<Leaflet.MarkerClusterGroup | null>(null);

  useEffect(() => {
    let dead = false;
    loadLeaflet(true).then(L => {
      if (dead || !el.current || map.current) return;
      const m = L.map(el.current, { scrollWheelZoom: false, worldCopyJump: true, minZoom: 2, maxZoom: 19, zoomControl: false }).setView([20, 0], 2);
      L.control.zoom({ position: 'topright' }).addTo(m);
      addBasemap(L, m);
      group.current = L.markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        maxClusterRadius: 48,
        iconCreateFunction: c => {
          const n = c.getChildCount();
          const size = n < 10 ? 34 : n < 100 ? 40 : 48;
          return L.divIcon({ className: 'lf-cluster', html: `<span>${n}</span>`, iconSize: [size, size] });
        },
      }).addTo(m);
      map.current = m;
      plot(L);
    });
    return () => { dead = true; map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (map.current) loadLeaflet(true).then(plot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  function plot(L: Awaited<ReturnType<typeof loadLeaflet>>) {
    const m = map.current, g = group.current;
    if (!m || !g) return;
    g.clearLayers();
    const icon = pinIcon(L);
    const markers = points.map(p => {
      const when = new Date(p.when).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
      const acc = p.precise ? `Device location · ±${Math.round(p.accuracy || 15)} m` : 'Approximate (network)';
      const mk = L.marker([p.lat, p.lon], { icon, title: p.title });
      mk.bindPopup(
        `<div class="lf-pop"><strong>${escapeHtml(p.title)}</strong>` +
        `<span>${escapeHtml(p.place || `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`)}</span>` +
        `<em>${escapeHtml(when)}</em><small>${acc}</small></div>`,
      );
      if (onSelect) mk.on('click', () => onSelect(p.id));
      return mk;
    });
    g.addLayers(markers);
    m.invalidateSize();
    if (points.length === 1) m.setView([points[0].lat, points[0].lon], points[0].precise ? 15 : 10);
    else if (points.length > 1) m.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lon] as [number, number])), { padding: [36, 36], maxZoom: 15 });
    else m.setView([20, 0], 2);
  }

  return (
    <div className="open-map lf-wrap" style={{ height }}>
      <div ref={el} className="lf-map" role="region" aria-label="Map of where your secrets were opened" />
    </div>
  );
}
