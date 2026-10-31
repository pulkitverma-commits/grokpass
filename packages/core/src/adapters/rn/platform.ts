// React Native implementation of the chat ports. No `window`, `navigator`, `localStorage`,
// `indexedDB`, `File` or `Blob` here (enforced by ESLint for this directory): the app injects what
// the phone knows (site URL, API base, device model, the expo modules) and the core sees only the
// ChatPlatform interface.

import type { BinaryBody, ChatEnv, ChatPlatform, FileSource, KeyStore, LockStore, SupabaseLike, SupabaseSession } from '../../chat/ports';
import type { SecureStoreLike, SecureStoreOptionsLike } from './keystore';

// ---- Env

export interface RnEnvOptions {
  /** Where invite links point. Must be `https://onepeek.io` or `https://www.onepeek.io` (see `allowInsecureDev`). */
  siteUrl: string;
  /** Where `/api/chat/notify` lives. Same rule as `siteUrl`; defaults to `siteUrl`. */
  apiBaseUrl?: string;
  /** Model name from the app, e.g. "iPhone 15" or "Pixel 8". Never the user-typed device name. */
  deviceLabel: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /**
   * Spike / dev builds only: additionally accept `http://localhost` and `http://127.0.0.1` (any
   * port). The production app never passes this; `notify()` posts the session token as a bearer
   * to `apiBaseUrl`, so an arbitrary host here would be a token leak.
   */
  allowInsecureDev?: boolean;
}

const MAX_LABEL = 40;

/** The only hosts the phones may send the session bearer to or point invite links at. */
export const ALLOWED_HOSTS: readonly string[] = ['onepeek.io', 'www.onepeek.io'];
const DEV_HOSTS: readonly string[] = ['localhost', '127.0.0.1'];

/**
 * Parses `value` and returns its origin (`scheme://host[:port]`, no trailing slash), or throws.
 * Accepted: `https:` to an allowed host; with `allowInsecureDev`, also `http:`/`https:` to
 * localhost. Credentials, a path, a query or a fragment are refused. The message names the option,
 * never the value.
 */
export function checkOnePeekUrl(name: string, value: string, allowInsecureDev = false): string {
  let u: URL;
  try { u = new URL(value); } catch { throw new Error(`createRnEnv: ${name} is not an absolute URL`); }
  const dev = allowInsecureDev && DEV_HOSTS.includes(u.hostname) && (u.protocol === 'http:' || u.protocol === 'https:');
  const prod = u.protocol === 'https:' && ALLOWED_HOSTS.includes(u.hostname) && u.port === '';   // 443 only
  if (!dev && !prod) {
    throw new Error(`createRnEnv: ${name} must be https://onepeek.io or https://www.onepeek.io${allowInsecureDev ? ' (or http://localhost in a dev build)' : ''}`);
  }
  if (u.username || u.password) throw new Error(`createRnEnv: ${name} must not carry credentials`);
  if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) throw new Error(`createRnEnv: ${name} must be an origin with no path, query or fragment`);
  return u.origin;
}

/** Builds the phone's ChatEnv. Throws synchronously unless `siteUrl` and `apiBaseUrl` pass `checkOnePeekUrl`. */
export function createRnEnv(opts: RnEnvOptions): ChatEnv {
  const origin = checkOnePeekUrl('siteUrl', opts.siteUrl, opts.allowInsecureDev);
  const apiBase = opts.apiBaseUrl === undefined ? origin : checkOnePeekUrl('apiBaseUrl', opts.apiBaseUrl, opts.allowInsecureDev);
  const notifyUrl = `${apiBase}/api/chat/notify`;
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
  /**
   * The persistence of the latest `set()`/`clear()`. With a synchronous SecureStore (`setItem`,
   * expo-secure-store >= 13) `set()` has already landed when it returns and this is resolved;
   * otherwise Panic Exit should await it before leaving the app. Never rejects.
   */
  readonly pending: Promise<void>;
}

/**
 * Panic lock on SecureStore. Fails closed: `get()` reports locked until the stored flag has been
 * read, and stays locked when the read fails (Keychain unavailable, e.g. launched while the phone
 * is locked); the app clears it after its own unlock. `set()` flips the in-memory flag at once and
 * persists synchronously when the module offers `setItem`, else in the background (`pending`).
 * The flag is stored `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, like the wrapping key. A set/clear made
 * before the read lands wins over the stored value.
 */
export function createRnLockStore(secureStore: SecureStoreLike): RnLockStore {
  const accessibility: SecureStoreOptionsLike = { keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  let locked = true;   // until the flag is read, or when it cannot be
  let touched = false;
  let pending: Promise<void> = Promise.resolve();
  const apply = (v: string | null) => { if (!touched) locked = v === '1'; };

  let ready: Promise<void>;
  if (typeof secureStore.getItem === 'function') {
    try { apply(secureStore.getItem(LOCK_ID, accessibility)); } catch { /* unreadable: stay locked */ }
    ready = Promise.resolve();
  } else {
    ready = secureStore.getItemAsync(LOCK_ID, accessibility).then(apply, () => { /* unreadable: stay locked */ });
  }

  return {
    ready,
    get pending() { return pending; },
    set() {
      locked = true; touched = true;
      if (typeof secureStore.setItem === 'function') {
        try { secureStore.setItem(LOCK_ID, '1', accessibility); pending = Promise.resolve(); return; } catch { /* fall back to the async write */ }
      }
      pending = secureStore.setItemAsync(LOCK_ID, '1', accessibility).catch(() => {});
    },
    get: () => locked,
    clear() {
      locked = false; touched = true;
      pending = secureStore.deleteItemAsync(LOCK_ID, accessibility).catch(() => {});
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
