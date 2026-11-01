// PGlite + fake Supabase harness for the core's integration tests (docs/mobile/test-plan.md §2.1).
//
// This is the harness of lib/chat/client.integration.test.ts, duplicated rather than extracted: the
// web test keeps its own copy so its assertions stay byte-for-byte unchanged (the zero-diff rule for
// the C1 port). The one addition is that every fake client records its RPCs in its own log as well
// as the shared one, so a test can tell which device sent what.
//
// Only the network hop is replaced: `supabase.rpc()` runs the SQL function directly as that user,
// the way PostgREST would, and the storage stand-in applies the bucket's RLS checks.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { BinaryBody, SupabaseLike } from '../src/chat/ports';

/** Repository root (packages/core/test -> ../../..). */
export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
/** What the simulated browser's `window.location.origin` is. */
export const WEB_ORIGIN = 'https://onepeek.test';

export type SqlCall = { fn: string; args: Record<string, unknown> };
export type FakeUser = { id: string; is_anonymous?: boolean };

/** Chat migrations, in order: 006 and everything after it except rollbacks and the non-chat 007
 *  (it redefines create_request from 005, whose tables are not part of this schema). */
export function chatMigrations(): string[] {
  return readdirSync(path.join(ROOT, 'supabase/migrations'))
    .filter(f => /^\d{3}_.*\.sql$/.test(f) && !f.endsWith('_down.sql') && Number(f.slice(0, 3)) >= 6 && !f.startsWith('007_'))
    .sort();
}

function hexToBytes(s: string) { return new Uint8Array(Buffer.from(s.slice(2), 'hex')); }
function bytesToHex(b: Uint8Array) { return '\\x' + Buffer.from(b).toString('hex'); }

export type Harness = Awaited<ReturnType<typeof bootDb>>;

export async function bootDb() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  // Set after PGlite starts: a global `window` makes it think it is running in a browser.
  (globalThis as { window?: unknown }).window = { location: { origin: WEB_ORIGIN } };
  await db.exec(readFileSync(path.join(ROOT, 'supabase/tests/supabase-stubs.sql'), 'utf8'));
  for (const m of chatMigrations()) await db.exec(readFileSync(path.join(ROOT, 'supabase/migrations', m), 'utf8'));

  /** Every RPC from every fake client, in order. */
  const allSql: SqlCall[] = [];
  /** The bucket stand-in: object path -> uploaded bytes. */
  const objects = new Map<string, Uint8Array>();

  async function asUser(userId: string, sql: string, params: unknown[]) {
    try {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId}', false); set role authenticated;`);
      return (await db.query<{ ok: boolean }>(sql, params)).rows[0]?.ok ?? false;
    } finally {
      await db.exec('reset role;');
    }
  }

  async function addUser(user: FakeUser) {
    await db.query(`insert into auth.users(id, is_anonymous) values ($1, $2) on conflict do nothing`, [user.id, !!user.is_anonymous]);
  }

  /** A stand-in for the Supabase client, bound to one user. `sql` is this client's own RPC log. */
  function fakeSupabase(user: FakeUser, sql: SqlCall[] = []) {
    const token = `tok-${user.id.slice(0, 8)}`;
    const session = { user, access_token: token };
    const passkeyListCalls: number[] = [];
    const client: SupabaseLike & { sql: SqlCall[]; token: string; passkeyListCalls: number[] } = {
      sql, token, passkeyListCalls,
      auth: {
        getSession: async () => ({ data: { session } }),
        signInAnonymously: async () => ({ data: { session }, error: null }),
        passkey: { list: async () => { passkeyListCalls.push(Date.now()); return { data: [] }; } },
        signInWithPasskey: async () => ({ error: null }),
      },
      realtime: { setAuth: async () => {} },
      // Storage stand-in that applies the same checks as the bucket's RLS policies.
      storage: {
        from: (bucket: string) => ({
          async upload(name: string, body: Uint8Array | Blob) {
            const ok = await asUser(user.id, `select public.chat_attachment_writable($1) ok`, [name]);
            if (bucket !== 'chat-attachments' || !ok || objects.has(name)) return { error: { message: 'denied' } };
            objects.set(name, body instanceof Uint8Array ? new Uint8Array(body) : new Uint8Array(await body.arrayBuffer()));
            return { error: null };
          },
          async download(name: string): Promise<{ data: BinaryBody | null; error: { message: string } | null }> {
            const ok = await asUser(user.id, `select public.chat_attachment_readable($1) ok`, [name]);
            const bytes = objects.get(name);
            if (!ok || !bytes) return { data: null, error: { message: 'not found' } };
            return { data: new Blob([bytes as BlobPart]), error: null };
          },
        }),
      },
      channel: () => { const ch = { on() { return ch; }, subscribe() { return ch; } }; return ch; },
      removeChannel: () => {},
      async rpc(fn: string, args: Record<string, unknown>) {
        const call = { fn, args };
        sql.push(call);
        allSql.push(call);
        const names = Object.keys(args);
        const params = names.map(k => {
          const v = args[k];
          if (typeof v === 'string' && v.startsWith('\\x')) return hexToBytes(v);
          if (Array.isArray(v) && typeof v[0] === 'string' && v[0].startsWith('\\x')) return v.map(x => hexToBytes(x as string));
          return v;
        });
        const sig = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;
        const retset = (await db.query<{ s: boolean }>(`select proretset s from pg_proc where proname = $1`, [fn])).rows[0]?.s;
        try {
          await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user.id}', false); set role authenticated;`);
          const rows = (await db.query<Record<string, unknown>>(retset ? `select * from ${sig}` : `select ${sig} as v`, params)).rows;
          const conv = (r: Record<string, unknown>) =>
            Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Uint8Array ? bytesToHex(v) : v instanceof Date ? v.toISOString() : v]));
          return { data: retset ? rows.map(conv) : conv(rows[0]).v, error: null };
        } catch (e) {
          return { data: null, error: { message: (e as Error).message } };
        } finally {
          await db.exec('reset role;');
        }
      },
    };
    return client;
  }

  /** Every row of every chat_* table plus realtime.messages, as text (bytea renders as \x hex). */
  async function dumpDb(): Promise<string> {
    const tables = (await db.query<{ t: string }>(`select tablename t from pg_tables where schemaname = 'public' and tablename like 'chat\\_%' order by 1`)).rows.map(r => r.t);
    let out = '';
    for (const t of tables) {
      const r = (await db.query<{ d: string | null }>(`select string_agg(x::text, E'\n') d from public.${t} x`)).rows[0];
      out += `-- ${t}\n${r?.d ?? ''}\n`;
    }
    const rt = (await db.query<{ d: string | null }>(`select string_agg(x::text, E'\n') d from realtime.messages x`)).rows[0];
    out += `-- realtime.messages\n${rt?.d ?? ''}\n`;
    return out;
  }

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    return (await db.query<{ n: number }>(sql, params)).rows[0].n;
  }

  return { db, allSql, objects, asUser, addUser, fakeSupabase, dumpDb, count };
}
