'use client';

import { useCallback, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import Icon from '../../components/Icon';
import SignIn from '../SignIn';
import ChatNotifications from '../Notifications';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import * as chat from '@/lib/chat/client';

type Passkey = { id: string; friendly_name?: string; created_at: string; last_used_at?: string };
type Device = Awaited<ReturnType<typeof chat.listDevices>>[number];

export default function ChatSettingsPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [thisDevice, setThisDevice] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [keyLock, setKeyLock] = useState<'off' | 'locked' | 'unlocked'>('off');
  const [keyLockBusy, setKeyLockBusy] = useState(false);
  const [keyLockMsg, setKeyLockMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const s = await chat.ensureSession(false).catch(() => null);
    setUser(s?.user ?? null);
    if (!s || !supabase) return;
    if (!s.user.is_anonymous) {
      const { data } = await supabase.auth.passkey.list();
      setPasskeys((data as Passkey[]) ?? []);
    }
    setKeyLock(await chat.keystore.passkey.status());
    setDevices(await chat.listDevices().catch(() => []));
    const d = await chat.keystore.get<{ id: string }>(`device:${s.user.id}`);
    setThisDevice(d?.id ?? '');
    if (!s.user.is_anonymous) {
      const { error } = await supabase.rpc('chat_admin_stats');
      setIsAdmin(!error);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addPasskey() {
    if (!supabase) return;
    setMsg(null);
    const { error } = await supabase.auth.registerPasskey();
    if (error) setMsg({ ok: false, text: /exists/i.test(error.message) ? 'This device already has a passkey for your account.' : 'The passkey wasn’t saved. Try again.' });
    else { setMsg({ ok: true, text: 'Passkey added. You can now sign in with Face ID, Touch ID or your device PIN.' }); load(); }
  }

  async function toggleKeyLock() {
    setKeyLockMsg(null);
    if (keyLock !== 'off' && !confirm('Turn off the passkey lock? Your chat keys go back to being protected by this browser only.')) return;
    setKeyLockBusy(true);
    try {
      if (keyLock === 'off') {
        await chat.keystore.passkey.enable();
        setKeyLockMsg({ ok: true, text: 'Done. From now on, opening chats on this device needs your passkey.' });
      } else {
        await chat.keystore.passkey.disable();
        setKeyLockMsg({ ok: true, text: 'Passkey lock turned off on this device.' });
      }
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setKeyLockMsg({ ok: false, text: code === 'cancelled' ? 'Cancelled. Nothing changed.'
        : code === 'prf_unsupported' ? 'This passkey or browser can’t lock keys (it doesn’t support the WebAuthn PRF extension). Try another passkey, or Chrome, Edge or Safari 18+. Nothing changed.'
        : code === 'unreadable_records' ? 'Some chat data on this device can’t be opened, so nothing was changed. Reload the page and try again.'
        : 'Something went wrong. Nothing changed.' });
    } finally {
      setKeyLockBusy(false);
      setKeyLock(await chat.keystore.passkey.status());
    }
  }

  if (user === undefined) return <p className="c-empty">Loading…</p>;
  if (user === null) return <SignIn onDone={load} />;

  return (
    <>
      <h1 className="c-h1">Settings</h1>
      <p className="c-sub">{user.is_anonymous ? 'You’re using chat as a guest on this device.' : `Signed in as ${user.email ?? 'your account'}`}</p>

      {!user.is_anonymous && (
        <section className="c-section">
          <p className="c-label">Passkeys</p>
          <ul className="c-card c-list">
            {passkeys.map(p => (
              <li key={p.id} className="c-row">
                <div className="c-avatar"><Icon name="key" size={17} /></div>
                <div className="c-row-main"><div className="c-row-title">{p.friendly_name || 'Passkey'}</div>
                  <div className="c-row-meta">Added {new Date(p.created_at).toLocaleDateString()}{p.last_used_at ? ` · used ${new Date(p.last_used_at).toLocaleDateString()}` : ''}</div></div>
                <button className="c-btn ghost sm" onClick={async () => { if (confirm('Remove this passkey?')) { await supabase!.auth.passkey.delete({ passkeyId: p.id }); load(); } }}>Remove</button>
              </li>
            ))}
            <li className="c-row"><button className="c-btn sm" onClick={addPasskey}>Add a passkey</button>
              <span className="c-row-meta">Uses your device’s Face ID, Touch ID, Windows Hello or PIN.</span></li>
          </ul>
          {msg && <p className={msg.ok ? 'c-hint' : 'c-error'}>{msg.text}</p>}
          <p className="c-hint">Passkeys prove it’s you to OnePeek. They’re separate from the keys that encrypt your messages, which never leave this device.</p>
        </section>
      )}

      {!user.is_anonymous && (
        <section className="c-section">
          <p className="c-label">Passkey lock</p>
          <ul className="c-card c-list">
            <li className="c-row">
              <div className="c-avatar"><Icon name="key" size={16} /></div>
              <div className="c-row-main">
                <div className="c-row-title">Lock chat keys with your passkey · {keyLock === 'off' ? 'Off' : 'On'}</div>
                <div className="c-row-meta">{keyLock === 'off'
                  ? 'The keys that decrypt your chats in this browser are opened with your passkey (Face ID, Touch ID or your PIN) each time you load chat, and again after 10 minutes in the background. A copy of this browser’s data made after you turn this on can’t decrypt your messages without that passkey.'
                  : 'Opening chats in this browser needs your passkey. If that passkey is deleted from your password manager or device, these chat keys can’t be opened again.'}</div>
              </div>
              <button className={keyLock === 'off' ? 'c-btn sm' : 'c-btn ghost sm'} disabled={keyLockBusy || (keyLock === 'off' && passkeys.length === 0)} onClick={toggleKeyLock}>
                {keyLockBusy ? 'Waiting…' : keyLock === 'off' ? 'Turn on' : 'Turn off'}</button>
            </li>
          </ul>
          {keyLock === 'off' && passkeys.length === 0 && <p className="c-hint">Add a passkey above first.</p>}
          <p className="c-hint">It doesn’t protect copies of this browser’s data made before you turn it on: for that, sign this device out below and start fresh with the lock on. It also doesn’t hide which chats you’re in or when messages expire. A passkey synced through iCloud or Google unlocks these keys on your other devices too.</p>
          {keyLockMsg && <p className={keyLockMsg.ok ? 'c-hint' : 'c-error'}>{keyLockMsg.text}</p>}
        </section>
      )}

      <section className="c-section">
        <p className="c-label">Devices with chat keys</p>
        <ul className="c-card c-list">
          {devices.length === 0 && <li className="c-row c-row-meta">No devices yet. One is set up when you start or join a chat.</li>}
          {devices.map(d => (
            <li key={d.id} className="c-row">
              <div className="c-avatar"><Icon name="lock" size={16} /></div>
              <div className="c-row-main">
                <div className="c-row-title">{d.label || 'Browser'}{d.id === thisDevice ? ' · this device' : ''}</div>
                <div className="c-row-meta">{d.revoked_at ? 'Signed out' : `Last active ${new Date(d.last_seen).toLocaleDateString()}`}</div>
              </div>
              {!d.revoked_at && <button className="c-btn ghost sm" onClick={async () => {
                if (!confirm(d.id === thisDevice ? 'Sign this device out of chat? Its chat keys are destroyed and it leaves every chat.' : 'Sign that device out of chat? It leaves every chat and can’t read new messages.')) return;
                await chat.revokeDevice(d.id); load();
              }}>Sign out</button>}
            </li>
          ))}
        </ul>
      </section>

      <section className="c-section">
        <p className="c-label">Notifications</p>
        <ul className="c-card c-list">
          <ChatNotifications userId={user.id} />
        </ul>
      </section>

      <section className="c-section">
        <p className="c-label">Privacy</p>
        <ul className="c-card c-list">
          <li className="c-row"><div className="c-row-main"><div className="c-row-title">Panic Exit</div>
            <div className="c-row-meta">Press Shift + Esc twice, or tap Exit. Chats lock on this device until you unlock them.</div></div></li>
          <li className="c-row"><div className="c-row-main"><div className="c-row-title">Screenshots</div>
            <div className="c-row-meta">Screenshot shortcuts blur the chat and tell everyone in it. Secret Chat messages show only while you hold them, and every screen carries a faint watermark of who is viewing. No browser can block a phone’s screenshot buttons or a camera.</div></div></li>
        </ul>
      </section>

      {isAdmin && (
        <section className="c-section">
          <p className="c-label">Administration</p>
          <ul className="c-card c-list">
            <li><Link className="c-row" href="/chat/admin"><div className="c-row-main"><div className="c-row-title">Chat health dashboard</div>
              <div className="c-row-meta">Totals and security events. No content.</div></div></Link></li>
          </ul>
        </section>
      )}

      <div className="c-section">
        <button className="c-btn ghost block" onClick={async () => { await chat.keystore.wipe(); await supabase?.auth.signOut(); window.location.replace('/chat'); }}>
          Sign out and erase chat keys on this device</button>
      </div>
    </>
  );
}
