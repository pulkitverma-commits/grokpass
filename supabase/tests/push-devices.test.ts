// Tests migration 008 (native push tokens) against real Postgres (PGlite) on top of the stubs,
// 006 and 007, calling the RPCs exactly as the signed-in app would: role `authenticated` with
// auth.uid() set. Also proves the rollback applies cleanly and leaves 006/007 intact (up, down, up).
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
const up = read('../migrations/008_mobile_push_tokens.sql');
const down = read('../migrations/008_mobile_push_tokens_down.sql');

const ALICE = '00000000-0000-4000-8000-00000000000a';
const BOB = '00000000-0000-4000-8000-00000000000b';
const GUEST = '00000000-0000-4000-8000-00000000000c';
const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);
const TOKEN_C = 'c'.repeat(64);
// What an FCM registration token looks like: ':' after the instance id, then base64url-ish chars.
const FCM_LIKE = `${'d'.repeat(22)}:APA91b${'E'.repeat(60)}-${'f'.repeat(40)}_${'G'.repeat(30)}`;

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
const sys = (sql: string, params: unknown[] = []) => db.query<any>(sql, params);
const register = (user: string, platform: string, token: string, claims: object = {}) =>
  as(user, `select public.register_push_device($1, $2)`, [platform, token], claims);
const mine = (user: string) => as(user, `select owner, platform, token, last_seen from public.push_devices order by token`);

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(stubs);
  await db.exec(m006);
  // 007 re-creates create_request, which needs the 004/005 objects; schema history is covered by
  // production-history.test.ts. Here it only has to not clash with 008.
  await db.exec(m007).catch(() => undefined);
  await db.exec(up);
  await sys(`insert into auth.users(id, is_anonymous) values ($1, false), ($2, false), ($3, true)`, [ALICE, BOB, GUEST]);
}, 60_000);

beforeEach(async () => {
  await sys(`truncate public.push_devices`);
});

describe('migration 008: push_devices', () => {
  it('creates the table with RLS on and the two RPCs', async () => {
    const t = (await sys(`select relrowsecurity from pg_class where relname = 'push_devices'`)).rows[0];
    expect(t.relrowsecurity).toBe(true);
    const fns = (await sys(`select proname from pg_proc where proname in ('register_push_device', 'unregister_push_device') order by 1`)).rows.map(r => r.proname);
    expect(fns).toEqual(['register_push_device', 'unregister_push_device']);
  });

  it('lets an owner register and see only their own row', async () => {
    await register(ALICE, 'ios', TOKEN_A);
    const rows = await mine(ALICE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner: ALICE, platform: 'ios', token: TOKEN_A });
    expect(await mine(BOB)).toEqual([]);
  });

  it('keeps other users from deleting or updating a row', async () => {
    await register(ALICE, 'ios', TOKEN_A);
    await as(BOB, `delete from public.push_devices where token = $1`, [TOKEN_A]);
    await expect(as(BOB, `update public.push_devices set platform = 'android' where token = $1`, [TOKEN_A]))
      .rejects.toThrow(/permission denied/);
    await as(BOB, `select public.unregister_push_device($1)`, [TOKEN_A]);
    const all = (await sys(`select owner, platform from public.push_devices`)).rows;
    expect(all).toEqual([{ owner: ALICE, platform: 'ios' }]);
    // Direct inserts are refused by the grant (W2-5), for someone else's owner id as for one's own.
    await expect(as(BOB, `insert into public.push_devices(owner, platform, token) values ($1, 'ios', 'x')`, [ALICE]))
      .rejects.toThrow(/permission denied/);
  });

  it('re-registering the same token updates last_seen and platform instead of duplicating', async () => {
    await register(ALICE, 'ios', TOKEN_A);
    await sys(`update public.push_devices set last_seen = now() - interval '1 day'`);
    const before = (await mine(ALICE))[0].last_seen as Date;
    await register(ALICE, 'android', TOKEN_A);
    const rows = await mine(ALICE);
    expect(rows).toHaveLength(1);
    expect(rows[0].platform).toBe('android');
    expect(new Date(rows[0].last_seen).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it('registering the same (platform, token) twice keeps one row (same id, created_at) and advances last_seen (§1.5 d)', async () => {
    await register(ALICE, 'ios', TOKEN_A);
    await sys(`update public.push_devices set last_seen = now() - interval '1 day'`);
    const first = (await sys(`select id, created_at, last_seen from public.push_devices`)).rows[0];
    await register(ALICE, 'ios', TOKEN_A);
    const rows = (await sys(`select id, owner, platform, token, created_at, last_seen from public.push_devices`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner: ALICE, platform: 'ios', token: TOKEN_A, id: first.id });
    expect(new Date(rows[0].created_at).getTime()).toBe(new Date(first.created_at).getTime());
    expect(new Date(rows[0].last_seen).getTime()).toBeGreaterThan(new Date(first.last_seen).getTime());
    // A third time, back to back: still one row, last_seen never moves backwards.
    await register(ALICE, 'ios', TOKEN_A);
    const again = (await sys(`select last_seen from public.push_devices`)).rows;
    expect(again).toHaveLength(1);
    expect(new Date(again[0].last_seen).getTime()).toBeGreaterThanOrEqual(new Date(rows[0].last_seen).getTime());
  });

  it('stores exactly id, owner, platform, token, created_at, last_seen: no label, user agent, room or email (§1.5 f)', async () => {
    const cols = (await sys(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'push_devices' order by column_name`)).rows.map(r => r.column_name);
    expect(cols).toEqual(['created_at', 'id', 'last_seen', 'owner', 'platform', 'token']);
    await register(ALICE, 'android', FCM_LIKE);
    const dump = (await sys(`select row_to_json(d)::jsonb as j, d::text as t from public.push_devices d`)).rows;
    expect(dump).toHaveLength(1);
    expect(Object.keys(dump[0].j).sort()).toEqual(['created_at', 'id', 'last_seen', 'owner', 'platform', 'token']);
    expect(dump[0].j.token).toBe(FCM_LIKE);          // written as given
    expect(dump[0].j.owner).toBe(ALICE);
    expect(dump[0].j.platform).toBe('android');
    // The raw row text is the composite literal of those six values and nothing else.
    const fields = dump[0].t.replace(/^\(|\)$/g, '').split(',');
    expect(fields).toHaveLength(6);
    expect(fields[1]).toBe(ALICE);
    expect(fields[2]).toBe('android');
    expect(fields[3]).toBe(FCM_LIKE);
    for (const leak of ['user-agent', 'Mozilla', 'iPhone', 'Pixel', '@', 'chat', 'room', 'passport']) expect(dump[0].t).not.toContain(leak);
    // Claims on the session (user agent, email) are not picked up by the RPC either.
    await register(BOB, 'ios', TOKEN_B, { email: 'bob@example.com', user_agent: 'Mozilla/5.0 iPhone', user_metadata: { name: 'Bob' } });
    const bob = (await sys(`select d::text as t from public.push_devices d where owner = $1`, [BOB])).rows[0].t;
    for (const leak of ['bob@example.com', 'Mozilla', 'iPhone', 'Bob"', ',Bob']) expect(bob).not.toContain(leak);
  });

  it('a token belongs to one owner: re-registering it from another account takes it over (W1-2)', async () => {
    await register(ALICE, 'ios', TOKEN_A);
    await register(BOB, 'ios', TOKEN_A);
    // One row, now Bob's. Alice no longer sees it and her unregister touches nothing.
    expect((await sys(`select count(*)::int n from public.push_devices`)).rows[0].n).toBe(1);
    expect((await sys(`select owner from public.push_devices`)).rows[0].owner).toBe(BOB);
    expect(await mine(ALICE)).toEqual([]);
    expect((await mine(BOB)).map(r => r.token)).toEqual([TOKEN_A]);
    await as(ALICE, `select public.unregister_push_device($1)`, [TOKEN_A]);
    expect((await sys(`select owner from public.push_devices`)).rows).toEqual([{ owner: BOB }]);
    // The service role (lib/alerts.ts) sees exactly that one row.
    await db.exec('set role service_role');
    try {
      const rows = (await db.query<any>(`select owner, token from public.push_devices`)).rows;
      expect(rows).toEqual([{ owner: BOB, token: TOKEN_A }]);
    } finally {
      await db.exec('reset role');
    }
    // Bob's own unregister removes it.
    await as(BOB, `select public.unregister_push_device($1)`, [TOKEN_A]);
    expect((await sys(`select count(*)::int n from public.push_devices`)).rows[0].n).toBe(0);
    // A direct insert of a held token is refused (the grant; the unique constraint behind it).
    await register(ALICE, 'ios', TOKEN_A);
    await expect(as(BOB, `insert into public.push_devices(owner, platform, token) values ($1, 'ios', $2)`, [BOB, TOKEN_A]))
      .rejects.toThrow(/permission denied/);
  });

  it('unregister removes only the caller\'s token', async () => {
    await register(ALICE, 'ios', TOKEN_A);
    await register(ALICE, 'android', TOKEN_B);
    await register(BOB, 'ios', TOKEN_C);
    await as(ALICE, `select public.unregister_push_device($1)`, [TOKEN_A]);
    await as(ALICE, `select public.unregister_push_device($1)`, [TOKEN_C]);
    expect((await mine(ALICE)).map(r => r.token)).toEqual([TOKEN_B]);
    expect((await mine(BOB)).map(r => r.token)).toEqual([TOKEN_C]);
  });

  it('keeps at most 10 tokens per owner, dropping the least recently seen (W1-3)', async () => {
    const tokens = Array.from({ length: 11 }, (_, i) => `${String(i).padStart(2, '0')}${'t'.repeat(62)}`);
    for (const t of tokens.slice(0, 10)) await register(ALICE, 'ios', t);
    // Make token 00 unambiguously the oldest, and make sure Bob's rows are not counted or touched.
    await sys(`update public.push_devices set last_seen = now() - interval '1 day' where token = $1`, [tokens[0]]);
    await register(BOB, 'ios', TOKEN_B);
    await register(ALICE, 'android', tokens[10]);
    const rows = await mine(ALICE);
    expect(rows).toHaveLength(10);
    expect(rows.map(r => r.token)).toEqual(tokens.slice(1));
    expect((await mine(BOB)).map(r => r.token)).toEqual([TOKEN_B]);
    // Re-registering an existing token refreshes it rather than counting as an 11th.
    await register(ALICE, 'android', tokens[5]);
    expect(await mine(ALICE)).toHaveLength(10);
  });

  it('validates platform and token shape: 32-512 chars of [A-Za-z0-9:_-], else bad_token (W1-3)', async () => {
    await expect(register(ALICE, 'web', TOKEN_A)).rejects.toThrow(/bad_platform/);
    await expect(register(ALICE, 'ios', '')).rejects.toThrow(/bad_token/);
    await expect(register(ALICE, 'ios', 'x'.repeat(31))).rejects.toThrow(/bad_token/);
    await expect(register(ALICE, 'ios', 'x'.repeat(513))).rejects.toThrow(/bad_token/);
    await expect(register(ALICE, 'ios', 'x'.repeat(4096))).rejects.toThrow(/bad_token/);
    await expect(register(ALICE, 'ios', `${'x'.repeat(40)}$`)).rejects.toThrow(/bad_token/);
    await expect(register(ALICE, 'ios', `${'x'.repeat(20)} ${'x'.repeat(20)}`)).rejects.toThrow(/bad_token/);
    await expect(register(ALICE, 'ios', `${'x'.repeat(40)}\n`)).rejects.toThrow(/bad_token/);
    await expect(register(ALICE, 'ios', `${'x'.repeat(40)}.`)).rejects.toThrow(/bad_token/);
    expect(await mine(ALICE)).toEqual([]);
    // Accepted: a 32-char minimum, a 512-char maximum, an APNs hex token and an FCM-shaped token.
    await register(ALICE, 'ios', 'x'.repeat(32));
    await register(ALICE, 'ios', 'y'.repeat(512));
    await register(ALICE, 'ios', TOKEN_A);
    await register(ALICE, 'android', FCM_LIKE);
    expect(await mine(ALICE)).toHaveLength(4);
    // Direct inserts do not reach the table constraint: the grant refuses them first.
    await expect(as(ALICE, `insert into public.push_devices(owner, platform, token) values ($1, 'ios', 'short')`, [ALICE]))
      .rejects.toThrow(/permission denied/);
  });

  it('authenticated can only select and delete directly; insert and update are denied (W2-5)', async () => {
    await register(ALICE, 'ios', TOKEN_A);
    await register(ALICE, 'android', TOKEN_B);
    await expect(as(ALICE, `insert into public.push_devices(owner, platform, token) values ($1, 'ios', $2)`, [ALICE, 'z'.repeat(40)]))
      .rejects.toThrow(/permission denied/);
    await expect(as(ALICE, `update public.push_devices set last_seen = now() where token = $1`, [TOKEN_A]))
      .rejects.toThrow(/permission denied/);
    await expect(as(ALICE, `update public.push_devices set platform = 'android'`)).rejects.toThrow(/permission denied/);
    expect((await mine(ALICE)).map(r => r.token).sort()).toEqual([TOKEN_A, TOKEN_B].sort());
    await as(ALICE, `delete from public.push_devices where token = $1`, [TOKEN_A]);
    expect((await mine(ALICE)).map(r => r.token)).toEqual([TOKEN_B]);
    expect((await mine(BOB))).toEqual([]);
  });

  it('both RPCs run with an empty search_path and schema-qualified names', async () => {
    const rows = (await sys(`select proname, proconfig from pg_proc where proname in ('register_push_device', 'unregister_push_device') order by 1`)).rows;
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.proconfig).toEqual([expect.stringMatching(/^search_path=(""|'')?$/)]);
    // And they still work with it, which is the point of qualifying every name.
    await register(ALICE, 'ios', TOKEN_A);
    await as(ALICE, `select public.unregister_push_device($1)`, [TOKEN_A]);
    expect(await mine(ALICE)).toEqual([]);
  });

  it('denies anon the table and both RPCs', async () => {
    await expect(as(null, `select * from public.push_devices`)).rejects.toThrow(/permission denied/);
    await expect(as(null, `select public.register_push_device('ios', $1)`, [TOKEN_A])).rejects.toThrow(/permission denied/);
    await expect(as(null, `select public.unregister_push_device($1)`, [TOKEN_A])).rejects.toThrow(/permission denied/);
  });

  it('lets a chat guest (anonymous user) register, like chat_register_device does', async () => {
    await register(GUEST, 'android', TOKEN_B, { is_anonymous: true });
    expect(await mine(GUEST)).toHaveLength(1);
  });

  it('service role reads every row (what lib/alerts.ts does)', async () => {
    await register(ALICE, 'ios', TOKEN_A);
    await register(BOB, 'android', TOKEN_B);
    await db.exec('set role service_role');
    try {
      const rows = (await db.query<any>(`select owner from public.push_devices order by owner`)).rows;
      expect(rows.map(r => r.owner)).toEqual([ALICE, BOB]);
    } finally {
      await db.exec('reset role');
    }
  });

  it('cascades when the user is deleted', async () => {
    await register(BOB, 'ios', TOKEN_A);
    await sys(`delete from auth.users where id = $1`, [BOB]);
    expect((await sys(`select count(*)::int n from public.push_devices`)).rows[0].n).toBe(0);
    await sys(`insert into auth.users(id) values ($1)`, [BOB]);
  });
});

describe('migration 008: rollback', () => {
  it('applies down then up again and leaves 006/007 objects intact', async () => {
    await register(ALICE, 'ios', TOKEN_A);
    await db.exec(down);
    expect((await sys(`select count(*)::int n from pg_tables where tablename = 'push_devices'`)).rows[0].n).toBe(0);
    expect((await sys(`select count(*)::int n from pg_proc where proname in ('register_push_device', 'unregister_push_device')`)).rows[0].n).toBe(0);
    // 006 is untouched: 12 chat tables and its RPCs still work.
    expect((await sys(`select count(*)::int n from pg_tables where schemaname = 'public' and tablename like 'chat_%'`)).rows[0].n).toBe(12);
    const dev = await as(ALICE, `select public.chat_register_device($1::bytea, 'after-down') as id`, [new Uint8Array(32).fill(1)]);
    expect(dev[0].id).toMatch(/^[0-9a-f-]{36}$/);
    await db.exec(up);
    expect(await mine(ALICE)).toEqual([]);
    await register(ALICE, 'ios', TOKEN_A);
    expect(await mine(ALICE)).toHaveLength(1);
  });
});
