// Shared wording for timers and room kinds.
export const TIMERS = [
  { s: 10, label: '10s' },
  { s: 30, label: '30s' },
  { s: 60, label: '1m' },
  { s: 300, label: '5m' },
  { s: 3600, label: '1h' },
  { s: 86400, label: '24h' },
] as const;

export const ttlLabel = (s: number) => TIMERS.find(t => t.s === s)?.label ?? (s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);

export function countdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const h = Math.floor(s / 3600);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

export const KIND_NAME = { quick: 'Quick Chat', secret: 'Secret Chat', business: 'Business Room' } as const;

export function shortId(id: string) {
  return id.replace(/-/g, '').slice(0, 4).toUpperCase();
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
    default: return 'Something went wrong. Try again.';
  }
}
