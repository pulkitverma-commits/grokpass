// sync() / applyRows batching rules (docs/mobile/test-plan.md §11.4 P3-Q1, P3-Q2, P3-Q4), against
// real MLS and real SQL on PGlite (test/devices.ts). What is pinned here:
//   - a row that fails to decrypt mid-page is skipped; the page still ends in one state write and one
//     lastSeq write, and lastSeq is the seq of the last row that was applied;
//   - undecryptable rows at the end of a page are tried again on the next sync (lastSeq stops before
//     them) and passed over for good once a later row applies;
//   - a keystore failure mid-page rejects the sync and writes neither the state nor lastSeq, so the
//     persisted pair stays as it was and the whole page is applied on the next sync, nothing doubled;
//   - sync() pages while a page is full, at most SYNC_MAX_PAGES per call, and keeps the pages it
//     applied when a later page fails to download;
//   - the web client (web adapters, IndexedDB keystore) drains a multi-page backlog in one sync;
//   - transport failures become ChatError('network'); the server's own errors keep their codes.
import { describe, it, expect, beforeAll } from 'vitest';
import { ChatError, SYNC_MAX_PAGES, SYNC_PAGE_SIZE, toChatError } from '../src/chat/client';
import { hasNodeSqlite } from './rn-mocks';
import { bootDb, type Harness } from './harness';
import { pairUp, countPuts, sendMany, type Device } from './devices';

const TIMEOUT = 180_000;

let h: Harness;
beforeAll(async () => { if (hasNodeSqlite) h = await bootDb(); }, TIMEOUT);

async function lastSeqOf(d: Device, roomId: string) {
  return (await d.run(c => c.keystore.get<{ lastSeq: number }>(`room:${roomId}:local`)))?.lastSeq ?? 0;
}
async function seqOf(id: string) {
  return h.count(`select seq::int n from public.chat_messages where id = $1`, [id]);
}
/** Flips one byte near the end of a stored ciphertext (the AEAD tag), so nobody can decrypt it. */
async function tamper(id: string) {
  await h.db.query(`update public.chat_messages set ciphertext = set_byte(ciphertext, length(ciphertext) - 5, get_byte(ciphertext, length(ciphertext) - 5) # 255) where id = $1`, [id]);
}
async function sendIds(d: Device, roomId: string, n: number, prefix: string) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) { const id = crypto.randomUUID(); ids.push(id); await d.run(c => c.send(roomId, `${prefix}${i}`, 300, undefined, id)); }
  return ids;
}
/** Counts state and lastSeq writes while `fn` runs. */
async function writes<T>(d: Device, roomId: string, fn: () => Promise<T>) {
  const local = await countPuts(d, `room:${roomId}:local`, () => countPuts(d, `room:${roomId}:state`, fn));
  return { result: local.result.result, state: local.result.puts, local: local.puts };
}

const describeDb = hasNodeSqlite ? describe : describe.skip;

describeDb('applyRows (P3-Q1): one state + lastSeq write per page, decrypt and keystore failures', () => {
  it('a row that fails to decrypt mid-page is skipped; one state write, one lastSeq write, lastSeq at the last applied row', async () => {
    const { owner, guest: phone, roomId } = await pairUp(h, 'web', 'phone');
    const ids = await sendIds(owner, roomId, 5, 't');
    await tamper(ids[2]);
    const w = await writes(phone, roomId, () => phone.run(c => c.sync(roomId)));
    expect(w.result).toEqual({ joined: false, removed: false, newMessages: 4, newAlerts: 0 });
    expect(w.state).toBe(1);
    expect(w.local).toBe(1);
    expect(await lastSeqOf(phone, roomId)).toBe(await seqOf(ids[4]));
    expect((await phone.run(c => c.messages(roomId))).map(m => m.body)).toEqual(['t0', 't1', 't3', 't4']);
    // Passed over for good: the next sync asks for rows after t4 and writes nothing.
    const again = await writes(phone, roomId, () => phone.run(c => c.sync(roomId)));
    expect(again.result.newMessages).toBe(0);
    expect([again.state, again.local]).toEqual([0, 0]);
    // The ratchet the phone kept still reads what comes next.
    await owner.run(c => c.send(roomId, 'after', 300));
    expect((await phone.run(c => c.sync(roomId))).newMessages).toBe(1);
  }, TIMEOUT);

  it('undecryptable rows at the end of a page are tried once more on the next sync, then passed over once a later row applies', async () => {
    const { owner, guest: phone, roomId } = await pairUp(h, 'web', 'phone');
    const ids = await sendIds(owner, roomId, 3, 'e');
    await tamper(ids[2]);
    expect((await phone.run(c => c.sync(roomId))).newMessages).toBe(2);
    expect(await lastSeqOf(phone, roomId)).toBe(await seqOf(ids[1]));      // stops before the bad tail row

    const fetches = () => phone.sql.filter(s => s.fn === 'chat_fetch');
    const n = fetches().length;
    const retry = await writes(phone, roomId, () => phone.run(c => c.sync(roomId)));
    expect(retry.result.newMessages).toBe(0);
    expect([retry.state, retry.local]).toEqual([0, 0]);                      // nothing to write
    expect(Number(fetches()[n].args.p_after)).toBe(await seqOf(ids[1]));    // the bad row was asked for again

    const later = crypto.randomUUID();
    await owner.run(c => c.send(roomId, 'later', 300, undefined, later));
    expect((await phone.run(c => c.sync(roomId))).newMessages).toBe(1);
    expect(await lastSeqOf(phone, roomId)).toBe(await seqOf(later));
    expect((await phone.run(c => c.messages(roomId))).map(m => m.body)).toEqual(['e0', 'e1', 'later']);
  }, TIMEOUT);

  it('a keystore write failing mid-page rejects the sync and writes neither state nor lastSeq; the next sync applies the whole page once', async () => {
    const { owner, guest: phone, roomId } = await pairUp(h, 'web', 'phone');
    const ids = await sendIds(owner, roomId, 5, 'k');
    const ks = phone.c.keystore;
    const stateBefore = await ks.get<Uint8Array>(`room:${roomId}:state`);
    const seqBefore = await lastSeqOf(phone, roomId);
    const original = ks.put;
    ks.put = async (k, v, until) => {
      if (k === `room:${roomId}:msg:${ids[2]}`) throw new Error('disk full');
      return original.call(ks, k, v, until);
    };
    try {
      await expect(phone.run(c => c.sync(roomId))).rejects.toThrow('disk full');
    } finally {
      ks.put = original;
    }
    expect(await ks.get<Uint8Array>(`room:${roomId}:state`)).toEqual(stateBefore);
    expect(await lastSeqOf(phone, roomId)).toBe(seqBefore);

    const r = await phone.run(c => c.sync(roomId));
    expect(r.newMessages).toBe(5);                                           // k0, k1 are stored again under the same ids
    const msgs = await phone.run(c => c.messages(roomId));
    expect(msgs.map(m => m.body)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4']);
    expect(new Set(msgs.map(m => m.id)).size).toBe(5);
    expect(await lastSeqOf(phone, roomId)).toBe(await seqOf(ids[4]));
    // Ratchet consistent in both directions afterwards.
    await phone.run(c => c.send(roomId, 'reply', 300));
    expect((await owner.run(c => c.sync(roomId))).newMessages).toBe(1);
  }, TIMEOUT);
});

describeDb('sync paging (P3-Q2)', () => {
  /** Makes the phone's chat_fetch return full pages of rows it ignores (welcomes for a room it already has). */
  function fullPages(d: Device, failAt?: number) {
    const real = d.fake.rpc;
    let calls = 0;
    d.fake.rpc = async (fn, args) => {
      if (fn !== 'chat_fetch') return real(fn, args);
      calls++;
      d.sql.push({ fn, args });
      if (failAt && calls === failAt) return { data: null, error: { message: 'TypeError: Network request failed' } };
      const after = Number(args.p_after);
      const rows = Array.from({ length: Number(args.p_limit) }, (_, i) => ({
        id: crypto.randomUUID(), seq: after + i + 1, sender_device: crypto.randomUUID(), kind: 'welcome', epoch: 0,
        ciphertext: null, ttl_s: 300, created_at: new Date().toISOString(), expires_at: null,
      }));
      return { data: rows, error: null };
    };
    return { restore: () => { d.fake.rpc = real; }, calls: () => calls };
  }

  it(`stops after ${SYNC_MAX_PAGES} full pages; the next sync carries on from there`, async () => {
    const { guest: phone, roomId } = await pairUp(h, 'web', 'phone');
    const base = await lastSeqOf(phone, roomId);
    const f = fullPages(phone);
    try {
      const r = await phone.run(c => c.sync(roomId));
      expect(r).toEqual({ joined: false, removed: false, newMessages: 0, newAlerts: 0 });
      expect(f.calls()).toBe(SYNC_MAX_PAGES);
      expect(await lastSeqOf(phone, roomId)).toBe(base + SYNC_MAX_PAGES * SYNC_PAGE_SIZE);
      await phone.run(c => c.sync(roomId));
      expect(f.calls()).toBe(2 * SYNC_MAX_PAGES);
      const fetched = phone.sql.filter(s => s.fn === 'chat_fetch');
      expect(Number(fetched[fetched.length - SYNC_MAX_PAGES].args.p_after)).toBe(base + SYNC_MAX_PAGES * SYNC_PAGE_SIZE);
    } finally {
      f.restore();
    }
  }, TIMEOUT);

  it('a later page failing to download keeps the pages already applied and resolves; a first page failing still rejects', async () => {
    const { guest: phone, roomId } = await pairUp(h, 'web', 'phone');
    const base = await lastSeqOf(phone, roomId);
    let f = fullPages(phone, 3);
    try {
      const r = await phone.run(c => c.sync(roomId));
      expect(r.removed).toBe(false);
      expect(f.calls()).toBe(3);
      expect(await lastSeqOf(phone, roomId)).toBe(base + 2 * SYNC_PAGE_SIZE);
    } finally {
      f.restore();
    }
    f = fullPages(phone, 1);
    try {
      const err = await phone.run(c => c.sync(roomId)).then(() => null, (e: unknown) => e);
      expect((err as ChatError).code).toBe('network');
    } finally {
      f.restore();
    }
  }, TIMEOUT);

  it('the web client drains a 450-message backlog (three pages) in one sync, in order, once', async () => {
    const N = 450;
    const { owner: phone, guest: web, roomId } = await pairUp(h, 'phone', 'web');
    await sendMany(h, phone, roomId, N, i => `w${i}`);
    const before = web.sql.filter(s => s.fn === 'chat_fetch').length;
    const r = await web.run(c => c.sync(roomId));
    expect(r).toEqual({ joined: false, removed: false, newMessages: N, newAlerts: 0 });
    expect(web.sql.filter(s => s.fn === 'chat_fetch').length - before).toBe(3);
    const msgs = await web.run(c => c.messages(roomId));
    expect(msgs.map(m => m.body)).toEqual(Array.from({ length: N }, (_, i) => `w${i}`));
    expect((await web.run(c => c.sync(roomId))).newMessages).toBe(0);
  }, TIMEOUT);
});

describeDb('rpc transport failures (P3-Q4)', () => {
  it('a transport that rejects with anything (not only a TypeError) is ChatError(network); a server error keeps its code', async () => {
    const { guest: phone, roomId } = await pairUp(h, 'web', 'phone');
    const real = phone.fake.rpc;
    phone.fake.rpc = async () => { throw new Error('socket hang up'); };
    try {
      const err = await phone.run(c => c.sync(roomId)).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(ChatError);
      expect((err as ChatError).code).toBe('network');
    } finally {
      phone.fake.rpc = real;
    }
    // A real server refusal still reads as itself (and is handled as before: forget the room).
    const other = await pairUp(h, 'web', 'phone');
    await h.db.query(`update public.chat_rooms set state = 'burned' where id = $1`, [other.roomId]);
    expect((await other.guest.run(c => c.sync(other.roomId))).removed).toBe(true);
  }, TIMEOUT);
});

describe('toChatError (P3-Q4)', () => {
  it.each([
    ['TypeError: Network request failed', undefined],        // React Native
    ['TypeError: Failed to fetch', ''],                        // Chrome, via postgrest-js
    ['TypeError: Load failed', ''],                            // Safari
    ['TypeError: NetworkError when attempting to fetch resource.', ''], // Firefox
    ['TypeError: fetch failed', ''],                           // Node / undici
    ['FetchError: request to https://x/rest/v1/rpc/chat_fetch failed', ''],
  ])('%s -> network', (message, code) => {
    const e = toChatError({ message, code });
    expect(e.code).toBe('network');
    expect(e.message).toBe('network');
  });

  it.each([
    ['not_a_member', 'P0001', 'not_a_member'],
    ['rate_limited', 'P0001', 'rate_limited'],
    ['invite_invalid', undefined, 'invite_invalid'],
    ['TypeError: Network request failed', 'PGRST000', 'failed'],  // the server said it: not ours to rename
    ['permission denied for function chat_fetch', '42501', 'chat_fetch'],
  ])('%s (%s) keeps its code', (message, code, expected) => {
    expect(toChatError({ message, code }).code).toBe(expected);
  });
});
