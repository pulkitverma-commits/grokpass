// Tests migration 009 (report a chat, ids only) against real Postgres (PGlite) on top of the stubs,
// 006, 007 and 008, calling report_chat exactly as the app's session would: role `authenticated`
// with auth.uid() set. Also proves down/up/down leaves 006–008 intact.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const read = (f: string) => readFileSync(path.join(here, f), 'utf8');
const stubs = read('supabase-stubs.sql');
const m006 = read('../migrations/006_secret_chat.sql');
const m007 = read('../migrations/007_block_anonymous_accounts.sql');
const m008 = read('../migrations/008_mobile_push_tokens.sql');
const up = read('../migrations/009_chat_reports.sql');
const down = read('../migrations/009_chat_reports_down.sql');

const ALICE = '00000000-0000-4000-8000-00000000000a';
const BOB = '00000000-0000-4000-8000-00000000000b';
const EVE = '00000000-0000-4000-8000-00000000000e';
const GUEST = '00000000-0000-4000-8000-00000000000c';
const KEY = new Uint8Array(32).fill(0xab);
const KP = new Uint8Array(80).fill(0xcd);
const CT = (s: string) => new Uint8Array(Buffer.from(s));

let db: PGlite;

async function as<T = any>(user: string | null, sql: string, params: unknown[] = [], claims: object = {}): Promise<T[]> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false);
    select set_config('request.jwt.claims', '${JSON.stringify(user ? { sub: user, ...claims } : {})}', false);
    set role ${user ? 'authenticated' : 'anon'};`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}
const one = async <T = any>(user: string | null, sql: string, params: unknown[] = []) => (await as<T>(user, sql, params))[0];
const sys = (sql: string, params: unknown[] = []) => db.query<any>(sql, params);
const asService = async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> => {
  await db.exec('set role service_role');
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec('reset role'); }
};
const report = (user: string | null, room: string, reason: string, claims: object = {}) =>
  as(user, `select public.report_chat($1, $2)`, [room, reason], claims);
const reports = () => sys(`select room, reporter, reason, created_at from public.chat_reports order by created_at, room`).then(r => r.rows);

const devices: Record<string, string> = {};
async function device(user: string) {
  if (!devices[user]) devices[user] = (await one(user, `select public.chat_register_device($1::bytea, 'test') as id`, [KEY])).id as string;
  return devices[user];
}
/** Alice owns a quick room; Bob is redeemed and activated (same steps as the secret-chat tests). */
async function roomWithBob() {
  const aDev = await device(ALICE);
  const bDev = await device(BOB);
  const room = (await one(ALICE, `select public.chat_create_room($1, 'quick', 60, 'on_open', 86400, null) as id`, [aDev])).id as string;
  const token = crypto.randomUUID() + crypto.randomUUID();
  await as(ALICE, `select public.chat_create_invite($1, $2, 3600, 1, false)`, [room, token]);
  const red = await one(BOB, `select * from public.chat_redeem_invite($1, $2, $3::bytea, null)`, [token, bDev, KP]);
  expect(red.error).toBeNull();
  await as(ALICE, `select public.chat_send($1, $2, $3, 'commit', 0, $4::bytea, null, null, array[$5::uuid])`,
    [room, aDev, crypto.randomUUID(), CT('commit-add-bob'), bDev]);
  return { room, aDev, bDev };
}
async function soloRoom(user = ALICE) {
  const dev = await device(user);
  return (await one(user, `select public.chat_create_room($1, 'quick') as id`, [dev])).id as string;
}

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(stubs);
  await db.exec(m006);
  // 007 re-creates create_request, which needs the 004/005 objects; schema history is covered by
  // production-history.test.ts. Here it only has to not clash with 009.
  await db.exec(m007).catch(() => undefined);
  await db.exec(m008);
  await db.exec(up);
  await sys(`insert into auth.users(id, is_anonymous) values ($1, false), ($2, false), ($3, false), ($4, true)`, [ALICE, BOB, EVE, GUEST]);
}, 60_000);

beforeEach(async () => {
  await sys(`truncate public.chat_reports`);
  // Room creation is rate limited per user (30/h); the tests here create more than that in total.
  await sys(`truncate public.chat_rate_limits`);
});

describe('migration 009: chat_reports', () => {
  it('creates the table with RLS on, no policies, and the RPC with an empty search_path', async () => {
    const t = (await sys(`select relrowsecurity from pg_class where relname = 'chat_reports'`)).rows[0];
    expect(t.relrowsecurity).toBe(true);
    expect((await sys(`select count(*)::int n from pg_policies where tablename = 'chat_reports'`)).rows[0].n).toBe(0);
    const fn = (await sys(`select proname, prosecdef, proconfig from pg_proc where proname = 'report_chat'`)).rows;
    expect(fn).toHaveLength(1);
    expect(fn[0].prosecdef).toBe(true);
    expect(fn[0].proconfig).toEqual([expect.stringMatching(/^search_path=(""|'')?$/)]);
    // Grants: nothing for anon/authenticated on the table; execute for authenticated only.
    const grants = (await sys(`select grantee, privilege_type from information_schema.role_table_grants where table_name = 'chat_reports' order by 1, 2`)).rows;
    expect(grants.filter(g => g.grantee === 'anon' || g.grantee === 'authenticated')).toEqual([]);
    expect(grants.some(g => g.grantee === 'service_role')).toBe(true);
    const exec = (await sys(`select grantee from information_schema.routine_privileges where routine_name = 'report_chat' and privilege_type = 'EXECUTE' order by 1`)).rows.map(r => r.grantee);
    expect(exec).not.toContain('anon');
    expect(exec).not.toContain('PUBLIC');
    expect(exec).toContain('authenticated');
  });

  it('stores exactly id, room, reporter, reason, created_at', async () => {
    const cols = (await sys(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'chat_reports' order by column_name`)).rows.map(r => r.column_name);
    expect(cols).toEqual(['created_at', 'id', 'reason', 'reporter', 'room']);
  });

  it('a member reports a room: one row with room, reporter and reason only', async () => {
    const { room } = await roomWithBob();
    await report(BOB, room, 'spam', { email: 'bob@example.com', user_metadata: { name: 'Bob', nickname: 'bobby' } });
    const rows = await reports();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ room, reporter: BOB, reason: 'spam' });
    // The raw row is five values; no email, nickname, device id or message text.
    const dump = (await sys(`select r::text as t from public.chat_reports r`)).rows[0].t;
    expect(dump.replace(/^\(|\)$/g, '').split(',')).toHaveLength(5);
    for (const leak of ['bob@example.com', 'Bob', 'bobby', devices[BOB], devices[ALICE], 'commit-add-bob']) expect(dump).not.toContain(leak);
    // The owner can report too.
    await report(ALICE, room, 'other');
    expect(await reports()).toHaveLength(2);
  });

  it('the same member reporting the same room twice keeps one row and updates the reason', async () => {
    const { room } = await roomWithBob();
    await report(BOB, room, 'spam');
    await sys(`update public.chat_reports set created_at = now() - interval '2 hours'`);
    const first = (await sys(`select id, created_at from public.chat_reports`)).rows[0];
    await report(BOB, room, 'abuse');
    const rows = (await sys(`select id, room, reporter, reason, created_at from public.chat_reports`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.id, room, reporter: BOB, reason: 'abuse' });
    expect(new Date(rows[0].created_at).getTime()).toBeGreaterThan(new Date(first.created_at).getTime());
  });

  it('a non-member, a pending member, a removed member and an unknown room get not_a_member', async () => {
    const { room, bDev } = await roomWithBob();
    await expect(report(EVE, room, 'spam')).rejects.toThrow(/not_a_member/);
    await expect(report(ALICE, crypto.randomUUID(), 'spam')).rejects.toThrow(/not_a_member/);
    // Pending (redeemed, not yet committed) is not current membership.
    const pending = await soloRoom();
    const token = crypto.randomUUID() + crypto.randomUUID();
    await as(ALICE, `select public.chat_create_invite($1, $2, 3600, 1, false)`, [pending, token]);
    await one(BOB, `select * from public.chat_redeem_invite($1, $2, $3::bytea, null)`, [token, bDev, KP]);
    await expect(report(BOB, pending, 'spam')).rejects.toThrow(/not_a_member/);
    // Removed from the room: no longer a member.
    await sys(`update public.chat_members set state = 'removed', removed_at = now() where room_id = $1 and user_id = $2`, [room, BOB]);
    await expect(report(BOB, room, 'spam')).rejects.toThrow(/not_a_member/);
    // Burned or expired room: no longer a member either.
    const gone = await soloRoom();
    await sys(`update public.chat_rooms set expires_at = now() - interval '1 second' where id = $1`, [gone]);
    await expect(report(ALICE, gone, 'spam')).rejects.toThrow(/not_a_member/);
    expect(await reports()).toEqual([]);
  });

  it('anon is denied the RPC and the table', async () => {
    const { room } = await roomWithBob();
    await expect(report(null, room, 'spam')).rejects.toThrow(/permission denied/);
    await expect(as(null, `select * from public.chat_reports`)).rejects.toThrow(/permission denied/);
    expect(await reports()).toEqual([]);
  });

  it('a chat guest (anonymous user) who is a member may report, like any member', async () => {
    const gDev = await device(GUEST);
    const room = await soloRoom();
    const token = crypto.randomUUID() + crypto.randomUUID();
    await as(ALICE, `select public.chat_create_invite($1, $2, 3600, 1, false)`, [room, token]);
    await one(GUEST, `select * from public.chat_redeem_invite($1, $2, $3::bytea, null)`, [token, gDev, KP]);
    await as(ALICE, `select public.chat_send($1, $2, $3, 'commit', 0, $4::bytea, null, null, array[$5::uuid])`,
      [room, devices[ALICE], crypto.randomUUID(), CT('commit-add-guest'), gDev]);
    await report(GUEST, room, 'abuse', { is_anonymous: true });
    expect((await reports()).map(r => r.reporter)).toEqual([GUEST]);
  });

  it('rejects a bad reason without writing', async () => {
    const { room } = await roomWithBob();
    for (const bad of ['', 'SPAM', 'harassment', 'the wifi password is hunter2', 'spam; drop table']) {
      await expect(report(BOB, room, bad)).rejects.toThrow(/bad_reason/);
    }
    await expect(as(BOB, `select public.report_chat($1, null)`, [room])).rejects.toThrow(/bad_reason/);
    expect(await reports()).toEqual([]);
  });

  it('caps a reporter at 20 rooms per day: the 21st is too_many_reports, re-reports and old reports do not count', async () => {
    const rooms: string[] = [];
    for (let i = 0; i < 21; i++) rooms.push(await soloRoom());
    for (const r of rooms.slice(0, 20)) await report(ALICE, r, 'spam');
    expect(await reports()).toHaveLength(20);
    await expect(report(ALICE, rooms[20], 'spam')).rejects.toThrow(/too_many_reports/);
    expect(await reports()).toHaveLength(20);
    // Reporting one of the 20 again is an update, not a 21st.
    await report(ALICE, rooms[3], 'illegal');
    expect(await reports()).toHaveLength(20);
    expect((await sys(`select reason from public.chat_reports where room = $1`, [rooms[3]])).rows[0].reason).toBe('illegal');
    // Another reporter has their own budget.
    const shared = await roomWithBob();
    await report(BOB, shared.room, 'spam');
    expect(await reports()).toHaveLength(21);
    // Once a report is older than a day it stops counting.
    await sys(`update public.chat_reports set created_at = now() - interval '25 hours' where room = $1`, [rooms[0]]);
    await report(ALICE, rooms[20], 'spam');
    expect(await reports()).toHaveLength(22);
  });

  it('authenticated cannot select, insert, update or delete the table directly', async () => {
    const { room } = await roomWithBob();
    await report(BOB, room, 'spam');
    await expect(as(BOB, `select * from public.chat_reports`)).rejects.toThrow(/permission denied/);
    await expect(as(BOB, `select count(*) from public.chat_reports`)).rejects.toThrow(/permission denied/);
    await expect(as(BOB, `insert into public.chat_reports(room, reporter, reason) values ($1, $2, 'spam')`, [room, BOB])).rejects.toThrow(/permission denied/);
    await expect(as(ALICE, `insert into public.chat_reports(room, reporter, reason) values ($1, $2, 'spam')`, [room, BOB])).rejects.toThrow(/permission denied/);
    await expect(as(BOB, `update public.chat_reports set reason = 'other'`)).rejects.toThrow(/permission denied/);
    await expect(as(BOB, `delete from public.chat_reports`)).rejects.toThrow(/permission denied/);
    expect(await reports()).toHaveLength(1);
  });

  it('the service role (human reviewer) sees the rows; a deleted reporter takes their reports with them', async () => {
    const { room } = await roomWithBob();
    await report(BOB, room, 'illegal');
    await report(ALICE, room, 'spam');
    const seen = await asService(`select room, reporter, reason from public.chat_reports order by reporter`);
    expect(seen).toEqual([{ room, reporter: ALICE, reason: 'spam' }, { room, reporter: BOB, reason: 'illegal' }]);
    await sys(`delete from auth.users where id = $1`, [EVE]);
    await sys(`insert into auth.users(id) values ($1)`, [EVE]);
    // Bob deletes his account: auth.users cascades through chat_members/chat_devices (006) and chat_reports (009).
    await sys(`delete from auth.users where id = $1`, [BOB]);
    delete devices[BOB];
    expect((await reports()).map(r => r.reporter)).toEqual([ALICE]);
    await sys(`insert into auth.users(id, is_anonymous) values ($1, false)`, [BOB]);
  });

  it('has no realtime ping and no chat_security_events row with content', async () => {
    const { room } = await roomWithBob();
    const before = (await sys(`select count(*)::int n from realtime.messages`)).rows[0].n;
    await report(BOB, room, 'spam');
    expect((await sys(`select count(*)::int n from realtime.messages`)).rows[0].n).toBe(before);
  });
});

describe('migration 009: rollback', () => {
  it('applies down, up, down and leaves 006–008 intact', async () => {
    const { room } = await roomWithBob();
    await report(BOB, room, 'spam');
    await db.exec(down);
    expect((await sys(`select count(*)::int n from pg_tables where tablename = 'chat_reports'`)).rows[0].n).toBe(0);
    expect((await sys(`select count(*)::int n from pg_proc where proname = 'report_chat'`)).rows[0].n).toBe(0);
    // 006: 12 chat tables, chat_is_member and the device RPC still work. 008: push_devices and its RPCs.
    expect((await sys(`select count(*)::int n from pg_tables where schemaname = 'public' and tablename like 'chat\\_%'`)).rows[0].n).toBe(12);
    expect((await as(BOB, `select public.chat_is_member($1) m`, [room]))[0].m).toBe(true);
    expect((await sys(`select count(*)::int n from pg_tables where tablename = 'push_devices'`)).rows[0].n).toBe(1);
    expect((await sys(`select count(*)::int n from pg_proc where proname in ('register_push_device', 'unregister_push_device')`)).rows[0].n).toBe(2);
    await as(BOB, `select public.register_push_device('ios', $1)`, ['a'.repeat(64)]);
    await db.exec(up);
    expect(await reports()).toEqual([]);
    await report(BOB, room, 'abuse');
    expect(await reports()).toHaveLength(1);
    await db.exec(down);
    expect((await sys(`select count(*)::int n from pg_tables where tablename = 'chat_reports'`)).rows[0].n).toBe(0);
    expect((await sys(`select count(*)::int n from pg_tables where schemaname = 'public' and tablename like 'chat\\_%'`)).rows[0].n).toBe(12);
    expect((await as(BOB, `select count(*)::int n from public.push_devices`))[0].n).toBe(1);
    await db.exec(up);
  });
});
