// packages/core/src/secrets.ts against a recorded Supabase fake and a fake onepeek.io API. The
// expectations are derived from the web code, file by file:
//   app/page.tsx            -> header JSON, body / file ciphertext, `create_secret` argument object, link
//   app/s/[id]/page.tsx     -> `peek_secret` call, `/api/open` request body, decrypt + download + remove
//   app/api/open/route.ts   -> `/api/open` response shapes (200 row, 403 lock info, 404 gone)
//   app/api/unlock/*        -> `/api/unlock/send` and `/verify` bodies and error codes
// Every mapping is stated in a comment next to the assertion that pins it.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSecret, peekSecret, openSecret, parseSecretLink, secretLink, requestUnlockCode, verifyUnlockCode,
  SecretError, SECRETS_BUCKET, type SecretsDeps, type SecretsSupabase, type FetchResponseLike,
} from './secrets';
import { decryptJson, decryptText, decryptBytes, importKey, fromB64Url, toB64Url, newKey, MAX_TEXT_CHARS, MAX_FILE_BYTES, type SecretHeader } from './crypto';
import type { FileSource } from './chat/ports';

// ---------------------------------------------------------------------------- fakes

type Call = { kind: 'rpc' | 'upload' | 'download' | 'remove' | 'fetch'; args: unknown[] };

/** A server that stores what `create_secret` received and answers `peek_secret` and `/api/open` from it. */
function createWorld() {
  const calls: Call[] = [];
  const objects = new Map<string, Uint8Array>();
  const secrets = new Map<string, { header: string; body: string | null; file_path: string | null; max_views: number; views_used: number; lock_hint: string | null; open_after: string | null }>();
  const rpcErrors: Record<string, string[]> = {};   // fn -> queue of error messages
  const openResponses: { status: number; body: unknown }[] = [];   // forced /api/open answers
  const fetchFails = { value: false };
  const unlockResponses: { status: number; body: unknown }[] = [];
  let nextId = 1;

  const supabase: SecretsSupabase = {
    async rpc(fn, args) {
      calls.push({ kind: 'rpc', args: [fn, args] });
      const forced = rpcErrors[fn]?.shift();
      if (forced) return { data: null, error: { message: forced } };
      if (fn === 'create_secret') {
        const id = `Id${String(nextId++).padStart(8, '0')}`;
        secrets.set(id, {
          header: args.p_header as string, body: (args.p_body as string | null) ?? null, file_path: (args.p_file_path as string | null) ?? null,
          max_views: (args.p_max_views as number | undefined) ?? 1, views_used: 0,
          lock_hint: args.p_lock_email ? 'p•••@example.test' : null, open_after: (args.p_open_after as string | undefined) ?? null,
        });
        return { data: id, error: null };
      }
      if (fn === 'peek_secret') {
        const s = secrets.get(args.p_id as string);
        if (!s) return { data: [], error: null };
        return {
          data: [{ header: s.header, kind: s.file_path ? 'file' : 'text', expires_at: '2030-01-01T00:00:00Z', share_location: false, fence_radius_m: null, fence_label: null,
            max_views: s.max_views, views_left: s.max_views - s.views_used, lock_hint: s.lock_hint, open_after: s.open_after,
            window_start: null, window_end: null, window_tz: null, allowed_countries: null }],
          error: null,
        };
      }
      return { data: null, error: { message: 'unknown function' } };
    },
    storage: {
      from(bucket) {
        expect(bucket).toBe(SECRETS_BUCKET);
        return {
          async upload(path, body, options) {
            calls.push({ kind: 'upload', args: [path, body, options] });
            if (objects.has(path)) return { error: { message: 'exists' } };
            objects.set(path, body as Uint8Array);
            return { error: null };
          },
          async download(path) {
            calls.push({ kind: 'download', args: [path] });
            const o = objects.get(path);
            if (!o) return { data: null, error: { message: 'not found' } };
            return { data: { arrayBuffer: async () => o.buffer.slice(o.byteOffset, o.byteOffset + o.byteLength) as ArrayBuffer }, error: null };
          },
          async remove(paths) {
            calls.push({ kind: 'remove', args: [paths] });
            for (const p of paths) objects.delete(p);
            return { data: [], error: null };
          },
        };
      },
    },
  };

  const json = (status: number, body: unknown): FetchResponseLike => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  const fetch: SecretsDeps['fetch'] = async (url, init) => {
    calls.push({ kind: 'fetch', args: [url, init] });
    if (fetchFails.value) throw new TypeError('Network request failed');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    if (url.endsWith('/api/open')) {
      const forced = openResponses.shift();
      if (forced) return json(forced.status, forced.body);
      // app/api/open/route.ts: open_secret counts a view, burns on the last one.
      const s = secrets.get(String(body.id));
      if (!s) return json(404, { error: 'gone' });
      if (s.lock_hint && body.unlockToken !== 'unlock-token-ok') return json(403, { error: 'recipient_locked', meters: null, at: null, country: null });
      s.views_used += 1;
      const final = s.views_used >= s.max_views;
      if (final) secrets.delete(String(body.id));
      return json(200, { header: s.header, body: s.body, file_path: s.file_path, views_left: s.max_views - s.views_used, final, viewer_place: 'Delhi, IN' });
    }
    if (url.endsWith('/api/unlock/send') || url.endsWith('/api/unlock/verify')) {
      const forced = unlockResponses.shift();
      if (forced) return json(forced.status, forced.body);
      return url.endsWith('/send') ? json(200, { ok: true }) : json(200, { token: 'unlock-token-ok' });
    }
    return json(500, { error: 'unknown route' });
  };

  const deps: SecretsDeps = {
    supabase, fetch, apiBase: 'https://onepeek.io', origin: 'https://onepeek.io',
    tz: () => 'Asia/Calcutta', clientId: () => 'client-id-for-tests-0001', ref: () => null,
  };
  return { deps, calls, objects, secrets, rpcErrors, openResponses, unlockResponses, fetchFails };
}

type World = ReturnType<typeof createWorld>;
const rpcs = (w: World, fn: string) => w.calls.filter(c => c.kind === 'rpc' && c.args[0] === fn).map(c => c.args[1] as Record<string, unknown>);
const fetches = (w: World, path: string) => w.calls.filter(c => c.kind === 'fetch' && String(c.args[0]).endsWith(path)).map(c => c.args as [string, { method: string; headers: Record<string, string>; body: string }]);
const keyOf = (url: string) => url.slice(url.indexOf('#') + 1);
const bytesOf = (s: string) => new TextEncoder().encode(s);
const fileSource = (name: string, mime: string, data: Uint8Array): FileSource => ({ name, mime, size: data.byteLength, bytes: async () => data });
const fails = async (p: Promise<unknown>, code: string) => {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(SecretError);
  expect((e as SecretError).code).toBe(code);
  return e as SecretError;
};

const TEXT = 'prod db: postgres://admin:S3cretPassw0rd@db.internal/app';
const FILE_NAME = 'passport-scan.png';
const WIFI = { ssid: 'Office-5G', password: 'wifi-Passw0rd!', security: 'WPA' as const, hidden: false };

let w: World;
beforeEach(() => { w = createWorld(); });

// ---------------------------------------------------------------------------- create

describe('createSecret: text', () => {
  it('sends the create_secret arguments the web sends, in the web\'s key order, and builds the web link', async () => {
    const link = await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 86400 });
    const [args] = rpcs(w, 'create_secret');
    // app/page.tsx `args(tz)`: 9 fixed keys; p_max_views and the plan-gated keys only when set.
    expect(Object.keys(args)).toEqual(['p_header', 'p_body', 'p_file_path', 'p_ttl_seconds', 'p_client_id', 'p_ref', 'p_recipient', 'p_share_location', 'p_size']);
    expect(args).toMatchObject({ p_file_path: null, p_ttl_seconds: 86400, p_client_id: 'client-id-for-tests-0001', p_ref: null, p_recipient: null, p_share_location: false, p_size: null });
    // Link: `${window.location.origin}/s/${id}#${keyB64}` (origin without a trailing slash).
    expect(link.url).toBe(`https://onepeek.io/s/${link.id}#${keyOf(link.url)}`);
    expect(link.id).toMatch(/^[A-Za-z0-9]{6,32}$/);
    expect(keyOf(link.url)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The viewer page decrypts the header with the fragment key: identical JSON to the web's literal.
    const key = await importKey(keyOf(link.url));
    const header = await decryptJson<SecretHeader>(key, args.p_header as string);
    expect(JSON.stringify(header)).toBe(JSON.stringify({ v: 1, type: 'text', timer: 0, guard: undefined }));
    expect(await decryptText(key, args.p_body as string)).toBe(TEXT);
  });

  it('maps views, timer, guard, noCopy and noSave the way the web does', async () => {
    await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600, views: 5, timer: 30, guard: true, noCopy: true, noSave: true });
    const [args] = rpcs(w, 'create_secret');
    expect(args.p_max_views).toBe(5);   // `...(views > 1 ? { p_max_views: views } : {})`
    expect(Object.keys(args).at(-1)).toBe('p_max_views');
    const header = await decryptJson<SecretHeader>(await importKey(keyOf((await createSecret(w.deps, { kind: 'text', text: 'x' }, { ttlSeconds: 3600, timer: 30, guard: true, noCopy: true, noSave: true })).url)), rpcs(w, 'create_secret')[1].p_header as string);
    expect(JSON.stringify(header)).toBe('{"v":1,"type":"text","timer":30,"guard":true,"noCopy":true,"noSave":true}');
  });

  it('views = 1 omits p_max_views; timer is clamped to 0..3600 and floored', async () => {
    await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600, views: 1, timer: 9999.7 });
    const [args] = rpcs(w, 'create_secret');
    expect('p_max_views' in args).toBe(false);
    const link = await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600, timer: 9999.7 });
    const h = await decryptJson<SecretHeader>(await importKey(keyOf(link.url)), rpcs(w, 'create_secret')[1].p_header as string);
    expect(h.timer).toBe(3600);
    const link2 = await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600, timer: -5 });
    const h2 = await decryptJson<SecretHeader>(await importKey(keyOf(link2.url)), rpcs(w, 'create_secret')[2].p_header as string);
    expect(h2.timer).toBe(0);
  });

  it('refuses empty and over-long text before encrypting anything', async () => {
    await fails(createSecret(w.deps, { kind: 'text', text: '   ' }, { ttlSeconds: 3600 }), 'empty');
    await fails(createSecret(w.deps, { kind: 'text', text: 'a'.repeat(MAX_TEXT_CHARS + 1) }, { ttlSeconds: 3600 }), 'too_long');
    await fails(createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 299 }), 'invalid_expiry');
    expect(w.calls).toHaveLength(0);
  });

  it('fails with not_configured when there is no Supabase client', async () => {
    await fails(createSecret({ ...w.deps, supabase: null }, { kind: 'text', text: TEXT }, { ttlSeconds: 3600 }), 'not_configured');
  });
});

describe('createSecret: Wi-Fi template', () => {
  it('encrypts the same JSON body and tpl header as the web Wi-Fi tab', async () => {
    const link = await createSecret(w.deps, { kind: 'wifi', wifi: { ...WIFI, ssid: '  Office-5G ' } }, { ttlSeconds: 3600 });
    const [args] = rpcs(w, 'create_secret');
    const key = await importKey(keyOf(link.url));
    expect(JSON.stringify(await decryptJson(key, args.p_header as string))).toBe('{"v":1,"type":"text","tpl":"wifi","timer":0}');
    // app/page.tsx: JSON.stringify({ ssid: ssid.trim(), password: security === 'nopass' ? '' : password, security, hidden: !!hidden })
    expect(await decryptText(key, args.p_body as string)).toBe('{"ssid":"Office-5G","password":"wifi-Passw0rd!","security":"WPA","hidden":false}');
  });

  it('drops the password for an open network and validates the form like the web', async () => {
    const link = await createSecret(w.deps, { kind: 'wifi', wifi: { ssid: 'Cafe', password: 'ignored', security: 'nopass', hidden: true } }, { ttlSeconds: 3600 });
    const body = await decryptText(await importKey(keyOf(link.url)), rpcs(w, 'create_secret')[0].p_body as string);
    expect(body).toBe('{"ssid":"Cafe","password":"","security":"nopass","hidden":true}');
    await fails(createSecret(w.deps, { kind: 'wifi', wifi: { ...WIFI, ssid: ' ' } }, { ttlSeconds: 3600 }), 'wifi_ssid_required');
    await fails(createSecret(w.deps, { kind: 'wifi', wifi: { ...WIFI, password: '' } }, { ttlSeconds: 3600 }), 'wifi_password_required');
  });
});

describe('createSecret: file', () => {
  const data = bytesOf('PNG-bytes-of-a-passport-scan-' + 'x'.repeat(500));

  it('uploads the ciphertext to storage like the web and passes the path, not the file, to the RPC', async () => {
    const link = await createSecret(w.deps, { kind: 'file', file: fileSource(FILE_NAME, 'image/png', data) }, { ttlSeconds: 3600, timer: 10 });
    const uploads = w.calls.filter(c => c.kind === 'upload');
    expect(uploads).toHaveLength(1);
    const [path, body, options] = uploads[0].args as [string, Uint8Array, { contentType: string; upsert: boolean }];
    // app/page.tsx: filePath = `f/${randomToken(24)}.bin` (24 random bytes -> 32 base64url chars);
    // upload(filePath, ct, { contentType: 'application/octet-stream', upsert: false }); the RPC
    // (migration 005) checks `^f/[A-Za-z0-9_-]{24,64}\.bin$`.
    expect(path).toMatch(/^f\/[A-Za-z0-9_-]{32}\.bin$/);
    expect(options).toEqual({ contentType: 'application/octet-stream', upsert: false });
    expect(body).toBeInstanceOf(Uint8Array);
    expect(body.byteLength).toBe(data.byteLength + 12 + 16);   // IV + tag, as encryptBytes lays it out
    const key = await importKey(keyOf(link.url));
    expect(new Uint8Array(await decryptBytes(key, body))).toEqual(data);
    const [args] = rpcs(w, 'create_secret');
    expect(args).toMatchObject({ p_body: null, p_file_path: path, p_size: data.byteLength });
    const header = await decryptJson<SecretHeader>(key, args.p_header as string);
    expect(JSON.stringify(header)).toBe(JSON.stringify({ v: 1, type: 'file', name: FILE_NAME, mime: 'image/png', size: data.byteLength, timer: 10 }));
  });

  it('defaults an unknown mime to application/octet-stream and refuses files over the limit', async () => {
    const link = await createSecret(w.deps, { kind: 'file', file: fileSource('notes.bin', '', data) }, { ttlSeconds: 3600 });
    const header = await decryptJson<SecretHeader>(await importKey(keyOf(link.url)), rpcs(w, 'create_secret')[0].p_header as string);
    expect(header.mime).toBe('application/octet-stream');
    await fails(createSecret(w.deps, { kind: 'file', file: { name: 'big', mime: 'x/y', size: MAX_FILE_BYTES + 1, bytes: async () => new Uint8Array(0) } }, { ttlSeconds: 3600 }), 'file_too_large');
  });

  it('reports upload_failed and never calls the RPC when storage refuses', async () => {
    const broken: SecretsSupabase = { ...w.deps.supabase!, storage: { from: () => ({ upload: async () => ({ error: { message: 'bucket full' } }), download: async () => ({ data: null, error: { message: 'x' } }) }) } };
    await fails(createSecret({ ...w.deps, supabase: broken }, { kind: 'file', file: fileSource(FILE_NAME, 'image/png', data) }, { ttlSeconds: 3600 }), 'upload_failed');
    expect(rpcs(w, 'create_secret')).toHaveLength(0);
  });

  it('removes the uploaded ciphertext when the RPC refuses (quota, plan), as the web does', async () => {
    w.rpcErrors.create_secret = ['quota_exceeded'];
    await fails(createSecret(w.deps, { kind: 'file', file: fileSource(FILE_NAME, 'image/png', data) }, { ttlSeconds: 3600 }), 'quota_exceeded');
    const path = (w.calls.find(c => c.kind === 'upload')!.args as [string])[0];
    expect(w.calls.filter(c => c.kind === 'remove').map(c => c.args[0])).toEqual([[path]]);
    expect(w.objects.has(path)).toBe(false);
  });
});

describe('createSecret: plan-gated arguments and error mapping', () => {
  it('adds lock email, open-after, window (with the normalised zone) and countries only when given', async () => {
    await createSecret(w.deps, { kind: 'text', text: TEXT }, {
      ttlSeconds: 3600, views: 3, lockEmail: ' Pat@Example.test ', openAfter: '2030-01-01T10:00:00.000Z',
      window: { start: 540, end: 1080 }, countries: ['IN', 'GB'], recipient: ' friend@example.test ', shareLocation: true,
      geofence: { lat: 28.6139, lon: 77.209, radius: 500, label: 'Office' },
    });
    const [args] = rpcs(w, 'create_secret');
    expect(Object.keys(args)).toEqual([
      'p_header', 'p_body', 'p_file_path', 'p_ttl_seconds', 'p_client_id', 'p_ref', 'p_recipient', 'p_share_location', 'p_size',
      'p_fence_lat', 'p_fence_lon', 'p_fence_radius', 'p_fence_label', 'p_max_views', 'p_lock_email', 'p_open_after', 'p_window_start', 'p_window_end', 'p_window_tz', 'p_countries',
    ]);
    expect(args).toMatchObject({
      p_recipient: 'friend@example.test', p_share_location: true,
      p_fence_lat: 28.6139, p_fence_lon: 77.209, p_fence_radius: 500, p_fence_label: 'Office',
      p_max_views: 3, p_lock_email: 'Pat@Example.test', p_open_after: '2030-01-01T10:00:00.000Z',
      p_window_start: 540, p_window_end: 1080, p_window_tz: 'Asia/Kolkata',   // lib/time localTz(): Asia/Calcutta -> Asia/Kolkata
      p_countries: ['IN', 'GB'],
    });
  });

  it('retries once with the POSIX offset zone when the database rejects the zone name', async () => {
    w.rpcErrors.create_secret = ['invalid time window'];
    await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600, window: { start: 0, end: 60 } });
    const calls = rpcs(w, 'create_secret');
    expect(calls).toHaveLength(2);
    expect(calls[0].p_window_tz).toBe('Asia/Kolkata');
    expect(calls[1].p_window_tz).toMatch(/^UTC[+-]\d{2}:\d{2}$/);
    // The ciphertext is the same object both times: the retry re-sends, it does not re-encrypt.
    expect(calls[1].p_header).toBe(calls[0].p_header);
  });

  it('does not retry a time-window error when no window was asked for', async () => {
    w.rpcErrors.create_secret = ['invalid time window'];
    await fails(createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600 }), 'invalid_time_lock');
    expect(rpcs(w, 'create_secret')).toHaveLength(1);
  });

  it.each([
    ['quota_exceeded', 'quota_exceeded', null],
    ['invalid geofence', 'invalid_geofence', null],
    ['Could not find the function public.create_secret(p_body, p_client_id, p_countries...) in the schema cache', 'feature_unavailable', null],
    ['function create_secret(p_max_views => integer) does not exist', 'feature_unavailable', null],
    ['expiry_too_long:604800', 'expiry_too_long', null],
    ['plan_required:plus', 'plan_required', 'plus'],
    ['plan_required:pro', 'plan_required', 'pro'],
    ['invalid recipient email', 'invalid_recipient_email', null],
    ['open_after_past_expiry', 'invalid_time_lock', null],
    ['something else entirely', 'create_failed', null],
  ])('maps the server message %j to code %s', async (message, code, plan) => {
    w.rpcErrors.create_secret = [message];
    const e = await fails(createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600 }), code);
    expect(e.plan).toBe(plan);
    expect(e.retryable).toBe(true);
  });

  it('validates the lock email and the window client-side first', async () => {
    await fails(createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600, lockEmail: 'not-an-email' }), 'invalid_recipient_email');
    await fails(createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600, window: { start: 60, end: 60 } }), 'invalid_time_window');
    expect(w.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------- links

describe('parseSecretLink / secretLink', () => {
  const KEY43 = toB64Url(new Uint8Array(32).fill(7));

  it.each([
    [`https://onepeek.io/s/AbCdEfGhIj#${KEY43}`, 'AbCdEfGhIj'],
    [`https://www.onepeek.io/s/AbCdEfGhIj#${KEY43}`, 'AbCdEfGhIj'],
    [`HTTPS://OnePeek.io/s/AbCdEfGhIj#${KEY43}`, 'AbCdEfGhIj'],
    [`onepeek://s/AbCdEfGhIj#${KEY43}`, 'AbCdEfGhIj'],
    [`https://onepeek.io/s/AbCdEfGhIj/#${KEY43}`, 'AbCdEfGhIj'],
    [`https://onepeek.io/s/AbCdEfGhIj?utm=x#${KEY43}`, 'AbCdEfGhIj'],
    [`  https://onepeek.io/s/abc123#${KEY43}\n`, 'abc123'],
  ])('accepts %s', (url, id) => {
    expect(parseSecretLink(url)).toEqual({ id, keyB64: KEY43 });
  });

  it.each([
    `http://onepeek.io/s/AbCdEfGhIj#${KEY43}`,                   // plain http
    `https://onepeek.io:443/s/AbCdEfGhIj#${KEY43}`,              // a port
    `https://onepeek.io.evil.example/s/AbCdEfGhIj#${KEY43}`,     // another host
    `https://evil.example/onepeek.io/s/AbCdEfGhIj#${KEY43}`,
    `https://user@onepeek.io/s/AbCdEfGhIj#${KEY43}`,             // credentials
    `https://onepeek.io/chat/join/AbCdEfGhIj#${KEY43}`,          // another route
    `https://onepeek.io/s/AbCdEfGhIj`,                           // no key
    `https://onepeek.io/s/AbCdEfGhIj#`,
    `https://onepeek.io/s/#${KEY43}`,                            // no id
    `https://onepeek.io/s/abc#${KEY43}`,                         // id too short
    `https://onepeek.io/s/${'a'.repeat(33)}#${KEY43}`,           // id too long
    `https://onepeek.io/s/Ab-CdEfGhIj#${KEY43}`,                 // id not alphanumeric
    `https://onepeek.io/s/AbCdEfGhIj#${KEY43.slice(1)}`,         // 42 chars
    `https://onepeek.io/s/AbCdEfGhIj#${KEY43}A`,                 // 44 chars
    `https://onepeek.io/s/AbCdEfGhIj#${KEY43.slice(0, 42)}+`,    // not base64url
    `https://onepeek.io/s/AbCdEfGhIj#${KEY43}#x`,                // two fragments
    `onepeek://auth#${KEY43}`,
    `onepeek:/s/AbCdEfGhIj#${KEY43}`,
    `javascript:alert(1)//onepeek.io/s/AbCdEfGhIj#${KEY43}`,
    '', 'not a url',
  ])('rejects %s', url => {
    expect(parseSecretLink(url)).toBeNull();
  });

  it('rejects non-strings and absurd lengths', () => {
    expect(parseSecretLink(undefined as unknown as string)).toBeNull();
    expect(parseSecretLink(`https://onepeek.io/s/AbCdEfGhIj?${'q'.repeat(3000)}#${KEY43}`)).toBeNull();
  });

  it('round-trips the link createSecret builds', async () => {
    const link = await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600 });
    expect(parseSecretLink(link.url)).toEqual({ id: link.id, keyB64: keyOf(link.url) });
    expect(secretLink('https://onepeek.io', link.id, keyOf(link.url))).toBe(link.url);
  });
});

// ---------------------------------------------------------------------------- peek

describe('peekSecret', () => {
  it('calls peek_secret with { p_id } and decrypts the header with the fragment key', async () => {
    const link = await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600, views: 3, timer: 60 });
    const peek = await peekSecret(w.deps, link.id, keyOf(link.url));
    expect(rpcs(w, 'peek_secret')).toEqual([{ p_id: link.id }]);   // app/s/[id]/page.tsx: supabase.rpc('peek_secret', { p_id: id })
    expect(peek).toMatchObject({ kind: 'text', viewsLeft: 3, maxViews: 3, locked: false, lockHint: null, notYet: null, window: null, countries: [], fence: null, shareLocation: false });
    expect(peek.header).toEqual({ v: 1, type: 'text', timer: 60 });
  });

  it('reports a locked link and a future open-after as typed fields', async () => {
    const link = await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 86400, lockEmail: 'pat@example.test', openAfter: '2030-01-01T10:00:00.000Z' });
    const peek = await peekSecret(w.deps, link.id, keyOf(link.url));
    expect(peek.locked).toBe(true);
    expect(peek.lockHint).toBe('p•••@example.test');
    expect(peek.notYet).toBe('2030-01-01T10:00:00.000Z');
  });

  it('is gone for an unknown id and bad_key for a damaged or foreign key', async () => {
    const link = await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600 });
    await fails(peekSecret(w.deps, 'NoSuchId00', keyOf(link.url)), 'gone');
    await fails(peekSecret(w.deps, link.id, 'short'), 'bad_key');
    const { keyB64: other } = await newKey();
    await fails(peekSecret(w.deps, link.id, other), 'bad_key');
    await fails(peekSecret({ ...w.deps, supabase: null }, link.id, keyOf(link.url)), 'not_configured');
  });
});

// ---------------------------------------------------------------------------- open

describe('openSecret', () => {
  it('posts the web\'s /api/open body and decrypts the text on the device', async () => {
    const link = await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600 });
    const opened = await openSecret(w.deps, link.id, keyOf(link.url));
    const [[url, init]] = fetches(w, '/api/open');
    expect(url).toBe('https://onepeek.io/api/open');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    // app/s/[id]/page.tsx: JSON.stringify({ id, precise, unlockToken: unlockToken || undefined }) with precise = null
    expect(init.body).toBe(JSON.stringify({ id: link.id, precise: null }));
    expect(opened).toMatchObject({ kind: 'text', text: TEXT, viewsLeft: 0, final: true, viewerPlace: 'Delhi, IN' });
    expect(opened.header).toEqual({ v: 1, type: 'text', timer: 0 });
    // Burned: the next peek and open find nothing.
    await fails(peekSecret(w.deps, link.id, keyOf(link.url)), 'gone');
    await fails(openSecret(w.deps, link.id, keyOf(link.url)), 'gone');
  });

  it('includes the unlock token and the precise position when given, exactly as the web', async () => {
    const link = await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600, lockEmail: 'pat@example.test' });
    await fails(openSecret(w.deps, link.id, keyOf(link.url)), 'recipient_locked');
    const opened = await openSecret(w.deps, link.id, keyOf(link.url), { unlockToken: 'unlock-token-ok', precise: { lat: 1.5, lon: 2.5, accuracy: 12 } });
    expect(opened.kind).toBe('text');
    const bodies = fetches(w, '/api/open').map(([, init]) => init.body);
    expect(bodies[0]).toBe(JSON.stringify({ id: link.id, precise: null }));
    expect(bodies[1]).toBe(JSON.stringify({ id: link.id, precise: { lat: 1.5, lon: 2.5, accuracy: 12 }, unlockToken: 'unlock-token-ok' }));
  });

  it('counts views: a 3-view link opens three times with the right viewsLeft / final, then is gone', async () => {
    const link = await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600, views: 3 });
    const a = await openSecret(w.deps, link.id, keyOf(link.url));
    const b = await openSecret(w.deps, link.id, keyOf(link.url));
    const c = await openSecret(w.deps, link.id, keyOf(link.url));
    expect([a.viewsLeft, b.viewsLeft, c.viewsLeft]).toEqual([2, 1, 0]);
    expect([a.final, b.final, c.final]).toEqual([false, false, true]);
    await fails(openSecret(w.deps, link.id, keyOf(link.url)), 'gone');
  });

  it('returns the Wi-Fi template parsed, as the web card shows it', async () => {
    const link = await createSecret(w.deps, { kind: 'wifi', wifi: WIFI }, { ttlSeconds: 3600 });
    const opened = await openSecret(w.deps, link.id, keyOf(link.url));
    expect(opened).toMatchObject({ kind: 'wifi', wifi: { ssid: 'Office-5G', password: 'wifi-Passw0rd!', security: 'WPA', hidden: false } });
    expect(opened.header.tpl).toBe('wifi');
  });

  it('downloads and decrypts a file, deleting the ciphertext after the final view only', async () => {
    const data = bytesOf('%PDF-1.7 the file contents ' + 'y'.repeat(2000));
    const link = await createSecret(w.deps, { kind: 'file', file: fileSource('contract.pdf', 'application/pdf', data) }, { ttlSeconds: 3600, views: 2 });
    const path = rpcs(w, 'create_secret')[0].p_file_path as string;
    const first = await openSecret(w.deps, link.id, keyOf(link.url));
    expect(first).toMatchObject({ kind: 'file', name: 'contract.pdf', mime: 'application/pdf', final: false, viewsLeft: 1 });
    expect(first.kind === 'file' && first.bytes).toEqual(data);
    expect(w.calls.filter(c => c.kind === 'download').map(c => c.args[0])).toEqual([path]);
    expect(w.calls.filter(c => c.kind === 'remove')).toHaveLength(0);
    const second = await openSecret(w.deps, link.id, keyOf(link.url));
    expect(second.final).toBe(true);
    // app/s/[id]/page.tsx: `if (isFinal) supabase.storage.from('secrets').remove([row.file_path])`
    expect(w.calls.filter(c => c.kind === 'remove').map(c => c.args[0])).toEqual([[path]]);
  });

  it('works with a Supabase client that has no remove() (the chat SupabaseLike)', async () => {
    const data = bytesOf('bytes');
    const link = await createSecret(w.deps, { kind: 'file', file: fileSource('a.bin', 'application/octet-stream', data) }, { ttlSeconds: 3600 });
    const inner = w.deps.supabase!;
    const noRemove: SecretsSupabase = { rpc: (f, a) => inner.rpc(f, a), storage: { from: b => { const x = inner.storage.from(b); return { upload: x.upload, download: x.download }; } } };
    const opened = await openSecret({ ...w.deps, supabase: noRemove }, link.id, keyOf(link.url));
    expect(opened.kind === 'file' && opened.bytes).toEqual(data);
  });

  it.each([
    [{ error: 'geofence_outside', meters: 420, at: null, country: null }, 'geofence_outside', { meters: 420 }],
    [{ error: 'geofence_imprecise', meters: 1500, at: null, country: null }, 'geofence_imprecise', { meters: 1500 }],
    [{ error: 'geofence_location_required', meters: null }, 'geofence_location_required', {}],
    [{ error: 'timelock_until', meters: null, at: 1893492000000, country: null }, 'timelock_until', { at: 1893492000000 }],
    [{ error: 'timelock_window', meters: null, at: null, country: null }, 'timelock_window', {}],
    [{ error: 'country_blocked', meters: null, at: null, country: 'RU' }, 'country_blocked', { country: 'RU' }],
    [{ error: 'recipient_locked' }, 'recipient_locked', {}],
    [{ error: 'something_new' }, 'location_required', {}],
    [{}, 'location_required', {}],
  ])('maps a 403 lock answer %j to %s and keeps the secret openable', async (info, code, extra) => {
    const link = await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600 });
    w.openResponses.push({ status: 403, body: info });
    const e = await fails(openSecret(w.deps, link.id, keyOf(link.url)), code);
    expect(e.retryable).toBe(true);
    expect(e).toMatchObject({ meters: null, at: null, country: null, ...extra });
    // Nothing was burned: the real open afterwards still works.
    expect((await openSecret(w.deps, link.id, keyOf(link.url))).kind).toBe('text');
  });

  it('maps 404 to gone, other statuses to a retryable open_failed, and a thrown fetch to network', async () => {
    const link = await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600 });
    w.openResponses.push({ status: 404, body: { error: 'gone' } });
    expect((await fails(openSecret(w.deps, link.id, keyOf(link.url)), 'gone')).retryable).toBe(false);
    w.openResponses.push({ status: 502, body: { error: 'open_failed' } });
    expect((await fails(openSecret(w.deps, link.id, keyOf(link.url)), 'open_failed')).retryable).toBe(true);
    w.openResponses.push({ status: 500, body: null });
    await fails(openSecret(w.deps, link.id, keyOf(link.url)), 'open_failed');
    w.fetchFails.value = true;
    expect((await fails(openSecret(w.deps, link.id, keyOf(link.url)), 'network')).retryable).toBe(true);
    w.fetchFails.value = false;
    await fails(openSecret({ ...w.deps, supabase: null }, link.id, keyOf(link.url)), 'not_configured');
  });

  it('is bad_key when the fragment key does not decrypt what the server returned', async () => {
    const link = await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600, views: 2 });
    const { keyB64: other } = await newKey();
    await fails(openSecret(w.deps, link.id, other), 'bad_key');
    await fails(openSecret(w.deps, link.id, 'damaged'), 'bad_key');
    // A damaged key is refused before any request leaves the device.
    expect(fetches(w, '/api/open')).toHaveLength(1);
  });

  it('reports download_failed when the file ciphertext is not there', async () => {
    const link = await createSecret(w.deps, { kind: 'file', file: fileSource('a.bin', 'x/y', bytesOf('b')) }, { ttlSeconds: 3600 });
    w.objects.clear();
    await fails(openSecret(w.deps, link.id, keyOf(link.url)), 'download_failed');
  });
});

// ---------------------------------------------------------------------------- unlock

describe('requestUnlockCode / verifyUnlockCode', () => {
  it('posts the web bodies to /api/unlock/send and /verify and returns the token', async () => {
    await requestUnlockCode(w.deps, 'AbCdEfGhIj', ' Pat@example.test ');
    const token = await verifyUnlockCode(w.deps, 'AbCdEfGhIj', '123 456');
    expect(token).toBe('unlock-token-ok');
    const [[sendUrl, send]] = fetches(w, '/api/unlock/send');
    const [[verifyUrl, verify]] = fetches(w, '/api/unlock/verify');
    expect(sendUrl).toBe('https://onepeek.io/api/unlock/send');
    expect(send.body).toBe(JSON.stringify({ id: 'AbCdEfGhIj', email: 'Pat@example.test' }));   // page.tsx: { id, email: lockEmail.trim() }
    expect(verifyUrl).toBe('https://onepeek.io/api/unlock/verify');
    expect(verify.body).toBe(JSON.stringify({ id: 'AbCdEfGhIj', code: '123456' }));           // page.tsx: { id, code }
  });

  it('maps the send and verify error answers to codes', async () => {
    await fails(requestUnlockCode(w.deps, 'AbCdEfGhIj', 'nope'), 'invalid');
    for (const [status, error] of [[429, 'wait'], [429, 'too_many'], [503, 'not_configured'], [404, 'gone'], [400, 'not_locked'], [502, 'send_failed'], [500, 'weird']] as const) {
      w.unlockResponses.push({ status, body: { error } });
      await fails(requestUnlockCode(w.deps, 'AbCdEfGhIj', 'pat@example.test'), error === 'weird' ? 'send_failed' : error);
    }
    await fails(verifyUnlockCode(w.deps, 'AbCdEfGhIj', '12'), 'invalid');
    w.unlockResponses.push({ status: 400, body: { error: 'wrong_code', left: 3 } });
    expect((await fails(verifyUnlockCode(w.deps, 'AbCdEfGhIj', '000000'), 'wrong_code')).left).toBe(3);
    for (const error of ['too_many', 'expired', 'not_configured'] as const) {
      w.unlockResponses.push({ status: 400, body: { error } });
      await fails(verifyUnlockCode(w.deps, 'AbCdEfGhIj', '000000'), error);
    }
    w.unlockResponses.push({ status: 200, body: {} });
    await fails(verifyUnlockCode(w.deps, 'AbCdEfGhIj', '000000'), 'verify_failed');
    w.fetchFails.value = true;
    await fails(requestUnlockCode(w.deps, 'AbCdEfGhIj', 'pat@example.test'), 'network');
  });
});

// ---------------------------------------------------------------------------- leak sweep

describe('leak sweep: nothing readable reaches the server', () => {
  /** Every encoding a secret could leak in: raw, base64, base64url, JSON-escaped, URL-encoded. */
  function forms(s: string): string[] {
    const b = bytesOf(s);
    const std = btoa(String.fromCharCode(...b));
    return [s, std, std.replace(/=+$/, ''), toB64Url(b), JSON.stringify(s).slice(1, -1), encodeURIComponent(s)];
  }
  function everythingSent(): string {
    return w.calls.map(c => {
      const parts = c.args.map(a => (a instanceof Uint8Array ? [String.fromCharCode(...a), toB64Url(a), btoa(String.fromCharCode(...a))].join('|') : JSON.stringify(a)));
      return `${c.kind} ${parts.join(' ')}`;
    }).join('\n');
  }

  it('create + peek + open: the key, text, Wi-Fi password and file name appear nowhere in any RPC, upload or fetch', async () => {
    const data = bytesOf('secret file body ' + 'z'.repeat(300));
    const links = [
      await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600, views: 2, lockEmail: 'pat@example.test' }),
      await createSecret(w.deps, { kind: 'wifi', wifi: WIFI }, { ttlSeconds: 3600 }),
      await createSecret(w.deps, { kind: 'file', file: fileSource(FILE_NAME, 'image/png', data) }, { ttlSeconds: 3600 }),
    ];
    for (const l of links) await peekSecret(w.deps, l.id, keyOf(l.url));
    await openSecret(w.deps, links[1].id, keyOf(links[1].url));
    await openSecret(w.deps, links[2].id, keyOf(links[2].url));
    await requestUnlockCode(w.deps, links[0].id, 'pat@example.test');
    await verifyUnlockCode(w.deps, links[0].id, '123456');
    await openSecret(w.deps, links[0].id, keyOf(links[0].url), { unlockToken: 'unlock-token-ok' });

    const sent = everythingSent();
    expect(w.calls.length).toBeGreaterThan(10);
    const forbidden = [
      ...links.flatMap(l => forms(keyOf(l.url))),
      ...forms(TEXT), ...forms('S3cretPassw0rd'), ...forms(WIFI.password), ...forms(WIFI.ssid), ...forms(FILE_NAME), ...forms('secret file body'),
      ...links.flatMap(l => forms(l.url)),
    ];
    for (const f of forbidden) expect(sent, `leaked: ${f.slice(0, 12)}…`).not.toContain(f);
    // What the web does put on the wire is there: the id (peek and open), the lock email (the
    // viewer confirms it with the server), the unlock token, the ciphertext path.
    expect(sent).toContain(links[0].id);
    expect(sent).toContain('pat@example.test');
    expect(sent).toContain('unlock-token-ok');
    expect(sent).toMatch(/f\/[A-Za-z0-9_-]{32}\.bin/);
  });

  it('a SecretError never carries the key or the content', async () => {
    const link = await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600 });
    w.openResponses.push({ status: 403, body: { error: 'country_blocked', country: 'RU' } });
    const e = await fails(openSecret(w.deps, link.id, keyOf(link.url)), 'country_blocked');
    const dump = JSON.stringify({ ...e, message: e.message, stack: e.stack });
    expect(dump).not.toContain(keyOf(link.url));
    expect(dump).not.toContain(TEXT);
  });

  it('the fragment key really is the AES key: decoding it gives 32 bytes that decrypt the stored header', async () => {
    const link = await createSecret(w.deps, { kind: 'text', text: TEXT }, { ttlSeconds: 3600 });
    expect(fromB64Url(keyOf(link.url))).toHaveLength(32);
    const stored = w.secrets.get(link.id)!;
    expect(await decryptJson(await importKey(keyOf(link.url)), stored.header)).toEqual({ v: 1, type: 'text', timer: 0 });
    expect(await decryptText(await importKey(keyOf(link.url)), stored.body!)).toBe(TEXT);
  });
});
