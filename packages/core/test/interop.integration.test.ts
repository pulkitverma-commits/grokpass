// Web <-> mobile interop (docs/mobile/test-plan.md §2): a browser and a phone in one room, built with
// createChatClient over the real adapters. Real MLS (ts-mls), real SQL (migration 006 on PGlite), the
// real web keystore on fake-indexeddb and the real React Native keystore on a Map-backed SecureStore
// plus node:sqlite in memory. Node's WebCrypto stands in for react-native-quick-crypto (logic only;
// the Hermes proof is C2's spike). Every scenario runs twice with the roles swapped, and every
// scenario ends with the same security sweep over the SQL log, the database, the uploaded objects and
// the phone's own storage.
import { describe, it, expect, beforeAll, vi, type Mock } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createChatClient, fromBytea, type ChatClient, type LocalMessage } from '../src/chat/client';
import * as mls from '../src/chat/mls';
import type { ChatEnv, FileSource } from '../src/chat/ports';
import { fromB64Url } from '../src/crypto';
import { createWebPlatform } from '../src/adapters/web/platform';
import { createRnKeyStore } from '../src/adapters/rn/keystore';
import { createRnPlatform, createRnLockStore, LOCK_ID } from '../src/adapters/rn/platform';
import {
  createSecureStoreMock, createSqliteMock, createFetchRecorder, hasNodeSqlite, WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  type SecureStoreMock, type SqliteMock,
} from './rn-mocks';
import { bootDb, WEB_ORIGIN, type Harness, type SqlCall } from './harness';
import { BODY, BODY2, FILE_NAME, FILE_BODY, ACCESS_CODE, NICK, OWNER_NICK, ROOM_NAME, forbidden, expectClean, hex, type Forbidden } from './fixtures';

const PHONE_ORIGIN = 'https://onepeek.io';
const WRONG_CODE = 'wrong-code-99';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIMEOUT = 60_000;

let h: Harness;

beforeAll(async () => {
  h = await bootDb();
}, TIMEOUT);

// ---------------------------------------------------------------------------- devices

type Kind = 'web' | 'phone';

type Device = {
  name: string;
  kind: Kind;
  userId: string;
  anonymous: boolean;
  c: ChatClient;
  /** This device's own RPC log (the shared one is `h.allSql`). */
  sql: SqlCall[];
  /** The session token the fake Supabase hands this device. */
  token: string;
  passkeyListCalls: number[];
  fake: ReturnType<Harness['fakeSupabase']>;
  notify: Mock<ChatEnv['notify']>;
  origin: string;
  /** Runs one device's code; for a browser, with its own IndexedDB in place. */
  run<T>(fn: (c: ChatClient) => Promise<T>): Promise<T>;
  // Phone only.
  secure?: SecureStoreMock;
  /** This phone's SecureStore entry for the wrapping key (one per simulated device: the cache is process-wide per entry). */
  wrapKeyId?: string;
  sqlite?: SqliteMock;
  fetchCalls?: ReturnType<typeof createFetchRecorder>['calls'];
};

async function device(kind: Kind, name: string, anonymous = false): Promise<Device> {
  const userId = crypto.randomUUID();
  await h.addUser({ id: userId, is_anonymous: anonymous });
  const sql: SqlCall[] = [];
  const fake = h.fakeSupabase({ id: userId, is_anonymous: anonymous }, sql);
  const base = { name: `${name}(${kind})`, kind, userId, anonymous, sql, token: fake.token, passkeyListCalls: fake.passkeyListCalls, fake };

  if (kind === 'web') {
    // A fresh keystore module per browser: its wrapping-key cache is module state, as in a real tab.
    vi.resetModules();
    const { createWebKeyStore } = await import('../src/adapters/web/keystore');
    const idb = new IDBFactory();
    (globalThis as { indexedDB?: IDBFactory }).indexedDB = idb;
    const platform = createWebPlatform({ supabase: fake, keystore: createWebKeyStore() });
    // The browser's notify() posts to a relative URL on its own site; there is no site here, so the
    // spy records the call without making it.
    const notify = vi.fn<ChatEnv['notify']>(async () => {});
    platform.env = { ...platform.env, notify };
    const c = createChatClient(platform);
    return {
      ...base, c, notify, origin: WEB_ORIGIN,
      run: async fn => { (globalThis as { indexedDB?: IDBFactory }).indexedDB = idb; return fn(c); },
    };
  }

  const log: string[] = [];
  const secure = createSecureStoreMock(log);
  const sqlite = createSqliteMock(log);
  const rec = createFetchRecorder();
  const wrapKeyId = `onepeek.wrap.${userId}`;
  const keystore = createRnKeyStore({ secureStore: secure.module, sqlite: sqlite.module, dbName: ':memory:', wrapKeyId });
  const platform = createRnPlatform({
    supabase: fake, keystore, secureStore: secure.module,
    siteUrl: PHONE_ORIGIN, apiBaseUrl: PHONE_ORIGIN, deviceLabel: 'iPhone 15', fetch: rec.fetch,
  });
  const notify = vi.fn<ChatEnv['notify']>(platform.env.notify);
  platform.env = { ...platform.env, notify };
  const c = createChatClient(platform);
  return { ...base, c, notify, origin: PHONE_ORIGIN, run: fn => fn(c), secure, wrapKeyId, sqlite, fetchCalls: rec.calls };
}

const tokenOf = (link: string) => link.split('#')[1];
const text = (f: { bytes: Uint8Array }) => Buffer.from(f.bytes).toString('utf8');
const latin1 = (u8: Uint8Array) => Buffer.from(u8).toString('latin1');
const bodies = (ms: LocalMessage[]) => ms.map(m => m.body);
const settle = () => new Promise(r => setTimeout(r, 0));

function source(name: string, body: string, onRead?: () => void): FileSource {
  const bytes = new Uint8Array(Buffer.from(body, 'utf8'));
  return { name, mime: 'text/plain', size: bytes.length, bytes: async () => { onRead?.(); return bytes; } };
}

async function stateOf(d: Device, roomId: string) {
  const b = await d.run(c => c.keystore.get<Uint8Array>(`room:${roomId}:state`));
  return b ? mls.loadState(b) : null;
}

/** The phone's SQLite rows (keys + hex of iv/ct) as one string. */
function sealedDump(d: Device): string {
  return d.sqlite!.dump().map(r => `${r.key} ${hex(r.iv)} ${hex(r.ct)} ${r.expires_at}`).join('\n');
}
function secureDump(d: Device): string {
  return [...d.secure!.items].map(([k, v]) => `${k}=${v}`).join('\n');
}
function wrapKeyBytes(d: Device): Uint8Array {
  const v = d.secure!.items.get(d.wrapKeyId!);
  expect(v, `${d.name} has a wrapping key in SecureStore`).toBeTruthy();
  return fromB64Url(v!);
}

/** A pair in one secret room: owner created it as OWNER_NICK with the access code, guest joined as NICK and was admitted. */
async function pair(ownerKind: Kind, guestKind: Kind) {
  const owner = await device(ownerKind, 'owner');
  const guest = await device(guestKind, 'guest', true);
  const roomId = await owner.run(c => c.createRoom({ kind: 'secret', ttl: 30, mode: 'on_open', lifetime: 3600, accessCode: ACCESS_CODE, name: ROOM_NAME, nickname: OWNER_NICK }));
  const { link } = await owner.run(c => c.createInvite(roomId, { expiresIn: 3600, maxUses: 1, approval: false }));
  const token = tokenOf(link);
  expect(await guest.run(c => c.redeemInvite(token, NICK, ACCESS_CODE))).toBe(roomId);
  expect(await owner.run(c => c.admitPending(roomId))).toBe(1);
  expect((await guest.run(c => c.sync(roomId))).joined).toBe(true);
  return { owner, guest, roomId, token, link };
}

// ---------------------------------------------------------------------------- the security sweep (§1.1 expectClean)

const FIXTURES: Forbidden[] = [
  forbidden('message body', BODY), forbidden('reply body', BODY2), forbidden('file name', FILE_NAME), forbidden('file body', FILE_BODY),
  forbidden('nickname', NICK), forbidden('owner nickname', OWNER_NICK), forbidden('room name', ROOM_NAME),
];
const TOKEN_RPCS = ['chat_create_invite', 'chat_peek_invite', 'chat_redeem_invite'];
const CODE_RPCS = ['chat_create_room', 'chat_redeem_invite'];

/**
 * Asserts, for every scenario: the SQL log (RPC name + arguments), a dump of every chat_* table, the
 * uploaded objects, the phone's SQLite rows and its SecureStore never contain, as text, hex or
 * base64(url), any fixture string, invite token, access code, file key, MLS signing private key or
 * wrapping key. Also: the wrapping key was stored WHEN_UNLOCKED_THIS_DEVICE_ONLY, and env.notify was
 * only ever called with (roomId, this device's token), one POST per call on the phone.
 */
async function sweep(devices: Device[], extra: Forbidden[] = [], tokens: string[] = []) {
  const secrets = [...FIXTURES, ...extra];
  for (const d of devices) {
    const dev = await d.run(c => c.ensureDevice());
    secrets.push(forbidden(`${d.name} MLS signing private key`, dev.signing.signKey));
  }
  const phones = devices.filter(d => d.kind === 'phone');
  const wraps = phones.map(d => forbidden(`${d.name} wrapping key`, wrapKeyBytes(d)));
  // F2-7: a link's fragment is `<token>.1<owner pin>`; neither part may leak, and only the token is an RPC input.
  const bareTokens = tokens.map(t => t.split('.')[0]);
  const pins = tokens.map(t => t.split('.')[1]).filter((p): p is string => !!p);
  const tokenList = [...bareTokens.map(t => forbidden('invite token', t)), ...pins.map(p => forbidden('owner pin', p))];
  const codeList = [forbidden('access code', ACCESS_CODE), forbidden('wrong access code', WRONG_CODE)];

  // 1. The SQL log. The token and the code are legitimately the *input* of a few RPCs (hashed
  //    server-side); redact them there and assert they appear nowhere else.
  const redacted = h.allSql.map(({ fn, args }) => {
    const a = { ...args };
    if ('p_token' in a) {
      expect(TOKEN_RPCS, `p_token passed to ${fn}`).toContain(fn);
      expect(String(a.p_token), `${fn} got a bare token, never the owner pin`).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
      a.p_token = '<token>';
    }
    if ('p_access_code' in a) { expect(CODE_RPCS, `p_access_code passed to ${fn}`).toContain(fn); a.p_access_code = '<code>'; }
    return { fn, args: a };
  });
  expectClean(JSON.stringify(redacted), [...secrets, ...wraps, ...tokenList, ...codeList], 'the SQL log');

  // 2. The database.
  const dump = await h.dumpDb();
  expectClean(dump, [...secrets, ...wraps, ...tokenList, ...codeList], 'the DB dump');
  for (const t of bareTokens) {
    const hashes = (await h.db.query<{ h: string }>(`select encode(token_hash, 'hex') h from public.chat_invites`)).rows.map(r => r.h);
    expect(hashes).not.toContain(hex(t));
  }
  const codeHashes = (await h.db.query<{ c: string | null }>(`select access_code_hash c from public.chat_rooms`)).rows.map(r => r.c).filter(Boolean) as string[];
  for (const c of codeHashes) expect(c).toMatch(/^\$2a\$10\$/);

  // 3. The uploaded objects (ciphertext only).
  const objs = [...h.objects.values()];
  expectClean(objs.map(latin1).join('\n'), [...secrets, ...tokenList, ...codeList].map(f => ({ ...f, forms: f.forms.filter(x => !/^[0-9a-f]+$/.test(x)) })), 'the stored objects (latin1)');
  expectClean(objs.map(hex).join('\n'), [...secrets, ...wraps], 'the stored objects (hex)');

  // 4. The phones: SQLite holds only sealed rows, SecureStore holds the wrapping key and the lock flag.
  for (const d of phones) {
    expectClean(sealedDump(d), [...secrets, ...wraps, ...tokenList, ...codeList], `${d.name} SQLite`);
    expectClean(secureDump(d), [...secrets, ...tokenList, ...codeList], `${d.name} SecureStore`);
    expect([...d.secure!.items.keys()].every(k => k === d.wrapKeyId || k === LOCK_ID)).toBe(true);
    expect(d.secure!.setOptions.get(d.wrapKeyId!)).toEqual({ keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  }

  // 5. notify(roomId, token) and nothing else; on the phone each call is one POST {room} with the bearer.
  await settle();
  for (const d of devices) {
    for (const call of d.notify.mock.calls) expect(call).toEqual([expect.stringMatching(UUID), d.token]);
    if (d.kind === 'phone') {
      expect(d.fetchCalls).toHaveLength(d.notify.mock.calls.length);
      d.fetchCalls!.forEach((f, i) => {
        expect(f.url).toBe(`${PHONE_ORIGIN}/api/chat/notify`);
        expect(f.init?.method).toBe('POST');
        expect(f.init?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${d.token}` });
        expect(JSON.parse(String(f.init?.body))).toEqual({ room: d.notify.mock.calls[i][0] });
      });
    }
  }
}

// ---------------------------------------------------------------------------- scenarios (§2.2)

const ROLES: [string, Kind, Kind][] = [
  ['web owner, phone guest', 'web', 'phone'],
  ['phone owner, web guest', 'phone', 'web'],
];

// node:sqlite (Node 22.13+) backs the phone's SQLite mock; without it there is no phone to test.
const describeInterop = hasNodeSqlite ? describe : describe.skip;

describeInterop.each(ROLES)('Web <-> mobile interop: %s', (_label, ownerKind, guestKind) => {
  it('A. room, invite, access code, admit', async () => {
    const owner = await device(ownerKind, 'owner');
    const guest = await device(guestKind, 'guest', true);

    // #1
    const roomId = await owner.run(c => c.createRoom({ kind: 'secret', ttl: 30, mode: 'on_open', lifetime: 3600, accessCode: ACCESS_CODE, name: ROOM_NAME }));
    expect(roomId).toMatch(UUID);
    // #2: the link's origin is the platform's injected origin, not read from any global.
    const { link } = await owner.run(c => c.createInvite(roomId, { expiresIn: 3600, maxUses: 1, approval: false }));
    expect(link).toMatch(new RegExp(`^${owner.origin.replace(/[./]/g, '\\$&')}/chat/join#[A-Za-z0-9_-]{40,}\\.1[A-Za-z0-9_-]{64}$`));
    const token = tokenOf(link);
    // #3
    expect(await guest.run(c => c.peekInvite(token))).toEqual({ needs_code: true, kind: 'secret' });
    // #4: a wrong code is refused; it reaches the server only as the argument to be hashed.
    const mark = h.allSql.length;
    await expect(guest.run(c => c.redeemInvite(token, NICK, WRONG_CODE))).rejects.toMatchObject({ code: 'access_code_wrong' });
    expect(h.allSql.slice(mark).filter(s => JSON.stringify(s).includes(WRONG_CODE)).map(s => s.fn)).toEqual(['chat_redeem_invite']);
    expect(await h.dumpDb()).not.toContain(WRONG_CODE);
    // #5
    expect(await guest.run(c => c.redeemInvite(token, NICK, ACCESS_CODE))).toBe(roomId);
    expect((await guest.run(c => c.sync(roomId))).joined).toBe(false);   // not admitted yet: nothing to read
    expect(await owner.run(c => c.admitPending(roomId))).toBe(1);
    expect((await guest.run(c => c.sync(roomId))).joined).toBe(true);
    expect((await guest.run(c => c.myRooms())).map(r => r.id)).toContain(roomId);
    expect((await owner.run(c => c.myRooms())).find(r => r.id === roomId)?.name).toBe(ROOM_NAME);
    // #6
    await sweep([owner, guest], [], [token]);
  }, TIMEOUT);

  it('B. text both ways, markOpened, expiry, phone storage sealed, epochs agree', async () => {
    const { owner, guest, roomId, token } = await pair(ownerKind, guestKind);

    // #7
    const mark = h.allSql.length;
    await owner.run(c => c.send(roomId, BODY, 30));
    expectClean(JSON.stringify(h.allSql.slice(mark)), [forbidden('message body', BODY)], 'the send RPCs');
    expect(await guest.run(c => c.sync(roomId))).toMatchObject({ newMessages: 1, newAlerts: 0 });
    const seen = await guest.run(c => c.messages(roomId));
    expect(bodies(seen)).toEqual([BODY]);
    expect(seen[0].mine).toBe(false);
    expect(seen[0].expiresAt).toBeNull();   // unopened: countdown not started
    // #8
    const opened = await guest.run(c => c.markOpened(roomId, seen[0]));
    expect(opened.expiresAt! - Date.now()).toBeLessThanOrEqual(31_000);
    expect(opened.expiresAt! - Date.now()).toBeGreaterThan(0);
    // #9
    await guest.run(c => c.send(roomId, BODY2, 30));
    await owner.run(c => c.sync(roomId));
    expect((await owner.run(c => c.messages(roomId))).map(m => [m.mine, m.body])).toEqual([[true, BODY], [false, BODY2]]);
    // #11
    const [so, sg] = [await stateOf(owner, roomId), await stateOf(guest, roomId)];
    expect(so && sg).toBeTruthy();
    expect(mls.epoch(so!)).toBe(mls.epoch(sg!));
    // notify: exactly one call per send, with (roomId, this device's token).
    await vi.waitFor(() => expect(owner.notify).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(guest.notify).toHaveBeenCalledTimes(1));
    expect(owner.notify).toHaveBeenCalledWith(roomId, owner.token);
    expect(guest.notify).toHaveBeenCalledWith(roomId, guest.token);
    // #10: the phone's SQLite and SecureStore hold no body, key material or nickname (in sweep).
    const phone = [owner, guest].find(d => d.kind === 'phone')!;
    expect(phone.sqlite!.dump().filter(r => r.key.startsWith(`room:${roomId}:msg:`))).toHaveLength(2);
    await sweep([owner, guest], [], [token]);
  }, TIMEOUT);

  it('C. file both ways: encrypted before upload, decrypted bytes equal', async () => {
    const { owner, guest, roomId, token } = await pair(ownerKind, guestKind);

    // #12, #16
    let reads = 0;
    const mark = h.allSql.length;
    const sent = await owner.run(c => c.sendFile(roomId, source(FILE_NAME, FILE_BODY, () => reads++), 300, false));
    expect(sent.file?.name).toBe(FILE_NAME);
    expect(reads).toBe(1);
    const key = fromB64Url(sent.file!.key);
    // #13
    const fileSecrets = [forbidden('file name', FILE_NAME), forbidden('file body', FILE_BODY), forbidden('file key', key)];
    expectClean(JSON.stringify(h.allSql.slice(mark)), fileSecrets, 'the sendFile RPCs');
    const stored = h.objects.get(sent.file!.objectPath)!;
    expect(stored.byteLength).toBeGreaterThan(Buffer.byteLength(FILE_BODY));
    expectClean(latin1(stored), fileSecrets.map(f => ({ ...f, forms: f.forms.filter(x => !/^[0-9a-f]+$/.test(x)) })), 'the stored object');
    expectClean(hex(stored), fileSecrets, 'the stored object (hex)');
    // #14
    await guest.run(c => c.sync(roomId));
    const got = (await guest.run(c => c.messages(roomId))).find(m => m.file)!;
    expect(got.file!.name).toBe(FILE_NAME);
    const opened = await guest.run(c => c.openFile(roomId, got));
    expect(text(opened)).toBe(FILE_BODY);
    expect(opened.mime).toBe('text/plain');
    // #15
    const stranger = crypto.randomUUID();
    await h.addUser({ id: stranger });
    expect(await h.asUser(stranger, `select public.chat_attachment_readable($1) ok`, [sent.file!.objectPath])).toBe(false);
    // and back the other way
    const replyBody = 'itinerary: flight BA117 seat 2A';
    const back = await guest.run(c => c.sendFile(roomId, source('itinerary.txt', replyBody), 300, false));
    await owner.run(c => c.sync(roomId));
    const gotBack = (await owner.run(c => c.messages(roomId))).find(m => m.id === back.id)!;
    expect(text(await owner.run(c => c.openFile(roomId, gotBack)))).toBe(replyBody);
    await sweep([owner, guest], [forbidden('file key', key), forbidden('reply file key', fromB64Url(back.file!.key)), forbidden('reply file', replyBody), forbidden('reply file name', 'itinerary.txt')], [token]);
  }, TIMEOUT);

  it('D. view-once file: first open works, second is gone, sender cannot open own', async () => {
    const { owner, guest, roomId, token } = await pair(ownerKind, guestKind);
    const secret = 'one look only: 7731';

    // #17
    const once = await owner.run(c => c.sendFile(roomId, source('once.txt', secret), 300, true));
    await expect(owner.run(c => c.openFile(roomId, once))).rejects.toMatchObject({ code: 'view_once_sent' });
    // #18
    await guest.run(c => c.sync(roomId));
    const msg = (await guest.run(c => c.messages(roomId))).find(m => m.file?.viewOnce)!;
    expect(text(await guest.run(c => c.openFile(roomId, msg)))).toBe(secret);
    const after = (await guest.run(c => c.messages(roomId))).find(m => m.id === msg.id)!;
    expect(after.viewed).toBe(true);
    // #19: the second open is refused locally, before any RPC; the sealed row is still there.
    const mark = h.allSql.length;
    await expect(guest.run(c => c.openFile(roomId, after))).rejects.toMatchObject({ code: 'gone' });
    expect(h.allSql.length).toBe(mark);
    if (guest.kind === 'phone') expect(guest.sqlite!.dump().some(r => r.key === `room:${roomId}:msg:${msg.id}`)).toBe(true);
    // Replaying the claim from a fresh copy is refused by the server.
    await expect(guest.run(c => c.openFile(roomId, { ...msg, viewed: false }))).rejects.toMatchObject({ code: 'gone' });
    expect(h.allSql.slice(mark).map(s => s.fn)).toEqual(['chat_claim_attachment']);
    await sweep([owner, guest], [forbidden('view-once body', secret), forbidden('view-once key', fromB64Url(once.file!.key))], [token]);
  }, TIMEOUT);

  it('E. removal: the removed device is locked out on the server and cryptographically', async () => {
    const owner = await device(ownerKind, 'owner');
    const m1 = await device(guestKind, 'm1', true);
    const m2 = await device(ownerKind, 'm2', true);
    const roomId = await owner.run(c => c.createRoom({ kind: 'quick', ttl: 60, mode: 'on_open', lifetime: 3600 }));
    const { link } = await owner.run(c => c.createInvite(roomId, { expiresIn: 3600, maxUses: 2, approval: false }));
    await m1.run(c => c.redeemInvite(tokenOf(link), 'One'));
    await m2.run(c => c.redeemInvite(tokenOf(link), 'Two'));
    expect(await owner.run(c => c.admitPending(roomId))).toBe(2);
    await m1.run(c => c.sync(roomId));
    await m2.run(c => c.sync(roomId));

    // #20
    const m1Dev = (await m1.run(c => c.ensureDevice())).id;
    const oldState = (await stateOf(m1, roomId))!;
    await owner.run(c => c.removeMember(roomId, m1Dev));
    // #21
    expect((await m1.run(c => c.sync(roomId))).removed).toBe(true);
    expect(await m1.run(c => c.keystore.keys(`room:${roomId}:`))).toEqual([]);
    if (m1.kind === 'phone') expect(m1.sqlite!.dump().filter(r => r.key.startsWith(`room:${roomId}:`))).toEqual([]);
    expect((await m1.run(c => c.myRooms())).map(r => r.id)).not.toContain(roomId);
    // #22
    await m2.run(c => c.sync(roomId));
    const mark = h.allSql.length;
    const later = 'only m2 now: code 9981';
    await owner.run(c => c.send(roomId, later, 60));
    await m2.run(c => c.sync(roomId));
    expect(bodies(await m2.run(c => c.messages(roomId)))).toContain(later);
    const refused = await m1.fake.rpc('chat_fetch', { p_room: roomId, p_device: m1Dev, p_after: 0, p_limit: 200 });
    expect(refused.error?.message).toContain('not_a_member');
    const ct = h.allSql.slice(mark).find(s => s.fn === 'chat_send')!.args.p_ciphertext as string;
    await expect(mls.receive(oldState, fromBytea(ct), m1Dev)).rejects.toThrow();
    await sweep([owner, m1, m2], [forbidden('later body', later)], [tokenOf(link)]);
  }, TIMEOUT);

  it('F. burn: the room disappears on both sides, keys gone, one burned ping, other rooms intact', async () => {
    const { owner, guest, roomId, token } = await pair(ownerKind, guestKind);
    const phone = [owner, guest].find(d => d.kind === 'phone')!;
    const other = await phone.run(c => c.createRoom({ kind: 'quick', ttl: 60, mode: 'on_open', lifetime: 3600 }));
    await owner.run(c => c.send(roomId, BODY, 30));
    await guest.run(c => c.sync(roomId));

    // #23
    await expect(guest.run(c => c.burn(roomId))).rejects.toMatchObject({ code: 'not_owner' });
    await owner.run(c => c.burn(roomId));
    expect(await owner.run(c => c.keystore.keys(`room:${roomId}:`))).toEqual([]);
    expect(await h.count(`select count(*)::int n from public.chat_messages where room_id = $1`, [roomId])).toBe(0);
    expect((await guest.run(c => c.sync(roomId))).removed).toBe(true);
    expect(await guest.run(c => c.keystore.keys(`room:${roomId}:`))).toEqual([]);
    expect((await owner.run(c => c.myRooms())).map(r => r.id)).not.toContain(roomId);
    expect((await guest.run(c => c.myRooms())).map(r => r.id)).not.toContain(roomId);
    expect(await h.count(`select count(*)::int n from realtime.messages where event = 'burned' and topic = $1`, [`room:${roomId}`])).toBe(1);
    const keys = phone.sqlite!.dump().map(r => r.key);
    expect(keys.filter(k => k.startsWith(`room:${roomId}:`))).toEqual([]);
    expect(keys.some(k => k.startsWith(`room:${other}:`))).toBe(true);   // burn is per room, not a wipe
    await sweep([owner, guest], [], [token]);
  }, TIMEOUT);

  it('G. a screenshot alert from the guest shows on the owner as a notice with an empty body', async () => {
    const { owner, guest, roomId, token } = await pair(ownerKind, guestKind);

    // #24
    const mark = h.allSql.length;
    const sent = await guest.run(c => c.sendScreenshotAlert(roomId, 30));
    expect(sent.alert).toBe('screenshot');
    expect(JSON.stringify(h.allSql.slice(mark))).not.toContain('screenshot');   // the server only sees ciphertext
    const r = await owner.run(c => c.sync(roomId));
    const got = (await owner.run(c => c.messages(roomId))).find(m => m.id === sent.id)!;
    expect(got).toMatchObject({ alert: 'screenshot', mine: false, body: '' });
    expect(got.expiresAt).not.toBeNull();   // disappears on the room timer without being opened
    // Q1 finding (b), fixed in Phase 1: a notice is counted in newAlerts, never in newMessages.
    expect(r.newAlerts).toBe(1);
    expect(r.newMessages).toBe(0);
    expect(guest.notify).not.toHaveBeenCalled();   // an alert is not a message: no push for it
    await sweep([owner, guest], [], [token]);
  }, TIMEOUT);

  it('H. nickname travels only inside the encrypted nick control message', async () => {
    const { owner, guest, roomId, token } = await pair(ownerKind, guestKind);

    // #25
    await owner.run(c => c.sync(roomId));
    const ms = await owner.run(c => c.members(roomId));
    expect(ms.find(m => m.role === 'member')!.nickname).toBe(NICK);
    expectClean(await h.dumpDb(), [forbidden('nickname', NICK)], 'the DB dump');
    const rows = (await owner.fake.rpc('chat_room_members', { p_room: roomId })).data as Record<string, unknown>[];
    expect(rows.length).toBe(2);
    for (const row of rows) expect(Object.keys(row).some(k => /nick|name|label/i.test(k))).toBe(false);
    // #26 (Phase 1 fix of Q1 finding a): the owner's nickname, given to createRoom, reaches the member
    // through the nick control message re-announced after the admit; the server never sees it.
    expect(ms.find(m => m.role === 'owner')!.nickname).toBe(OWNER_NICK);   // the owner's own copy
    const gm = await guest.run(c => c.members(roomId));
    expect(gm.find(m => m.role === 'owner')!.nickname).toBe(OWNER_NICK);
    expect(gm.find(m => m.role === 'member')!.nickname).toBe(NICK);   // its own, from the pending join
    for (const row of rows) expect(JSON.stringify(row)).not.toContain(OWNER_NICK);
    await sweep([owner, guest], [], [token]);
  }, TIMEOUT);

  it('I. sending while a sync is running keeps the encryption state consistent', async () => {
    const { owner: a, guest: b, roomId, token } = await pair(ownerKind, guestKind);

    // #27 (the pre-assigned id stands for a message already shown on screen while it is being sent)
    const b3Id = crypto.randomUUID();
    await a.run(c => Promise.all([c.send(roomId, 'a1', 300), c.send(roomId, 'a2', 300)]));
    await b.run(c => Promise.all([
      c.sync(roomId), c.send(roomId, 'b1', 300), c.sync(roomId), c.send(roomId, 'b2', 300), c.send(roomId, 'b3', 300, undefined, b3Id),
    ]));
    await a.run(c => Promise.all([c.sync(roomId), c.send(roomId, 'a3', 300), c.sync(roomId)]));
    await b.run(c => c.sync(roomId));
    await a.run(c => c.sync(roomId));
    expect(bodies(await a.run(c => c.messages(roomId))).sort()).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'b3']);
    expect(bodies(await b.run(c => c.messages(roomId))).sort()).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'b3']);
    expect((await a.run(c => c.messages(roomId))).some(m => m.id === b3Id)).toBe(true);
    expect(mls.epoch((await stateOf(a, roomId))!)).toBe(mls.epoch((await stateOf(b, roomId))!));
    await sweep([a, b], [], [token]);
  }, TIMEOUT);

  it('J. panic lock on the phone hides chats until unlocked, survives a restart, deletes nothing', async () => {
    const { owner, guest, roomId, token } = await pair(ownerKind, guestKind);
    const phone = [owner, guest].find(d => d.kind === 'phone')!;

    // #28
    phone.c.lock();
    expect(phone.c.isLocked()).toBe(true);
    await settle();
    expect(phone.secure!.items.get(LOCK_ID)).toBe('1');
    const restarted = createRnLockStore(phone.secure!.module);   // a new process over the same SecureStore
    await restarted.ready;
    expect(restarted.get()).toBe(true);
    await phone.run(c => c.unlock());
    expect(phone.c.isLocked()).toBe(false);
    if (phone.anonymous) expect(phone.passkeyListCalls).toHaveLength(0);   // a guest needs no passkey
    await settle();
    expect(phone.secure!.items.has(LOCK_ID)).toBe(false);
    expect((await phone.run(c => c.myRooms())).map(r => r.id)).toContain(roomId);
    expect(phone.sqlite!.dump().some(r => r.key === `room:${roomId}:state`)).toBe(true);
    await sweep([owner, guest], [], [token]);
  }, TIMEOUT);

  it('K. F-2: safety numbers come from the MLS tree, agree across web and phone, equal the listing-based ones, and a substituted listing is caught on both', async () => {
    const { owner, guest, roomId, token } = await pair(ownerKind, guestKind);
    const o = await owner.run(c => c.ensureDevice());
    const g = await guest.run(c => c.ensureDevice());
    const fromOwner = await owner.run(c => c.safetyNumberWith(roomId, g.id));
    const fromGuest = await guest.run(c => c.safetyNumberWith(roomId, o.id));
    expect(fromOwner).toMatch(/^\d{60}$/);
    expect(fromOwner).toBe(fromGuest);
    // Byte-identical to the pre-F-2 computation over the server's listing (honest server).
    expect(fromOwner).toBe(await mls.safetyNumber({ key: o.signing.publicKey, id: o.id }, { key: g.signing.publicKey, id: g.id }));
    for (const d of [owner, guest]) for (const m of await d.run(c => c.members(roomId))) expect(m.keyMismatch).toBe(false);
    await owner.run(c => c.markVerified(roomId, g.id));
    await guest.run(c => c.markVerified(roomId, o.id));

    const fake = await mls.newSigningKey();
    await h.db.query(`update public.chat_devices set signature_pub = $1 where id = $2`, [fake.publicKey, g.id]);
    const err = await owner.run(c => c.safetyNumberWith(roomId, g.id)).then(() => null, (e: { code?: string }) => e);
    expect(err?.code, owner.name).toBe('member_key_mismatch');
    for (const d of [owner, guest]) expect((await d.run(c => c.members(roomId))).find(m => m.deviceId === g.id)!.keyMismatch, d.name).toBe(true);
    // The guest's own listing is what the server lied about: its number for the owner still uses the real keys (F2-2).
    expect(await guest.run(c => c.safetyNumberWith(roomId, o.id))).toBe(fromGuest);
    await sweep([owner, guest], [], [token]);
  }, TIMEOUT);
});
