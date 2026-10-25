'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [msg, setMsg] = useState('');
  const router = useRouter();

  async function submit() {
    if (!supabase) {
      setMsg('Supabase not configured');
      return;
    }
    setMsg('');
    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({ email, password });
      setMsg(error ? error.message : 'Check your email for confirmation (Mandrill will deliver it in production).');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg(error.message);
      else router.push('/dashboard');
    }
  }

  return (
    <div className="card">
      <h2>{mode === 'login' ? 'Login' : 'Sign up'}</h2>
      <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
      <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
      <button onClick={submit} style={{ marginTop: '1rem' }}>{mode === 'login' ? 'Login' : 'Create account'}</button>
      <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
        <button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} style={{ background: 'transparent', color: '#7c9cff' }}>
          {mode === 'login' ? 'Need an account?' : 'Already have one?'}
        </button>
      </p>
      {msg && <p style={{ marginTop: '0.75rem' }}>{msg}</p>}
    </div>
  );
}
