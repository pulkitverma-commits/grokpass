'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Icon, { type IconName } from './Icon';
import { COUNTRY_CODES, countryName, countryFlag } from '@/lib/countries';
import { localTz } from '@/lib/time';

export type Controls = {
  lockEmail: string;
  openAfter: string;     // <input type="datetime-local"> value, '' = off
  windowOn: boolean;
  windowStart: string;   // 'HH:MM'
  windowEnd: string;
  countries: string[];
  guard: boolean;
};

export const DEFAULT_CONTROLS: Controls = {
  lockEmail: '', openAfter: '', windowOn: false, windowStart: '09:00', windowEnd: '18:00', countries: [], guard: false,
};

export { localTz } from '@/lib/time';

export function toMinutes(hhmm: string) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Math.min(1439, Number(m[1]) * 60 + Number(m[2])) : null;
}

/** How many extra protections are on (for the collapsed summary). */
export function activeCount(c: Controls, fenceOn: boolean) {
  return [c.lockEmail.trim(), c.openAfter, c.windowOn, c.countries.length > 0, c.guard, fenceOn].filter(Boolean).length;
}

function Toggle({ checked, onChange, title, hint, icon }: { checked: boolean; onChange: (v: boolean) => void; title: string; hint: string; icon: IconName }) {
  return (
    <label className="loc-toggle">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="loc-switch" aria-hidden="true" />
      <span className="loc-text">
        <strong><Icon name={icon} size={14} strokeWidth={2} />{title}</strong>
        <small>{hint}</small>
      </span>
    </label>
  );
}

export default function MoreControls({ value, onChange, fenceOn, children }: {
  value: Controls; onChange: (v: Controls) => void; fenceOn: boolean; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [lockOn, setLockOn] = useState(!!value.lockEmail);
  const [afterOn, setAfterOn] = useState(!!value.openAfter);
  const [countryOn, setCountryOn] = useState(value.countries.length > 0);
  const [q, setQ] = useState('');
  const set = (patch: Partial<Controls>) => onChange({ ...value, ...patch });
  const n = activeCount(value, fenceOn);
  const tz = localTz();

  const all = useMemo(() => COUNTRY_CODES.map(c => ({ code: c, name: countryName(c) })).sort((a, b) => a.name.localeCompare(b.name)), []);
  // Best matches first: code or name starting with the query, then a word starting with it, then anywhere.
  const needle = q.trim().toLowerCase();
  const rank = (c: { code: string; name: string }) => {
    const n = c.name.toLowerCase();
    if (c.code.toLowerCase() === needle || n === needle) return 0;
    if (n.startsWith(needle)) return 1;
    if (n.split(/[\s(-]+/).some(w => w.startsWith(needle))) return 2;
    return n.includes(needle) ? 3 : 9;
  };
  const matches = needle
    ? all.filter(c => !value.countries.includes(c.code) && rank(c) < 9).sort((a, b) => rank(a) - rank(b)).slice(0, 6)
    : [];

  const minAfter = useMemo(() => {
    const d = new Date(Date.now() + 5 * 60_000);
    d.setSeconds(0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }, []);

  return (
    <div className={`more-box ${open ? 'open' : ''}`}>
      <button type="button" className="more-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span><Icon name="shield" size={16} strokeWidth={2} />More protection</span>
        <span className="more-sum">{n > 0 ? `${n} on` : 'Recipient, time, place, screenshots'}<Icon name="chevron" size={14} strokeWidth={2} className="more-chev" /></span>
      </button>

      {open && (
        <div className="more-body">
          <div className="more-item">
            <Toggle checked={lockOn} icon="user" title="Lock to a recipient"
              hint="Only opens after the viewer enters a one-time code we email to this address."
              onChange={v => { setLockOn(v); if (!v) set({ lockEmail: '' }); }} />
            {lockOn && (
              <input className="field-input" type="email" inputMode="email" autoComplete="off" placeholder="recipient@company.com"
                value={value.lockEmail} onChange={e => set({ lockEmail: e.target.value })} aria-label="Recipient email" />
            )}
          </div>

          <div className="more-item">
            <Toggle checked={afterOn} icon="clock" title="Opens after a set time"
              hint="The link works only from this date and time."
              onChange={v => { setAfterOn(v); if (!v) set({ openAfter: '' }); }} />
            {afterOn && (
              <input className="field-input" type="datetime-local" min={minAfter} value={value.openAfter}
                onChange={e => set({ openAfter: e.target.value })} aria-label="Opens after" />
            )}
          </div>

          <div className="more-item">
            <Toggle checked={value.windowOn} icon="clock" title="Only during certain hours"
              hint={`Opens only inside a daily window, in your time zone (${tz}).`}
              onChange={v => set({ windowOn: v })} />
            {value.windowOn && (
              <div className="more-row">
                <input className="field-input" type="time" value={value.windowStart} onChange={e => set({ windowStart: e.target.value })} aria-label="From" />
                <span>to</span>
                <input className="field-input" type="time" value={value.windowEnd} onChange={e => set({ windowEnd: e.target.value })} aria-label="Until" />
              </div>
            )}
          </div>

          <div className="more-item">
            <Toggle checked={countryOn} icon="globe" title="Only from certain countries"
              hint="Checked on our server from the viewer’s network. A lighter option than a geofence."
              onChange={v => { setCountryOn(v); if (!v) { set({ countries: [] }); setQ(''); } }} />
            {countryOn && (
              <div className="country-pick">
                {value.countries.length > 0 && (
                  <div className="country-chips">
                    {value.countries.map(c => (
                      <button key={c} type="button" onClick={() => set({ countries: value.countries.filter(x => x !== c) })} aria-label={`Remove ${countryName(c)}`}>
                        {countryFlag(c)} {countryName(c)} <span aria-hidden="true">×</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="fence-search">
                  <input className="field-input" type="search" placeholder="Add a country" value={q} onChange={e => setQ(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && matches[0]) { e.preventDefault(); set({ countries: [...value.countries, matches[0].code] }); setQ(''); } }}
                    aria-label="Add a country" />
                  {matches.length > 0 && (
                    <ul className="fence-hits" role="listbox">
                      {matches.map(m => (
                        <li key={m.code}><button type="button" onClick={() => { set({ countries: [...value.countries, m.code] }); setQ(''); }}>{countryFlag(m.code)} {m.name}</button></li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="more-item">
            <Toggle checked={value.guard} icon="eye" title="Blur until held"
              hint="The secret stays blurred until the viewer presses and holds it, with a faint watermark of their email or city. Discourages screenshots."
              onChange={v => set({ guard: v })} />
          </div>

          {children}
        </div>
      )}
    </div>
  );
}
