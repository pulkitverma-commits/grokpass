// React Native implementation of the chat ports. No `window`, `navigator`, `localStorage`,
// `indexedDB`, `File` or `Blob` here (enforced by ESLint for this directory): the app injects what
// the phone knows (site URL, API base, device model, the expo modules) and the core sees only the
// ChatPlatform interface.

import type { BinaryBody, ChatEnv, ChatPlatform, FileSource, KeyStore, LockStore, SupabaseLike, SupabaseSession } from '../../chat/ports';
import type { SecureStoreLike } from './keystore';

// ---- Env

export interface RnEnvOptions {
  /** Where invite links point, e.g. `https://onepeek.io`. */
  siteUrl: string;
  /** Where `/api/chat/notify` lives, e.g. `https://onepeek.io` (may equal siteUrl). */
  apiBaseUrl: string;
  /** Model name from the app, e.g. "iPhone 15" or "Pixel 8". Never the user-typed device name. */
  deviceLabel: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

const MAX_LABEL = 40;

export function createRnEnv(opts: RnEnvOptions): ChatEnv {
  const origin = opts.siteUrl.replace(/\/+$/, '');
  const notifyUrl = `${opts.apiBaseUrl.replace(/\/+$/, '')}/api/chat/notify`;
  const label = (opts.deviceLabel.trim() || 'Phone').slice(0, MAX_LABEL);
  return {
    origin: () => origin,
    deviceLabel: () => label,
    randomUUID: () => crypto.randomUUID(),
    /** Best effort: no retries, nothing thrown; the push is content-free so losing one is harmless. */
    async notify(roomId, accessToken) {
      const f = opts.fetch ?? globalThis.fetch;
      if (typeof f !== 'function') return;
      try {
        await f(notifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ room: roomId }),
        });
      } catch {
        /* best effort */
      }
    },
  };
}

// ---- Lock

/** SecureStore entry for the panic-lock flag. */
export const LOCK_ID = 'onepeek.lock';

export interface RnLockStore extends LockStore {
  /** Resolves once the flag has been read back from SecureStore (after a process restart). */
  ready: Promise<void>;
}

/**
 * Panic lock on SecureStore. `set()` flips an in-memory flag synchronously so the UI can cover the
 * screen at once, and persists it in the background; a new instance after a restart reads it back
 * (`ready`). A set/clear made before the read lands wins over the stored value.
 */
export function createRnLockStore(secureStore: SecureStoreLike): RnLockStore {
  let locked = false;
  let touched = false;
  const ready = secureStore
    .getItemAsync(LOCK_ID)
    .then(v => { if (!touched && v === '1') locked = true; })
    .catch(() => { /* unreadable flag: stay unlocked, the app can still lock explicitly */ });
  return {
    ready,
    set() {
      locked = true; touched = true;
      void secureStore.setItemAsync(LOCK_ID, '1').catch(() => {});
    },
    get: () => locked,
    clear() {
      locked = false; touched = true;
      void secureStore.deleteItemAsync(LOCK_ID).catch(() => {});
    },
  };
}

// ---- Files

export interface RnPickedFile {
  /** `file://` URI from expo-image-picker / expo-document-picker. Kept for the UI; the core never reads it. */
  uri: string;
  name: string;
  mime?: string | null;
  /** From the picker metadata; the core checks it against MAX_ATTACHMENT_BYTES before reading. */
  size: number;
  /** Reads the whole file, e.g. with expo-file-system. Called lazily, once, by sendFile. */
  read(): Promise<Uint8Array>;
}

/** Adapts a picked file for the core's sendFile. Bytes are read only when the core asks. */
export function fileSource(f: RnPickedFile): FileSource & { uri: string } {
  return { uri: f.uri, name: f.name, mime: f.mime ?? '', size: f.size, bytes: () => f.read() };
}

// ---- Supabase

type FileReaderLike = {
  result: unknown;
  onload: null | (() => void);
  onerror: null | (() => void);
  readAsArrayBuffer?(b: unknown): void;
  readAsDataURL(b: unknown): void;
};

function base64Decode(s: string): Uint8Array {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0, acc = 0, n = 0;
  for (const ch of clean) {
    acc = (acc << 6) | A.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; out[n++] = (acc >> bits) & 0xff; }
  }
  return out.subarray(0, n);
}

function viaFileReader(body: unknown, mode: 'arrayBuffer' | 'dataURL'): Promise<ArrayBuffer> {
  const Ctor = (globalThis as { FileReader?: new () => FileReaderLike }).FileReader;
  if (!Ctor) return Promise.reject(new Error('download_body_unsupported'));
  return new Promise((resolve, reject) => {
    const r = new Ctor();
    r.onerror = () => reject(new Error('download_body_unreadable'));
    r.onload = () => {
      const v = r.result;
      if (v instanceof ArrayBuffer) return resolve(v);
      if (typeof v === 'string') {
        const u8 = base64Decode(v.slice(v.indexOf(',') + 1));
        return resolve(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer);
      }
      reject(new Error('download_body_unreadable'));
    };
    if (mode === 'arrayBuffer') {
      if (typeof r.readAsArrayBuffer !== 'function') return reject(new Error('download_body_unsupported'));
      r.readAsArrayBuffer(body);
    } else r.readAsDataURL(body);
  });
}

/**
 * Turns whatever supabase-js hands back from `download()` on React Native into an ArrayBuffer.
 * RN's Blob may lack `arrayBuffer()`, or have one that throws; FileReader is the documented path
 * (`readAsArrayBuffer`, else `readAsDataURL` + base64). Typed arrays pass straight through.
 */
export async function bodyToArrayBuffer(body: unknown): Promise<ArrayBuffer> {
  if (body instanceof ArrayBuffer) return body;
  if (body instanceof Uint8Array) return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  const b = body as { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof b?.arrayBuffer === 'function') {
    try { return await b.arrayBuffer(); } catch { /* RN: "not implemented"; fall through */ }
  }
  try { return await viaFileReader(body, 'arrayBuffer'); } catch { /* older RN: readAsArrayBuffer missing */ }
  return viaFileReader(body, 'dataURL');
}

/**
 * Wraps the app's Supabase client for the core: uploads pass the ciphertext bytes through
 * untouched (supabase-js on RN sends a Uint8Array fine) and downloads are normalised to a
 * `BinaryBody` whose `arrayBuffer()` works on RN. Everything else is delegated.
 */
export function wrapRnSupabase<S extends SupabaseSession>(sb: SupabaseLike<S>): SupabaseLike<S> {
  return {
    auth: sb.auth,
    rpc: (fn, args) => sb.rpc(fn, args),
    channel: (name, options) => sb.channel(name, options),
    removeChannel: (channel) => sb.removeChannel(channel),
    realtime: sb.realtime,
    storage: {
      from(bucket) {
        const b = sb.storage.from(bucket);
        return {
          upload: (path, body, options) => b.upload(path, body, options),
          async download(path) {
            const res = await b.download(path);
            if (res.error || !res.data) return { data: null, error: res.error ?? { message: 'empty' } };
            const raw: unknown = res.data;
            const data: BinaryBody = { arrayBuffer: () => bodyToArrayBuffer(raw) };
            return { data, error: null };
          },
        };
      },
    },
  };
}

// ---- Everything together

export interface RnPlatformOptions<S extends SupabaseSession> extends RnEnvOptions {
  supabase: SupabaseLike<S> | null;
  keystore: KeyStore;
  /** Defaults to a SecureStore lock when `secureStore` is given. */
  lockStore?: LockStore;
  secureStore?: SecureStoreLike;
}

/** Builds the React Native ChatPlatform. The keystore comes from createRnKeyStore. */
export function createRnPlatform<S extends SupabaseSession>(opts: RnPlatformOptions<S>): ChatPlatform<S> {
  const lock = opts.lockStore ?? (opts.secureStore ? createRnLockStore(opts.secureStore) : null);
  if (!lock) throw new Error('createRnPlatform: pass lockStore or secureStore');
  return {
    supabase: opts.supabase && wrapRnSupabase(opts.supabase),
    keystore: opts.keystore,
    env: createRnEnv(opts),
    lock,
  };
}
