// Time-zone helpers for the daily opening window.
// Browsers sometimes report old IANA names (Chrome says "Asia/Calcutta" in India) that some
// databases don't know, so we map the common ones and can fall back to a fixed UTC offset.
const TZ_ALIASES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Rangoon': 'Asia/Yangon', 'Asia/Dacca': 'Asia/Dhaka', 'Asia/Thimbu': 'Asia/Thimphu',
  'Asia/Ulan_Bator': 'Asia/Ulaanbaatar', 'Pacific/Truk': 'Pacific/Chuuk', 'Atlantic/Faeroe': 'Atlantic/Faroe',
};

export function localTz() {
  let z = 'UTC';
  try { z = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* keep UTC */ }
  return TZ_ALIASES[z] || z;
}

/** The current offset as a POSIX zone Postgres always understands (note: POSIX signs are reversed). */
export function offsetTz() {
  const east = -new Date().getTimezoneOffset();
  const a = Math.abs(east);
  return `UTC${east >= 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** Human label for a stored zone: "Asia/Kolkata" → "Asia/Kolkata", "UTC-05:30" (POSIX) → "UTC+05:30". */
export function tzLabel(tz?: string | null) {
  if (!tz) return '';
  const m = /^UTC([+-])(\d{2}:\d{2})$/.exec(tz);
  if (m) return `UTC${m[1] === '-' ? '+' : '-'}${m[2]}`;
  return tz.replace(/_/g, ' ');
}
