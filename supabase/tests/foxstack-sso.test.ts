import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (name: string) => readFileSync(path.join(dir, name), 'utf8');
const ALICE = '11111111-2222-4333-8444-555555555555';
const BOB = '11111111-2222-4333-8444-555555555556';
const random = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
let db: PGlite;
type Row = Record<string, unknown>;
async function as(role: 'anon' | 'authenticated' | 'service_role', sql: string, params: unknown[] = []) {
  await db.exec(`set role ${role}`);
  try { return (await db.query<Row>(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const svc = (sql: string, params: unknown[] = []) => as('service_role', sql, params);
const sys = (sql: string, params: unknown[] = []) => db.query<Row>(sql, params).then(r => r.rows);
async function exchange(subject = ALICE, nonce = random(), secret = random(), expires = "now() + interval '60 seconds'") {
  const rows = await svc(`select * from foxstack_exchange_session($1,$2,'Example Employee',$3,$4,${expires})`,
    [subject, subject === ALICE ? 'alice@foxnetglobal.com' : 'bob@foxnetglobal.com', hash(secret), nonce]);
  return { id: rows[0].id as string, expiresAt: rows[0].expires_at, nonce, secret };
}
const auth = (id: string, secret: string) => svc('select * from foxstack_auth_session($1,$2)', [id, hash(secret)]);

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(read('tests/supabase-stubs.sql'));
  await db.exec(read('schema.sql'));
  const migrations = readdirSync(path.join(dir, 'migrations')).filter(f => /^\d{3}_.*\.sql$/.test(f) && !f.endsWith('_down.sql')).sort();
  for (const migration of migrations) await db.exec(read(`migrations/${migration}`));
  await db.exec(read('migrations/20261125183016_foxstack_scoped_sso.sql'));
}, 120_000);
beforeEach(async () => {
  await db.exec('truncate public.foxstack_sso_identities, public.app_installs cascade; delete from public.secrets;');
});

describe('FoxStack SSO database boundary', () => {
  it('denies browser roles every new table and function', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      for (const table of ['foxstack_sso_identities', 'foxstack_sso_sessions']) {
        await expect(as(role, `select * from ${table}`)).rejects.toThrow(/permission denied/);
      }
      await expect(as(role, "select * from foxstack_auth_session('x','y')")).rejects.toThrow(/permission denied/);
      await expect(as(role, `select * from foxstack_exchange_session('${ALICE}','a@foxnetglobal.com','A','${'a'.repeat(64)}','${'n'.repeat(43)}',now())`)).rejects.toThrow(/permission denied/);
    }
    const settings = await sys("select prosecdef from pg_proc where proname in ('foxstack_exchange_session','foxstack_auth_session')");
    expect(settings).toHaveLength(2);
    expect(settings.every(row => row.prosecdef === false)).toBe(true);
  });

  it('creates a ten-minute hashed credential, with no access through the general install API', async () => {
    const session = await exchange();
    const rows = await auth(session.id, session.secret);
    expect(rows).toHaveLength(1);
    const data = await sys('select *,extract(epoch from (expires_at-created_at)) as ttl from foxstack_sso_sessions');
    expect(Number(data[0].ttl)).toBe(600);
    expect(data[0].secret_hash).toBe(hash(session.secret));
    expect(JSON.stringify(data)).not.toContain(session.secret);
    expect(await auth(session.id, random())).toEqual([]);
    expect((await svc('select app_auth($1,$2) as ok', [rows[0].install_id, hash(session.secret)]))[0].ok).toBe(false);
  });

  it('consumes the nonce once and rolls back a replay completely', async () => {
    const session = await exchange();
    await expect(exchange(ALICE, session.nonce, session.secret)).rejects.toThrow(/assertion_replayed/);
    expect((await sys('select count(*)::int as n from foxstack_sso_sessions'))[0].n).toBe(1);
    expect((await sys('select count(*)::int as n from app_installs'))[0].n).toBe(1);
  });

  it('keeps identity, quota and idempotency stable across renewed sessions', async () => {
    const first = await exchange();
    const firstInstall = (await auth(first.id, first.secret))[0].install_id;
    const second = await exchange();
    expect((await auth(second.id, second.secret))[0].install_id).toBe(firstInstall);
    const other = await exchange(BOB);
    expect((await auth(other.id, other.secret))[0].install_id).not.toBe(firstInstall);
    expect(await auth(first.id, other.secret)).toEqual([]);
    const args = [firstInstall, random(), hash(random()), random(), random(), null, 10, 3600, 1];
    const one = await svc('select * from app_create_share($1,$2,$3,$4,$5,$6,$7,$8,$9)', args);
    const retry = await svc('select * from app_create_share($1,$2,$3,$4,$5,$6,$7,$8,$9)', args);
    expect(retry[0].id).toBe(one[0].id);
    expect(retry[0].replayed).toBe(true);
  });

  it('rejects expired or overlong assertions before creating an identity', async () => {
    await expect(exchange(ALICE, random(), random(), "now() - interval '1 second'")).rejects.toThrow(/assertion_expired/);
    await expect(exchange(ALICE, random(), random(), "now() + interval '2 minutes'")).rejects.toThrow(/assertion_expired/);
    expect(await sys('select * from foxstack_sso_identities')).toEqual([]);
  });

  it('rejects expired sessions and a revoked employee install', async () => {
    const old = await exchange();
    await sys("update foxstack_sso_sessions set created_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' where id=$1", [old.id]);
    expect(await auth(old.id, old.secret)).toEqual([]);
    const current = await exchange();
    const install = (await auth(current.id, current.secret))[0].install_id;
    await sys('update app_installs set revoked_at=now() where id=$1', [install]);
    expect(await auth(current.id, current.secret)).toEqual([]);
    await expect(exchange()).rejects.toThrow(/identity_revoked/);
  });
});
