// PGlite harness for the one-time-secrets interop test (docs/mobile/test-plan.md §2.4, task Q5).
//
// Unlike `harness.ts` (chat only: 006+), this boots the WHOLE production schema the way
// `supabase/tests/production-history.test.ts` does: `supabase/tests/supabase-stubs.sql`, then
// `supabase/schema.sql`, then every migration 002..008 in order (rollbacks excluded). `create_secret`,
// `peek_secret` and `open_secret` are therefore the live definitions (005, 004, 004), with the plan,
// quota and geofence code they depend on, not stubs.
//
// Three things stand in for the network, nothing else:
//   - `fakeSupabase(user)`: `rpc()` runs the SQL function as `anon` (the website's anonymous client,
//     no session) or `authenticated` with that uid (a signed-in phone); `storage.from('secrets')`
//     applies the bucket's RLS predicates (`is_claimed_file`, `is_burned_file`, the upload name regex).
//   - `openRoute(id)`: a mirror of `app/api/open/route.ts`. The handler itself cannot be imported here
//     (it reaches `@/lib/server`, `@/lib/alerts`, `@/lib/geo` through the root vitest alias, which the
//     core's vitest config does not define), so this calls `open_secret` as `service_role` with the
//     exact argument names the route passes, and shapes the JSON the route returns. The interop test
//     reads `route.ts` and asserts those names are still in it, so a drift in the route fails the test.
//   - every RPC, every `/api/open` body and every response is recorded for the security sweep.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Repository root (packages/core/test -> ../../..). */
export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
/** The website's origin, as the browser sees it; the phone opens only https://onepeek.io links. */
export const WEB_ORIGIN = 'https://onepeek.io';

export type SqlCall = { fn: string; args: Record<string, unknown> };
export type FakeUser = { id: string; is_anonymous?: boolean };
export type Role = 'anon' | 'authenticated' | 'service_role';

/** Every forward migration, in order: 002 … 008 (the `_down.sql` rollbacks are not applied). */
export function allMigrations(): string[] {
  return readdirSync(path.join(ROOT, 'supabase/migrations'))
    .filter(f => /^\d{3}_.*\.sql$/.test(f) && !f.endsWith('_down.sql'))
    .sort();
}

export type SecretsHarness = Awaited<ReturnType<typeof bootSecretsDb>>;

/** What the website's `/api/open` returns: the row's ciphertext plus view bookkeeping; never a key. */
export type OpenRow = { header: string; body: string | null; file_path: string | null; views_left: number; final: boolean; viewer_place: string | null };
export type RouteResult = { status: number; json: OpenRow | { error: string } };

const UPLOAD_NAME = /^f\/[A-Za-z0-9_-]{24,64}\.bin$/;

export async function bootSecretsDb() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
  await db.exec(read('supabase/tests/supabase-stubs.sql'));
  await db.exec(read('supabase/schema.sql'));
  for (const m of allMigrations()) await db.exec(read(`supabase/migrations/${m}`));

  /** Every RPC from every fake client and from the route mirror, in order. */
  const allSql: SqlCall[] = [];
  /** Every `/api/open` request body the route mirror received, serialised as the phone/browser sent it. */
  const requests: string[] = [];
  /** Every `/api/open` response body, serialised. */
  const responses: string[] = [];
  /** The `secrets` bucket stand-in: object path -> uploaded bytes. */
  const objects = new Map<string, Uint8Array>();

  async function setRole(role: Role, userId: string | null) {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId ?? ''}', false);
      select set_config('request.jwt.claims', '${userId ? JSON.stringify({ sub: userId, role }) : '{}'}', false); set role ${role};`);
  }

  /** Runs `sql` as `role` (with `auth.uid()` = userId when given) and returns the rows. */
  async function asRole<T = Record<string, unknown>>(role: Role, userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
    await setRole(role, userId);
    try {
      return (await db.query<T>(sql, params)).rows;
    } finally {
      await db.exec('reset role;');
    }
  }

  async function predicate(role: Role, userId: string | null, fn: string, name: string): Promise<boolean> {
    const rows = await asRole<{ ok: boolean }>(role, userId, `select public.${fn}($1) ok`, [name]);
    return rows[0]?.ok ?? false;
  }

  async function addUser(user: FakeUser) {
    await db.query(`insert into auth.users(id, is_anonymous) values ($1, $2) on conflict do nothing`, [user.id, !!user.is_anonymous]);
  }

  /** PostgREST-style RPC: named arguments, `returns table` → array of rows, scalar → the value. */
  async function rpcAs(role: Role, userId: string | null, fn: string, args: Record<string, unknown>) {
    const call = { fn, args };
    allSql.push(call);
    const names = Object.keys(args).filter(k => args[k] !== undefined);
    const params = names.map(k => args[k]);
    const sig = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;
    const retset = (await db.query<{ s: boolean }>(`select proretset s from pg_proc where proname = $1`, [fn])).rows[0]?.s;
    try {
      const rows = await asRole<Record<string, unknown>>(role, userId, retset ? `select * from ${sig}` : `select ${sig} as v`, params);
      const conv = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
      return { data: retset ? rows.map(conv) : conv(rows[0]).v, error: null as null | { message: string } };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  }

  /**
   * A stand-in for the Supabase JS client as the website (`user === null`: the anonymous client, no
   * session) or a signed-in phone uses it for secrets: `rpc()` and the `secrets` bucket. `sql` is this
   * client's own RPC log; `uploads` what it put in the bucket.
   */
  function fakeSupabase(user: FakeUser | null, sql: SqlCall[] = []) {
    const role: Role = user ? 'authenticated' : 'anon';
    const uid = user?.id ?? null;
    const uploads: string[] = [];
    return {
      sql,
      uploads,
      async rpc(fn: string, args: Record<string, unknown>) {
        sql.push({ fn, args });
        return rpcAs(role, uid, fn, args);
      },
      storage: {
        from: (bucket: string) => ({
          async upload(name: string, body: Uint8Array | ArrayBuffer | Blob, _opts?: unknown) {
            void _opts;
            // Policy "onepass upload": bucket `secrets`, path f/<24..64 url-safe chars>.bin, no overwrite.
            if (bucket !== 'secrets' || !UPLOAD_NAME.test(name) || objects.has(name)) return { error: { message: 'new row violates row-level security policy' } };
            const bytes = body instanceof Uint8Array ? new Uint8Array(body) : body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(await body.arrayBuffer());
            objects.set(name, bytes);
            uploads.push(name);
            return { error: null };
          },
          async download(name: string): Promise<{ data: Blob | null; error: { message: string } | null }> {
            // Policy "onepass read claimed": only once the secret was opened (a live claim).
            const ok = bucket === 'secrets' && (await predicate(role, uid, 'is_claimed_file', name));
            const bytes = objects.get(name);
            if (!ok || !bytes) return { data: null, error: { message: 'Object not found' } };
            return { data: new Blob([bytes as BlobPart]), error: null };
          },
          async remove(names: string[]) {
            // Policy "onepass delete claimed" (004): only once fully burned, never between views.
            const removed: string[] = [];
            for (const name of names) {
              if (bucket === 'secrets' && (await predicate(role, uid, 'is_burned_file', name)) && objects.delete(name)) removed.push(name);
            }
            return { data: removed.map(name => ({ name })), error: null };
          },
        }),
      },
    };
  }

  /**
   * Mirror of `app/api/open/route.ts` POST: validates the id the way the route does, calls
   * `open_secret` as the service role with the network-location arguments (no device location, as a
   * phone or browser that did not share it), maps "no row" to 404 `gone` and a lock error to 403.
   * `country` is what Vercel's `x-vercel-ip-country` would carry.
   */
  async function openRoute(body: unknown, country: string | null = 'IN'): Promise<RouteResult> {
    requests.push(JSON.stringify(body));
    const b = (body ?? {}) as { id?: unknown; unlockToken?: unknown };
    const id = String(b.id || '');
    const reply = (status: number, json: RouteResult['json']): RouteResult => {
      responses.push(JSON.stringify(json));
      return { status, json };
    };
    if (!/^[A-Za-z0-9]{6,32}$/.test(id)) return reply(400, { error: 'invalid_id' });
    const unlockToken = typeof b.unlockToken === 'string' && /^[A-Za-z0-9_-]{20,80}$/.test(b.unlockToken) ? b.unlockToken : null;
    const args = { p_lat: null, p_lon: null, p_source: 'network', p_area: null, p_city: null, p_region: null, p_country: country };
    const { data, error } = await rpcAs('service_role', null, 'open_secret', { p_id: id, ...args, p_ip_country: country, p_unlock_token: unlockToken });
    const lock = /(geofence_location_required|geofence_imprecise|geofence_outside|timelock_until|timelock_window|country_blocked|recipient_locked)/.exec(error?.message || '');
    if (lock) return reply(403, { error: lock[1] });
    if (error) return reply(502, { error: 'open_failed' });
    const row = (Array.isArray(data) ? data[0] : null) as Record<string, unknown> | null;
    if (!row) return reply(404, { error: 'gone' });
    return reply(200, {
      header: row.header as string, body: (row.body as string | null) ?? null, file_path: (row.file_path as string | null) ?? null,
      views_left: typeof row.views_left === 'number' ? row.views_left : 0,
      final: typeof row.final === 'boolean' ? row.final : true,
      viewer_place: country,
    });
  }

  /** Every row of every public table, storage.objects, and the stored ciphertext as hex, as one text. */
  async function dumpDb(): Promise<string> {
    const tables = (await db.query<{ t: string }>(`select tablename t from pg_tables where schemaname = 'public' order by 1`)).rows.map(r => r.t);
    let out = '';
    for (const t of tables) {
      const r = (await db.query<{ d: string | null }>(`select string_agg(x::text, E'\n') d from public.${t} x`)).rows[0];
      if (r?.d) out += `-- ${t}\n${r.d}\n`;
    }
    for (const [name, bytes] of objects) out += `-- object ${name}\n${Buffer.from(bytes).toString('hex')}\n`;
    return out;
  }

  /** Moves a secret's expiry into the past (the web test pattern for "it expired"). */
  async function expire(id: string) {
    await db.query(`update public.secrets set expires_at = now() - interval '1 second' where id = $1`, [id]);
  }

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    return Number((await db.query<{ n: number | string }>(sql, params)).rows[0].n);
  }

  return { db, allSql, requests, responses, objects, asRole, rpcAs, addUser, fakeSupabase, openRoute, dumpDb, expire, count };
}
