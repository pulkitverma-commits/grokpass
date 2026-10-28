// Tests migration 006 against real Postgres (PGlite) with stubbed Supabase schemas.
// Each test calls the RPCs exactly as a signed-in browser would: role `authenticated`
// with auth.uid() set. Expiry is tested by moving stored timestamps into the past.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const stubs = readFileSync(path.join(here, 'supabase-stubs.sql'), 'utf8');
const migration = readFileSync(path.join(here, '../migrations/006_secret_chat.sql'), 'utf8');

const ALICE = '00000000-0000-4000-8000-00000000000a';
const BOB = '00000000-0000-4000-8000-00000000000b';
const EVE = '00000000-0000-4000-8000-00000000000e';
const KEY = new Uint8Array(32).fill(0xab);   // stands in for a signature public key
const KP = new Uint8Array(80).fill(0xcd);    // stands in for an MLS KeyPackage
const CT = (s: string) => new Uint8Array(Buffer.from(s));

let db: PGlite;

async function as<T = any>(user: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role ${user ? 'authenticated' : 'anon'};`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}
const one = async <T = any>(user: string | null, sql: string, params: unknown[] = []) => (await as<T>(user, sql, params))[0];
const sys = (sql: string, params: unknown[] = []) => db.query<any>(sql, params);

async function device(user: string) {
  return (await one(user, `select public.chat_register_device($1::bytea, 'test') as id`, [KEY])).id as string;
}

async function roomWithBob(opts: { mode?: 'on_open' | 'on_send'; code?: string | null } = {}) {
  const aDev = await device(ALICE);
  const bDev = await device(BOB);
  const room = (await one(ALICE, `select public.chat_create_room($1, 'quick', 60, $2, 86400, $3) as id`,
    [aDev, opts.mode ?? 'on_open', opts.code ?? null])).id as string;
  const token = crypto.randomUUID() + crypto.randomUUID();
  await as(ALICE, `select public.chat_create_invite($1, $2, 3600, 1, false)`, [room, token]);
  const red = await one(BOB, `select * from public.chat_redeem_invite($1, $2, $3::bytea, $4)`, [token, bDev, KP, opts.code ?? null]);
  expect(red.error).toBeNull();
  // Alice's client commits the MLS add and activates Bob in the same call.
  await as(ALICE, `select public.chat_send($1, $2, $3, 'commit', 0, $4::bytea, null, null, array[$5::uuid])`,
    [room, aDev, crypto.randomUUID(), CT('commit-add-bob'), bDev]);
  return { room, aDev, bDev, token };
}

const send = (user: string, room: string, dev: string, id = crypto.randomUUID(), body = 'secret') =>
  one(user, `select public.chat_send($1, $2, $3, 'app', 1, $4::bytea) as seq`, [room, dev, id, CT(body)]);
const fetchMsgs = (user: string, room: string, dev: string, after = 0) =>
  as(user, `select * from public.chat_fetch($1, $2, $3)`, [room, dev, after]);

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(stubs);
  await db.exec(migration);
  await sys(`insert into auth.users(id) values ($1), ($2), ($3)`, [ALICE, BOB, EVE]);
}, 60_000);

beforeEach(async () => {
  await sys(`truncate public.chat_rooms, public.chat_devices, public.chat_rate_limits, public.chat_security_events,
             public.chat_storage_trash, realtime.messages cascade`);
});

describe('migration 006: access control', () => {
  it('denies direct table access to signed-in users and anon', async () => {
    for (const t of ['chat_messages', 'chat_rooms', 'chat_invites', 'chat_devices', 'chat_members']) {
      await expect(as(ALICE, `select * from public.${t}`)).rejects.toThrow(/permission denied/);
      await expect(as(null, `select * from public.${t}`)).rejects.toThrow(/permission denied/);
    }
  });

  it('denies anon every chat RPC', async () => {
    await expect(as(null, `select public.chat_my_rooms()`)).rejects.toThrow(/permission denied/);
    await expect(as(null, `select public.chat_reap()`)).rejects.toThrow(/permission denied/);
  });

  it('keeps maintenance functions away from signed-in users', async () => {
    await expect(as(ALICE, `select public.chat_reap()`)).rejects.toThrow(/permission denied/);
  });

  it('rejects using someone else\'s device', async () => {
    const aDev = await device(ALICE);
    await expect(as(EVE, `select public.chat_create_room($1, 'quick')`, [aDev])).rejects.toThrow(/device_not_found/);
  });

  it('blocks a non-member from reading or sending (cross-account)', async () => {
    const { room } = await roomWithBob();
    const eDev = await device(EVE);
    await expect(fetchMsgs(EVE, room, eDev)).rejects.toThrow(/not_a_member/);
    await expect(send(EVE, room, eDev)).rejects.toThrow(/not_a_member/);
    await expect(as(EVE, `select * from public.chat_room_members($1)`, [room])).rejects.toThrow(/not_a_member/);
    await expect(as(EVE, `select public.chat_burn($1)`, [room])).rejects.toThrow(/not_owner/);
  });

  it('lets a revoked device read nothing', async () => {
    const { room, aDev, bDev } = await roomWithBob();
    await send(ALICE, room, aDev);
    await as(BOB, `select public.chat_revoke_device($1)`, [bDev]);
    await expect(fetchMsgs(BOB, room, bDev)).rejects.toThrow(/device_not_found/);
  });

  it('denies admin stats to non-admins and allows admins (aggregates only)', async () => {
    await expect(as(ALICE, `select public.chat_admin_stats()`)).rejects.toThrow(/forbidden/);
    await sys(`insert into public.chat_admins values ($1)`, [ALICE]);
    const s = (await one(ALICE, `select public.chat_admin_stats() as s`)).s;
    expect(Object.keys(s).sort()).toEqual(['active_rooms', 'attachments_bytes', 'messages_24h', 'messages_held', 'rate_limited_24h', 'security_24h', 'storage_trash']);
    await sys(`delete from public.chat_admins`);
  });
});

describe('migration 006: invites and access codes', () => {
  it('stores neither the invite token nor the access code in plaintext', async () => {
    const { token } = await roomWithBob({ code: 'correct-horse-9' });
    const inv = (await sys(`select token_hash::text t from public.chat_invites`)).rows[0];
    const room = (await sys(`select access_code_hash h from public.chat_rooms`)).rows[0];
    expect(inv.t).not.toContain(Buffer.from(token).toString('hex'));
    expect(room.h).toMatch(/^\$2a\$10\$/);
    expect(room.h).not.toContain('correct-horse');
  });

  it('refuses a one-time invite the second time', async () => {
    const { token } = await roomWithBob();
    const eDev = await device(EVE);
    const r = await one(EVE, `select * from public.chat_redeem_invite($1, $2, $3::bytea)`, [token, eDev, KP]);
    expect(r).toMatchObject({ joined_room: null, error: 'invite_invalid' });
  });

  it('refuses expired and revoked invites, and unknown tokens look the same', async () => {
    const aDev = await device(ALICE);
    const eDev = await device(EVE);
    const room = (await one(ALICE, `select public.chat_create_room($1, 'quick') as id`, [aDev])).id;
    const t1 = 'x'.repeat(40), t2 = 'y'.repeat(40);
    await as(ALICE, `select public.chat_create_invite($1, $2, 3600, 5)`, [room, t1]);
    const inv2 = (await one(ALICE, `select public.chat_create_invite($1, $2, 3600, 5) as id`, [room, t2])).id;
    await sys(`update public.chat_invites set expires_at = now() - interval '1 second' where token_hash = extensions.digest($1::text, 'sha256')`, [t1]);
    await as(ALICE, `select public.chat_revoke_invite($1)`, [inv2]);
    for (const t of [t1, t2, 'z'.repeat(40)]) {
      expect((await one(EVE, `select * from public.chat_redeem_invite($1, $2, $3::bytea)`, [t, eDev, KP])).error).toBe('invite_invalid');
      expect(await as(EVE, `select * from public.chat_peek_invite($1)`, [t])).toEqual([]);
    }
  });

  it('checks the access code and rate-limits guessing', async () => {
    const aDev = await device(ALICE);
    const eDev = await device(EVE);
    const room = (await one(ALICE, `select public.chat_create_room($1, 'secret', 30, 'on_open', 86400, 'right-code-1') as id`, [aDev])).id;
    const token = 'k'.repeat(48);
    await as(ALICE, `select public.chat_create_invite($1, $2, 3600, 10)`, [room, token]);
    expect((await one(EVE, `select * from public.chat_peek_invite($1)`, [token])).needs_code).toBe(true);
    const results: string[] = [];
    for (let i = 0; i < 7; i++) {
      results.push((await one(EVE, `select * from public.chat_redeem_invite($1, $2, $3::bytea, $4)`, [token, eDev, KP, `wrong-${i}`])).error);
    }
    expect(results.slice(0, 5)).toEqual(Array(5).fill('access_code_wrong'));
    expect(results.slice(5)).toEqual(['rate_limited', 'rate_limited']);
    // Even the right code is refused while the limit is in force.
    expect((await one(EVE, `select * from public.chat_redeem_invite($1, $2, $3::bytea, 'right-code-1')`, [token, eDev, KP])).error).toBe('rate_limited');
    const logged = (await sys(`select count(*)::int n from public.chat_security_events where kind = 'access_code_wrong'`)).rows[0].n;
    expect(logged).toBe(5);
  });

  it('admits with the right code, and the member is pending until a commit activates it', async () => {
    const aDev = await device(ALICE);
    const bDev = await device(BOB);
    const room = (await one(ALICE, `select public.chat_create_room($1, 'secret', 30, 'on_open', 86400, 'right-code-1') as id`, [aDev])).id;
    const token = 'q'.repeat(48);
    await as(ALICE, `select public.chat_create_invite($1, $2)`, [room, token]);
    const r = await one(BOB, `select * from public.chat_redeem_invite($1, $2, $3::bytea, 'right-code-1')`, [token, bDev, KP]);
    expect(r).toMatchObject({ joined_room: room, error: null });
    const members = await as(ALICE, `select device_id, state from public.chat_room_members($1)`, [room]);
    expect(members.find((m: any) => m.device_id === bDev).state).toBe('pending');
    await expect(send(BOB, room, bDev)).rejects.toThrow(/not_a_member/);
  });
});

describe('migration 006: delivery', () => {
  it('orders messages and treats a retried id as the same message', async () => {
    const { room, aDev, bDev } = await roomWithBob();
    const id = crypto.randomUUID();
    const s1 = (await send(ALICE, room, aDev, id)).seq;
    const again = (await send(ALICE, room, aDev, id)).seq;
    const s2 = (await send(ALICE, room, aDev)).seq;
    expect(again).toBe(s1);
    expect(Number(s2)).toBe(Number(s1) + 1);
    const got = await fetchMsgs(BOB, room, bDev);
    expect(got.filter((m: any) => m.kind === 'app').map((m: any) => Number(m.seq))).toEqual([Number(s1), Number(s2)]);
  });

  it('serves an offline recipient everything after its last seen sequence', async () => {
    const { room, aDev, bDev } = await roomWithBob();
    const first = Number((await send(ALICE, room, aDev)).seq);
    await send(ALICE, room, aDev);
    await send(ALICE, room, aDev);
    const later = await fetchMsgs(BOB, room, bDev, first);
    expect(later.map((m: any) => Number(m.seq))).toEqual([first + 1, first + 2]);
  });

  it('pings the room with ids only, never ciphertext', async () => {
    const { room, aDev } = await roomWithBob();
    await send(ALICE, room, aDev, crypto.randomUUID(), 'TOP-SECRET-BODY');
    const pings = (await sys(`select topic, event, payload::text p from realtime.messages`)).rows;
    expect(pings.length).toBeGreaterThan(0);
    for (const p of pings) {
      expect(p.topic).toBe('room:' + room);
      expect(p.p).not.toMatch(/TOP-SECRET|5345435245/i);
    }
  });

  it('only lets members subscribe to a room channel', async () => {
    const { room } = await roomWithBob();
    await sys(`select realtime.send('{}'::jsonb, 'x', $1, true)`, ['room:' + room]);
    const visible = async (user: string) => {
      await db.exec(`select set_config('realtime.topic', 'room:${room}', false)`);
      return (await as(user, `select count(*)::int n from realtime.messages`))[0].n;
    };
    expect(await visible(BOB)).toBeGreaterThan(0);
    expect(await visible(EVE)).toBe(0);
  });
});

describe('migration 006: expiry is enforced by the database', () => {
  it('expire-after-open: the countdown starts on first open and a second open does not extend it', async () => {
    const { room, aDev, bDev } = await roomWithBob({ mode: 'on_open' });
    const id = crypto.randomUUID();
    await send(ALICE, room, aDev, id);
    const before = (await fetchMsgs(BOB, room, bDev)).find((m: any) => m.id === id);
    expect(before.expires_at).toBeNull();
    const first = (await one(BOB, `select public.chat_mark_opened($1, $2) as e`, [id, bDev])).e as Date;
    expect(first.getTime() - Date.now()).toBeLessThanOrEqual(61_000);
    const second = (await one(BOB, `select public.chat_mark_opened($1, $2) as e`, [id, bDev])).e as Date;
    expect(second.getTime()).toBe(first.getTime());
    await sys(`update public.chat_deliveries set expires_at = now() - interval '1 second' where message_id = $1`, [id]);
    expect((await fetchMsgs(BOB, room, bDev)).find((m: any) => m.id === id)).toBeUndefined();
    await sys(`select public.chat_reap()`);
    expect((await sys(`select count(*)::int n from public.chat_messages where id = $1`, [id])).rows[0].n).toBe(0);
  });

  it('expire-after-send: the countdown starts at send time', async () => {
    const { room, aDev, bDev } = await roomWithBob({ mode: 'on_send' });
    const id = crypto.randomUUID();
    await send(ALICE, room, aDev, id);
    const m = (await fetchMsgs(BOB, room, bDev)).find((x: any) => x.id === id);
    expect(m.expires_at).not.toBeNull();
  });

  it('an unopened message disappears at its absolute limit', async () => {
    const { room, aDev, bDev } = await roomWithBob({ mode: 'on_open' });
    const id = crypto.randomUUID();
    await send(ALICE, room, aDev, id);
    const hard = (await sys(`select extract(epoch from hard_expires_at - created_at)::int s from public.chat_messages where id = $1`, [id])).rows[0].s;
    expect(hard).toBeLessThanOrEqual(7 * 86400);
    await sys(`update public.chat_messages set hard_expires_at = now() - interval '1 second' where id = $1`, [id]);
    expect((await fetchMsgs(BOB, room, bDev)).find((x: any) => x.id === id)).toBeUndefined();
    await sys(`select public.chat_reap()`);
    expect((await sys(`select count(*)::int n from public.chat_messages where id = $1`, [id])).rows[0].n).toBe(0);
  });

  it('an expired room is closed to everyone and reaped', async () => {
    const { room, aDev, bDev } = await roomWithBob();
    await sys(`update public.chat_rooms set expires_at = now() - interval '1 second' where id = $1`, [room]);
    await expect(send(ALICE, room, aDev)).rejects.toThrow(/room_closed/);
    await expect(fetchMsgs(BOB, room, bDev)).rejects.toThrow(/not_a_member/);
    await sys(`select public.chat_reap()`);
    expect((await sys(`select count(*)::int n from public.chat_rooms where id = $1`, [room])).rows[0].n).toBe(0);
  });

  it('reaping twice is harmless', async () => {
    await roomWithBob();
    await sys(`select public.chat_reap()`);
    const again = (await sys(`select public.chat_reap() r`)).rows[0].r;
    expect(again).toEqual({ deliveries: 0, messages: 0, attachments: 0, rooms: 0 });
  });
});

describe('migration 006: leave, burn, attachments', () => {
  it('Burn Chat: owner only; removes content, invites and members; notifies the room', async () => {
    const { room, aDev, bDev } = await roomWithBob();
    await send(ALICE, room, aDev);
    const attId = crypto.randomUUID();
    await as(ALICE, `select public.chat_register_attachment($1, $2, $3, 1000, false, 3600)`, [room, aDev, attId]);
    await expect(as(BOB, `select public.chat_burn($1)`, [room])).rejects.toThrow(/not_owner/);
    await as(ALICE, `select public.chat_burn($1)`, [room]);
    expect((await sys(`select count(*)::int n from public.chat_messages where room_id = $1`, [room])).rows[0].n).toBe(0);
    expect((await sys(`select count(*)::int n from public.chat_invites where room_id = $1 and revoked_at is null`, [room])).rows[0].n).toBe(0);
    expect((await sys(`select count(*)::int n from public.chat_members where room_id = $1 and state <> 'removed'`, [room])).rows[0].n).toBe(0);
    expect((await sys(`select object_path from public.chat_storage_trash`)).rows.map((r: any) => r.object_path)).toEqual([`${room}/${attId}`]);
    expect((await sys(`select count(*)::int n from realtime.messages where event = 'burned'`)).rows[0].n).toBe(1);
    await expect(fetchMsgs(BOB, room, bDev)).rejects.toThrow(/not_a_member/);
    await expect(send(ALICE, room, aDev)).rejects.toThrow(/not_a_member|room_closed/);
  });

  it('leaving removes the member and their pending deliveries', async () => {
    const { room, aDev, bDev } = await roomWithBob();
    await send(ALICE, room, aDev);
    await as(BOB, `select public.chat_leave($1, $2)`, [room, bDev]);
    await expect(fetchMsgs(BOB, room, bDev)).rejects.toThrow(/not_a_member/);
    expect((await sys(`select count(*)::int n from public.chat_deliveries where device_id = $1`, [bDev])).rows[0].n).toBe(0);
  });

  it('a removed member cannot be re-activated by a non-owner commit', async () => {
    const { room, aDev, bDev } = await roomWithBob();
    const cDev = await device(EVE);
    await expect(as(BOB, `select public.chat_send($1, $2, $3, 'commit', 1, $4::bytea, null, null, null, array[$5::uuid])`,
      [room, bDev, crypto.randomUUID(), CT('remove'), aDev])).rejects.toThrow(/not_owner/);
    void cDev;
  });

  it('view-once attachments allow one claim window, then deny access', async () => {
    const { room, aDev, bDev } = await roomWithBob();
    const attId = crypto.randomUUID();
    const p = (await one(ALICE, `select public.chat_register_attachment($1, $2, $3, 1000, true, 60) as p`, [room, aDev, attId])).p;
    expect(p).toBe(`${room}/${attId}`);
    expect((await one(BOB, `select public.chat_attachment_readable($1) as ok`, [p])).ok).toBe(true);
    await as(BOB, `select public.chat_claim_attachment($1)`, [attId]);
    await sys(`update public.chat_attachments set revoked_at = now() - interval '1 second' where id = $1`, [attId]);
    expect((await one(BOB, `select public.chat_attachment_readable($1) as ok`, [p])).ok).toBe(false);
    await expect(as(BOB, `select public.chat_claim_attachment($1)`, [attId])).rejects.toThrow(/gone/);
    void bDev;
  });

  it('a non-member cannot read an attachment', async () => {
    const { room, aDev } = await roomWithBob();
    const attId = crypto.randomUUID();
    const p = (await one(ALICE, `select public.chat_register_attachment($1, $2, $3, 1000, false, 60) as p`, [room, aDev, attId])).p;
    expect((await one(EVE, `select public.chat_attachment_readable($1) as ok`, [p])).ok).toBe(false);
  });
});
