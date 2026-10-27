'use client';

// Shared Leaflet setup: OpenFreeMap vector tiles (free, no key, commercial use allowed),
// drawn inside Leaflet with MapLibre. Falls back to OpenStreetMap raster tiles if WebGL
// isn't available. Everything is loaded lazily so pages without a map stay light.
import type * as Leaflet from 'leaflet';

export type L = typeof Leaflet;

const STYLE = process.env.NEXT_PUBLIC_MAP_STYLE || 'https://tiles.openfreemap.org/styles/dark';
const ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

let loading: Promise<L> | null = null;

export function loadLeaflet(withCluster = false): Promise<L> {
  if (!loading) {
    loading = (async () => {
      const mod = await import('leaflet');
      const L = (mod.default || mod) as L;
      // Plugins expect a global L.
      (window as unknown as { L: L }).L = L;
      await import('maplibre-gl');
      await import('@maplibre/maplibre-gl-leaflet');
      return L;
    })();
  }
  return loading.then(async L => {
    if (withCluster) await import('leaflet.markercluster');
    return L;
  });
}

function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

export function addBasemap(L: L, map: Leaflet.Map) {
  const maplibre = (L as unknown as { maplibreGL?: (o: object) => Leaflet.Layer }).maplibreGL;
  const raster = () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);
  if (maplibre && webglOk()) {
    const layer = maplibre({ style: STYLE, attribution: ATTRIBUTION, interactive: false }).addTo(map) as Leaflet.Layer & { getMaplibreMap?: () => any };
    // If the vector style fails or is too slow (blocked network, flaky connection), switch to
    // plain OpenStreetMap tiles so the map is never blank.
    let swapped = false;
    const swap = () => { if (swapped || !map.hasLayer(layer)) return; swapped = true; map.removeLayer(layer); raster(); };
    const gl = layer.getMaplibreMap?.();
    gl?.on?.('error', (e: { error?: { status?: number }; sourceId?: string }) => { if (!gl.isStyleLoaded?.()) swap(); else if (e?.error?.status && e.error.status >= 400) swap(); });
    setTimeout(() => { try { if (gl && !gl.isStyleLoaded?.()) swap(); } catch { swap(); } }, 8000);
  } else {
    raster();
  }
  map.attributionControl.setPrefix(false);
}

export const PIN_SVG = '<svg width="28" height="34" viewBox="0 0 24 30" aria-hidden="true"><path d="M12 29s10-9.2 10-17A10 10 0 0 0 2 12c0 7.8 10 17 10 17Z" fill="#D7FF39" stroke="#0A0C0F" stroke-width="1.5"/><circle cx="12" cy="12" r="3.6" fill="#0A0C0F"/></svg>';

export function pinIcon(L: L) {
  return L.divIcon({ className: 'lf-pin', html: PIN_SVG, iconSize: [28, 34], iconAnchor: [14, 33], popupAnchor: [0, -30] });
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
