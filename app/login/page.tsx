'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Mode = 'login' | 'signup';
type Method = 'password' | 'magic';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<Mode>('login');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'azure' | null>(null);
  const [method, setMethod] = useState<Method>('password');
  const [magicSentTo, setMagicSentTo] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const router = useRouter();

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendMagicLink() {
    if (!supabase) { setMsg({ kind: 'err', text: 'Login is not configured yet.' }); return; }
    const to = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { setMsg({ kind: 'err', text: 'Enter a valid email address.' }); return; }
    setMsg(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: to,
      options: { emailRedirectTo: `${window.location.origin}/dashboard`, shouldCreateUser: true },
    });
    setLoading(false);
    if (error) { setMsg({ kind: 'err', text: error.message }); return; }
    setMagicSentTo(to);
    setCooldown(60);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (method === 'magic') { await sendMagicLink(); return; }
    if (!supabase) { setMsg({ kind: 'err', text: 'Login is not configured yet.' }); return; }
    setMsg(null);
    setLoading(true);
    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({ email, password });
      setMsg(error ? { kind: 'err', text: error.message } : { kind: 'ok', text: 'Check your inbox to confirm your email, then log in.' });
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg({ kind: 'err', text: error.message });
      else { router.push('/dashboard'); return; }
    }
    setLoading(false);
  }

  async function oauth(provider: 'google' | 'azure') {
    if (!supabase) { setMsg({ kind: 'err', text: 'Login is not configured yet.' }); return; }
    setMsg(null);
    setOauthLoading(provider);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
        scopes: provider === 'azure' ? 'email openid profile User.Read' : undefined,
      },
    });
    if (error) {
      setMsg({ kind: 'err', text: error.message });
      setOauthLoading(null);
    }
  }

  function switchMode(m: Mode) {
    setMode(m);
    setMsg(null);
  }

  function switchMethod(m: Method) {
    setMethod(m);
    setMsg(null);
    setMagicSentTo('');
  }

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#0A0C0F' }}>
      <div className="bg-layer" aria-hidden="true">
        <div className="gp-grid" />
        <div className="gp-glow gp-glow-a" />
        <div className="gp-glow gp-glow-b" />
        <div className="gp-scan" />
      </div>

      <header className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', position: 'relative', zIndex: 10 }}>
        <Link href="/" className="logo" aria-label="OnePass home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/onepass-logo.png" alt="OnePass" className="logo-img" width={139} height={56} />
        </Link>
        <Link href="/#send" className="gp-btn gp-ghost" style={{ textDecoration: 'none' }}>Send a secret →</Link>
      </header>

      <main className="auth-wrap">
        <form className="auth-card" onSubmit={submit} noValidate>
          <div className="tabs" role="group" aria-label="Account">
            <button type="button" className={`tab ${mode === 'login' ? 'tab-on' : ''}`} aria-pressed={mode === 'login'} onClick={() => switchMode('login')}>Log in</button>
            <button type="button" className={`tab ${mode === 'signup' ? 'tab-on' : ''}`} aria-pressed={mode === 'signup'} onClick={() => switchMode('signup')}>Sign up</button>
          </div>

          <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="auth-sub">
            {mode === 'login'
              ? 'See every secret you’ve sent and whether it was opened.'
              : 'Track your secrets in one place. Your secrets stay end-to-end encrypted.'}
          </p>

          <div className="auth-social">
            <button type="button" className="auth-social-btn" onClick={() => oauth('google')} disabled={!!oauthLoading}>
              <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
              <span>{oauthLoading === 'google' ? 'Opening Google…' : 'Continue with Google'}</span>
            </button>
            <button type="button" className="auth-social-btn" onClick={() => oauth('azure')} disabled={!!oauthLoading}>
              <svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true"><path fill="#F25022" d="M1 1h10v10H1z" /><path fill="#7FBA00" d="M12 1h10v10H12z" /><path fill="#00A4EF" d="M1 12h10v10H1z" /><path fill="#FFB900" d="M12 12h10v10H12z" /></svg>
              <span>{oauthLoading === 'azure' ? 'Opening Microsoft…' : 'Continue with Microsoft (Hotmail / Outlook)'}</span>
            </button>
          </div>

          <div className="auth-divider" role="separator"><span>or use email</span></div>

          <div className="auth-method" role="group" aria-label="Email sign-in method">
            <button type="button" className={method === 'password' ? 'on' : ''} aria-pressed={method === 'password'} onClick={() => switchMethod('password')}>Password</button>
            <button type="button" className={method === 'magic' ? 'on' : ''} aria-pressed={method === 'magic'} onClick={() => switchMethod('magic')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
              Magic link
            </button>
          </div>

          {method === 'magic' && magicSentTo ? (
            <div className="magic-sent" role="status">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
              <p><strong>Check your inbox.</strong> We sent a sign-in link to <span>{magicSentTo}</span>. It works once and expires in 1 hour.</p>
              <div className="magic-actions">
                <button type="button" onClick={sendMagicLink} disabled={loading || cooldown > 0}>{cooldown > 0 ? `Resend in ${cooldown}s` : (loading ? 'Sending…' : 'Resend link')}</button>
                <button type="button" onClick={() => { setMagicSentTo(''); setMsg(null); }}>Use a different email</button>
              </div>
            </div>
          ) : (
            <>
              <div className="auth-field">
                <label htmlFor="auth-email">Email</label>
                <input id="auth-email" className="auth-input" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>

              {method === 'password' && (
                <div className="auth-field">
                  <label htmlFor="auth-pass">Password</label>
                  <div className="auth-pass">
                    <input id="auth-pass" className="auth-input" type={showPass ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'login' ? 'Your password' : 'At least 6 characters'} value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
                    <button type="button" className="auth-eye" onClick={() => setShowPass(s => !s)} aria-label={showPass ? 'Hide password' : 'Show password'}>
                      {showPass ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6" /></svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {method === 'magic' && <p className="magic-hint">We’ll email you a one-time link. No password needed{mode === 'signup' ? ' — your account is created when you click it' : ''}.</p>}
            </>
          )}

          {msg && <p className={`auth-msg ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</p>}

          {!(method === 'magic' && magicSentTo) && (
            <button type="submit" className="gp-btn auth-submit" disabled={loading || !email || (method === 'password' && password.length < 6)}>
              {method === 'magic'
                ? (loading ? 'Sending link…' : 'Email me a magic link')
                : loading ? (mode === 'login' ? 'Logging in…' : 'Creating account…') : (mode === 'login' ? 'Log in' : 'Create account')}
            </button>
          )}

          <p className="auth-switch">
            {mode === 'login' ? 'New to OnePass? ' : 'Already have an account? '}
            <button type="button" onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}>
              {mode === 'login' ? 'Create an account' : 'Log in'}
            </button>
          </p>

          <div className="auth-perks" aria-hidden="true">
            <span>AES-256</span><span>ZERO-KNOWLEDGE</span><span>ONE VIEW ONLY</span>
          </div>
        </form>
      </main>
    </div>
  );
}
