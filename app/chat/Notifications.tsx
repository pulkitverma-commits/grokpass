'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

function urlB64ToBytes(s: string) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

type State = 'loading' | 'unsupported' | 'blocked' | 'off' | 'on';

/** New-message alerts for this browser. The alert never contains the message, sender or room name. */
export default function ChatNotifications({ userId }: { userId: string }) {
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      if (!VAPID || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setState('unsupported'); return; }
      if (Notification.permission === 'denied') { setState('blocked'); return; }
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      setState((await reg?.pushManager.getSubscription()) ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
  }, []);

  async function turnOn() {
    if (!supabase) return;
    setBusy(true); setErr('');
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'blocked' : 'off'); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(VAPID) });
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const { error } = await supabase.from('push_subscriptions').upsert({
        endpoint: j.endpoint, owner: userId, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200),
      });
      if (error) throw error;
      await supabase.from('notify_prefs').upsert({ owner: userId, push_on: true, updated_at: new Date().toISOString() });
      setState('on');
    } catch {
      setErr('Couldn’t turn on notifications in this browser.');
    } finally { setBusy(false); }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) { await supabase?.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
      setState('off');
    } catch { /* ignore */ } finally { setBusy(false); }
  }

  return (
    <li className="c-row">
      <div className="c-row-main">
        <div className="c-row-title">New message notifications</div>
        <div className="c-row-meta">
          {state === 'unsupported' ? 'This browser doesn’t support notifications. On iPhone, add OnePeek to your Home Screen first.'
            : state === 'blocked' ? 'Notifications are blocked for onepeek.io in your browser settings.'
            : 'Just “You have a new message”. Never the text, the sender or the chat name.'}
        </div>
        {err && <p className="c-error">{err}</p>}
      </div>
      {state === 'on' && <button className="c-btn ghost sm" disabled={busy} onClick={turnOff}>Turn off</button>}
      {state === 'off' && <button className="c-btn sm" disabled={busy} onClick={turnOn}>Turn on</button>}
    </li>
  );
}
