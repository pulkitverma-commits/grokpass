// Browser implementation of the chat ports: the `window`, `navigator`, `localStorage`,
// `BroadcastChannel`, `fetch` and `File`/`Blob` code that used to live inline in
// lib/chat/client.ts. Globals are read at call time, never captured at import.

import type { ChatEnv, ChatPlatform, FileSource, KeyStore, LockStore, OpenedFile, SupabaseLike, SupabaseSession } from '../../chat/ports';
import { createWebKeyStore } from './keystore';

function deviceLabel() {
  if (typeof navigator === 'undefined') return 'Browser';
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Linux';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

export const webEnv: ChatEnv = {
  origin: () => window.location.origin,
  deviceLabel,
  randomUUID: () => crypto.randomUUID(),
  /** Posts to the web app's own notify route. Best effort; the caller already swallows errors. */
  async notify(roomId, accessToken) {
    if (typeof fetch === 'undefined' || typeof window === 'undefined') return;
    await fetch('/api/chat/notify', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ room: roomId }),
    });
  },
};

// Panic lock: kept in localStorage so other tabs lock too (they listen on the BroadcastChannel).
const LOCK = 'onepeek.chat.locked';
export const webLock: LockStore = {
  set() {
    try { localStorage.setItem(LOCK, '1'); } catch { /* ignore */ }
    try { new BroadcastChannel('onepeek-chat').postMessage({ t: 'lock' }); } catch { /* ignore */ }
  },
  get() {
    try { return localStorage.getItem(LOCK) === '1'; } catch { return false; }
  },
  clear() {
    try { localStorage.removeItem(LOCK); } catch { /* ignore */ }
  },
};

/** Adapts a browser `File` for the core's sendFile. */
export function fileSource(file: File): FileSource {
  return { name: file.name, mime: file.type, size: file.size, bytes: async () => new Uint8Array(await file.arrayBuffer()) };
}

/** Turns the core's decrypted attachment back into the `Blob` the web UI expects. */
export function toBlob(f: OpenedFile): Blob {
  return new Blob([f.bytes as BlobPart], { type: f.mime });
}

/** Builds the browser ChatPlatform. Pass the app's Supabase client (or null when unconfigured). */
export function createWebPlatform<S extends SupabaseSession>(opts: { supabase: SupabaseLike<S> | null; keystore?: KeyStore }): ChatPlatform<S> {
  return { supabase: opts.supabase, keystore: opts.keystore ?? createWebKeyStore(), env: webEnv, lock: webLock };
}
