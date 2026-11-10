// Simulated devices for the Phase 3 core tests (perf, offline/reconnect): the same construction as
// `device()` in interop.integration.test.ts (a browser on the web adapters over fake-indexeddb, a phone
// on the RN adapters over a Map-backed SecureStore and node:sqlite in memory), plus two hooks the
// interop test does not need:
//   - `transport`: a switch that makes the phone's Supabase stand-in fail like a phone with no network
//     (every `rpc` returns a PostgREST-style fetch error, or rejects outright) until it is flipped back;
//   - a realtime channel stand-in that records subscriptions and lets a test push statuses and
//     broadcasts into whatever `subscribe()` registered.
// Nothing in here reaches a network; the harness runs the SQL functions directly on PGlite.
import { vi, type Mock } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createChatClient, type ChatClient } from '../src/chat/client';
import type { ChatEnv, RealtimeChannelLike, SupabaseLike } from '../src/chat/ports';
import { createWebPlatform } from '../src/adapters/web/platform';
import { createRnKeyStore } from '../src/adapters/rn/keystore';
import { createRnPlatform } from '../src/adapters/rn/platform';
import { createSecureStoreMock, createSqliteMock, createFetchRecorder, type SecureStoreMock, type SqliteMock } from './rn-mocks';
import type { Harness, SqlCall } from './harness';

export const PHONE_ORIGIN = 'https://onepeek.io';

export type Kind = 'web' | 'phone';

/**
 * What React Native's fetch says when the phone has no route: `TypeError: Network request failed`.
 * postgrest-js catches it and hands the client `{ data: null, error: { message: 'TypeError: Network
 * request failed', ... } }` (it never rejects unless `throwOnError()` was asked for), so that is the
 * default failure shape. `reject` is the other shape: the transport throws before postgrest-js sees it.
 */
export const RN_NETWORK_MESSAGE = 'TypeError: Network request failed';

export type Transport = {
  /** `up`: normal. `error`: every rpc returns the RN fetch error. `reject`: every rpc rejects with a TypeError. */
  mode: 'up' | 'error' | 'reject';
  /** rpc names that were attempted while the transport was down (nothing reached the database). */
  blocked: string[];
};

/** A realtime channel the test controls. */
export type FakeChannel = RealtimeChannelLike & {
  name: string;
  options: unknown;
  handlers: Array<(msg: { event: string; payload: unknown }) => void>;
  status: ((status: string) => void) | null;
  /** Deliver a status callback (`SUBSCRIBED`, `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`). */
  emitStatus(status: string): void;
  /** Deliver a broadcast (what the server's `realtime.send` fans out). */
  broadcast(event: string, payload?: unknown): void;
};

export type Realtime = {
  channels: FakeChannel[];
  removed: FakeChannel[];
  setAuthCalls: string[];
};

export type Device = {
  name: string;
  kind: Kind;
  userId: string;
  c: ChatClient;
  sql: SqlCall[];
  token: string;
  fake: ReturnType<Harness['fakeSupabase']>;
  notify: Mock<ChatEnv['notify']>;
  transport: Transport;
  realtime: Realtime;
  /** Runs one device's code; for a browser, with its own IndexedDB in place. */
  run<T>(fn: (c: ChatClient) => Promise<T>): Promise<T>;
  // Phone only.
  secure?: SecureStoreMock;
  sqlite?: SqliteMock;
};

function makeRealtime(): Realtime & { channel: SupabaseLike['channel']; removeChannel: SupabaseLike['removeChannel'] } {
  const channels: FakeChannel[] = [];
  const removed: FakeChannel[] = [];
  const setAuthCalls: string[] = [];
  return {
    channels, removed, setAuthCalls,
    channel(name, options) {
      const ch: FakeChannel = {
        name, options, handlers: [], status: null,
        on(_type, _filter, cb) { ch.handlers.push(cb); return ch; },
        subscribe(cb) { ch.status = cb ?? null; return ch; },
        emitStatus(s) { ch.status?.(s); },
        broadcast(event, payload = {}) { for (const h of ch.handlers) h({ event, payload }); },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch) { removed.push(ch as FakeChannel); },
  };
}

/** Wraps the harness's Supabase stand-in with the transport switch and the controllable realtime. */
function withFaults(fake: ReturnType<Harness['fakeSupabase']>, transport: Transport, rt: ReturnType<typeof makeRealtime>): SupabaseLike {
  return {
    ...fake,
    auth: fake.auth,
    storage: fake.storage,
    realtime: { setAuth: async (t: string) => { rt.setAuthCalls.push(t); } },
    channel: rt.channel,
    removeChannel: rt.removeChannel,
    async rpc(fn, args) {
      if (transport.mode === 'error') { transport.blocked.push(fn); return { data: null, error: { message: RN_NETWORK_MESSAGE } }; }
      if (transport.mode === 'reject') { transport.blocked.push(fn); throw new TypeError('Network request failed'); }
      return fake.rpc(fn, args);
    },
  };
}

export async function makeDevice(h: Harness, kind: Kind, name: string, anonymous = false): Promise<Device> {
  const userId = crypto.randomUUID();
  await h.addUser({ id: userId, is_anonymous: anonymous });
  const sql: SqlCall[] = [];
  const fake = h.fakeSupabase({ id: userId, is_anonymous: anonymous }, sql);
  const transport: Transport = { mode: 'up', blocked: [] };
  const rt = makeRealtime();
  const supabase = withFaults(fake, transport, rt);
  const realtime: Realtime = rt;
  const base = { name: `${name}(${kind})`, kind, userId, sql, token: fake.token, fake, transport, realtime };

  if (kind === 'web') {
    vi.resetModules();
    const { createWebKeyStore } = await import('../src/adapters/web/keystore');
    const idb = new IDBFactory();
    (globalThis as { indexedDB?: IDBFactory }).indexedDB = idb;
    const platform = createWebPlatform({ supabase, keystore: createWebKeyStore() });
    const notify = vi.fn<ChatEnv['notify']>(async () => {});
    platform.env = { ...platform.env, notify };
    const c = createChatClient(platform);
    return { ...base, c, notify, run: async fn => { (globalThis as { indexedDB?: IDBFactory }).indexedDB = idb; return fn(c); } };
  }

  const log: string[] = [];
  const secure = createSecureStoreMock(log);
  const sqlite = createSqliteMock(log);
  const rec = createFetchRecorder();
  const keystore = createRnKeyStore({ secureStore: secure.module, sqlite: sqlite.module, dbName: ':memory:', wrapKeyId: `onepeek.wrap.${userId}` });
  const platform = createRnPlatform({
    supabase, keystore, secureStore: secure.module,
    siteUrl: PHONE_ORIGIN, apiBaseUrl: PHONE_ORIGIN, deviceLabel: 'Redmi Note 13', fetch: rec.fetch,
  });
  // notify() is a POST to the site; there is no site here, so it is a spy that records and returns.
  const notify = vi.fn<ChatEnv['notify']>(async () => {});
  platform.env = { ...platform.env, notify };
  const c = createChatClient(platform);
  return { ...base, c, notify, run: fn => fn(c), secure, sqlite };
}

export const tokenOf = (link: string) => link.split('#')[1];

/** Owner creates a secret room, guest redeems the invite, owner admits, guest syncs the welcome. */
export async function pairUp(h: Harness, ownerKind: Kind, guestKind: Kind, opts: { ttl?: number } = {}) {
  const owner = await makeDevice(h, ownerKind, 'owner');
  const guest = await makeDevice(h, guestKind, 'guest', true);
  const roomId = await owner.run(c => c.createRoom({ kind: 'secret', ttl: opts.ttl ?? 300, mode: 'on_open', lifetime: 3600, name: 'qa-p3', nickname: 'Owner' }));
  const { link } = await owner.run(c => c.createInvite(roomId, { expiresIn: 3600, maxUses: 1, approval: false }));
  const token = tokenOf(link);
  if ((await guest.run(c => c.redeemInvite(token, 'Guest'))) !== roomId) throw new Error('redeem failed');
  if ((await owner.run(c => c.admitPending(roomId))) !== 1) throw new Error('admit failed');
  if (!(await guest.run(c => c.sync(roomId))).joined) throw new Error('guest did not join');
  return { owner, guest, roomId, token };
}

/** Counts keystore writes to one key while `fn` runs, without changing what is written. */
export async function countPuts<T>(d: Device, key: string, fn: () => Promise<T>): Promise<{ result: T; puts: number }> {
  const ks = d.c.keystore;
  const original = ks.put;
  let puts = 0;
  ks.put = async (k, v, until) => { if (k === key) puts++; return original.call(ks, k, v, until); };
  try {
    const result = await fn();
    return { result, puts };
  } finally {
    ks.put = original;
  }
}

/**
 * Sends `n` texts from one device. `chat_send` allows 120 per device per minute (migration 006), so
 * a real 200-message backlog accumulates over more than a minute or from several senders. Instead of
 * sleeping, the counter is moved the way the interop test moves the server clock: the device's `send`
 * window rows are deleted every 100 messages (server state, not a fake).
 */
export async function sendMany(h: Harness, d: Device, roomId: string, n: number, label: (i: number) => string, ttl = 300) {
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % 100 === 0) await h.db.query(`delete from public.chat_rate_limits where bucket = 'send'`);
    await d.run(c => c.send(roomId, label(i), ttl));
  }
}
