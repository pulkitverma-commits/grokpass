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
  guard?: boolean; // blur until the viewer presses and holds, with a watermark
  tpl?: 'wifi';    // text is JSON for a template (Wi-Fi network)
};

export type WifiSecret = { ssid: string; password: string; security: 'WPA' | 'WEP' | 'nopass'; hidden?: boolean };

/** Standard Wi-Fi QR payload understood by iOS and Android cameras. */
export function wifiQrPayload(w: WifiSecret) {
  const esc = (v: string) => v.replace(/([\\;,:"])/g, '\\$1');
  return `WIFI:T:${w.security};S:${esc(w.ssid)};${w.security === 'nopass' ? '' : `P:${esc(w.password)};`}${w.hidden ? 'H:true;' : ''};`;
}

// ---- Requests: the responder encrypts to the requester's public key (ECDH P-256 + HKDF + AES-GCM).

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const REQ_INFO = new TextEncoder().encode('onepeek-request-v1');

export async function newRequestKeys(): Promise<{ publicB64: string; privateB64: string }> {
  const kp = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey('raw', kp.publicKey);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { publicB64: toB64Url(pub), privateB64: toB64Url(new TextEncoder().encode(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }))) };
}

async function aesFromShared(bits: ArrayBuffer, salt: Uint8Array) {
  const ikm = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: REQ_INFO }, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Output: base64url( ephemeral public key (65 bytes) || iv (12) || ciphertext+tag ). */
export async function encryptToPublicKey(publicB64: string, text: string): Promise<string> {
  const recipient = await crypto.subtle.importKey('raw', fromB64Url(publicB64) as BufferSource, ECDH, false, []);
  const eph = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']) as CryptoKeyPair;
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: recipient }, eph.privateKey, 256);
  const ephRaw = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const key = await aesFromShared(bits, ephRaw);
  const sealed = await encryptBytes(key, new TextEncoder().encode(JSON.stringify({ v: 1, text })));
  const out = new Uint8Array(ephRaw.length + sealed.length);
  out.set(ephRaw, 0);
  out.set(sealed, ephRaw.length);
  return toB64Url(out);
}

export async function decryptWithPrivateKey(privateB64: string, blobB64: string): Promise<string> {
  const jwk = JSON.parse(new TextDecoder().decode(fromB64Url(privateB64)));
  const priv = await crypto.subtle.importKey('jwk', { ...jwk, ext: true, key_ops: ['deriveBits'] }, ECDH, false, ['deriveBits']);
  const blob = fromB64Url(blobB64);
  const ephRaw = blob.slice(0, 65);
  const eph = await crypto.subtle.importKey('raw', ephRaw as BufferSource, ECDH, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: eph }, priv, 256);
  const key = await aesFromShared(bits, ephRaw);
  const plain = await decryptBytes(key, blob.slice(65));
  const data = JSON.parse(new TextDecoder().decode(plain)) as { text?: string };
  return data.text ?? '';
}

// 50 MB, minus room for the 28 bytes AES-GCM adds, so the encrypted file fits a 50 MB storage limit.
export const MAX_FILE_BYTES = 50 * 1024 * 1024 - 1024;
export const MAX_TEXT_CHARS = 50_000;
