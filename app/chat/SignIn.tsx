'use client';

import Link from 'next/link';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import Icon from '../components/Icon';

/** Sign-in for chat: passkey first (Face ID / Touch ID / device PIN), existing OnePeek login otherwise. */
export default function SignIn({ onDone, guest }: { onDone: () => void; guest?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function passkey() {
    if (!supabase) return;
    setErr(''); setBusy(true);
    const { error } = await supabase.auth.signInWithPasskey();
    setBusy(false);
    if (error) { setErr(/not.?found|cancel|abort|NotAllowed/i.test(error.message) ? 'No passkey was used. Try again, or sign in another way.' : 'Passkey sign-in didn’t work. Try again.'); return; }
    onDone();
  }

  return (
    <div className="c-card" style={{ padding: 22, textAlign: 'center' }}>
      <Icon name="key" size={28} />
      <h2 className="c-h1" style={{ fontSize: 22 }}>Sign in to chat</h2>
      <p className="c-sub">Use your passkey, or your OnePeek account.</p>
      <button className="c-btn block" onClick={passkey} disabled={busy}>{busy ? 'Waiting for your device…' : 'Sign in with a passkey'}</button>
      <div style={{ height: 10 }} />
      <Link className="c-btn ghost block" href="/login?next=/chat">Email, Google or Microsoft</Link>
      {guest && <p className="c-hint" style={{ marginTop: 14 }}>No account? <button className="c-link" onClick={guest}>Start a Quick Chat as a guest</button></p>}
      {err && <p className="c-error">{err}</p>}
    </div>
  );
}
