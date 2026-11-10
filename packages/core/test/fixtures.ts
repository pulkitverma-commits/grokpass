// Fixture strings and the "never appears" helper shared by every test in docs/mobile/test-plan.md
// (§1.1). The strings are chosen so a grep over any log, dump or payload finds them; every security
// assertion is a negative `toContain` on a serialised artefact, in text, hex and base64url form.
import { expect } from 'vitest';

export const BODY = 'The launch code is 4471';
export const BODY2 = 'Got it';
export const FILE_NAME = 'passport.txt';
export const FILE_BODY = 'passport scan: P1234567';
export const ACCESS_CODE = 'blue-river-42';
/** Long enough (11 bytes) that its hex cannot occur by chance inside random ciphertext. */
export const NICK = 'Sam Okonkwo';
/** The owner's display name, announced through the same encrypted `nick` control message. */
export const OWNER_NICK = 'Priya Venkatesan';
export const ROOM_NAME = 'qa-launch';

export type Forbidden = { label: string; forms: string[] };

export function hex(v: string | Uint8Array): string {
  return Buffer.from(v).toString('hex');
}
export function b64url(v: string | Uint8Array): string {
  return Buffer.from(v).toString('base64url');
}
export function b64(v: string | Uint8Array): string {
  return Buffer.from(v).toString('base64');
}

/**
 * Every encoding a secret could leak in: as text, as the `\x` hex PostgREST uses for bytea, as
 * base64url (what toB64Url produces) and as standard base64. Byte values are checked as hex and
 * base64 only (a random 32-byte key has no meaningful text form).
 */
export function forbidden(label: string, v: string | Uint8Array): Forbidden {
  const forms = typeof v === 'string' ? [v, hex(v), b64url(v), b64(v)] : [hex(v), b64url(v), b64(v)];
  return { label, forms: forms.filter(f => f.length >= 6) };
}

/** Asserts none of the forbidden values occur in `artefact`. The failure names what leaked where. */
export function expectClean(artefact: string, list: Forbidden[], where: string): void {
  for (const f of list) {
    for (const form of f.forms) {
      expect(artefact.includes(form), `${f.label} (${form.slice(0, 24)}…) found in ${where}`).toBe(false);
    }
  }
}
