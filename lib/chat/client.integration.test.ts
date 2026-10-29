// Two simulated browsers running the real chat client end to end:
// real MLS (ts-mls), real SQL (migration 006 on PGlite), real encrypted keystore (one
// IndexedDB per browser). Only the network hop is replaced: supabase.rpc() calls the SQL
// function directly as that browser's user, the way PostgREST would.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
let db: PGlite;
let lastSql: { fn: string; args: Record<string, unknown> }[] = [];

function hexToBytes(s: string) { return new Uint8Array(Buffer.from(s.slice(2), 'hex')); }
function bytesToHex(b: Uint8Array) { return '\\x' + Buffer.from(b).toString('hex'); }

const objects = new Map<string, Uint8Array>();

async function asUser(userId: string, sql: string, params: unknown[]) {
  try {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId}', false); set role authenticated;`);
    return (await db.query<{ ok: boolean }>(sql, params)).rows[0]?.ok ?? false;
  } finally {
    await db.exec('reset role;');
  }
}

/** A stand-in for the browser Supabase client, bound to one user. */
function fakeSupabase(user: { id: string; is_anonymous?: boolean }) {
  return {
    auth: {
      getSession: async () => ({ data: { session: { user, access_token: 't' } } }),
      signInAnonymously: async () => ({ data: { session: { user, access_token: 't' } }, error: null }),
      passkey: { list: async () => ({ data: [] }) },
    },
    realtime: { setAuth: async () => {} },
    // Storage stand-in that applies the same checks as the bucket's RLS policies.
    storage: {
      from: (bucket: string) => ({
        async upload(name: string, body: Blob) {
          const ok = await asUser(user.id, `select public.chat_attachment_writable($1) ok`, [name]);
          if (bucket !== 'chat-attachments' || !ok || objects.has(name)) return { data: null, error: { message: 'denied' } };
          objects.set(name, new Uint8Array(await body.arrayBuffer()));
          return { data: { path: name }, error: null };
        },
        async download(name: string) {
          const ok = await asUser(user.id, `select public.chat_attachment_readable($1) ok`, [name]);
          const bytes = objects.get(name);
          if (!ok || !bytes) return { data: null, error: { message: 'not found' } };
          return { data: new Blob([bytes as BlobPart]), error: null };
        },
      }),
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
    async rpc(fn: string, args: Record<string, unknown>) {
      lastSql.push({ fn, args });
      const names = Object.keys(args);
      const params = names.map(k => {
        const v = args[k];
        if (typeof v === 'string' && v.startsWith('\\x')) return hexToBytes(v);
        if (Array.isArray(v) && typeof v[0] === 'string' && v[0].startsWith('\\x')) return v.map(x => hexToBytes(x as string));
        return v;
      });
      const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;
      const retset = (await db.query<{ s: boolean }>(`select proretset s from pg_proc where proname = $1`, [fn])).rows[0]?.s;
      try {
        await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user.id}', false); set role authenticated;`);
        const rows = (await db.query<any>(retset ? `select * from ${call}` : `select ${call} as v`, params)).rows;
        const conv = (r: any) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Uint8Array ? bytesToHex(v) : v instanceof Date ? v.toISOString() : v]));
        return { data: retset ? rows.map(conv) : conv(rows[0]).v, error: null };
      } catch (e: any) {
        return { data: null, error: { message: e.message } };
      } finally {
        await db.exec('reset role;');
      }
    },
  };
}

type Client = typeof import('./client');
type Browser = { name: string; idb: IDBFactory; c: Client };

async function browser(name: string, userId: string, anonymous = false): Promise<Browser> {
  await db.query(`insert into auth.users(id, is_anonymous) values ($1, $2) on conflict do nothing`, [userId, anonymous]);
  vi.resetModules();
  const fake = fakeSupabase({ id: userId, is_anonymous: anonymous });
  vi.doMock('../supabase', () => ({ supabase: fake }));
  const idb = new IDBFactory();
  (globalThis as any).indexedDB = idb;
  const c = await import('./client');
  return { name, idb, c };
}

/** Runs one browser's code with its own IndexedDB in place. */
async function on<T>(b: Browser, fn: (c: Client) => Promise<T>): Promise<T> {
  (globalThis as any).indexedDB = b.idb;
  return fn(b.c);
}

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  // Set after PGlite starts: a global `window` makes it think it is running in a browser.
  (globalThis as any).window = { location: { origin: 'https://onepeek.test' } };
  await db.exec(readFileSync(path.join(root, 'supabase/tests/supabase-stubs.sql'), 'utf8'));
  await db.exec(readFileSync(path.join(root, 'supabase/migrations/006_secret_chat.sql'), 'utf8'));
}, 60_000);

const tokenOf = (link: string) => link.split('#')[1];

describe('Secret Chat end to end (two browsers)', () => {
  it('owner creates a room, guest joins by invite + code, both exchange encrypted messages', async () => {
    const alice = await browser('alice', '10000000-0000-4000-8000-000000000001');
    const guest = await browser('guest', '20000000-0000-4000-8000-000000000002', true);

    const roomId = await on(alice, c => c.createRoom({ kind: 'secret', ttl: 30, mode: 'on_open', lifetime: 3600, accessCode: 'blue-river-42', name: 'Launch' }));
    const { link } = await on(alice, c => c.createInvite(roomId, { expiresIn: 3600, maxUses: 1, approval: false }));
    expect(link).toMatch(/^https:\/\/onepeek\.test\/chat\/join#[A-Za-z0-9_-]{40,}$/);

    // The invite token never appears in a server-side lookup other than as an argument to be hashed.
    expect(await on(guest, c => c.peekInvite(tokenOf(link)))).toEqual({ needs_code: true, kind: 'secret' });
    await expect(on(guest, c => c.redeemInvite(tokenOf(link), 'Sam', 'wrong-code'))).rejects.toMatchObject({ code: 'access_code_wrong' });
    const joined = await on(guest, c => c.redeemInvite(tokenOf(link), 'Sam', 'blue-river-42'));
    expect(joined).toBe(roomId);

    // Before being admitted the guest can read nothing.
    expect((await on(guest, c => c.sync(roomId))).joined).toBe(false);

    expect(await on(alice, c => c.admitPending(roomId))).toBe(1);
    const g1 = await on(guest, c => c.sync(roomId));
    expect(g1.joined).toBe(true);

    lastSql = [];
    await on(alice, c => c.send(roomId, 'The launch code is 4471', 30));
    // What went over the wire was ciphertext only.
    const wire = JSON.stringify(lastSql);
    expect(wire).not.toContain('launch code');
    expect(wire).not.toContain(Buffer.from('launch code').toString('hex'));

    await on(guest, c => c.sync(roomId));
    const seen = await on(guest, c => c.messages(roomId));
    expect(seen.map(m => m.body)).toEqual(['The launch code is 4471']);
    expect(seen[0].expiresAt).toBeNull();  // unopened: countdown not started

    const opened = await on(guest, c => c.markOpened(roomId, seen[0]));
    expect(opened.expiresAt! - Date.now()).toBeLessThanOrEqual(31_000);

    await on(guest, c => c.send(roomId, 'Got it', 30));
    await on(alice, c => c.sync(roomId));
    const aliceView = await on(alice, c => c.messages(roomId));
    expect(aliceView.map(m => [m.mine, m.body])).toEqual([[true, 'The launch code is 4471'], [false, 'Got it']]);

    // Alice learns the guest's nickname from an encrypted control message, not from the server.
    const ms = await on(alice, c => c.members(roomId));
    expect(ms.find(m => m.role === 'member')!.nickname).toBe('Sam');
    const dbNick = (await db.query(`select count(*)::int n from public.chat_members where key_package::text like '%' || encode('Sam'::bytea, 'hex') || '%'`)).rows[0] as any;
    expect(dbNick.n).toBe(0);

    // The database holds no plaintext anywhere.
    const dump = (await db.query<any>(`select string_agg(encode(ciphertext, 'escape'), '') d from public.chat_messages`)).rows[0].d ?? '';
    expect(dump).not.toContain('launch code');
    expect(dump).not.toContain('Got it');
  });

  it('safety numbers match on both sides and flag a changed key', async () => {
    const a = await browser('a', '30000000-0000-4000-8000-000000000003');
    const b = await browser('b', '40000000-0000-4000-8000-000000000004');
    const roomId = await on(a, c => c.createRoom({ kind: 'business', ttl: 3600, mode: 'on_send', lifetime: 3600 }));
    const { link } = await on(a, c => c.createInvite(roomId, { expiresIn: 3600, maxUses: 1, approval: true }));
    await on(b, c => c.redeemInvite(tokenOf(link), 'Bo'));
    await on(a, c => c.admitPending(roomId));
    await on(b, c => c.sync(roomId));
    const bDev = (await on(b, c => c.ensureDevice())).id;
    const aDev = (await on(a, c => c.ensureDevice())).id;
    const fromA = await on(a, c => c.safetyNumberWith(roomId, bDev));
    const fromB = await on(b, c => c.safetyNumberWith(roomId, aDev));
    expect(fromA).toMatch(/^\d{60}$/);
    expect(fromA).toBe(fromB);
    await on(a, c => c.markVerified(roomId, bDev));
    let mb = (await on(a, c => c.members(roomId))).find(m => m.deviceId === bDev)!;
    expect(a.c.keyChanged(mb)).toBe(false);
    // Simulate a substituted key on the server.
    await db.query(`update public.chat_devices set signature_pub = decode(repeat('ee', 32), 'hex') where id = $1`, [bDev]);
    mb = (await on(a, c => c.members(roomId))).find(m => m.deviceId === bDev)!;
    expect(a.c.keyChanged(mb)).toBe(true);
  });

  it('removed members are locked out; Burn Chat wipes server and local state', async () => {
    const owner = await browser('owner', '50000000-0000-4000-8000-000000000005');
    const m1 = await browser('m1', '60000000-0000-4000-8000-000000000006');
    const m2 = await browser('m2', '70000000-0000-4000-8000-000000000007');
    const roomId = await on(owner, c => c.createRoom({ kind: 'quick', ttl: 60, mode: 'on_open', lifetime: 3600 }));
    const { link } = await on(owner, c => c.createInvite(roomId, { expiresIn: 3600, maxUses: 2, approval: false }));
    await on(m1, c => c.redeemInvite(tokenOf(link), 'One'));
    await on(m2, c => c.redeemInvite(tokenOf(link), 'Two'));
    expect(await on(owner, c => c.admitPending(roomId))).toBe(2);
    await on(m1, c => c.sync(roomId));
    await on(m2, c => c.sync(roomId));

    const m1Dev = (await on(m1, c => c.ensureDevice())).id;
    await on(owner, c => c.removeMember(roomId, m1Dev));
    const r1 = await on(m1, c => c.sync(roomId));
    expect(r1.removed).toBe(true);
    expect(await on(m1, c => c.keystore.keys(`room:${roomId}:`))).toEqual([]);

    await on(m2, c => c.sync(roomId));
    await on(owner, c => c.send(roomId, 'only m2 now', 60));
    await on(m2, c => c.sync(roomId));
    expect((await on(m2, c => c.messages(roomId))).map(m => m.body)).toContain('only m2 now');

    await expect(on(m2, c => c.burn(roomId))).rejects.toMatchObject({ code: 'not_owner' });
    await on(owner, c => c.burn(roomId));
    expect(await on(owner, c => c.keystore.keys(`room:${roomId}:`))).toEqual([]);
    expect((await db.query<any>(`select count(*)::int n from public.chat_messages where room_id = $1`, [roomId])).rows[0].n).toBe(0);
    expect((await on(m2, c => c.sync(roomId))).removed).toBe(true);
    expect(await on(m2, c => c.keystore.keys(`room:${roomId}:`))).toEqual([]);
  });

  it('files are encrypted before upload, and view-once files open only once', async () => {
    const a = await browser('fa', 'a0000000-0000-4000-8000-00000000000a');
    const b = await browser('fb', 'b0000000-0000-4000-8000-00000000000b');
    await db.query(`insert into auth.users(id) values ('c0000000-0000-4000-8000-00000000000c') on conflict do nothing`);
    const roomId = await on(a, c => c.createRoom({ kind: 'quick', ttl: 300, mode: 'on_open', lifetime: 3600 }));
    const { link } = await on(a, c => c.createInvite(roomId, { expiresIn: 3600, maxUses: 1, approval: false }));
    await on(b, c => c.redeemInvite(tokenOf(link), 'Bea'));
    await on(a, c => c.admitPending(roomId));
    await on(b, c => c.sync(roomId));

    const secret = 'passport scan: P1234567';
    const file = new File([secret], 'passport.txt', { type: 'text/plain' });
    lastSql = [];
    const sent = await on(a, c => c.sendFile(roomId, file, 300, false));
    expect(sent.file?.name).toBe('passport.txt');
    // Neither the RPC calls nor the stored object contain the file, its name or its key.
    const wire = JSON.stringify(lastSql);
    expect(wire).not.toContain('passport');
    expect(wire).not.toContain(sent.file!.key);
    const stored = Buffer.from(objects.get(sent.file!.objectPath)!).toString('latin1');
    expect(stored).not.toContain('passport');

    await on(b, c => c.sync(roomId));
    const got = (await on(b, c => c.messages(roomId))).find(m => m.file)!;
    expect(got.file!.name).toBe('passport.txt');
    const blob = await on(b, c => c.openFile(roomId, got));
    expect(await blob.text()).toBe(secret);
    // Not a member: the storage policy refuses the download.
    expect(await asUser('c0000000-0000-4000-8000-00000000000c', `select public.chat_attachment_readable($1) ok`, [sent.file!.objectPath])).toBe(false);

    // View once: the recipient can open it once; the sender can't use up the view.
    const once = await on(a, c => c.sendFile(roomId, new File(['one look'], 'once.txt', { type: 'text/plain' }), 300, true));
    await expect(on(a, c => c.openFile(roomId, once))).rejects.toMatchObject({ code: 'view_once_sent' });
    await on(b, c => c.sync(roomId));
    const onceMsg = (await on(b, c => c.messages(roomId))).find(m => m.file?.viewOnce)!;
    expect(await (await on(b, c => c.openFile(roomId, onceMsg))).text()).toBe('one look');
    const after = (await on(b, c => c.messages(roomId))).find(m => m.id === onceMsg.id)!;
    expect(after.viewed).toBe(true);
    await expect(on(b, c => c.openFile(roomId, after))).rejects.toMatchObject({ code: 'gone' });
    // Even replaying the claim from a fresh copy is refused by the server.
    await expect(on(b, c => c.openFile(roomId, { ...onceMsg, viewed: false }))).rejects.toMatchObject({ code: 'gone' });

    await expect(on(a, c => c.sendFile(roomId, new File([], 'empty.txt'), 300, false))).rejects.toMatchObject({ code: 'empty_file' });
  });

  it('a duplicate send with the same id is stored once', async () => {
    const a = await browser('dup', '80000000-0000-4000-8000-000000000008');
    const roomId = await on(a, c => c.createRoom({ kind: 'quick', ttl: 60, mode: 'on_open', lifetime: 3600 }));
    const dev = await on(a, c => c.ensureDevice());
    const id = crypto.randomUUID();
    const args = { p_room: roomId, p_device: dev.id, p_id: id, p_kind: 'app', p_epoch: 0, p_ciphertext: '\\x00ff', p_ttl_s: 60 };
    const fake = fakeSupabase({ id: '80000000-0000-4000-8000-000000000008' });
    const s1 = await fake.rpc('chat_send', args);
    const s2 = await fake.rpc('chat_send', args);
    expect(s1.data).toBe(s2.data);
    expect((await db.query<any>(`select count(*)::int n from public.chat_messages where id = $1`, [id])).rows[0].n).toBe(1);
  });

  it('Panic lock hides chats until unlocked, without deleting rooms', async () => {
    const a = await browser('panic', '90000000-0000-4000-8000-000000000009');
    (globalThis as any).localStorage = new Map() as any;
    (globalThis as any).localStorage.getItem = function (k: string) { return Map.prototype.get.call(this, k) ?? null; };
    (globalThis as any).localStorage.setItem = function (k: string, v: string) { Map.prototype.set.call(this, k, v); };
    (globalThis as any).localStorage.removeItem = function (k: string) { Map.prototype.delete.call(this, k); };
    const roomId = await on(a, c => c.createRoom({ kind: 'quick', ttl: 60, mode: 'on_open', lifetime: 3600 }));
    a.c.lock();
    expect(a.c.isLocked()).toBe(true);
    await on(a, c => c.unlock());
    expect(a.c.isLocked()).toBe(false);
    expect((await on(a, c => c.myRooms())).map(r => r.id)).toContain(roomId);
  });
});
