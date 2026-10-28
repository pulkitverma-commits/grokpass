// Replays OnePeek's full schema history (schema.sql, 002–007) on Postgres (PGlite), the
// way production got there, to check 006 and 007 apply cleanly on top of the live schema.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f: string) => readFileSync(path.join(dir, f), 'utf8');
const migrations = readdirSync(path.join(dir, 'migrations')).filter(f => /^\d{3}_.*\.sql$/.test(f) && !f.endsWith('_down.sql')).sort();

let db: PGlite;
const USER = '00000000-0000-4000-8000-0000000000c1';
const GUEST = '00000000-0000-4000-8000-0000000000c2';
const KEY = 'A'.repeat(88);

async function asUser(id: string, anonymous: boolean, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${id}', false);
    select set_config('request.jwt.claims', '${JSON.stringify({ sub: id, is_anonymous: anonymous })}', false); set role authenticated;`);
  try { return (await db.query<any>(sql, params)).rows; } finally { await db.exec('reset role;'); }
}

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(read('tests/supabase-stubs.sql'));
  await db.exec(read('schema.sql'));
  for (const m of migrations) await db.exec(read(`migrations/${m}`));
  await db.query(`insert into auth.users(id, is_anonymous) values ($1, false), ($2, true)`, [USER, GUEST]);
}, 120_000);

describe('production schema history', () => {
  it('applies every migration in order, including Secret Chat', async () => {
    expect(migrations).toContain('006_secret_chat.sql');
    expect(migrations).toContain('007_block_anonymous_accounts.sql');
    expect(migrations).toContain('008_lock_cleanup.sql');
    const n = (await db.query<any>(`select count(*)::int n from pg_tables where schemaname = 'public' and tablename like 'chat_%'`)).rows[0].n;
    expect(n).toBe(12);
  });

  it('leaves the existing OnePeek tables in place', async () => {
    const t = (await db.query<any>(`select tablename from pg_tables where schemaname = 'public' and tablename not like 'chat_%' order by 1`)).rows.map((r: any) => r.tablename);
    for (const name of ['secrets', 'secret_log', 'secret_requests', 'secret_quota', 'subscriptions']) expect(t).toContain(name);
  });

  it('lets a real account create a secret request', async () => {
    const r = await asUser(USER, false, `select public.create_request('need the wifi', $1, 3600, 'client-real-000001') as id`, [KEY]);
    expect(r[0].id).toMatch(/^[A-Za-z0-9]{10}$/);
  });

  it('refuses a chat guest (anonymous user)', async () => {
    await expect(asUser(GUEST, true, `select public.create_request('x', $1, 3600, 'client-guest-00001')`, [KEY])).rejects.toThrow(/login_required/);
  });

  it('008: only the server can run secret cleanup', async () => {
    await expect(asUser(USER, false, `select public.reap_expired_secrets()`)).rejects.toThrow(/permission denied/);
    await db.exec(`reset role; set role anon;`);
    await expect(db.query(`select public.reap_expired_secrets()`)).rejects.toThrow(/permission denied/);
    await db.exec(`reset role; set role service_role;`);
    await db.query(`select public.reap_expired_secrets()`);
    await db.exec('reset role;');
  });

  it('still lets a chat guest use Secret Chat', async () => {
    const dev = (await asUser(GUEST, true, `select public.chat_register_device(decode(repeat('ab', 32), 'hex')) as id`))[0].id;
    const room = (await asUser(GUEST, true, `select public.chat_create_room($1, 'quick') as id`, [dev]))[0].id;
    expect(room).toMatch(/^[0-9a-f-]{36}$/);
  });
});
