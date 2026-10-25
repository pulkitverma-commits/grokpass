'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

export default function Dashboard() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
  }, []);

  if (!user) return <div className="card"><p>Please <Link href="/login">log in</Link>.</p></div>;

  return (
    <div className="card">
      <h2>Dashboard</h2>
      <p>Logged in as {user.email}</p>
      <p style={{ marginTop: '1rem', color: '#9aa0a6' }}>
        Your sent secrets will appear here once Supabase tables are connected.
        Photos/files are stored encrypted in Supabase Storage.
      </p>
      <Link href="/" style={{ display: 'inline-block', marginTop: '1rem' }}>Send another</Link>
    </div>
  );
}
