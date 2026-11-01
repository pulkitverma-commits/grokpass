// In-memory stand-in for expo-sqlite's `openDatabaseSync`, understanding exactly the statements the
// core's RN keystore issues (packages/core/src/adapters/rn/keystore.ts). The core's own tests use
// node:sqlite (packages/core/test/rn-mocks.ts); jest-expo keeps this runner free of that experimental
// module, so the handful of statements are matched by hand here. Unknown SQL throws, so a new
// statement in the keystore fails this suite loudly instead of silently doing nothing.

type Bind = string | number | null | Uint8Array;
type SealedRow = { key: string; iv: Uint8Array; ct: Uint8Array; expires_at: number | null };

export type FakeDatabase = {
  sealed: Map<string, SealedRow>;
  meta: Map<string, string>;
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: Bind[]): Promise<{ changes: number }>;
  getFirstAsync<T>(sql: string, params: Bind[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params: Bind[]): Promise<T[]>;
};

export type FakeSqlite = {
  openDatabaseSync(name: string): FakeDatabase;
  /** Every database by file name; the same name returns the same database, like a real file. */
  files: Map<string, FakeDatabase>;
};

const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();

function createDatabase(): FakeDatabase {
  const sealed = new Map<string, SealedRow>();
  const meta = new Map<string, string>();
  const db: FakeDatabase = {
    sealed,
    meta,
    async execAsync(sql) {
      for (const stmt of sql.split(';').map(norm).filter(Boolean)) {
        if (!/^CREATE TABLE IF NOT EXISTS (sealed|meta)\(/.test(stmt)) throw new Error(`fake-sqlite: unsupported exec: ${stmt}`);
      }
    },
    async runAsync(sql, params) {
      const s = norm(sql);
      if (s === 'INSERT OR REPLACE INTO sealed(key, iv, ct, expires_at) VALUES (?, ?, ?, ?)') {
        const [key, iv, ct, expires_at] = params as [string, Uint8Array, Uint8Array, number | null];
        sealed.set(key, { key, iv: new Uint8Array(iv), ct: new Uint8Array(ct), expires_at });
        return { changes: 1 };
      }
      if (s === 'DELETE FROM sealed WHERE key = ?') return { changes: sealed.delete(params[0] as string) ? 1 : 0 };
      if (s === 'DELETE FROM sealed') { const n = sealed.size; sealed.clear(); return { changes: n }; }
      if (s === 'DELETE FROM sealed WHERE expires_at IS NOT NULL AND expires_at <= ?') {
        let n = 0;
        for (const [k, r] of sealed) if (r.expires_at !== null && r.expires_at <= (params[0] as number)) { sealed.delete(k); n++; }
        return { changes: n };
      }
      if (s === 'INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)') { meta.set(params[0] as string, params[1] as string); return { changes: 1 }; }
      if (s === 'DELETE FROM meta WHERE k = ?') return { changes: meta.delete(params[0] as string) ? 1 : 0 };
      throw new Error(`fake-sqlite: unsupported run: ${s}`);
    },
    async getFirstAsync<T>(sql: string, params: Bind[]) {
      const s = norm(sql);
      if (s === 'SELECT key, iv, ct, expires_at FROM sealed WHERE key = ?') return (sealed.get(params[0] as string) as T | undefined) ?? null;
      if (s === 'SELECT 1 AS one FROM sealed LIMIT 1') return sealed.size ? ({ one: 1 } as T) : null;
      if (s === 'SELECT v FROM meta WHERE k = ?') { const v = meta.get(params[0] as string); return v === undefined ? null : ({ v } as T); }
      throw new Error(`fake-sqlite: unsupported getFirst: ${s}`);
    },
    async getAllAsync<T>(sql: string) {
      const s = norm(sql);
      if (s === 'SELECT key FROM sealed ORDER BY key') return [...sealed.keys()].sort().map(key => ({ key }) as T);
      throw new Error(`fake-sqlite: unsupported getAll: ${s}`);
    },
  };
  return db;
}

export function createFakeSqlite(): FakeSqlite {
  const files = new Map<string, FakeDatabase>();
  return {
    files,
    openDatabaseSync(name) {
      let db = files.get(name);
      if (!db) { db = createDatabase(); files.set(name, db); }
      return db;
    },
  };
}
