/* eslint-disable no-console -- a CLI check that reports to the terminal */
// End-to-end check of the app API against a REAL OnePeek deployment (no mocks).
//
//   BASE_URL=https://<preview>.vercel.app SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=<public anon key> npx tsx tests/integration/send-securely.e2e.ts
//
// Does what TopShelf (sender) and the browser viewer (recipient) do: register an install, encrypt
// locally, upload ciphertext to a signed URL, create shares, open them through /api/open and the
// storage RLS path, race view-once opens, walk the passphrase flow, revoke, and probe auth and
// cross-install isolation. Prints one line per check and exits non-zero on any failure.
// It only ever sends ciphertext; test content is random and contains nothing real.
import { randomBytes, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  newKey, encryptJson, encryptBytes, decryptBytes, decryptJson, importKey, toB64Url, fromB64Url,
  derivePassKeys, derivePassContentKey, sha256Hex,
} from '../../packages/core/src/crypto';

const BASE = (process.env.BASE_URL || '').replace(/\/$/, '');
const SB_URL = process.env.SUPABASE_URL || '';
const SB_ANON = process.env.SUPABASE_ANON_KEY || '';
if (!BASE || !SB_URL || !SB_ANON) { console.error('Set BASE_URL, SUPABASE_URL and SUPABASE_ANON_KEY'); process.exit(2); }
const BYPASS: Record<string, string> = process.env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS } : {};

const anon = createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });
const b64u = (n: number) => randomBytes(n).toString('base64url');
const hex = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

async function api(path: string, init: RequestInit & { install?: { id: string; secret: string } } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...BYPASS, ...(init.headers as Record<string, string> || {}) };
  if (init.install) headers.Authorization = `OnePeek-Install ${init.install.id}.${init.install.secret}`;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, headers: res.headers };
}

async function register() {
  const secret = b64u(32);
  const r = await api('/api/v1/installs', { method: 'POST', body: JSON.stringify({ secretHash: hex(secret), platform: 'macos', appVersion: 'e2e' }) });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { id: r.body.installId as string, secret };
}

async function createText(install: { id: string; secret: string }, text: string, opts: { views?: number; ttl?: number; key?: string; manage?: string } = {}) {
  const { key, keyB64 } = await newKey();
  const header = await encryptJson(key, { v: 1, type: 'text', timer: 0 });
  const body = toB64Url(await encryptBytes(key, new TextEncoder().encode(text)));
  const manage = opts.manage ?? b64u(32);
  const r = await api('/api/v1/shares', { method: 'POST', install, body: JSON.stringify({
    idempotencyKey: opts.key ?? b64u(18), manageHash: hex(manage), header, body, ttlSeconds: opts.ttl ?? 900, maxViews: opts.views ?? 1,
  }) });
  return { r, keyB64, manage };
}

const openShare = (id: string, unlockToken?: string) =>
  api('/api/open', { method: 'POST', body: JSON.stringify({ id, unlockToken }) });

async function main() {
  // --- headers and auth
  const home = await fetch(`${BASE}/s/abcdefghij`, { headers: BYPASS });
  check('share page sends no-referrer, no-store, noindex, DENY framing',
    home.headers.get('referrer-policy') === 'no-referrer' && /no-store/.test(home.headers.get('cache-control') || '')
      && /noindex/.test(home.headers.get('x-robots-tag') || '') && home.headers.get('x-frame-options') === 'DENY');
  check('API refuses calls without install credentials', (await api('/api/v1/shares')).status === 401);
  check('API refuses a wrong install secret',
    (await api('/api/v1/shares', { install: { id: 'A'.repeat(22), secret: b64u(32) } })).status === 401);
  check('cleanup cron refuses unauthenticated callers', (await fetch(`${BASE}/api/cleanup`, { headers: BYPASS })).status === 401);
  const anonReap = await anon.rpc('reap_expired_secrets');
  check('browsers can no longer run the reaper (anon RPC)', !!anonReap.error, anonReap.error?.message);

  const a = await register(), b = await register();
  check('registers installs', /^[A-Za-z0-9]{22}$/.test(a.id) && a.id !== b.id);

  // --- text share, opened like the viewer does
  const plain = `e2e ${b64u(12)}`;
  const t = await createText(a, plain);
  check('creates a text share', t.r.status === 201 && /\/s\/[A-Za-z0-9]{10}$/.test(t.r.body?.url), `${t.r.status}`);
  const id = t.r.body.id as string;
  check('the URL from the API carries no key', !String(t.r.body.url).includes('#'));
  const peek = await anon.rpc('peek_secret', { p_id: id });
  const key = await importKey(t.keyB64);
  check('viewer can peek and decrypt the header', !peek.error && (await decryptJson(key, peek.data[0].header)).type === 'text');
  const opened = await openShare(id);
  check('viewer opens and decrypts the text', opened.status === 200 &&
    new TextDecoder().decode(await decryptBytes(key, fromB64Url(opened.body.body))) === plain);
  check('view-once: a second open gets nothing', (await openShare(id)).status === 404);
  const listA = await api('/api/v1/shares', { install: a });
  check('My Shares shows it as viewed', listA.body?.shares?.find((s: any) => s.id === id)?.status === 'viewed');
  check('another install cannot see it', !(await api('/api/v1/shares', { install: b })).body?.shares?.some((s: any) => s.id === id));

  // --- idempotency
  const idemKey = b64u(18), manage = b64u(32);
  const i1 = await createText(a, 'idem', { key: idemKey, manage });
  const i2 = await createText(a, 'idem', { key: idemKey, manage });
  check('retrying a create returns the same share', i1.r.status === 201 && i2.r.status === 200 && i2.r.body.replayed && i2.r.body.id === i1.r.body.id);
  check('a retry with a different manage token is refused', (await createText(a, 'idem', { key: idemKey })).r.status === 409);

  // --- concurrent view-once
  const race = await createText(a, 'race');
  const results = await Promise.all(Array.from({ length: 8 }, () => openShare(race.r.body.id)));
  const wins = results.filter(r => r.status === 200).length;
  check('8 simultaneous opens of a view-once share: exactly one succeeds', wins === 1, `${wins} succeeded`);

  // --- multi-view
  const mv = await createText(a, 'three', { views: 3 });
  const opens = [await openShare(mv.r.body.id), await openShare(mv.r.body.id), await openShare(mv.r.body.id), await openShare(mv.r.body.id)];
  check('a 3-view share opens exactly 3 times', opens.map(o => o.status).join(',') === '200,200,200,404');

  // --- revoke
  const rv = await createText(a, 'revoke me', { views: 5 });
  const rid = rv.r.body.id;
  check('another install cannot revoke it',
    (await api(`/api/v1/shares/${rid}`, { method: 'DELETE', install: b, headers: { 'X-Manage-Token': rv.manage } })).status === 404);
  check('the wrong manage token cannot revoke it',
    (await api(`/api/v1/shares/${rid}`, { method: 'DELETE', install: a, headers: { 'X-Manage-Token': b64u(32) } })).status === 404);
  const del = await api(`/api/v1/shares/${rid}`, { method: 'DELETE', install: a, headers: { 'X-Manage-Token': rv.manage } });
  check('the sender revokes it', del.status === 200 && del.body?.revoked === true);
  check('a revoked share cannot be opened', (await openShare(rid)).status === 404);
  check('My Shares shows it as revoked',
    (await api('/api/v1/shares', { install: a })).body?.shares?.find((s: any) => s.id === rid)?.status === 'revoked');

  // --- file share via signed upload, downloaded through storage RLS like the viewer
  const fileBytes = randomBytes(300_000);
  const { key: fk, keyB64: fkB64 } = await newKey();
  const ct = await encryptBytes(fk, fileBytes);
  const up = await api('/api/v1/uploads', { method: 'POST', install: a, body: JSON.stringify({ size: ct.byteLength }) });
  check('reserves a signed upload', up.status === 201 && /^f\/[A-Za-z0-9]{32}\.bin$/.test(up.body?.path));
  const put = await fetch(up.body.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from(ct) });
  check('uploads ciphertext to the signed URL', put.ok, `${put.status}`);
  const fhdr = await encryptJson(fk, { v: 1, type: 'file', name: 'e2e.bin', mime: 'application/octet-stream', size: fileBytes.length, timer: 0 });
  const fileShare = await api('/api/v1/shares', { method: 'POST', install: a, body: JSON.stringify({
    idempotencyKey: b64u(18), manageHash: hex(b64u(32)), header: fhdr, filePath: up.body.path, size: fileBytes.length, ttlSeconds: 900, maxViews: 1 }) });
  check('creates a file share', fileShare.status === 201, `${fileShare.status} ${JSON.stringify(fileShare.body?.error ?? '')}`);
  check('nobody can download the file before it is opened', !!(await anon.storage.from('secrets').download(up.body.path)).error);
  const fo = await openShare(fileShare.body.id);
  const dl = await anon.storage.from('secrets').download(fo.body?.file_path || '');
  const back = dl.data ? new Uint8Array(await decryptBytes(await importKey(fkB64), new Uint8Array(await dl.data.arrayBuffer()))) : null;
  check('the recipient downloads and decrypts the identical file', !!back && Buffer.from(back).equals(fileBytes));
  check('the same upload slot cannot be reused', (await api('/api/v1/shares', { method: 'POST', install: a, body: JSON.stringify({
    idempotencyKey: b64u(18), manageHash: hex(b64u(32)), header: fhdr, filePath: up.body.path, ttlSeconds: 900, maxViews: 1 }) })).status === 409);
  const tamper = new Uint8Array(ct); tamper[100] ^= 1;
  check('tampered ciphertext fails authentication', await decryptBytes(fk, tamper).then(() => false, () => true));

  // --- passphrase share
  const passphrase = `e2e ${b64u(9)}`;
  const salt = b64u(16), linkPart = b64u(32), serverHalf = b64u(32);
  const { authKeyB64, wrapKey } = await derivePassKeys(passphrase, salt);
  const pk = await derivePassContentKey(linkPart, wrapKey, serverHalf, ['encrypt', 'decrypt']);
  const ps = await api('/api/v1/shares', { method: 'POST', install: a, body: JSON.stringify({
    idempotencyKey: b64u(18), manageHash: hex(b64u(32)), header: await encryptJson(pk, { v: 1, type: 'text', timer: 0 }),
    body: toB64Url(await encryptBytes(pk, new TextEncoder().encode('behind a passphrase'))), ttlSeconds: 900, maxViews: 1,
    passphrase: { salt, authHash: await sha256Hex(fromB64Url(authKeyB64)), serverHalf } }) });
  check('creates a passphrase share', ps.status === 201, `${ps.status}`);
  const pid = ps.body.id;
  check('the viewer gets the KDF salt', (await anon.rpc('peek_pass', { p_id: pid })).data === salt);
  check('opening without the passphrase is refused', (await openShare(pid)).body?.error === 'passphrase_required');
  const wrong = await api('/api/v1/pass/unlock', { method: 'POST', body: JSON.stringify({ id: pid, authKey: (await derivePassKeys('nope', salt)).authKeyB64 }) });
  check('a wrong passphrase is refused and counted', wrong.status === 403 && wrong.body?.error?.attemptsLeft === 4);
  const right = await api('/api/v1/pass/unlock', { method: 'POST', body: JSON.stringify({ id: pid, authKey: authKeyB64 }) });
  check('the right passphrase returns the server half', right.status === 200 && right.body?.serverHalf === serverHalf);
  const po = await openShare(pid, right.body?.token);
  const viewerKey = await derivePassContentKey(linkPart, (await derivePassKeys(passphrase, salt)).wrapKey, right.body.serverHalf);
  check('the recipient decrypts it', po.status === 200 &&
    new TextDecoder().decode(await decryptBytes(viewerKey, fromB64Url(po.body.body))) === 'behind a passphrase');

  const ps2 = await api('/api/v1/shares', { method: 'POST', install: a, body: JSON.stringify({
    idempotencyKey: b64u(18), manageHash: hex(b64u(32)), header: await encryptJson(pk, { v: 1, type: 'text', timer: 0 }),
    body: toB64Url(await encryptBytes(pk, new TextEncoder().encode('x'))), ttlSeconds: 900, maxViews: 1,
    passphrase: { salt, authHash: await sha256Hex(fromB64Url(authKeyB64)), serverHalf } }) });
  const guesses = await Promise.all(Array.from({ length: 7 }, (_, i) =>
    derivePassKeys(`guess ${i}`, salt).then(k => api('/api/v1/pass/unlock', { method: 'POST', body: JSON.stringify({ id: ps2.body.id, authKey: k.authKeyB64 }) }))));
  const lockedNow = await api('/api/v1/pass/unlock', { method: 'POST', body: JSON.stringify({ id: ps2.body.id, authKey: authKeyB64 }) });
  check('7 parallel wrong guesses: the share is destroyed and the right passphrase no longer works',
    lockedNow.status === 404 && guesses.filter(g => g.status === 403).length <= 4,
    guesses.map(g => g.status).join(','));

  // --- validation
  const bad = await api('/api/v1/shares', { method: 'POST', install: a, body: JSON.stringify({
    idempotencyKey: b64u(18), manageHash: hex('m'), header: '<script>alert(1)</script>', body: 'x', ttlSeconds: 900, maxViews: 1 }) });
  check('rejects non-ciphertext (script) payloads', bad.status === 400);
  check('rejects an expiry past 7 days', (await createText(a, 'x', { ttl: 604801 })).r.status === 400);

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error('E2E aborted:', e instanceof Error ? e.message : 'error'); process.exit(1); });
