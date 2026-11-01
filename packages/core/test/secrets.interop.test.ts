// One-time secrets across platforms (docs/mobile/test-plan.md §2.4, task Q5): a secret made on one
// side is opened on the other, over the live `create_secret` / `peek_secret` / `open_secret` SQL (the
// whole production schema on PGlite, see secrets-harness.ts), the website's own crypto
// (`packages/core/src/crypto.ts`, which `lib/crypto.ts` re-exports) and a mirror of `/api/open`.
//
// Two halves:
//   1. "web path": the browser's exact code path, lifted step for step from `app/page.tsx`
//      (`createSecret`) and `app/s/[id]/page.tsx` (peek, open, decrypt). It runs today and is the
//      specification the phone must meet: link format, header, burn, expiry, flags, file bytes.
//   2. "app <-> web": the core module `packages/core/src/secrets.ts` (core-crypto, C4) on the phone
//      side, in both directions. `describe.skip` until that module is merged (TODO below).
// Every scenario ends with the same sweep: key, plaintext, file name, file bytes and Wi-Fi password
// never appear in the SQL log, the database dump, the stored objects, the `/api/open` bodies or the
// responses, in text, hex, base64 or base64url, except as ciphertext.
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  newKey, importKey, encryptJson, encryptText, encryptBytes, decryptJson, decryptText, decryptBytes, randomToken, fromB64Url,
  type SecretHeader, type WifiSecret,
} from '../src/crypto';
import { bootSecretsDb, ROOT, WEB_ORIGIN, type SecretsHarness, type OpenRow } from './secrets-harness';
import { BODY, FILE_NAME, FILE_BODY, forbidden, expectClean, type Forbidden } from './fixtures';

const TIMEOUT = 120_000;
const LINK = /^https:\/\/onepeek\.io\/s\/([A-Za-z0-9]{10})#([A-Za-z0-9_-]{43})$/;
const WIFI: WifiSecret = { ssid: 'Okonkwo-Guest', password: 'river-4471-blue', security: 'WPA' };
/** The core module under test in half 2; absent until C4 merges. */
const SECRETS_MODULE = path.join(ROOT, 'packages/core/src/secrets.ts');
const CORE_PRESENT = existsSync(SECRETS_MODULE);

let h: SecretsHarness;

beforeAll(async () => {
  h = await bootSecretsDb();
}, TIMEOUT);

// ---------------------------------------------------------------------------- the website's code path

type WebInput = { kind: 'text'; text: string } | { kind: 'wifi'; wifi: WifiSecret } | { kind: 'file'; name: string; mime: string; bytes: Uint8Array };
type WebOptions = { ttlSeconds: number; views?: number; timer?: number; guard?: boolean; noCopy?: boolean; noSave?: boolean };

/** One browser tab: the anonymous Supabase client and the random client id `getClientId()` keeps in localStorage. */
function browser() {
  const supabase = h.fakeSupabase(null);
  const clientId = `web-${randomToken(12)}`;
  return { supabase, clientId };
}
type Browser = ReturnType<typeof browser>;

/** `app/page.tsx` createSecret, step for step: key, header, body or upload, `create_secret`, link. */
async function webCreate(b: Browser, input: WebInput, opts: WebOptions): Promise<{ link: string; id: string; keyB64: string }> {
  const { key, keyB64 } = await newKey();
  const guard = opts.guard || undefined;
  const timer = opts.timer ?? 0;
  const header: SecretHeader = input.kind === 'file'
    ? { v: 1, type: 'file', name: input.name, mime: input.mime || 'application/octet-stream', size: input.bytes.length, timer, guard }
    : input.kind === 'wifi'
      ? { v: 1, type: 'text', tpl: 'wifi', timer, guard }
      : { v: 1, type: 'text', timer, guard };
  if (opts.noCopy) header.noCopy = true;
  if (opts.noSave) header.noSave = true;
  const encHeader = await encryptJson(key, header);
  let body: string | null = null;
  let filePath: string | null = null;
  if (input.kind === 'file') {
    const ct = await encryptBytes(key, input.bytes);
    filePath = `f/${randomToken(24)}.bin`;
    const { error } = await b.supabase.storage.from('secrets').upload(filePath, ct, { contentType: 'application/octet-stream', upsert: false });
    if (error) throw new Error('Upload failed. Please try again.');
  } else if (input.kind === 'wifi') {
    const w = input.wifi;
    body = await encryptText(key, JSON.stringify({ ssid: w.ssid.trim(), password: w.security === 'nopass' ? '' : w.password, security: w.security, hidden: !!w.hidden }));
  } else {
    body = await encryptText(key, input.text);
  }
  const views = opts.views ?? 1;
  const { data: id, error } = await b.supabase.rpc('create_secret', {
    p_header: encHeader, p_body: body, p_file_path: filePath, p_ttl_seconds: opts.ttlSeconds,
    p_client_id: b.clientId, p_ref: null, p_recipient: null, p_share_location: false,
    p_size: input.kind === 'file' ? input.bytes.length : null,
    ...(views > 1 ? { p_max_views: views } : {}),
  });
  if (error || !id) throw new Error(`create_secret: ${error?.message ?? 'no id'}`);
  return { link: `${WEB_ORIGIN}/s/${id}#${keyB64}`, id: String(id), keyB64 };
}

type Peek = { header: string; kind: string; expires_at: string; max_views: number | null; views_left: number | null; lock_hint: string | null; open_after: string | null };

/** `app/s/[id]/page.tsx` load effect: key from the fragment, `peek_secret`, decrypt the header. Null = "already opened or expired". */
async function webPeek(b: Browser, link: string): Promise<{ header: SecretHeader; peek: Peek } | null> {
  const u = new URL(link);
  const id = u.pathname.split('/').pop()!;
  const key = await importKey(u.hash.slice(1));
  const { data, error } = await b.supabase.rpc('peek_secret', { p_id: id });
  const row = (Array.isArray(data) ? data[0] : null) as Peek | null;
  if (error || !row) return null;
  return { header: await decryptJson<SecretHeader>(key, row.header), peek: row };
}

type Opened =
  | { kind: 'text'; text: string; header: SecretHeader; row: OpenRow }
  | { kind: 'wifi'; wifi: WifiSecret; header: SecretHeader; row: OpenRow }
  | { kind: 'file'; bytes: Uint8Array; header: SecretHeader; row: OpenRow }
  | { kind: 'gone' };

/** `app/s/[id]/page.tsx` open(): POST /api/open, then decrypt body or download + decrypt the file, remove it on the final view. */
async function webOpen(b: Browser, link: string, header: SecretHeader): Promise<Opened> {
  const u = new URL(link);
  const id = u.pathname.split('/').pop()!;
  const key = await importKey(u.hash.slice(1));
  const res = await h.openRoute({ id, precise: undefined, unlockToken: undefined });
  if (res.status === 404) return { kind: 'gone' };
  if (res.status !== 200) throw new Error(`open: ${res.status} ${JSON.stringify(res.json)}`);
  const row = res.json as OpenRow;
  const isFinal = row.final !== false;
  if (row.body) {
    const text = await decryptText(key, row.body);
    if (header.tpl === 'wifi') return { kind: 'wifi', wifi: JSON.parse(text) as WifiSecret, header, row };
    return { kind: 'text', text, header, row };
  }
  if (!row.file_path) throw new Error('open: neither body nor file');
  const { data: blob, error } = await b.supabase.storage.from('secrets').download(row.file_path);
  if (error || !blob) throw new Error('download');
  const bytes = new Uint8Array(await decryptBytes(key, new Uint8Array(await blob.arrayBuffer())));
  if (isFinal) await b.supabase.storage.from('secrets').remove([row.file_path]);
  return { kind: 'file', bytes, header, row };
}

// ---------------------------------------------------------------------------- sweep

function forbiddenFor(keyB64: string, extra: Forbidden[] = []): Forbidden[] {
  return [
    forbidden('key (base64url)', keyB64),
    forbidden('key (raw bytes)', fromB64Url(keyB64)),
    ...extra,
  ];
}

/** The artefacts a leak could land in, as text. */
async function artefacts() {
  return {
    'SQL log': JSON.stringify(h.allSql),
    'DB dump + objects': await h.dumpDb(),
    '/api/open request bodies': h.requests.join('\n'),
    '/api/open responses': h.responses.join('\n'),
  };
}

async function sweep(list: Forbidden[]) {
  for (const [where, text] of Object.entries(await artefacts())) expectClean(text, list, where);
}

/** Ciphertext is allowed to be there; the ids are not secrets. This proves the sweep looks at the right places. */
async function expectPresent(id: string) {
  const a = await artefacts();
  expect(a['SQL log']).toContain(id);
  expect(a['/api/open request bodies']).toContain(id);
}

// ---------------------------------------------------------------------------- 1. the web path on the real migrations

describe('one-time secrets: the website path on the production schema', () => {
  it('boots the whole schema and keeps open_secret for the server only', async () => {
    const ok = await h.asRole<{ ok: boolean }>('service_role', null, `select has_function_privilege('service_role', 'public.open_secret(text,text,text,text,double precision,double precision,text,int,text,text,text)', 'execute') ok`);
    expect(ok[0].ok).toBe(true);
    for (const role of ['anon', 'authenticated'] as const) {
      const r = await h.asRole<{ ok: boolean }>('service_role', null, `select has_function_privilege($1, 'public.open_secret(text,text,text,text,double precision,double precision,text,int,text,text,text)', 'execute') ok`, [role]);
      expect(r[0].ok, `${role} may not call open_secret directly`).toBe(false);
      // and in practice: the RPC the website's anonymous client would make is refused.
      const { error } = await h.rpcAs(role, null, 'open_secret', { p_id: 'AAAAAAAAAA' });
      expect(error?.message).toMatch(/permission denied/);
    }
    // create_secret and peek_secret are what the browser and the phone call themselves.
    for (const fn of ['create_secret', 'peek_secret']) {
      const r = await h.asRole<{ ok: boolean }>('service_role', null, `select bool_and(has_function_privilege(r, p.oid, 'execute')) ok from pg_proc p, unnest(array['anon','authenticated']) r where p.proname = $1`, [fn]);
      expect(r[0].ok, `${fn} callable by anon and authenticated`).toBe(true);
    }
  });

  it('text: create → peek → open once → the second open is refused; guard/timer/noCopy/noSave round-trip in the header', async () => {
    const b = browser();
    const { link, id, keyB64 } = await webCreate(b, { kind: 'text', text: BODY }, { ttlSeconds: 3600, timer: 30, guard: true, noCopy: true, noSave: true });
    expect(link).toMatch(LINK);
    expect(LINK.exec(link)![1]).toBe(id);

    const peeked = await webPeek(b, link);
    expect(peeked).not.toBeNull();
    expect(peeked!.header).toEqual({ v: 1, type: 'text', timer: 30, guard: true, noCopy: true, noSave: true });
    expect(peeked!.peek.kind).toBe('text');
    expect(peeked!.peek.views_left).toBe(1);
    expect(peeked!.peek.max_views).toBe(1);
    // Peeking does not burn.
    expect(await h.count(`select count(*) n from public.secrets where id = $1`, [id])).toBe(1);

    const opened = await webOpen(b, link, peeked!.header);
    expect(opened.kind).toBe('text');
    if (opened.kind !== 'text') return;
    expect(opened.text).toBe(BODY);
    expect(opened.row.final).toBe(true);
    expect(opened.row.views_left).toBe(0);
    expect(opened.row.body).not.toContain(BODY); // the route hands back ciphertext

    // Burned: the row is gone, peek says gone, a second open says gone.
    expect(await h.count(`select count(*) n from public.secrets where id = $1`, [id])).toBe(0);
    expect(await webPeek(b, link)).toBeNull();
    expect(await webOpen(b, link, peeked!.header)).toEqual({ kind: 'gone' });

    await expectPresent(id);
    await sweep(forbiddenFor(keyB64, [forbidden('body', BODY)]));
  });

  it('wifi: the template flag and the password survive the round trip; neither reaches the server', async () => {
    const b = browser();
    const { link, keyB64 } = await webCreate(b, { kind: 'wifi', wifi: WIFI }, { ttlSeconds: 3600 });
    const peeked = await webPeek(b, link);
    expect(peeked!.header).toEqual({ v: 1, type: 'text', tpl: 'wifi', timer: 0 });
    const opened = await webOpen(b, link, peeked!.header);
    expect(opened.kind).toBe('wifi');
    if (opened.kind !== 'wifi') return;
    expect(opened.wifi).toEqual({ ssid: WIFI.ssid, password: WIFI.password, security: 'WPA', hidden: false });
    expect(await webOpen(b, link, peeked!.header)).toEqual({ kind: 'gone' });
    await sweep(forbiddenFor(keyB64, [forbidden('wifi password', WIFI.password), forbidden('wifi ssid', WIFI.ssid)]));
  });

  it('file: bytes equal after decrypt; the ciphertext is unreadable before the open and deleted after the final view', async () => {
    const b = browser();
    const bytes = new Uint8Array(Buffer.from(FILE_BODY, 'utf8'));
    const { link, id, keyB64 } = await webCreate(b, { kind: 'file', name: FILE_NAME, mime: 'text/plain', bytes }, { ttlSeconds: 3600, guard: true });
    expect(b.supabase.uploads).toHaveLength(1);
    const filePath = b.supabase.uploads[0];
    expect(filePath).toMatch(/^f\/[A-Za-z0-9_-]{32}\.bin$/);
    // Before the open the bucket policy refuses the download (no claim yet).
    const early = await b.supabase.storage.from('secrets').download(filePath);
    expect(early.data).toBeNull();

    const peeked = await webPeek(b, link);
    expect(peeked!.header).toEqual({ v: 1, type: 'file', name: FILE_NAME, mime: 'text/plain', size: bytes.length, timer: 0, guard: true });
    expect(peeked!.peek.kind).toBe('file');
    const opened = await webOpen(b, link, peeked!.header);
    expect(opened.kind).toBe('file');
    if (opened.kind !== 'file') return;
    expect(Buffer.from(opened.bytes).equals(Buffer.from(bytes))).toBe(true);
    expect(opened.header.name).toBe(FILE_NAME);
    // The final view removed the ciphertext (policy "delete claimed" allows it only once fully burned).
    expect(h.objects.has(filePath)).toBe(false);
    expect(await h.count(`select count(*) n from public.secrets where id = $1`, [id])).toBe(0);
    expect(await webOpen(b, link, peeked!.header)).toEqual({ kind: 'gone' });
    await sweep(forbiddenFor(keyB64, [forbidden('file name', FILE_NAME), forbidden('file body', FILE_BODY)]));
  });

  it('views: a 3-view secret opens three times (views_left 2, 1, 0; final on the last), then is gone; the file stays until the last view', async () => {
    const b = browser();
    const bytes = new Uint8Array(Buffer.from(FILE_BODY, 'utf8'));
    const { link, id, keyB64 } = await webCreate(b, { kind: 'file', name: FILE_NAME, mime: 'text/plain', bytes }, { ttlSeconds: 3600, views: 3 });
    const filePath = b.supabase.uploads[0];
    const peeked = await webPeek(b, link);
    expect(peeked!.peek.max_views).toBe(3);
    expect(peeked!.peek.views_left).toBe(3);
    const seen: Array<[number, boolean]> = [];
    for (let i = 0; i < 3; i++) {
      const o = await webOpen(b, link, peeked!.header);
      expect(o.kind).toBe('file');
      if (o.kind !== 'file') return;
      expect(Buffer.from(o.bytes).equals(Buffer.from(bytes))).toBe(true);
      seen.push([o.row.views_left, o.row.final]);
      if (i < 2) {
        // Between views: still there, peek counts down, the ciphertext cannot be deleted by a viewer.
        expect(await h.count(`select count(*) n from public.secrets where id = $1`, [id])).toBe(1);
        expect((await webPeek(b, link))!.peek.views_left).toBe(2 - i);
        await b.supabase.storage.from('secrets').remove([filePath]);
        expect(h.objects.has(filePath)).toBe(true);
      }
    }
    expect(seen).toEqual([[2, false], [1, false], [0, true]]);
    expect(h.objects.has(filePath)).toBe(false);
    expect(await webOpen(b, link, peeked!.header)).toEqual({ kind: 'gone' });
    expect(await webPeek(b, link)).toBeNull();
    await sweep(forbiddenFor(keyB64, [forbidden('file name', FILE_NAME), forbidden('file body', FILE_BODY)]));
  });

  it('expiry: an expired secret cannot be peeked or opened, and its ciphertext stays unreadable', async () => {
    const b = browser();
    const { link, id, keyB64 } = await webCreate(b, { kind: 'text', text: BODY }, { ttlSeconds: 300 });
    expect(await webPeek(b, link)).not.toBeNull();
    await h.expire(id);
    expect(await webPeek(b, link)).toBeNull();
    const res = await h.openRoute({ id });
    expect(res).toEqual({ status: 404, json: { error: 'gone' } });
    // The row is still in the table until the reaper runs; its body is ciphertext.
    expect(await h.count(`select count(*) n from public.secrets where id = $1`, [id])).toBe(1);
    await sweep(forbiddenFor(keyB64, [forbidden('body', BODY)]));
    // create_secret refuses a lifetime under 5 minutes (the web's shortest choice).
    const { error } = await b.supabase.rpc('create_secret', { p_header: 'x', p_body: 'y', p_file_path: null, p_ttl_seconds: 60, p_client_id: b.clientId });
    expect(error?.message).toMatch(/invalid expiry/);
  });

  it('wrong key: the link with another key cannot decrypt the header, and the secret is not burned by the attempt', async () => {
    const b = browser();
    const { link, id } = await webCreate(b, { kind: 'text', text: BODY }, { ttlSeconds: 3600 });
    const other = (await newKey()).keyB64;
    const wrong = link.replace(/#.*$/, `#${other}`);
    await expect(webPeek(b, wrong)).rejects.toThrow();
    expect(await h.count(`select count(*) n from public.secrets where id = $1`, [id])).toBe(1);
    // A damaged key (wrong length) is refused before any RPC.
    const before = h.allSql.length;
    await expect(webPeek(b, link.replace(/#.*$/, `#${'A'.repeat(40)}`))).rejects.toThrow(/Invalid key/);
    expect(h.allSql.length).toBe(before);
  });

  it('the route mirror matches app/api/open/route.ts: same RPC, same argument names, same response keys', () => {
    const src = readFileSync(path.join(ROOT, 'app/api/open/route.ts'), 'utf8');
    expect(src).toContain(`supabase.rpc('open_secret', { p_id: id, ...args, p_ip_country: net.country, p_unlock_token: unlockToken })`);
    for (const name of ['p_lat', 'p_lon', 'p_source', 'p_area', 'p_city', 'p_region', 'p_country']) expect(src, name).toContain(`${name}:`);
    expect(src).toContain(`return NextResponse.json({ error: 'gone' }, { status: 404 })`);
    expect(src).toContain(`header: row.header, body: row.body, file_path: row.file_path`);
    expect(src).toMatch(/views_left: typeof row\.views_left === 'number' \? row\.views_left : 0/);
    expect(src).toMatch(/final: typeof row\.final === 'boolean' \? row\.final : true/);
    expect(src).toContain(`/^[A-Za-z0-9]{6,32}$/.test(id)`);
    // The route never sees a key: no decrypt call, no key import, no URL fragment (the comment may say so; the code may not do it).
    const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    expect(code).not.toMatch(/\bdecrypt[A-Za-z]*\(|importKey\(|location\.hash|\.hash\b/);
  });

  it('canary: the sweep fires on a planted plaintext, key, file name and password in every encoding', async () => {
    const { keyB64 } = await newKey();
    const list = forbiddenFor(keyB64, [forbidden('body', BODY), forbidden('file name', FILE_NAME), forbidden('wifi password', WIFI.password)]);
    const encodings = (v: string) => [v, Buffer.from(v).toString('hex'), Buffer.from(v).toString('base64'), Buffer.from(v).toString('base64url')];
    for (const planted of [...encodings(BODY), ...encodings(FILE_NAME), ...encodings(WIFI.password), keyB64, Buffer.from(fromB64Url(keyB64)).toString('hex')]) {
      expect(() => expectClean(`-- secrets\n(abc,${planted},x)`, list, 'canary'), planted).toThrow();
    }
    // And the real artefacts are not empty: the sweep has looked at something.
    const a = await artefacts();
    expect(a['SQL log'].length).toBeGreaterThan(1000);
    expect(a['DB dump + objects']).toContain('-- secret_quota'); // secret_log needs an owner; the anonymous browser has none
    expect(h.requests.length).toBeGreaterThan(5);
  });

  it('the website viewer sends the server only the id (never the fragment), and the create path only ciphertext', () => {
    for (const req of h.requests) {
      const keys = Object.keys(JSON.parse(req));
      expect(keys.every(k => ['id', 'precise', 'unlockToken'].includes(k)), req).toBe(true);
    }
    for (const call of h.allSql.filter(c => c.fn === 'create_secret')) {
      const a = call.args as { p_header: string; p_body: string | null; p_file_path: string | null };
      expect(a.p_header).toMatch(/^[A-Za-z0-9_-]+$/);
      if (a.p_body) expect(a.p_body).toMatch(/^[A-Za-z0-9_-]+$/);
      if (a.p_file_path) expect(a.p_file_path).toMatch(/^f\/[A-Za-z0-9_-]{24,64}\.bin$/);
    }
  });
});

// ---------------------------------------------------------------------------- 2. app <-> web through the core module

// TODO(lead, after C4 merges): change `describe.skip` to `describe` once packages/core/src/secrets.ts
// exists, and align `appDeps()` with its real `deps` shape (`createSecret(deps, input, opts)`,
// `peekSecret(deps, url)`, `openSecret(deps, url, unlock?)` per the lead's contract and
// apps/mobile/lib/secrets.ts). Everything the module needs from the outside is here: a Supabase
// stand-in as a signed-in phone, a `fetch` that routes POST https://onepeek.io/api/open to the route
// mirror and records every body, and the site/api base URL.
describe.skip('one-time secrets: app <-> web through packages/core/src/secrets.ts (unskip after C4 merges)', () => {
  type SecretsModule = {
    createSecret(deps: unknown, input: unknown, opts: unknown): Promise<{ id: string; url: string }>;
    peekSecret(deps: unknown, url: string): Promise<{ header: SecretHeader; viewsLeft: number | null; maxViews: number | null; locked: boolean }>;
    openSecret(deps: unknown, url: string, unlock?: unknown): Promise<
      | { kind: 'text'; text: string; header: SecretHeader }
      | { kind: 'wifi'; wifi: WifiSecret; header: SecretHeader }
      | { kind: 'file'; bytes: Uint8Array; name: string; mime: string; header: SecretHeader }
    >;
    isSecretLink?(url: string): boolean;
  };
  let mod: SecretsModule;
  /** Request bodies the phone sent to /api/open. */
  const phoneRequests: string[] = [];

  beforeAll(async () => {
    expect(CORE_PRESENT, `${SECRETS_MODULE} is missing`).toBe(true);
    // A computed specifier: tsc and vitest do not resolve it at build time, so the file may be absent.
    mod = (await import(/* @vite-ignore */ `../src/${'secrets'}`)) as SecretsModule;
  });

  async function phone() {
    const userId = crypto.randomUUID();
    await h.addUser({ id: userId });
    const supabase = h.fakeSupabase({ id: userId });
    const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      expect(url, 'the phone opens secrets only through onepeek.io/api/open').toBe(`${WEB_ORIGIN}/api/open`);
      expect(init?.method).toBe('POST');
      const body = typeof init?.body === 'string' ? init.body : '';
      phoneRequests.push(body);
      const res = await h.openRoute(JSON.parse(body));
      return new Response(JSON.stringify(res.json), { status: res.status, headers: { 'content-type': 'application/json' } });
    };
    const deps = { supabase, fetch, siteUrl: WEB_ORIGIN, apiBaseUrl: WEB_ORIGIN, clientId: `app-${randomToken(12)}`, deviceLabel: 'iPhone 15' };
    return { userId, supabase, deps };
  }

  const opts = { ttlSeconds: 3600, views: 1, timer: 30, guard: true, noCopy: true, noSave: true };

  it('app → web, text: the phone creates, the website opens; flags round-trip; second open gone', async () => {
    const p = await phone();
    const b = browser();
    const { id, url } = await mod.createSecret(p.deps, { kind: 'text', text: BODY }, opts);
    expect(url).toMatch(LINK);
    expect(LINK.exec(url)![1]).toBe(id);
    const keyB64 = LINK.exec(url)![2];
    const peeked = await webPeek(b, url);
    expect(peeked!.header).toEqual({ v: 1, type: 'text', timer: 30, guard: true, noCopy: true, noSave: true });
    const opened = await webOpen(b, url, peeked!.header);
    expect(opened).toMatchObject({ kind: 'text', text: BODY });
    expect(await webOpen(b, url, peeked!.header)).toEqual({ kind: 'gone' });
    // The phone's create path sent the server only ciphertext, under its own session.
    const creates = p.supabase.sql.filter(c => c.fn === 'create_secret');
    expect(creates).toHaveLength(1);
    expect(await h.count(`select count(*) n from public.secret_log where id = $1 and owner = $2`, [id, p.userId])).toBe(1);
    await sweep(forbiddenFor(keyB64, [forbidden('body', BODY)]));
  });

  it('app → web, wifi', async () => {
    const p = await phone();
    const b = browser();
    const { url } = await mod.createSecret(p.deps, { kind: 'wifi', wifi: WIFI }, { ttlSeconds: 3600, views: 1 });
    const peeked = await webPeek(b, url);
    expect(peeked!.header.tpl).toBe('wifi');
    const opened = await webOpen(b, url, peeked!.header);
    expect(opened).toMatchObject({ kind: 'wifi', wifi: { ssid: WIFI.ssid, password: WIFI.password, security: 'WPA' } });
    await sweep(forbiddenFor(LINK.exec(url)![2], [forbidden('wifi password', WIFI.password)]));
  });

  it('app → web, file: bytes equal, name and mime in the header, ciphertext removed after the final view', async () => {
    const p = await phone();
    const b = browser();
    const bytes = new Uint8Array(Buffer.from(FILE_BODY, 'utf8'));
    const file = { name: FILE_NAME, mime: 'text/plain', size: bytes.length, bytes: async () => bytes };
    const { url } = await mod.createSecret(p.deps, { kind: 'file', file }, { ttlSeconds: 3600, views: 1 });
    expect(p.supabase.uploads).toHaveLength(1);
    const peeked = await webPeek(b, url);
    expect(peeked!.header).toMatchObject({ type: 'file', name: FILE_NAME, mime: 'text/plain', size: bytes.length });
    const opened = await webOpen(b, url, peeked!.header);
    expect(opened.kind).toBe('file');
    if (opened.kind !== 'file') return;
    expect(Buffer.from(opened.bytes).equals(Buffer.from(bytes))).toBe(true);
    expect(h.objects.has(p.supabase.uploads[0])).toBe(false);
    await sweep(forbiddenFor(LINK.exec(url)![2], [forbidden('file name', FILE_NAME), forbidden('file body', FILE_BODY)]));
  });

  it('web → app, text: the website creates, the phone peeks then opens; second open refused; expiry refused', async () => {
    const b = browser();
    const p = await phone();
    const { link, id, keyB64 } = await webCreate(b, { kind: 'text', text: BODY }, { ttlSeconds: 3600, timer: 30, guard: true, noCopy: true, noSave: true });
    if (mod.isSecretLink) expect(mod.isSecretLink(link)).toBe(true);
    const peek = await mod.peekSecret(p.deps, link);
    expect(peek.header).toEqual({ v: 1, type: 'text', timer: 30, guard: true, noCopy: true, noSave: true });
    expect(peek.viewsLeft).toBe(1);
    expect(peek.locked).toBe(false);
    const opened = await mod.openSecret(p.deps, link);
    expect(opened).toMatchObject({ kind: 'text', text: BODY, header: { guard: true, timer: 30, noCopy: true, noSave: true } });
    await expect(mod.openSecret(p.deps, link)).rejects.toThrow();
    // The phone sent the server only the id.
    for (const req of phoneRequests) expect(Object.keys(JSON.parse(req)).every(k => ['id', 'precise', 'unlockToken'].includes(k)), req).toBe(true);
    // Expiry, seen from the phone.
    const second = await webCreate(b, { kind: 'text', text: BODY }, { ttlSeconds: 300 });
    await h.expire(second.id);
    await expect(mod.peekSecret(p.deps, second.link)).rejects.toThrow();
    await expect(mod.openSecret(p.deps, second.link)).rejects.toThrow();
    void id;
    await sweep([...forbiddenFor(keyB64, [forbidden('body', BODY)]), forbidden('key 2', second.keyB64)]);
    expectClean(phoneRequests.join('\n'), forbiddenFor(keyB64, [forbidden('body', BODY)]), 'phone request bodies');
  });

  it('web → app, wifi and file', async () => {
    const b = browser();
    const p = await phone();
    const w = await webCreate(b, { kind: 'wifi', wifi: WIFI }, { ttlSeconds: 3600 });
    expect(await mod.openSecret(p.deps, w.link)).toMatchObject({ kind: 'wifi', wifi: { ssid: WIFI.ssid, password: WIFI.password } });
    const bytes = new Uint8Array(Buffer.from(FILE_BODY, 'utf8'));
    const f = await webCreate(b, { kind: 'file', name: FILE_NAME, mime: 'text/plain', bytes }, { ttlSeconds: 3600, views: 2 });
    const first = await mod.openSecret(p.deps, f.link);
    expect(first.kind).toBe('file');
    if (first.kind !== 'file') return;
    expect(Buffer.from(first.bytes).equals(Buffer.from(bytes))).toBe(true);
    expect(first).toMatchObject({ name: FILE_NAME, mime: 'text/plain' });
    // Second of two views: still readable, then gone.
    const second = await mod.openSecret(p.deps, f.link);
    expect(second.kind).toBe('file');
    await expect(mod.openSecret(p.deps, f.link)).rejects.toThrow();
    await sweep([
      ...forbiddenFor(w.keyB64, [forbidden('wifi password', WIFI.password)]),
      ...forbiddenFor(f.keyB64, [forbidden('file name', FILE_NAME), forbidden('file body', FILE_BODY)]),
    ]);
  });
});
