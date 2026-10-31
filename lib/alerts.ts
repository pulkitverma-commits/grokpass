// "Your secret was opened" and "Your request was answered" alerts: email + browser push.
// Plus native push (APNs / FCM) for the mobile app, further down.
import webpush from 'web-push';
import http2 from 'node:http2';
import { createPrivateKey, sign as cryptoSign, type KeyObject } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail, layout } from './email';
import { escapeHtml } from './server';

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:secret@onepeek.io';

export function pushConfigured() {
  return !!(VAPID_PUBLIC && VAPID_PRIVATE);
}

type Prefs = { email_on: boolean; push_on: boolean };
type Alert = { title: string; body: string; url: string; tag: string };

async function prefsFor(admin: SupabaseClient, owner: string): Promise<Prefs> {
  const { data } = await admin.from('notify_prefs').select('email_on, push_on').eq('owner', owner).maybeSingle();
  return { email_on: data?.email_on ?? true, push_on: data?.push_on ?? true };
}

export async function pushTo(admin: SupabaseClient, owner: string, alert: Alert) {
  if (!pushConfigured()) return 0;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth').eq('owner', owner);
  let sent = 0;
  await Promise.all((subs || []).map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(alert), { TTL: 3600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
    }
  }));
  return sent;
}

async function ownerEmail(admin: SupabaseClient, owner: string) {
  const { data } = await admin.auth.admin.getUserById(owner);
  return data?.user?.email || null;
}

function placeOf(r: { open_area?: string | null; open_city?: string | null; open_region?: string | null; open_country?: string | null }) {
  const parts = [...(r.open_area ? r.open_area.split(', ') : []), r.open_city, r.open_region, r.open_country].filter(Boolean) as string[];
  return parts.filter((x, i) => parts.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i).join(', ');
}

/** Called after a secret is opened. Does nothing for secrets sent while signed out. */
export async function notifyOpened(admin: SupabaseClient, id: string, site: string) {
  const { data: r } = await admin.from('secret_log')
    .select('owner, recipient, kind, share_location, open_area, open_city, open_region, open_country, open_source, views_used, max_views')
    .eq('id', id).maybeSingle();
  if (!r?.owner) return;
  const prefs = await prefsFor(admin, r.owner);
  const who = r.recipient ? `to ${r.recipient}` : '';
  const where = r.share_location ? placeOf(r) : '';
  const views = r.max_views > 1 ? ` (view ${r.views_used} of ${r.max_views})` : '';
  const burned = r.views_used >= r.max_views;
  const title = `Your secret ${who ? who + ' ' : ''}was opened`.replace(/\s+/g, ' ');
  const line = `${where ? `Opened in ${where}` : 'Opened just now'}${views}. ${burned ? 'It has now been deleted.' : 'It can still be opened again until the views run out.'}`;
  const url = `${site}/dashboard`;

  const jobs: Promise<unknown>[] = [];
  if (prefs.push_on) jobs.push(pushTo(admin, r.owner, { title, body: line, url, tag: `open-${id}` }));
  if (prefs.email_on) {
    jobs.push(ownerEmail(admin, r.owner).then(to => to ? sendEmail({
      to,
      subject: title,
      text: `${line}\n\nSee it in your dashboard: ${url}`,
      html: layout({
        title,
        body: `<p style="color:#3a414b;line-height:1.55;margin:0;">${escapeHtml(line)}</p>`,
        button: { label: 'Open dashboard', href: url },
        foot: 'You get this because alerts are on in your OnePeek dashboard. Turn them off there any time.',
      }),
    }) : null));
  }
  await Promise.allSettled(jobs);
}

/** Called after someone answers a request. */
export async function notifyAnswered(admin: SupabaseClient, requestId: string, owner: string, site: string) {
  const { data: r } = await admin.from('secret_requests').select('note, recipient').eq('id', requestId).maybeSingle();
  const prefs = await prefsFor(admin, owner);
  const title = `${r?.recipient ? r.recipient : 'Someone'} answered your request`;
  const line = `“${(r?.note || 'Your request').slice(0, 120)}” has an answer waiting. It can be read once.`;
  const url = `${site}/dashboard#requests`;
  const jobs: Promise<unknown>[] = [];
  if (prefs.push_on) jobs.push(pushTo(admin, owner, { title, body: line, url, tag: `req-${requestId}` }));
  if (prefs.email_on) {
    jobs.push(ownerEmail(admin, owner).then(to => to ? sendEmail({
      to, subject: title,
      text: `${line}\n\nOpen it from your dashboard: ${url}`,
      html: layout({
        title,
        body: `<p style="color:#3a414b;line-height:1.55;margin:0;">${escapeHtml(line)}</p>`,
        button: { label: 'Open dashboard', href: url },
      }),
    }) : null));
  }
  await Promise.allSettled(jobs);
}

// ---------------------------------------------------------------------------------------
// Native push (OnePeek mobile app): APNs (token-based auth, HTTP/2) and FCM HTTP v1.
//
// The server sends directly; the .p8 key and the FCM service account live in Vercel env only.
// Payloads are fixed strings plus the room id as an opaque routing key. Never the sender, text,
// room name, nickname, file names or anything from secret_log. Transports are injectable so
// tests capture what would be sent. Without APNS_*/FCM_* env the senders are no-ops returning 0.
// ---------------------------------------------------------------------------------------
export const NATIVE_TITLE = 'OnePeek';
export const NATIVE_BODY = 'You have a new message in a private chat.';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The only thing a native push carries besides fixed strings: the room id. */
export type NativePayload = { room: string };

export type Http2Response = { status: number; body: string };
export type Http2Request = (req: { authority: string; path: string; headers: Record<string, string>; body: string }) => Promise<Http2Response>;
export type NativeTransports = { fetch: typeof fetch; http2Request: Http2Request; now: () => number };
export type NativeResult = { sent: number; dead: string[] };

const defaultTransports: NativeTransports = { fetch: (...a) => fetch(...a), http2Request: nodeHttp2Request, now: () => Date.now() };
let overrides: Partial<NativeTransports> = {};
/** Tests only: replace fetch / http2 / clock for every native sender in this process. */
export function configureNativeTransports(t: Partial<NativeTransports> | null) {
  overrides = t || {};
  apnsJwtCache.clear();
  fcmTokenCache.clear();
}
const transports = (t?: Partial<NativeTransports>): NativeTransports => ({ ...defaultTransports, ...overrides, ...t });

/** Takes the room id out of whatever it is given and refuses anything that is not a uuid. */
function roomOf(p: NativePayload): string {
  const room = typeof p?.room === 'string' ? p.room : '';
  if (!UUID_RE.test(room)) throw new Error('bad_room');
  return room.toLowerCase();
}

/** APNs body. Fixed strings; `thread-id` groups per room; `room` is the app's routing key. */
export function apnsPayload(p: NativePayload) {
  const room = roomOf(p);
  return { aps: { alert: { title: NATIVE_TITLE, body: NATIVE_BODY }, sound: 'default', 'thread-id': room }, room };
}

/** FCM v1 message for one token. No `apns` block: iOS goes through APNs directly. */
export function fcmMessage(token: string, p: NativePayload) {
  const room = roomOf(p);
  return {
    message: {
      token,
      notification: { title: NATIVE_TITLE, body: NATIVE_BODY },
      data: { room },
      android: { priority: 'high', notification: { tag: `chat-${room}` } },
    },
  };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const jwtPart = (o: object) => b64url(JSON.stringify(o));
const pem = (s: string) => s.replace(/\\n/g, '\n');

// ---- APNs ----------------------------------------------------------------------------

type ApnsConfig = { keyId: string; teamId: string; key: KeyObject; topic: string; host: string };

function apnsConfig(): ApnsConfig | null {
  const keyId = process.env.APNS_KEY_ID, teamId = process.env.APNS_TEAM_ID, raw = process.env.APNS_PRIVATE_KEY;
  if (!keyId || !teamId || !raw) return null;
  try {
    return {
      keyId, teamId, key: createPrivateKey(pem(raw)),
      topic: process.env.APNS_BUNDLE_ID || 'io.onepeek.app',
      host: process.env.APNS_USE_SANDBOX === '1' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com',
    };
  } catch {
    return null;
  }
}

export function apnsConfigured() { return apnsConfig() !== null; }

const APNS_JWT_TTL_MS = 50 * 60 * 1000;
const apnsJwtCache = new Map<string, { jwt: string; madeAt: number }>();

/** ES256 provider token: header {alg, kid}, claims {iss, iat}. Cached 50 minutes (Apple allows 60). */
function apnsJwt(c: ApnsConfig, now: number) {
  const k = `${c.teamId}:${c.keyId}`;
  const hit = apnsJwtCache.get(k);
  if (hit && now - hit.madeAt < APNS_JWT_TTL_MS) return hit.jwt;
  const unsigned = `${jwtPart({ alg: 'ES256', kid: c.keyId })}.${jwtPart({ iss: c.teamId, iat: Math.floor(now / 1000) })}`;
  const sig = cryptoSign('sha256', Buffer.from(unsigned), { key: c.key, dsaEncoding: 'ieee-p1363' });
  const jwt = `${unsigned}.${b64url(sig)}`;
  apnsJwtCache.set(k, { jwt, madeAt: now });
  return jwt;
}

function nodeHttp2Request(req: { authority: string; path: string; headers: Record<string, string>; body: string }): Promise<Http2Response> {
  return new Promise((resolve, reject) => {
    const session = http2.connect(`https://${req.authority}`);
    const done = (fn: () => void) => { session.close(); fn(); };
    session.on('error', e => done(() => reject(e)));
    const stream = session.request({ ':method': 'POST', ':path': req.path, ...req.headers });
    const chunks: Buffer[] = [];
    let status = 0;
    stream.on('response', h => { status = Number(h[':status'] || 0); });
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => done(() => resolve({ status, body: Buffer.concat(chunks).toString('utf8') })));
    stream.on('error', e => done(() => reject(e)));
    stream.setTimeout(10_000, () => stream.close(http2.constants.NGHTTP2_CANCEL));
    stream.end(req.body);
  });
}

const APNS_DEAD_REASONS = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic', 'ExpiredToken']);

/** Sends the fixed alert to each iOS token. Returns tokens APNs says are gone so the caller can forget them. */
export async function sendApns(tokens: string[], payload: NativePayload, t?: Partial<NativeTransports>): Promise<NativeResult> {
  const c = apnsConfig();
  if (!c || !tokens.length) return { sent: 0, dead: [] };
  const tr = transports(t);
  const body = JSON.stringify(apnsPayload(payload));
  const room = roomOf(payload);
  const result: NativeResult = { sent: 0, dead: [] };
  await Promise.all(tokens.map(async token => {
    try {
      const res = await tr.http2Request({
        authority: c.host, path: `/3/device/${encodeURIComponent(token)}`,
        headers: {
          authorization: `bearer ${apnsJwt(c, tr.now())}`,
          'apns-topic': c.topic, 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-expiration': '0',
          'apns-collapse-id': `chat-${room}`, 'content-type': 'application/json',
        },
        body,
      });
      if (res.status >= 200 && res.status < 300) { result.sent++; return; }
      let reason = '';
      try { reason = String(JSON.parse(res.body)?.reason || ''); } catch { /* not json */ }
      if (res.status === 410 || APNS_DEAD_REASONS.has(reason)) result.dead.push(token);
    } catch { /* network error: try again next time */ }
  }));
  return result;
}

// ---- FCM HTTP v1 ----------------------------------------------------------------------

type FcmAccount = { project_id: string; client_email: string; private_key: string };
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function fcmAccount(): FcmAccount | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as Partial<FcmAccount>;
    return a.project_id && a.client_email && a.private_key ? { project_id: a.project_id, client_email: a.client_email, private_key: a.private_key } : null;
  } catch {
    return null;
  }
}

export function fcmConfigured() { return fcmAccount() !== null; }

const fcmTokenCache = new Map<string, { token: string; expiresAt: number }>();

/** OAuth2 access token via the JWT bearer grant (RS256). Cached until a minute before it expires. */
async function fcmAccessToken(a: FcmAccount, tr: NativeTransports): Promise<string | null> {
  const now = tr.now();
  const hit = fcmTokenCache.get(a.client_email);
  if (hit && hit.expiresAt > now) return hit.token;
  const iat = Math.floor(now / 1000);
  const unsigned = `${jwtPart({ alg: 'RS256', typ: 'JWT' })}.${jwtPart({ iss: a.client_email, scope: FCM_SCOPE, aud: FCM_TOKEN_URL, iat, exp: iat + 3600 })}`;
  const sig = cryptoSign('sha256', Buffer.from(unsigned), createPrivateKey(pem(a.private_key)));
  const assertion = `${unsigned}.${b64url(sig)}`;
  const res = await tr.fetch(FCM_TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const data = await res.json().catch(() => null) as { access_token?: string; expires_in?: number } | null;
  if (!data?.access_token) return null;
  fcmTokenCache.set(a.client_email, { token: data.access_token, expiresAt: now + (Math.max(120, data.expires_in || 3600) - 60) * 1000 });
  return data.access_token;
}

function fcmDead(status: number, body: string) {
  if (status === 404) return true;
  try {
    const err = JSON.parse(body)?.error;
    if (err?.status === 'NOT_FOUND') return true;
    for (const d of err?.details || []) if (d?.errorCode === 'UNREGISTERED') return true;
  } catch { /* not json */ }
  return false;
}

/** Sends the fixed message to each Android token. Returns tokens FCM says are gone. */
export async function sendFcm(tokens: string[], payload: NativePayload, t?: Partial<NativeTransports>): Promise<NativeResult> {
  const a = fcmAccount();
  if (!a || !tokens.length) return { sent: 0, dead: [] };
  const tr = transports(t);
  const room = roomOf(payload);
  const result: NativeResult = { sent: 0, dead: [] };
  const access = await fcmAccessToken(a, tr);
  if (!access) return result;
  await Promise.all(tokens.map(async token => {
    try {
      const res = await tr.fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(a.project_id)}/messages:send`, {
        method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
        body: JSON.stringify(fcmMessage(token, { room })),
      });
      if (res.ok) { result.sent++; return; }
      if (fcmDead(res.status, await res.text().catch(() => ''))) result.dead.push(token);
    } catch { /* network error: try again next time */ }
  }));
  return result;
}

// ---- fan-out --------------------------------------------------------------------------

export function nativePushConfigured() { return apnsConfigured() || fcmConfigured(); }

/** Pushes "new activity" to every native device the owner registered, forgetting dead tokens. */
export async function pushToNative(admin: SupabaseClient, owner: string, roomId: string, t?: Partial<NativeTransports>) {
  if (!nativePushConfigured()) return 0;
  const payload: NativePayload = { room: roomId };
  const { data } = await admin.from('push_devices').select('platform, token').eq('owner', owner);
  const devices = (data || []) as { platform: string; token: string }[];
  const ios = devices.filter(d => d.platform === 'ios').map(d => d.token);
  const android = devices.filter(d => d.platform === 'android').map(d => d.token);
  const [a, f] = await Promise.all([sendApns(ios, payload, t), sendFcm(android, payload, t)]);
  const dead = [...a.dead, ...f.dead];
  if (dead.length) await admin.from('push_devices').delete().eq('owner', owner).in('token', dead);
  return a.sent + f.sent;
}
