// Invite link fragment with the owner pinned (security review f2-tree-keys.md F2-7).
//
//   https://onepeek.io/chat/join#<token>                       before F2-7 (still accepted)
//   https://onepeek.io/chat/join#<token>.1<pin>                 v1: <pin> = base64url(uuid[16] || sha256(owner signing key)[32])
//
// The fragment never reaches a server (browsers don't send it, the apps strip it before any
// request); only `<token>` is ever passed to an RPC. The joiner keeps the pin and requires that the
// Welcome and every commit come from that device with that key, whatever the server's listing says.
// '.' is not in the base64url alphabet, so the token alone still parses the way it always did.
import { toB64Url, fromB64Url } from '../crypto';

export type OwnerPin = { deviceId: string; keyHash: string };   // keyHash: hex of SHA-256(signature public key)

const TOKEN = '[A-Za-z0-9_-]{32,128}';
const PIN_V1 = '1[A-Za-z0-9_-]{64}';
/** A whole fragment (without '#'): the token, optionally followed by `.1<pin>`. */
export const INVITE_FRAGMENT_RE = new RegExp(`^(${TOKEN})(?:\\.(${PIN_V1}))?$`);

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function keyHash(signaturePublicKey: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', signaturePublicKey as BufferSource)));
}

export async function ownerPin(deviceId: string, signaturePublicKey: Uint8Array): Promise<OwnerPin> {
  return { deviceId, keyHash: await keyHash(signaturePublicKey) };
}

/** `1<base64url(uuid bytes || key hash)>`. */
export function encodePin(pin: OwnerPin): string {
  if (!UUID.test(pin.deviceId) || !/^[0-9a-f]{64}$/.test(pin.keyHash)) throw new Error('bad_pin');
  const out = new Uint8Array(48);
  const id = pin.deviceId.replace(/-/g, '');
  for (let i = 0; i < 16; i++) out[i] = parseInt(id.substr(i * 2, 2), 16);
  for (let i = 0; i < 32; i++) out[16 + i] = parseInt(pin.keyHash.substr(i * 2, 2), 16);
  return '1' + toB64Url(out);
}

function decodePin(s: string): OwnerPin | null {
  if (s[0] !== '1') return null;
  let b: Uint8Array;
  try { b = fromB64Url(s.slice(1)); } catch { return null; }
  if (b.length !== 48) return null;
  const h = hex(b.subarray(0, 16));
  const deviceId = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  return UUID.test(deviceId) ? { deviceId, keyHash: hex(b.subarray(16)) } : null;
}

/** Splits a fragment (with or without a leading '#') into the server token and the owner pin, if any. */
export function parseInviteFragment(fragment: string): { token: string; pin: OwnerPin | null } | null {
  const m = INVITE_FRAGMENT_RE.exec(fragment.replace(/^#/, ''));
  if (!m) return null;
  const pin = m[2] ? decodePin(m[2]) : null;
  if (m[2] && !pin) return null;
  return { token: m[1], pin };
}
