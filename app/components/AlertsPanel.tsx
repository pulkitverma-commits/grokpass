'use client';

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import Icon from './Icon';

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

function urlB64ToBytes(s: string) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

type Caps = { email: boolean; push: boolean; server: boolean };

export default function AlertsPanel({ user }: { user: User }) {
  const [caps, setCaps] = useState<Caps | null>(null);
  const [emailOn, setEmailOn] = useState(true);
  const [pushOn, setPushOn] = useState(true);
  const [device, setDevice] = useState<'unsupported' | 'off' | 'on' | 'blocked'>('off');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch('/api/alerts/test').then(r => r.json()).then(setCaps).catch(() => setCaps({ email: false, push: false, server: false }));
    supabase?.from('notify_prefs').select('email_on, push_on').eq('owner', user.id).maybeSingle().then(({ data }) => {
      if (data) { setEmailOn(data.email_on); setPushOn(data.push_on); }
    });
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setDevice('unsupported'); return; }
      if (Notification.permission === 'denied') { setDevice('blocked'); return; }
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      setDevice(sub ? 'on' : 'off');
    })().catch(() => setDevice('unsupported'));
  }, [user.id]);

  async function savePrefs(next: { email_on: boolean; push_on: boolean }) {
    setEmailOn(next.email_on); setPushOn(next.push_on);
    await supabase?.from('notify_prefs').upsert({ owner: user.id, ...next, updated_at: new Date().toISOString() });
  }

  async function enablePush() {
    if (!supabase || !VAPID) return;
    setBusy(true); setMsg('');
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setDevice(perm === 'denied' ? 'blocked' : 'off'); setBusy(false); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(VAPID) });
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const { error } = await supabase.from('push_subscriptions').upsert({
        endpoint: j.endpoint, owner: user.id, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200),
      });
      if (error) throw error;
      setDevice('on');
      if (!pushOn) await savePrefs({ email_on: emailOn, push_on: true });
    } catch {
      setMsg('Couldn’t turn on alerts in this browser.');
    }
    setBusy(false);
  }

  async function disablePush() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await supabase?.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
      }
      setDevice('off');
    } catch { /* ignore */ }
    setBusy(false);
  }

  async function test() {
    if (!supabase) return;
    setBusy(true); setMsg('');
    const { data } = await supabase.auth.getSession();
    const res = await fetch('/api/alerts/test', { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token || ''}` } }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) as { pushed?: number; emailed?: boolean } : {};
    if (!res?.ok) setMsg('Alerts aren’t set up on the server yet.');
    else setMsg([out.emailed ? `email sent to ${user.email}` : null, out.pushed ? `${out.pushed} browser alert${out.pushed === 1 ? '' : 's'} sent` : null].filter(Boolean).join(' · ') || 'Nothing was sent. Turn on a channel first.');
    setBusy(false);
  }

  return (
    <div className="dash-panel alerts-panel">
      <h2><Icon name="bell" size={18} strokeWidth={2} />Alerts</h2>
      <p className="dash-muted">Hear the moment a secret is opened (with the area, if you asked for it) or a request is answered.</p>

      <label className="loc-toggle">
        <input type="checkbox" checked={emailOn} onChange={e => savePrefs({ email_on: e.target.checked, push_on: pushOn })} />
        <span className="loc-switch" aria-hidden="true" />
        <span className="loc-text"><strong>Email</strong><small>{user.email}{caps && !caps.email ? ' · not set up on the server yet' : ''}</small></span>
      </label>

      <label className="loc-toggle">
        <input type="checkbox" checked={pushOn} onChange={e => savePrefs({ email_on: emailOn, push_on: e.target.checked })} />
        <span className="loc-switch" aria-hidden="true" />
        <span className="loc-text"><strong>Browser notifications</strong><small>
          {device === 'on' ? 'On for this browser.' : device === 'blocked' ? 'Blocked in this browser’s site settings.' : device === 'unsupported' ? 'Not supported in this browser. On iPhone, add OnePeek to your Home Screen first.' : 'Not on for this browser yet.'}
        </small></span>
      </label>

      <div className="alerts-actions">
        {device === 'off' && VAPID && <button type="button" className="gp-btn gp-ghost" onClick={enablePush} disabled={busy}>Turn on in this browser</button>}
        {device === 'on' && <button type="button" className="dash-ghost" onClick={disablePush} disabled={busy}>Turn off here</button>}
        <button type="button" className="dash-ghost" onClick={test} disabled={busy}>Send a test</button>
      </div>
      {msg && <p className="field-hint">{msg}</p>}
    </div>
  );
}
