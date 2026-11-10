// Migration 010 (app API for TopShelf "Send Securely", passphrase shares, security fixes),
// tested on Postgres (PGlite) on top of the full production history (schema.sql, 002–009),
// calling each function with the role the real caller has: service_role for the server routes,
// anon/authenticated for anything a browser could reach.
//
// Not covered here: true concurrency. PGlite is a single connection, so "two opens at once" is
// proven by the row lock + sequential semantics below and must also be exercised against a real
// Postgres (see docs/send-securely/VERIFICATION.md).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f: string) => readFileSync(path.join(dir, f), 'utf8');
const history = readdirSync(path.join(dir, 'migrations'))
  .filter(f => /^\d{3}_.*\.sql$/.test(f) && !f.endsWith('_down.sql') && !f.startsWith('010_')).sort();

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const b64u = (n: number) => randomBytes(n).toString('base64url');
const idem = () => b64u(18);

let db: PGlite;

async function as<T = any>(role: 'anon' | 'authenticated' | 'service_role', sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`set role ${role}`);
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const svc = <T = any>(sql: string, params: unknown[] = []) => as<T>('service_role', sql, params);
const sys = (sql: string, params: unknown[] = []) => db.query<any>(sql, params).then(r => r.rows);

async function install() {
  const secret = b64u(32);
  const id = (await svc(`select public.app_register_install($1, 'macos', '1.1') as id`, [sha(secret)]))[0].id as string;
  return { id, secret };
}

type ShareOpts = { file?: string; size?: number; ttl?: number; views?: number; manage?: string; key?: string; pass?: { salt: string; auth: string; half: string } };
async function share(inst: string, o: ShareOpts = {}) {
  const manage = o.manage ?? b64u(32);
  const rows = await svc(
    `select * from public.app_create_share($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [inst, o.key ?? idem(), sha(manage), b64u(60), o.file ? null : b64u(80), o.file ?? null, o.size ?? null,
     o.ttl ?? 3600, o.views ?? 1, o.pass?.salt ?? null, o.pass ? sha(o.pass.auth) : null, o.pass?.half ?? null]);
  return { ...rows[0], manage } as { id: string; expires_at: string; replayed: boolean; manage: string };
}
const open = (id: string, token: string | null = null) =>
  svc(`select * from public.open_secret($1, null, null, null, null, null, null, null, 'network', null, $2)`, [id, token]);
const list = (inst: string) => svc(`select * from public.app_list_shares($1)`, [inst]);
const statusOf = async (inst: string, id: string) => (await list(inst)).find((r: any) => r.id === id);

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(read('tests/supabase-stubs.sql'));
  await db.exec(read('schema.sql'));
  for (const m of history) await db.exec(read(`migrations/${m}`));
  await db.exec(read('migrations/010_app_api.sql'));
}, 120_000);

beforeEach(async () => {
  await db.exec(`delete from public.app_shares; delete from public.app_uploads; delete from public.app_installs;
             delete from public.secrets; delete from public.secret_claims; delete from public.secret_unlocks;
             delete from public.api_rate; delete from storage.objects;`);
});

describe('migration 010: install and permissions', () => {
  it('applies on top of the production history and rolls back cleanly', async () => {
    const t = (await sys(`select tablename from pg_tables where schemaname='public' and tablename like 'app_%' order by 1`)).map((r: any) => r.tablename);
    expect(t).toEqual(['app_installs', 'app_shares', 'app_uploads']);
    await db.exec(read('migrations/010_app_api_down.sql'));
    expect((await sys(`select count(*)::int n from pg_tables where schemaname='public' and tablename like 'app_%'`))[0].n).toBe(0);
    expect((await sys(`select count(*)::int n from information_schema.columns where table_name='secrets' and column_name like 'pass_%'`))[0].n).toBe(0);
    await db.exec(read('migrations/010_app_api.sql'));
    expect((await sys(`select count(*)::int n from pg_tables where schemaname='public' and tablename like 'app_%'`))[0].n).toBe(3);
  });

  it('keeps every app function, the reaper and open_secret away from browsers', async () => {
    const calls = [
      `select public.app_register_install('${'a'.repeat(64)}', 'macos', null)`,
      `select public.app_auth('x', 'y')`,
      `select public.app_begin_upload('x', 10)`,
      `select * from public.app_list_shares('x')`,
      `select * from public.app_revoke_share('x', 'y', 'z')`,
      `select * from public.pass_unlock('x', 'y', '${'a'.repeat(64)}')`,
      `select public.unlock_check_code('x', 'y', '${'a'.repeat(64)}')`,
      `select public.api_rate_ok('x', 1, 60)`,
      `select * from public.reap_expired_secrets()`,
      `select * from public.reap_orphan_uploads()`,
      `select * from public.open_secret('x')`,
    ];
    for (const role of ['anon', 'authenticated'] as const) {
      for (const sql of calls) await expect(as(role, sql), `${role}: ${sql}`).rejects.toThrow(/permission denied/);
      await expect(as(role, `select * from public.app_installs`)).rejects.toThrow(/permission denied/);
      await expect(as(role, `select * from public.app_shares`)).rejects.toThrow(/permission denied/);
    }
    // The viewer may look up a passphrase salt (null for an unknown id).
    expect((await as('anon', `select public.peek_pass('nope') as s`))[0].s).toBeNull();
  });

  it('authenticates installs by secret hash only, and not once revoked', async () => {
    const a = await install();
    expect(a.id).toMatch(/^[A-Za-z0-9]{22}$/);
    expect((await svc(`select public.app_auth($1, $2) ok`, [a.id, sha(a.secret)]))[0].ok).toBe(true);
    expect((await svc(`select public.app_auth($1, $2) ok`, [a.id, sha('wrong')]))[0].ok).toBe(false);
    expect((await svc(`select public.app_auth($1, $2) ok`, ['nobody', sha(a.secret)]))[0].ok).toBe(false);
    await sys(`update public.app_installs set revoked_at = now() where id = $1`, [a.id]);
    expect((await svc(`select public.app_auth($1, $2) ok`, [a.id, sha(a.secret)]))[0].ok).toBe(false);
    // Only the hash is stored.
    expect(JSON.stringify(await sys(`select * from public.app_installs`))).not.toContain(a.secret);
  });
});

describe('migration 010: shares', () => {
  it('creates a text share the existing viewer can peek and open', async () => {
    const a = await install();
    const s = await share(a.id, { views: 1 });
    expect(s.id).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(s.replayed).toBe(false);
    const peek = await as('anon', `select * from public.peek_secret($1)`, [s.id]);
    expect(peek).toHaveLength(1);
    expect(peek[0].kind).toBe('text');
    expect((await statusOf(a.id, s.id)).status).toBe('active');
    const o = await open(s.id);
    expect(o[0].final).toBe(true);
    expect(o[0].body).toBeTruthy();
    expect(await open(s.id)).toHaveLength(0);                    // view once
    const row = await statusOf(a.id, s.id);
    expect(row.status).toBe('viewed');
    expect(row.views_used).toBe(1);
  });

  it('is idempotent per install and refuses a replay with a different manage token', async () => {
    const a = await install();
    const key = idem();
    const manage = b64u(32);
    const first = await share(a.id, { key, manage });
    const again = await share(a.id, { key, manage });
    expect(again.id).toBe(first.id);
    expect(again.replayed).toBe(true);
    expect((await sys(`select count(*)::int n from public.secrets`))[0].n).toBe(1);
    await expect(share(a.id, { key, manage: b64u(32) })).rejects.toThrow(/idempotency_conflict/);
    // The same key from another install is a different share.
    const b = await install();
    expect((await share(b.id, { key })).id).not.toBe(first.id);
  });

  it('counts views for multi-view shares and reports them as viewed', async () => {
    const a = await install();
    const s = await share(a.id, { views: 3 });
    expect((await open(s.id))[0]).toMatchObject({ final: false, views_left: 2 });
    let row = await statusOf(a.id, s.id);
    expect(row).toMatchObject({ status: 'viewed', views_used: 1, max_views: 3 });
    await open(s.id); await open(s.id);
    expect(await open(s.id)).toHaveLength(0);
    row = await statusOf(a.id, s.id);
    expect(row).toMatchObject({ status: 'viewed', views_used: 3 });
  });

  it('stops granting access at expiry', async () => {
    const a = await install();
    const s = await share(a.id, { ttl: 300 });
    await sys(`update public.secrets set expires_at = now() - interval '1 second' where id = $1`, [s.id]);
    await sys(`update public.app_shares set expires_at = now() - interval '1 second' where id = $1`, [s.id]);
    expect(await open(s.id)).toHaveLength(0);
    expect(await as('anon', `select * from public.peek_secret($1)`, [s.id])).toHaveLength(0);
    expect((await statusOf(a.id, s.id)).status).toBe('expired');
  });

  it('validates expiry, views and payload encoding', async () => {
    const a = await install();
    await expect(share(a.id, { ttl: 299 })).rejects.toThrow(/invalid expiry/);
    await expect(share(a.id, { ttl: 604801 })).rejects.toThrow(/invalid expiry/);
    await expect(share(a.id, { views: 0 })).rejects.toThrow(/invalid views/);
    await expect(share(a.id, { views: 1001 })).rejects.toThrow(/invalid views/);
    await expect(svc(`select * from public.app_create_share($1,$2,$3,'<script>',$4,null,null,3600,1)`,
      [a.id, idem(), sha('m'), b64u(10)])).rejects.toThrow(/invalid header/);
    await expect(svc(`select * from public.app_create_share($1,$2,$3,$4,'a b',null,null,3600,1)`,
      [a.id, idem(), sha('m'), b64u(10)])).rejects.toThrow(/invalid body/);
  });

  it('keeps each install to its own shares', async () => {
    const a = await install(), b = await install();
    const s = await share(a.id);
    expect(await list(b.id)).toHaveLength(0);
    expect((await svc(`select * from public.app_revoke_share($1, $2, $3)`, [b.id, s.id, sha(s.manage)]))[0].revoked).toBe(false);
    expect(await open(s.id)).toHaveLength(1);
  });

  it('revokes only with the right manage token, deletes the secret and returns the file path', async () => {
    const a = await install();
    const path = (await svc(`select public.app_begin_upload($1, 1000) p`, [a.id]))[0].p as string;
    await sys(`insert into storage.objects (bucket_id, name, metadata) values ('secrets', $1, '{"size": 900}')`, [path]);
    const s = await share(a.id, { file: path, size: 900 });
    expect((await svc(`select * from public.app_revoke_share($1, $2, $3)`, [a.id, s.id, sha('wrong')]))[0].revoked).toBe(false);
    const r = (await svc(`select * from public.app_revoke_share($1, $2, $3)`, [a.id, s.id, sha(s.manage)]))[0];
    expect(r).toEqual({ revoked: true, file_path: path });
    expect(await open(s.id)).toHaveLength(0);
    expect((await statusOf(a.id, s.id)).status).toBe('revoked');
  });

  it('enforces the monthly quota per install', async () => {
    const a = await install();
    const s = await share(a.id);
    await sys(`insert into public.app_shares (id, install_id, idempotency_key, manage_hash, kind, max_views, expires_at)
               select 'q' || g, $1, 'k' || lpad(g::text, 20, '0'), $2, 'text', 1, now() + interval '1 hour'
               from generate_series(1, 299) g`, [a.id, sha('m')]);
    expect(await list(a.id)).toHaveLength(100);
    await expect(share(a.id)).rejects.toThrow(/quota_exceeded/);
    expect(s.id).toBeTruthy();
  });
});

describe('migration 010: uploads', () => {
  it('only accepts the install’s own, present, unused upload within its size cap', async () => {
    const a = await install(), b = await install();
    const p1 = (await svc(`select public.app_begin_upload($1, 1000) p`, [a.id]))[0].p as string;
    expect(p1).toMatch(/^f\/[A-Za-z0-9]{32}\.bin$/);
    await expect(share(a.id, { file: p1 })).rejects.toThrow(/upload_missing/);
    await sys(`insert into storage.objects (bucket_id, name, metadata) values ('secrets', $1, '{"size": 2000}')`, [p1]);
    await expect(share(a.id, { file: p1 })).rejects.toThrow(/upload_too_large/);
    await sys(`update storage.objects set metadata = '{"size": 1000}' where name = $1`, [p1]);
    await expect(share(b.id, { file: p1 })).rejects.toThrow(/invalid upload/);           // someone else's
    await expect(share(a.id, { file: 'f/' + 'A'.repeat(32) + '.bin' })).rejects.toThrow(/invalid upload/);
    const s = await share(a.id, { file: p1, size: 1000 });
    expect((await as('anon', `select * from public.peek_secret($1)`, [s.id]))[0].kind).toBe('file');
    await expect(share(a.id, { file: p1 })).rejects.toThrow(/invalid upload/);           // used
  });

  it('caps pending uploads and upload size', async () => {
    const a = await install();
    await expect(svc(`select public.app_begin_upload($1, 52428801)`, [a.id])).rejects.toThrow(/invalid size/);
    for (let i = 0; i < 20; i++) await svc(`select public.app_begin_upload($1, 10)`, [a.id]);
    await expect(svc(`select public.app_begin_upload($1, 10)`, [a.id])).rejects.toThrow(/too_many_pending_uploads/);
  });

  it('reaps expired app uploads and old orphans, never live files', async () => {
    const a = await install();
    const stale = (await svc(`select public.app_begin_upload($1, 10) p`, [a.id]))[0].p as string;
    await sys(`update public.app_uploads set expires_at = now() - interval '1 minute' where path = $1`, [stale]);
    const live = (await svc(`select public.app_begin_upload($1, 10) p`, [a.id]))[0].p as string;
    await sys(`insert into storage.objects (bucket_id, name, metadata) values ('secrets', $1, '{"size": 5}')`, [live]);
    const s = await share(a.id, { file: live, size: 5 });
    const orphan = 'f/' + 'B'.repeat(30) + '.bin';
    await sys(`insert into storage.objects (bucket_id, name, created_at) values ('secrets', $1, now() - interval '2 days')`, [orphan]);
    await sys(`update storage.objects set created_at = now() - interval '2 days' where name = $1`, [live]);
    const reaped = (await svc(`select * from public.reap_orphan_uploads() p`)).map((r: any) => r.p);
    expect(reaped).toContain(stale);
    expect(reaped).toContain(orphan);
    expect(reaped).not.toContain(live);
    expect(await open(s.id)).toHaveLength(1);
  });
});

describe('migration 010: passphrase shares', () => {
  const pass = () => ({ salt: b64u(16), auth: b64u(32), half: b64u(32) });

  it('needs a passphrase token to open, and the token works once', async () => {
    const a = await install();
    const p = pass();
    const s = await share(a.id, { pass: p, views: 2 });
    expect((await as('anon', `select public.peek_pass($1) s`, [s.id]))[0].s).toBe(p.salt);
    await expect(open(s.id)).rejects.toThrow(/passphrase_required/);
    const token = b64u(32);
    const r = (await svc(`select * from public.pass_unlock($1, $2, $3)`, [s.id, sha(p.auth), sha(token)]))[0];
    expect(r).toEqual({ status: 'ok', server_half: p.half });
    expect((await open(s.id, token))[0].final).toBe(false);
    await expect(open(s.id, token)).rejects.toThrow(/passphrase_required/);             // used once
  });

  it('counts wrong guesses and destroys the share (and its server half) on the fifth', async () => {
    const a = await install();
    const p = pass();
    const s = await share(a.id, { pass: p });
    for (let left = 4; left >= 1; left--) {
      const r = (await svc(`select * from public.pass_unlock($1, $2, $3)`, [s.id, sha('guess' + left), sha(b64u(32))]))[0];
      expect(r).toEqual({ status: `wrong:${left}`, server_half: null });
    }
    const last = (await svc(`select * from public.pass_unlock($1, $2, $3)`, [s.id, sha('guess0'), sha(b64u(32))]))[0];
    expect(last.status).toBe('locked');
    expect((await sys(`select count(*)::int n from public.secrets where id = $1`, [s.id]))[0].n).toBe(0);
    // Even the right passphrase is useless now.
    const after = (await svc(`select * from public.pass_unlock($1, $2, $3)`, [s.id, sha(p.auth), sha(b64u(32))]))[0];
    expect(after).toEqual({ status: 'gone', server_half: null });
  });

  it('rejects partial passphrase parameters', async () => {
    const a = await install();
    await expect(svc(`select * from public.app_create_share($1,$2,$3,$4,$5,null,null,3600,1,null,$6,null)`,
      [a.id, idem(), sha('m'), b64u(20), b64u(20), sha('x')])).rejects.toThrow(/invalid passphrase parameters/);
    await expect(svc(`select * from public.app_create_share($1,$2,$3,$4,$5,null,null,3600,1,$6,null,null)`,
      [a.id, idem(), sha('m'), b64u(20), b64u(20), b64u(16)])).rejects.toThrow(/invalid passphrase parameters/);
  });
});

describe('migration 010: fixes to existing behaviour', () => {
  it('counts email-code attempts atomically and locks after five', async () => {
    await sys(`insert into public.secrets (id, header, body, expires_at, lock_email) values ('lockedone1', 'h', 'b', now() + interval '1 hour', 'a@b.co')`);
    await sys(`insert into public.secret_unlocks (id, code_hash, code_expires) values ('lockedone1', $1, now() + interval '10 minutes')`, [sha('lockedone1:123456')]);
    const check = (code: string) => svc(`select public.unlock_check_code('lockedone1', $1, $2) r`, [sha(`lockedone1:${code}`), sha(b64u(32))]).then(r => r[0].r);
    expect(await check('000000')).toBe('wrong:4');
    expect(await check('000001')).toBe('wrong:3');
    expect(await check('000002')).toBe('wrong:2');
    expect(await check('000003')).toBe('wrong:1');
    expect(await check('000004')).toBe('too_many');
    expect(await check('123456')).toBe('expired');          // the code was wiped on the 5th miss
  });

  it('hands out a one-use open token for the right email code', async () => {
    await sys(`insert into public.secrets (id, header, body, expires_at, lock_email) values ('lockedtwo1', 'h', 'b', now() + interval '1 hour', 'a@b.co')`);
    await sys(`insert into public.secret_unlocks (id, code_hash, code_expires) values ('lockedtwo1', $1, now() + interval '10 minutes')`, [sha('lockedtwo1:654321')]);
    const token = b64u(32);
    expect((await svc(`select public.unlock_check_code('lockedtwo1', $1, $2) r`, [sha('lockedtwo1:654321'), sha(token)]))[0].r).toBe('ok');
    await expect(open('lockedtwo1')).rejects.toThrow(/recipient_locked/);
    expect(await open('lockedtwo1', token)).toHaveLength(1);
  });

  it('rate-limits atomically per bucket and window', async () => {
    const ok = (b: string) => svc(`select public.api_rate_ok($1, 3, 60) ok`, [b]).then(r => r[0].ok);
    expect([await ok('ip:1'), await ok('ip:1'), await ok('ip:1'), await ok('ip:1')]).toEqual([true, true, true, false]);
    expect(await ok('ip:2')).toBe(true);
  });
});
