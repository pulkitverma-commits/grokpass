'use client';

import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import OpenMap from './OpenMap';

export type Geofence = { lat: number; lon: number; radius: number; label: string };

const KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || '';
const RADII = [
  { m: 100, label: '100 m' },
  { m: 500, label: '500 m' },
  { m: 1000, label: '1 km' },
  { m: 5000, label: '5 km' },
  { m: 25000, label: '25 km' },
];
export const FENCE_TOLERANCE = 0.05; // the secret also opens up to 5% beyond the radius

type Hit = { id: string; name: string; lat: number; lon: number };

function fmt(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${+(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

async function geocode(q: string, near?: { lat: number; lon: number }): Promise<Hit[]> {
  if (!KEY || q.trim().length < 3) return [];
  const prox = near ? `&proximity=${near.lon},${near.lat}` : '';
  const res = await fetch(`https://api.maptiler.com/geocoding/${encodeURIComponent(q.trim())}.json?key=${KEY}&limit=5&language=en&autocomplete=true${prox}`);
  if (!res.ok) return [];
  const data = await res.json() as { features?: { id: string; place_name?: string; center?: [number, number] }[] };
  return (data.features || []).filter(f => f.center).map(f => ({ id: f.id, name: f.place_name || '', lat: f.center![1], lon: f.center![0] }));
}

async function reverse(lat: number, lon: number): Promise<string> {
  if (!KEY) return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  try {
    const res = await fetch(`https://api.maptiler.com/geocoding/${lon},${lat}.json?key=${KEY}&language=en`);
    const data = await res.json() as { features?: { place_type?: string[]; text?: string }[] };
    const pick = (...t: string[]) => { for (const x of t) { const f = data.features?.find(y => y.place_type?.includes(x)); if (f?.text) return f.text; } return null; };
    return [pick('neighbourhood', 'municipality', 'locality', 'place'), pick('subregion', 'county', 'region')].filter(Boolean).join(', ') || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }
}

export default function GeofencePicker({ value, onChange, onActiveChange }: { value: Geofence | null; onChange: (v: Geofence | null) => void; onActiveChange?: (on: boolean) => void }) {
  const [on, setOn] = useState(!!value);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [custom, setCustom] = useState('');
  const [radius, setRadiusState] = useState(value?.radius ?? 1000);
  const near = useRef<{ lat: number; lon: number } | undefined>(undefined);

  useEffect(() => {
    if (!on) return;
    const q = query;
    if (q.trim().length < 3) { setHits([]); return; }
    const t = setTimeout(() => { geocode(q, near.current).then(setHits).catch(() => setHits([])); }, 300);
    return () => clearTimeout(t);
  }, [query, on]);

  function toggle(next: boolean) {
    setOn(next);
    onActiveChange?.(next);
    setMsg('');
    if (!next) onChange(null);
  }

  function useMyLocation() {
    if (!navigator.geolocation) { setMsg('Your browser can’t share its location.'); return; }
    setBusy(true);
    setMsg('');
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      near.current = { lat, lon };
      const label = await reverse(lat, lon);
      onChange({ lat, lon, radius, label });
      setQuery('');
      setHits([]);
      setBusy(false);
    }, () => {
      setBusy(false);
      setMsg('Location access was blocked. Search for a place instead.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }

  function pick(h: Hit) {
    const short = h.name.split(',').slice(0, 3).join(',').trim();
    onChange({ lat: h.lat, lon: h.lon, radius, label: short });
    setQuery('');
    setHits([]);
  }

  function setRadius(m: number) {
    setRadiusState(m);
    if (value) onChange({ ...value, radius: m });
  }

  return (
    <div className="fence-box">
      <label className="loc-toggle">
        <input type="checkbox" checked={on} onChange={e => toggle(e.target.checked)} />
        <span className="loc-switch" aria-hidden="true" />
        <span className="loc-text">
          <strong><Icon name="lock" size={14} strokeWidth={2} />Lock to a place (geofence)</strong>
          <small>The secret only opens within a set distance of a place. The viewer’s browser checks their location first.</small>
        </span>
      </label>

      {on && (
        <div className="fence-body">
          <div className="fence-where">
            <button type="button" className="pill-btn" onClick={useMyLocation} disabled={busy}>
              <Icon name="pin" size={14} strokeWidth={2} />{busy ? 'Locating…' : 'Use my location'}
            </button>
            <div className="fence-search">
              <input className="field-input" type="search" placeholder={KEY ? 'or search a place, area or address' : 'Map search needs a MapTiler key'} value={query} onChange={e => setQuery(e.target.value)} disabled={!KEY} aria-label="Search a place" />
              {hits.length > 0 && (
                <ul className="fence-hits" role="listbox">
                  {hits.map(h => (
                    <li key={h.id}><button type="button" onClick={() => pick(h)}>{h.name}</button></li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div>
            <div className="field-label">Radius</div>
            <div className="pills">
              {RADII.map(r => (
                <button key={r.m} type="button" className={`pill-btn ${radius === r.m && !custom ? 'pill-on' : ''}`} onClick={() => { setCustom(''); setRadius(r.m); }} aria-pressed={radius === r.m && !custom}>{r.label}</button>
              ))}
              <span className="fence-custom">
                <input type="number" min={0.05} max={500} step={0.05} placeholder="Custom" value={custom} aria-label="Custom radius in km"
                  onChange={e => { setCustom(e.target.value); const km = Number(e.target.value); if (km >= 0.05 && km <= 500) setRadius(Math.round(km * 1000)); }} />
                <span>km</span>
              </span>
            </div>
          </div>

          {value ? (
            <>
              <OpenMap lat={value.lat} lon={value.lon} label={value.label} radiusMeters={value.radius * (1 + FENCE_TOLERANCE)} pin height={200} />
              <p className="field-hint">
                Opens only within <strong>{fmt(value.radius)}</strong> of {value.label} (+5% margin, up to {fmt(value.radius * (1 + FENCE_TOLERANCE))}).
                Determined users can fake their location, so treat this as an extra check, not a guarantee.
              </p>
            </>
          ) : (
            <p className="field-hint">Choose a place: use your current location or search for one.</p>
          )}
          {msg && <p className="field-hint" style={{ color: 'var(--danger)' }}>{msg}</p>}
        </div>
      )}
    </div>
  );
}
