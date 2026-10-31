// Test doubles for the React Native adapters (docs/mobile/test-plan.md §1.3). This is the only place
// in the tests where the expo module shapes are built by hand. Both mocks append to a shared call
// log so tests can assert ordering (e.g. the wrapping key is deleted before any row).

import { createRequire } from 'node:module';
import type { SecureStoreLike, SecureStoreOptionsLike, SqliteBindValue, SqliteDatabaseLike, SqliteModuleLike } from '../src/adapters/rn/keystore';

export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 7701;

export type SecureStoreMock = {
  module: SecureStoreLike;
  items: Map<string, string>;
  /** Options passed to every setItemAsync, by key. */
  setOptions: Map<string, SecureStoreOptionsLike | undefined>;
};

export function createSecureStoreMock(log: string[] = []): SecureStoreMock {
  const items = new Map<string, string>();
  const setOptions = new Map<string, SecureStoreOptionsLike | undefined>();
  const module: SecureStoreLike = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    async getItemAsync(key) { log.push(`secure.get ${key}`); return items.get(key) ?? null; },
    async setItemAsync(key, value, options) { log.push(`secure.set ${key}`); setOptions.set(key, options); items.set(key, value); },
    async deleteItemAsync(key) { log.push(`secure.delete ${key}`); items.delete(key); },
  };
  return { module, items, setOptions };
}

// node:sqlite (Node 22.13+). @types/node 20 has no declarations for it, so the subset is typed here.
type NodeStatement = {
  run(...params: unknown[]): { changes: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};
type NodeDatabase = { exec(sql: string): void; prepare(sql: string): NodeStatement };

let DatabaseSync: (new (path: string) => NodeDatabase) | null = null;
try {
  DatabaseSync = (createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => NodeDatabase }).DatabaseSync;
} catch {
  DatabaseSync = null;
}

/** True when this Node has `node:sqlite`; tests skip otherwise. */
export const hasNodeSqlite = DatabaseSync !== null;

export type SqliteMock = {
  module: SqliteModuleLike;
  /** Every opened database by name (`:memory:` databases are distinct per open). */
  opened: Map<string, NodeDatabase>;
  /** Dumps the `sealed` table of the last opened database. */
  dump(): { key: string; iv: Uint8Array; ct: Uint8Array; expires_at: number | null }[];
  /** Re-inserts rows (e.g. captured before a wipe) into the last opened database. */
  insert(rows: { key: string; iv: Uint8Array; ct: Uint8Array; expires_at: number | null }[]): void;
};

export function createSqliteMock(log: string[] = []): SqliteMock {
  if (!DatabaseSync) throw new Error('node:sqlite unavailable');
  const Ctor = DatabaseSync;
  const opened = new Map<string, NodeDatabase>();
  let last: NodeDatabase | null = null;
  const wrap = (db: NodeDatabase): SqliteDatabaseLike => ({
    async execAsync(sql) { log.push(`sql ${sql}`); db.exec(sql); },
    async runAsync(sql, params: SqliteBindValue[]) {
      log.push(`sql ${sql}`);
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async getFirstAsync<T>(sql: string, params: SqliteBindValue[]) {
      log.push(`sql ${sql}`);
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async getAllAsync<T>(sql: string, params: SqliteBindValue[]) {
      log.push(`sql ${sql}`);
      return db.prepare(sql).all(...params) as T[];
    },
  });
  const module: SqliteModuleLike = {
    openDatabaseSync(name) {
      const db = new Ctor(':memory:');
      opened.set(name, db);
      last = db;
      return wrap(db);
    },
  };
  type Row = { key: string; iv: Uint8Array; ct: Uint8Array; expires_at: number | null };
  const rows = (): Row[] => (last ? (last.prepare('SELECT key, iv, ct, expires_at FROM sealed ORDER BY key').all() as Row[]) : []);
  return {
    module,
    opened,
    dump: () => rows().map(r => ({ ...r, iv: new Uint8Array(r.iv), ct: new Uint8Array(r.ct) })),
    insert(rs) {
      if (!last) throw new Error('no database opened');
      for (const r of rs) last.prepare('INSERT OR REPLACE INTO sealed(key, iv, ct, expires_at) VALUES (?, ?, ?, ?)').run(r.key, r.iv, r.ct, r.expires_at);
    },
  };
}

/** A fetch recorder for env.notify tests. */
export function createFetchRecorder(fail = false) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (fail) throw new Error('network down');
    return new Response(null, { status: 204 });
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}
