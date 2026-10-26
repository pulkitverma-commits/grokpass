'use client';

import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import OpenMap from './OpenMap';
import { searchPlaces, reversePlace, placeLabel, bestPosition, type Hit } from '@/lib/geo';

export type Geofence = { lat: number; lon: number; radius: number; label: string };

const RADII = [
  { m: 100, label: '100 m' },
  { m: 500, label: '500 m' },
  { m: 1000, label: '1 km' },
  { m: 5000, label: '5 km' },
  { m: 25000, label: '25 km' },
];
export const FENCE_TOLERANCE = 0.05; // the secret also opens up to 5% beyond the radius

function fmt(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${+(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

async function geocode(q: string, near?: { lat: number; lon: number }): Promise<Hit[]> {
  return searchPlaces(q, near);
}

async function reverse(lat: number, lon: number): Promise<string> {
  return placeLabel(await reversePlace(lat, lon), lat, lon);
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
    bestPosition({ timeoutMs: 8000, goodEnough: 30 }).then(async ({ lat, lon }) => {
      near.current = { lat, lon };
      const label = await reverse(lat, lon);
      onChange({ lat, lon, radius, label });
      setQuery('');
      setHits([]);
      setBusy(false);
    }).catch(() => {
      setBusy(false);
      setMsg('Location access was blocked. Search for a place instead.');
    });
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
              <input className="field-input" type="search" placeholder="or search a place, area or address" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search a place" />
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
