'use client';

import { useState } from 'react';
import type { User } from '@supabase/supabase-js';

// Profile photo from Google / Microsoft when available, otherwise a
// placeholder in the OnePass logo gradient with the user's initial.
export function avatarInfo(user: User | null) {
  const meta = (user?.user_metadata || {}) as Record<string, string>;
  const name = meta.full_name || meta.name || (user?.email || '').split('@')[0] || '';
  const photo = meta.avatar_url || meta.picture || '';
  return { name, photo, initial: (name.trim()[0] || '?').toUpperCase() };
}

export default function UserAvatar({ user, size = 40 }: { user: User | null; size?: number }) {
  const { photo, initial } = avatarInfo(user);
  const [broken, setBroken] = useState(false);
  const showPhoto = !!photo && !broken;

  return (
    <span className={`user-avatar${showPhoto ? '' : ' is-placeholder'}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        <span>{initial}</span>
      )}
    </span>
  );
}
