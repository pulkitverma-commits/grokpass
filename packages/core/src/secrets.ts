// One-time secrets (onepeek.io links), platform-neutral. The website is the spec and this file
// reproduces it byte for byte, so a secret made on a phone opens in a browser and vice versa:
//
//   create   app/page.tsx createSecret(): header JSON + ciphertext via ./crypto, the `create_secret`
//            RPC (migration 005 signature) and the link `${origin}/s/${id}#${keyB64}`.
//   peek     app/s/[id]/page.tsx load effect: `peek_secret` RPC, header decrypted on the device.
//   open     app/s/[id]/page.tsx reveal(): POST `${apiBase}/api/open` (app/api/open/route.ts; the
//            `open_secret` RPC is service-role only), then decrypt body / download + decrypt file.
//   unlock   app/api/unlock/send and /verify, for links locked to a recipient's email.
//
// Everything that differs between a browser and a phone comes in through `SecretsDeps`: the
// Supabase client, `fetch`, the site origin, the time zone and the anonymous client id. Nothing
// here touches `window`, `localStorage` or a global `fetch`. The AES key exists only in the
// caller's link / `keyB64` argument and inside WebCrypto; it is never logged, stored or sent.
// Web wiring is deliberately absent (zero web change in this step).

import {
  newKey, importKey, encryptJson, encryptText, encryptBytes, decryptJson, decryptText, decryptBytes, randomToken, fromB64Url,
  MAX_FILE_BYTES, MAX_TEXT_CHARS, type SecretHeader, type WifiSecret,
} from './crypto';
import type { BinaryBody, FileSource, SupabaseError } from './chat/ports';
import { normalizeTz, offsetTz } from './time';

export { MAX_FILE_BYTES, MAX_TEXT_CHARS };

// ---------------------------------------------------------------------------- ports

/** Where the website keeps encrypted files (`supabase.storage.from('secrets')`). */
export const SECRETS_BUCKET = 'secrets';

export type SecretsBucket = {
  upload(path: string, body: Uint8Array | Blob, options: { contentType: string; upsert: boolean }): Promise<{ error: SupabaseError | null }>;
  download(path: string): Promise<{ data: BinaryBody | null; error: SupabaseError | null }>;
  /** Optional: the web deletes the ciphertext after the final view and after a failed create. */
  remove?(paths: string[]): PromiseLike<unknown>;
};

/** The slice of supabase-js the secrets need. The real client and the chat `SupabaseLike` both fit. */
export interface SecretsSupabase {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: SupabaseError | null }>;
  storage: { from(bucket: string): SecretsBucket };
}

export type FetchResponseLike = { ok: boolean; status: number; json(): Promise<unknown> };
export type FetchLike = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<FetchResponseLike>;

export interface SecretsDeps {
  /** `null` when the app is not configured: every call then fails with `not_configured`. */
  supabase: SecretsSupabase | null;
  /** The platform's fetch (the global one on both platforms; injected so tests can record it). */
  fetch: FetchLike;
  /** Origin of the website API, e.g. `https://onepeek.io` (routes: /api/open, /api/unlock/*). */
  apiBase: string;
  /** Origin the link is built on, e.g. `https://onepeek.io` (web: `window.location.origin`). */
  origin: string;
  /** IANA zone of the device, e.g. `Intl.DateTimeFormat().resolvedOptions().timeZone` (web: localTz()). */
  tz: () => string;
  /** Anonymous per-install id for the free quota, `[A-Za-z0-9_-]{16,64}` (web: lib/quota getClientId()). */
  clientId: () => string | Promise<string>;
  /** Referral code captured from `?ref=` (web: captureRef()); phones have none. */
  ref?: () => string | null;
}

// ---------------------------------------------------------------------------- types

export type SecretInput =
  | { kind: 'text'; text: string }
  | { kind: 'wifi'; wifi: WifiSecret }
  | { kind: 'file'; file: FileSource };

export type Geofence = { lat: number; lon: number; radius: number; label?: string | null };

export type CreateSecretOptions = {
  /** Link lifetime in seconds; the server refuses < 300 and anything over the plan's maximum. */
  ttlSeconds: number;
  /** Views before the link burns (web: 1, 2, 3, 5, 10). Default 1. */
  views?: number;
  /** Seconds the viewer gets once opened; 0 = none (web `timer`, clamped to 0..3600). */
  timer?: number;
  /** Blur until held with a watermark (web `guard`). */
  guard?: boolean;
  noCopy?: boolean;
  noSave?: boolean;
  // Signed-in extras; the web passes them only when a user is signed in (`user ? … : null`).
  recipient?: string | null;
  shareLocation?: boolean;
  geofence?: Geofence | null;
  /** Lock to a recipient: they confirm this address with an emailed code before opening. */
  lockEmail?: string | null;
  /** ISO timestamp the secret can be opened from (web `openAfter`, already filtered to > now + 60 s). */
  openAfter?: string | null;
  /** Daily opening window in minutes since midnight in the device's zone (web `wStart` / `wEnd`). */
  window?: { start: number; end: number } | null;
  /** ISO-3166 alpha-2 country allow-list. */
  countries?: string[] | null;
};

export type SecretLink = { id: string; url: string };

/** What the viewer learns before opening (the web `Peek`, header decrypted): never the content. */
export type SecretPeek = {
  header: SecretHeader;
  kind: 'text' | 'file';
  expiresAt: string | null;
  viewsLeft: number | null;
  maxViews: number | null;
  /** Locked to a recipient's email: the viewer needs an unlock token (requestUnlockCode / verifyUnlockCode). */
  locked: boolean;
  /** Masked recipient address, e.g. `p•••@example.com`. */
  lockHint: string | null;
  /** ISO timestamp the secret opens from, when that is still in the future ("opens in …"). */
  notYet: string | null;
  openAfter: string | null;
  window: { start: number; end: number; tz: string | null } | null;
  countries: string[];
  shareLocation: boolean;
  fence: { radius: number; label: string | null } | null;
};

export type OpenedSecret = {
  header: SecretHeader;
  /** Views remaining after this one (`views_left`). */
  viewsLeft: number;
  /** This was the last view: the server deleted the secret (`final`). */
  final: boolean;
  /** City-level place of the viewer as the server saw it, for the watermark (`viewer_place`). */
  viewerPlace: string | null;
} & (
  | { kind: 'text'; text: string }
  | { kind: 'wifi'; wifi: WifiSecret }
  | { kind: 'file'; bytes: Uint8Array; name: string; mime: string }
);

export type OpenSecretOptions = {
  /** One-use token from verifyUnlockCode() for a link locked to a recipient. */
  unlockToken?: string | null;
  /** Device position for geofenced links (the web asks the browser for it when `fence` is set). */
  precise?: { lat: number; lon: number; accuracy: number } | null;
};

/** Codes a lock answers /api/open with (HTTP 403). Nothing was opened or burned. */
export type LockCode =
  | 'geofence_outside' | 'geofence_imprecise' | 'geofence_location_required'
  | 'timelock_until' | 'timelock_window' | 'country_blocked' | 'recipient_locked';

/**
 * Every failure is a SecretError with a stable `code` (listed per function below). `retryable`
 * is true when nothing was consumed server-side: the caller may keep the key and try again.
 */
export class SecretError extends Error {
  code: string;
  retryable: boolean;
  /** Lock details from /api/open: metres outside the fence / position accuracy, unlock time (ms), ISO country. */
  meters: number | null = null;
  at: number | null = null;
  country: string | null = null;
  /** verifyUnlockCode: wrong-code attempts left. */
  left: number | null = null;
  /** create: the plan the refused option needs. */
  plan: 'plus' | 'pro' | null = null;

  constructor(code: string, retryable = false, extra?: Partial<Pick<SecretError, 'meters' | 'at' | 'country' | 'left' | 'plan'>>) {
    super(code);
    this.name = 'SecretError';
    this.code = code;
    this.retryable = retryable;
    Object.assign(this, extra);
  }
}

// ---------------------------------------------------------------------------- links

/** Hosts a secret link may name; the app's deep-link scheme is accepted as `onepeek://s/<id>#<key>`. */
export const SECRET_LINK_HOSTS: readonly string[] = ['onepeek.io', 'www.onepeek.io'];
export const SECRET_LINK_SCHEME = 'onepeek';

// The server accepts ids `[A-Za-z0-9]{6,32}` (app/api/open/route.ts); `onepeek_new_id(10)` makes 10.
const ID = /^[A-Za-z0-9]{6,32}$/;
// 32 key bytes are exactly 43 base64url characters without padding (toB64Url strips it).
const KEY = /^[A-Za-z0-9_-]{43}$/;

// After the prefix: the id, an optional trailing slash and query (ignored), then the key fragment.
const TAIL = /^([A-Za-z0-9]+)\/?(?:\?[^#]*)?#([A-Za-z0-9_-]+)$/;

/**
 * Parses `https://<host>/s/<id>#<key>` (hosts above, https only, no port or credentials) or
 * `onepeek://s/<id>#<key>`. A trailing slash and a query string are tolerated and ignored.
 * Returns null for anything else, so the caller never hands a foreign URL's fragment to the core.
 * Written without `URL`: Hermes' implementation is incomplete and the fragment must stay on device.
 */
export function parseSecretLink(url: string, hosts: readonly string[] = SECRET_LINK_HOSTS, scheme = SECRET_LINK_SCHEME): { id: string; keyB64: string } | null {
  if (typeof url !== 'string' || url.length > 2048) return null;
  const s = url.trim();
  const lower = s.toLowerCase();
  const prefixes = [...hosts.map(h => `https://${h.toLowerCase()}/s/`), `${scheme.toLowerCase()}://s/`];
  const prefix = prefixes.find(p => lower.startsWith(p));
  if (!prefix) return null;
  const m = TAIL.exec(s.slice(prefix.length));
  if (!m) return null;
  const [, id, keyB64] = m;
  if (!ID.test(id) || !KEY.test(keyB64)) return null;
  try { if (fromB64Url(keyB64).length !== 32) return null; } catch { return null; }
  return { id, keyB64 };
}

/** The link the web shows after creating: `${origin}/s/${id}#${keyB64}`. */
export function secretLink(origin: string, id: string, keyB64: string): string {
  return `${origin}/s/${id}#${keyB64}`;
}

// ---------------------------------------------------------------------------- create

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function sb(deps: SecretsDeps): SecretsSupabase {
  if (!deps.supabase) throw new SecretError('not_configured', true);
  return deps.supabase;
}

/**
 * Creates a secret exactly as app/page.tsx does and returns its id and link.
 *
 * Codes: not_configured, empty, too_long, file_too_large, wifi_ssid_required, wifi_password_required,
 * invalid_expiry, invalid_recipient_email, invalid_time_window, upload_failed, quota_exceeded,
 * invalid_geofence, feature_unavailable (server lacks the plan-gated arguments), expiry_too_long,
 * plan_required (`plan` = plus | pro), invalid_time_lock, create_failed.
 */
export async function createSecret(deps: SecretsDeps, input: SecretInput, opts: CreateSecretOptions): Promise<SecretLink> {
  const supabase = sb(deps);

  // ---- the same client-side checks as the web, before anything is encrypted
  if (input.kind === 'text') {
    if (!input.text.trim()) throw new SecretError('empty', true);
    if (input.text.length > MAX_TEXT_CHARS) throw new SecretError('too_long', true);
  } else if (input.kind === 'wifi') {
    if (!input.wifi.ssid.trim()) throw new SecretError('wifi_ssid_required', true);
    if (input.wifi.security !== 'nopass' && !input.wifi.password) throw new SecretError('wifi_password_required', true);
  } else {
    if (input.file.size > MAX_FILE_BYTES) throw new SecretError('file_too_large', true);
  }
  const ttl = Math.round(opts.ttlSeconds);
  if (!Number.isFinite(ttl) || ttl < 300) throw new SecretError('invalid_expiry', true);
  const views = opts.views ?? 1;
  const lockEmail = (opts.lockEmail ?? '').trim();
  if (lockEmail && !EMAIL.test(lockEmail)) throw new SecretError('invalid_recipient_email', true);
  const wStart = opts.window ? opts.window.start : null;
  const wEnd = opts.window ? opts.window.end : null;
  if (opts.window && (wStart === null || wEnd === null || wStart === wEnd)) throw new SecretError('invalid_time_window', true);
  // Web: timerMode === 'custom' ? clamp(0..3600, floor) : timerMode.
  const timerSeconds = Math.max(0, Math.min(3600, Math.floor(Number(opts.timer) || 0)));
  const guard = opts.guard || undefined;

  // ---- everything below is encrypted here before it leaves the device (AES-256-GCM)
  const { key, keyB64 } = await newKey();
  // Same object literals, in the same key order, as app/page.tsx: JSON.stringify keeps insertion
  // order and drops `undefined`, so the encrypted header JSON is identical to the web's.
  const header: SecretHeader = input.kind === 'file'
    ? { v: 1, type: 'file', name: input.file.name, mime: input.file.mime || 'application/octet-stream', size: input.file.size, timer: timerSeconds, guard }
    : input.kind === 'wifi'
      ? { v: 1, type: 'text', tpl: 'wifi', timer: timerSeconds, guard }
      : { v: 1, type: 'text', timer: timerSeconds, guard };
  if (opts.noCopy) header.noCopy = true;
  if (opts.noSave) header.noSave = true;
  const encHeader = await encryptJson(key, header);

  let body: string | null = null;
  let filePath: string | null = null;
  if (input.kind === 'file') {
    const bytes = await input.file.bytes();
    if (bytes.byteLength > MAX_FILE_BYTES) throw new SecretError('file_too_large', true);
    const ct = await encryptBytes(key, bytes);
    filePath = `f/${randomToken(24)}.bin`;
    const { error: upErr } = await supabase.storage.from(SECRETS_BUCKET).upload(filePath, ct, { contentType: 'application/octet-stream', upsert: false });
    if (upErr) throw new SecretError('upload_failed', true);
  } else if (input.kind === 'wifi') {
    const w = input.wifi;
    body = await encryptText(key, JSON.stringify({ ssid: w.ssid.trim(), password: w.security === 'nopass' ? '' : w.password, security: w.security, hidden: !!w.hidden }));
  } else {
    body = await encryptText(key, input.text);
  }

  const dropFile = () => { if (filePath) try { void supabase.storage.from(SECRETS_BUCKET).remove?.([filePath]); } catch { /* best effort */ } };

  const clientId = await deps.clientId();
  const ref = deps.ref ? deps.ref() : null;
  const geofence = opts.geofence ?? null;
  const countries = opts.countries ?? [];
  // Argument object in the web's key order (app/page.tsx `args(tz)`), optional ones only when set.
  const args = (tz: string): Record<string, unknown> => ({
    p_header: encHeader, p_body: body, p_file_path: filePath, p_ttl_seconds: ttl,
    p_client_id: clientId, p_ref: ref,
    p_recipient: (opts.recipient ?? '').trim() || null,
    p_share_location: !!opts.shareLocation,
    p_size: input.kind === 'file' ? input.file.size : null,
    ...(geofence ? { p_fence_lat: geofence.lat, p_fence_lon: geofence.lon, p_fence_radius: geofence.radius, p_fence_label: geofence.label ?? null } : {}),
    ...(views > 1 ? { p_max_views: views } : {}),
    ...(lockEmail ? { p_lock_email: lockEmail } : {}),
    ...(opts.openAfter ? { p_open_after: opts.openAfter } : {}),
    ...(wStart !== null && wEnd !== null ? { p_window_start: wStart, p_window_end: wEnd, p_window_tz: tz } : {}),
    ...(countries.length ? { p_countries: countries } : {}),
  });
  let { data: id, error: rpcErr } = await supabase.rpc('create_secret', args(normalizeTz(deps.tz())));
  // Unknown time-zone name in the database: fall back to the current UTC offset (web does the same).
  if (rpcErr && wStart !== null && /invalid time window/.test(rpcErr.message || '')) {
    ({ data: id, error: rpcErr } = await supabase.rpc('create_secret', args(offsetTz())));
  }
  if (rpcErr) {
    const msg = rpcErr.message || '';
    if (/quota_exceeded/.test(msg)) { dropFile(); throw new SecretError('quota_exceeded', true); }
    if (/invalid geofence/.test(msg)) { dropFile(); throw new SecretError('invalid_geofence', true); }
    if (/could not find the function|p_fence|p_max_views|p_lock_email|p_open_after|p_window|p_countries/i.test(msg)) { dropFile(); throw new SecretError('feature_unavailable', true); }
    if (/expiry_too_long/.test(msg)) { dropFile(); throw new SecretError('expiry_too_long', true); }
    const plan = /plan_required:(plus|pro)/.exec(msg);
    if (plan) { dropFile(); throw new SecretError('plan_required', true, { plan: plan[1] as 'plus' | 'pro' }); }
    if (/invalid recipient email/.test(msg)) { dropFile(); throw new SecretError('invalid_recipient_email', true); }
    if (/invalid time window|open_after_past_expiry/.test(msg)) { dropFile(); throw new SecretError('invalid_time_lock', true); }
    dropFile();
    throw new SecretError('create_failed', true);
  }
  if (!id || typeof id !== 'string') { dropFile(); throw new SecretError('create_failed', true); }
  return { id, url: secretLink(deps.origin, id, keyB64) };
}

// ---------------------------------------------------------------------------- peek

type PeekRow = {
  header: string; kind?: string | null; expires_at?: string | null; share_location?: boolean | null;
  fence_radius_m?: number | null; fence_label?: string | null;
  max_views?: number | null; views_left?: number | null; lock_hint?: string | null;
  open_after?: string | null; window_start?: number | null; window_end?: number | null; window_tz?: string | null;
  allowed_countries?: string[] | null;
};

async function keyFor(keyB64: string): Promise<CryptoKey> {
  try { return await importKey(keyB64); } catch { throw new SecretError('bad_key', true); }
}

/**
 * Reads what the viewer may know before opening (`peek_secret`; peeking does not burn) and
 * decrypts the header with the link's key. Codes: not_configured, bad_key (damaged link or a key
 * that does not match), gone (opened, expired or never existed).
 */
export async function peekSecret(deps: SecretsDeps, id: string, keyB64: string): Promise<SecretPeek> {
  const supabase = sb(deps);
  const key = await keyFor(keyB64);
  const { data, error } = await supabase.rpc('peek_secret', { p_id: id });
  const row = (Array.isArray(data) ? data[0] : null) as PeekRow | null;
  if (error || !row) throw new SecretError('gone');
  let header: SecretHeader;
  try { header = await decryptJson<SecretHeader>(key, row.header); } catch { throw new SecretError('bad_key', true); }
  const openAfterMs = row.open_after ? Date.parse(row.open_after) : NaN;
  return {
    header,
    kind: row.kind === 'file' ? 'file' : 'text',
    expiresAt: row.expires_at ?? null,
    viewsLeft: typeof row.views_left === 'number' ? row.views_left : null,
    maxViews: typeof row.max_views === 'number' ? row.max_views : null,
    locked: !!row.lock_hint,
    lockHint: row.lock_hint || null,
    notYet: Number.isFinite(openAfterMs) && openAfterMs > Date.now() ? row.open_after! : null,
    openAfter: row.open_after ?? null,
    window: row.window_start != null && row.window_end != null ? { start: row.window_start, end: row.window_end, tz: row.window_tz ?? null } : null,
    countries: row.allowed_countries ?? [],
    shareLocation: !!row.share_location,
    fence: row.fence_radius_m ? { radius: row.fence_radius_m, label: row.fence_label || null } : null,
  };
}

// ---------------------------------------------------------------------------- open

type OpenRow = { header?: string; body?: string | null; file_path?: string | null; views_left?: number; final?: boolean; viewer_place?: string | null };
type LockInfo = { error?: string; meters?: number | null; at?: number | null; country?: string | null };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function post(deps: SecretsDeps, path: string, body: Record<string, unknown>): Promise<FetchResponseLike> {
  try {
    return await deps.fetch(`${deps.apiBase}${path}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
  } catch {
    throw new SecretError('network', true);
  }
}

async function jsonOf<T>(res: FetchResponseLike): Promise<T> {
  try { return (await res.json()) as T; } catch { return {} as T; }
}

/**
 * Opens a secret: counts a view (burning on the last one) through the website's `/api/open`, then
 * decrypts on the device. Same request body as the web (`{ id, precise, unlockToken }`).
 *
 * Codes: not_configured, bad_key (also when decryption fails after the view was counted), the
 * LockCode values (403, retryable, nothing burned; `meters` / `at` / `country` filled in),
 * location_required (403 with an unknown reason), gone (404 or empty row), open_failed (server
 * trouble, retryable), network (retryable), download_failed (file ciphertext unreachable).
 */
export async function openSecret(deps: SecretsDeps, id: string, keyB64: string, opts: OpenSecretOptions = {}): Promise<OpenedSecret> {
  const supabase = sb(deps);
  const key = await keyFor(keyB64);
  const unlockToken = opts.unlockToken || undefined;
  const precise = opts.precise ?? null;
  const res = await post(deps, '/api/open', { id, precise, unlockToken });
  if (res.status === 403) {
    const info = await jsonOf<LockInfo>(res);
    const code = info.error && /^(geofence_outside|geofence_imprecise|geofence_location_required|timelock_until|timelock_window|country_blocked|recipient_locked)$/.test(info.error)
      ? info.error : 'location_required';
    throw new SecretError(code, true, {
      meters: typeof info.meters === 'number' ? info.meters : null,
      at: typeof info.at === 'number' ? info.at : null,
      country: typeof info.country === 'string' ? info.country : null,
    });
  }
  if (res.status === 404) throw new SecretError('gone');
  // Server or network trouble: nothing was opened or burned, so the caller may keep the key and retry.
  if (!res.ok) throw new SecretError('open_failed', true);
  const row = await jsonOf<OpenRow | null>(res);
  if (!row || typeof row !== 'object') throw new SecretError('gone');

  const final = row.final !== false;
  const meta = {
    viewsLeft: typeof row.views_left === 'number' ? row.views_left : 0,
    final,
    viewerPlace: typeof row.viewer_place === 'string' && row.viewer_place ? row.viewer_place : null,
  };
  let header: SecretHeader;
  try { header = await decryptJson<SecretHeader>(key, String(row.header ?? '')); } catch { throw new SecretError('bad_key'); }

  if (row.body) {
    let text: string;
    try { text = await decryptText(key, row.body); } catch { throw new SecretError('bad_key'); }
    if (header.tpl === 'wifi') {
      // The web shows the Wi-Fi card only when the JSON parses; otherwise the raw text.
      try { return { ...meta, header, kind: 'wifi', wifi: JSON.parse(text) as WifiSecret }; } catch { /* fall through to text */ }
    }
    return { ...meta, header, kind: 'text', text };
  }
  if (row.file_path) {
    const { data: blob, error: dlErr } = await supabase.storage.from(SECRETS_BUCKET).download(row.file_path);
    if (dlErr || !blob) throw new SecretError('download_failed');
    let plain: ArrayBuffer;
    try { plain = await decryptBytes(key, new Uint8Array(await blob.arrayBuffer())); } catch { throw new SecretError('bad_key'); }
    // Last view: the ciphertext isn't needed anywhere any more, so delete it now (best effort, as the web).
    if (final) { try { void supabase.storage.from(SECRETS_BUCKET).remove?.([row.file_path]); } catch { /* best effort */ } }
    return { ...meta, header, kind: 'file', bytes: new Uint8Array(plain), name: header.name || 'secret-file', mime: header.mime || 'application/octet-stream' };
  }
  throw new SecretError('bad_key');
}

// ---------------------------------------------------------------------------- unlock (lock to a recipient)

/**
 * Step 1 of a recipient-locked link: asks the website to email a 6-digit code to `email`. Resolves
 * whether or not the address matches (the server answers `ok` for either, so a guesser learns
 * nothing). Codes: invalid, gone, not_locked, wait, too_many, not_configured, send_failed, network.
 */
export async function requestUnlockCode(deps: SecretsDeps, id: string, email: string): Promise<void> {
  const address = email.trim();
  if (!EMAIL.test(address)) throw new SecretError('invalid', true);
  const res = await post(deps, '/api/unlock/send', { id, email: address });
  if (res.ok) return;
  const info = await jsonOf<{ error?: string }>(res);
  const code = info.error && /^(invalid|gone|not_locked|wait|too_many|not_configured|send_failed)$/.test(info.error) ? info.error : 'send_failed';
  throw new SecretError(code, code !== 'gone');
}

/**
 * Step 2: checks the code and returns the one-use unlock token for openSecret(). Codes: invalid,
 * wrong_code (`left` attempts remain), too_many, expired, not_configured, verify_failed, network.
 */
export async function verifyUnlockCode(deps: SecretsDeps, id: string, code: string): Promise<string> {
  const digits = code.replace(/\D/g, '');
  if (digits.length !== 6) throw new SecretError('invalid', true);
  const res = await post(deps, '/api/unlock/verify', { id, code: digits });
  const info = await jsonOf<{ token?: unknown; error?: string; left?: unknown }>(res);
  if (res.ok && typeof info.token === 'string' && info.token) return info.token;
  const err = info.error && /^(invalid|wrong_code|too_many|expired|not_configured)$/.test(info.error) ? info.error : 'verify_failed';
  throw new SecretError(err, true, { left: typeof info.left === 'number' ? info.left : null });
}
