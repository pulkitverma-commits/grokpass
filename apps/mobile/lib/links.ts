// What a scanned QR, a shared text or a tapped message turns out to be: a OnePeek invite, a
// one-time secret link, a safety-number code, or nothing of ours. Pure string work plus a one-shot
// in-memory hand-off so a full secret link (whose #fragment is the decryption key) can travel from
// the place it was found (a bubble, the scanner, the share sheet) to the viewer screen WITHOUT going
// through navigation params, which expo-router would keep in its history and could put in a URL.
// Nothing here logs, stores or sends anything.
import { isSecretLink } from './secrets';
import { inviteTokenFrom } from './format';

/** `https://onepeek.io/s/<id>#<key>` (www too) or `onepeek://s/<id>#<key>`, anywhere inside a text. */
const SECRET_RE = /(?:https:\/\/(?:www\.)?onepeek\.io|onepeek:\/)\/s\/([A-Za-z0-9_-]{6,128})#([A-Za-z0-9_+/=-]{16,512})(?=[^A-Za-z0-9_+/=-]|$)/;
/** `https://onepeek.io/chat/join#<token>` or `onepeek://chat/join#<token>`. */
const INVITE_RE = /(?:https:\/\/(?:www\.)?onepeek\.io|onepeek:\/)\/chat\/join#[A-Za-z0-9_-]{32,128}(?=[^A-Za-z0-9_-]|$)/;
/** The QR shown under "Verify people": the 60-digit safety number behind a fixed prefix. */
const VERIFY_RE = /^onepeek-verify:(\d{60})$/;

export type Classified =
  | { kind: 'secret'; url: string; id: string }
  | { kind: 'invite'; url: string; token: string }
  | { kind: 'verify'; digits: string }
  | { kind: 'none' };

/** The first secret link inside `text`, or null. Confirmed with the core's isSecretLink when it is wired. */
export function secretLinkFrom(text: string | null | undefined): { url: string; id: string } | null {
  if (!text) return null;
  const m = SECRET_RE.exec(text);
  if (!m) return null;
  const url = m[0];
  try {
    if (!isSecretLink(url)) return null;
  } catch {
    // lib/secrets is the Phase 2 contract placeholder until core-crypto lands: trust the shape.
  }
  return { url, id: m[1]! };
}

export function inviteLinkFrom(text: string | null | undefined): { url: string; token: string } | null {
  if (!text) return null;
  const m = INVITE_RE.exec(text);
  const token = m ? inviteTokenFrom(m[0]) : null;
  return m && token ? { url: m[0], token } : null;
}

export function verifyDigitsFrom(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = VERIFY_RE.exec(text.trim());
  return m ? m[1]! : null;
}

export function classify(text: string | null | undefined): Classified {
  const s = secretLinkFrom(text);
  if (s) return { kind: 'secret', ...s };
  const i = inviteLinkFrom(text);
  if (i) return { kind: 'invite', ...i };
  const v = verifyDigitsFrom(text);
  if (v) return { kind: 'verify', digits: v };
  return { kind: 'none' };
}

// ---------------------------------------------------------------------------- hand-off

type Slot = 'secret' | 'invite';
const slots: Partial<Record<Slot, string>> = {};

/** Parks a full link for the next screen. Read once by `takeHandoff`; a second read gets null. */
export function stashHandoff(slot: Slot, value: string): void {
  slots[slot] = value;
}

export function takeHandoff(slot: Slot): string | null {
  const v = slots[slot] ?? null;
  delete slots[slot];
  return v;
}

/** Test and reset helper: forgets anything parked. */
export function clearHandoffs(): void {
  delete slots.secret;
  delete slots.invite;
}
