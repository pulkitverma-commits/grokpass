// Shared wording for timers, room kinds and errors. Mirrors the web's app/chat/format.ts so the
// phone and the browser say the same things; keep the two in step.
export const TIMERS = [
  { s: 10, label: '10s' },
  { s: 30, label: '30s' },
  { s: 60, label: '1m' },
  { s: 300, label: '5m' },
  { s: 3600, label: '1h' },
  { s: 86400, label: '24h' },
] as const;

export const LIFETIMES = [
  { s: 3600, label: '1 hour' },
  { s: 86400, label: '1 day' },
  { s: 604800, label: '7 days' },
] as const;

/** One-time secret options (the web's app/page.tsx): views before the link burns, and the viewer timer. */
export const SECRET_VIEWS = [
  { n: 1, label: 'Once' },
  { n: 3, label: '3 times' },
  { n: 5, label: '5 times' },
  { n: 10, label: '10 times' },
] as const;

export const SECRET_TIMERS = [
  { s: 0, label: 'Off' },
  { s: 10, label: '10s' },
  { s: 30, label: '30s' },
  { s: 60, label: '60s' },
] as const;

export const ttlLabel = (s: number) => TIMERS.find((t) => t.s === s)?.label ?? (s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);

export function countdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const h = Math.floor(s / 3600);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

export const KIND_NAME = { quick: 'Quick Chat', secret: 'Secret Chat', business: 'Business Room' } as const;
export const KIND_SHORT = { quick: 'Quick', secret: 'Secret', business: 'Business' } as const;

export function shortId(id: string) {
  return id.replace(/-/g, '').slice(0, 4).toUpperCase();
}

/** A room's display name: the local name, else "<kind> · <short id>" as on the web. */
export function roomTitle(r: { name: string | null; kind: keyof typeof KIND_NAME; id: string }) {
  return r.name || `${KIND_NAME[r.kind]} · ${shortId(r.id)}`;
}

/** The `code` of a core ChatError, or '' for anything else. Duck-typed so screens never import the core at runtime. */
export function errorCode(e: unknown): string {
  return e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string' ? (e as { code: string }).code : '';
}

export function friendlyError(code: string) {
  switch (code) {
    case 'access_code_wrong': return 'That access code isn’t right.';
    case 'invite_invalid': return 'This invite has expired, been used or been revoked.';
    case 'rate_limited': return 'Too many attempts. Wait a few minutes and try again.';
    case 'not_signed_in': return 'Sign in first.';
    case 'not_owner': return 'Only the room’s owner can do that.';
    case 'room_closed': return 'This chat has ended.';
    case 'weak_code': return 'Use an access code of at least 6 characters.';
    case 'not_configured': return 'Chat isn’t configured on this deployment yet.';
    case 'file_too_large': return 'Files can be up to 50 MB.';
    case 'empty_file': return 'That file is empty.';
    case 'upload_failed': return 'The file couldn’t be uploaded. Try again.';
    case 'view_once_sent': return 'You sent this as view once, so it can’t be opened on your side.';
    case 'gone': return 'That file has already been opened or has expired.';
    case 'no_local_state': return 'You haven’t been let into this chat yet. Wait for the owner, then try again.';
    case 'keystore_unavailable': return 'This phone’s chat keys are missing.';
    case 'report_failed': return 'The report couldn’t be sent. Try again.';
    case 'quota_exceeded': return 'You’ve used this month’s free secrets. See onepeek.io/pricing.';
    case 'secret_gone': return 'This secret has already been opened, or it has expired.';
    case 'bad_key': return 'This link’s key doesn’t match the secret. Ask the sender to share it again.';
    default: return 'Something went wrong. Try again.';
  }
}

/** Invite tokens travel only in the link's #fragment. Pulls one out of a pasted link or a deep-link URL. */
export function inviteTokenFrom(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /#([A-Za-z0-9_-]{32,128})(?:[^A-Za-z0-9_-]|$)/.exec(text.trim());
  return m ? m[1]! : null;
}

/**
 * Masks the fragment so the token or key is not drawn as text (the web shows `#••••••` the same way).
 * The text is not the only rendering: the invite and secret sheets can also show the full link as a
 * QR code, which is why that code stays hidden until "Show QR code" and hides again (HiddenQR, F-4).
 */
export function maskLink(link: string) {
  return link.replace(/#.*/, '#••••••');
}

/** The core's `keyChanged`: a verified member whose signing key no longer matches what was verified. */
export function keyChanged(m: { verified: string | null; signaturePub: Uint8Array }) {
  if (!m.verified) return false;
  let hex = '\\x';
  for (let i = 0; i < m.signaturePub.length; i++) hex += m.signaturePub[i]!.toString(16).padStart(2, '0');
  return m.verified !== hex;
}

/** A member's display name: nickname, else the web's `Guest XXXX`. */
export function memberName(nickname: string | null | undefined, deviceId: string) {
  return nickname || `Guest ${shortId(deviceId)}`;
}

/** Message timer text, per message: countdown once started, otherwise "<ttl> once read" as on the web. */
export function timerText(ttl: number, expiresAt: number | null, now: number) {
  if (expiresAt === null) return `${ttlLabel(ttl)} once read`;
  return `${countdown(expiresAt - now)} left`;
}

/** The time a message was sent, as the phone's local "H:MM" (accessibility labels; no Intl on Hermes needed). */
export function sentTime(ms: number) {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
