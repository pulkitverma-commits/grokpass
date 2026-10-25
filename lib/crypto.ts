// Client-side AES-256-GCM helpers. Keys never leave the browser except inside
// the URL fragment (#...), which browsers do not send to any server.

export function toB64Url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64Url(s: string): Uint8Array {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  const bin = atob(b);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function newKey(): Promise<{ key: CryptoKey; keyB64: string }> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const raw = await crypto.subtle.exportKey('raw', key);
  return { key, keyB64: toB64Url(raw) };
}

export async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = fromB64Url(keyB64);
  if (raw.length !== 32) throw new Error('Invalid key');
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['decrypt']);
}

/** Encrypts bytes with AES-256-GCM. Output = 12-byte IV followed by ciphertext+tag. */
export async function encryptBytes(key: CryptoKey, data: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data as BufferSource));
  const out = new Uint8Array(new ArrayBuffer(iv.length + ct.length));
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

export async function decryptBytes(key: CryptoKey, blob: Uint8Array): Promise<ArrayBuffer> {
  const iv = blob.slice(0, 12);
  const ct = blob.slice(12);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return toB64Url(await encryptBytes(key, bytes));
}

export async function decryptJson<T = any>(key: CryptoKey, b64: string): Promise<T> {
  const plain = await decryptBytes(key, fromB64Url(b64));
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function encryptText(key: CryptoKey, text: string): Promise<string> {
  return toB64Url(await encryptBytes(key, new TextEncoder().encode(text)));
}

export async function decryptText(key: CryptoKey, b64: string): Promise<string> {
  return new TextDecoder().decode(await decryptBytes(key, fromB64Url(b64)));
}

export function randomToken(bytes = 24): string {
  return toB64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Header stored (encrypted) alongside every secret. */
export type SecretHeader = {
  v: 1;
  type: 'text' | 'file';
  name?: string;
  mime?: string;
  size?: number;
  timer?: number; // seconds the viewer gets before the secret vanishes; 0 = no timer
};

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_TEXT_CHARS = 50_000;
