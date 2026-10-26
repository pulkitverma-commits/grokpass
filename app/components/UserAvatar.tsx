'use client';

import { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

// Photo first: the Google / Microsoft profile picture, then Gravatar for the
// email. If none loads, a placeholder in the OnePass logo gradient with the
// user's initial.
export function avatarInfo(user: User | null) {
  const meta = (user?.user_metadata || {}) as Record<string, string>;
  const name = meta.full_name || meta.name || (user?.email || '').split('@')[0] || '';
  const photo = meta.avatar_url || meta.picture || '';
  return { name, photo, initial: (name.trim()[0] || '?').toUpperCase() };
}

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Microsoft doesn't send a photo URL with sign-in, so right after a Microsoft
// login we fetch it once from Microsoft Graph, shrink it, and save it on the profile.
async function syncMicrosoftPhoto(): Promise<string | null> {
  if (!supabase) return null;
  try {
    if (sessionStorage.getItem('onepass.msphoto')) return null;
    sessionStorage.setItem('onepass.msphoto', '1');
  } catch { /* ignore */ }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.provider_token;
  if (!token) return null;
  const res = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const bmp = await createImageBitmap(await res.blob());
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const s = Math.min(bmp.width, bmp.height);
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  const url = canvas.toDataURL('image/jpeg', 0.72);
  await supabase.auth.updateUser({ data: { avatar_url: url } });
  return url;
}

export default function UserAvatar({ user, size = 40 }: { user: User | null; size?: number }) {
  const { photo, initial } = avatarInfo(user);
  const [msPhoto, setMsPhoto] = useState('');
  const [gravatar, setGravatar] = useState('');
  const [failed, setFailed] = useState<string[]>([]);

  const email = (user?.email || '').trim().toLowerCase();
  const provider = user?.app_metadata?.provider as string | undefined;

  useEffect(() => {
    let live = true;
    if (email && crypto?.subtle) sha256Hex(email).then(h => { if (live) setGravatar(`https://gravatar.com/avatar/${h}?s=160&d=404`); });
    return () => { live = false; };
  }, [email]);

  useEffect(() => {
    if (provider !== 'azure' || photo) return;
    let live = true;
    syncMicrosoftPhoto().then(url => { if (live && url) setMsPhoto(url); }).catch(() => {});
    return () => { live = false; };
  }, [provider, photo]);

  const candidates = useMemo(() => [photo, msPhoto, gravatar].filter(u => u && !failed.includes(u)), [photo, msPhoto, gravatar, failed]);
  const src = candidates[0] || '';

  return (
    <span className={`user-avatar${src ? '' : ' is-placeholder'}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(f => [...f, src])} />
      ) : (
        <span>{initial}</span>
      )}
    </span>
  );
}
