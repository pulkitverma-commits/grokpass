// Performance of a 200-message sync through the core (docs/mobile/test-plan.md §11): a phone that was
// admitted while the browser kept talking pulls the backlog in `chat_fetch` pages (p_limit 200) within
// one sync() and decrypts it. Real MLS, real SQL on PGlite, the real RN keystore on node:sqlite in memory. The budget here is
// deliberately generous (this is a laptop running Postgres in WebAssembly, not a phone): the point of
// the assertion is "completes in one batch, nothing duplicated, nothing lost", and the number it prints
// is a baseline for the device measurement, not a substitute for it.
//
// The second half counts keystore writes during that batch: applyRows writes `room:<id>:state` and
// `room:<id>:local` (lastSeq) once each per page, together at the end (P3-Q1, test-plan §11.4; the crash
// and decrypt-failure rules are in client.ts above applyRows and in test/sync.batch.test.ts).
import { describe, it, expect, beforeAll } from 'vitest';
import { hasNodeSqlite } from './rn-mocks';
import { bootDb, type Harness } from './harness';
import { makeDevice, pairUp, countPuts, tokenOf, sendMany } from './devices';

const TIMEOUT = 180_000;
const N = 200;
/** Wall-clock budget for the 200-row applyRows on this machine (test-plan §11.2 explains the gap to the device target). */
const BUDGET_MS = 60_000;

let h: Harness;
beforeAll(async () => { h = await bootDb(); }, TIMEOUT);

const describePerf = hasNodeSqlite ? describe : describe.skip;

describePerf('perf: 200-message sync (web sends, phone catches up)', () => {
  it(`syncs ${N} messages in one sync (one full chat_fetch page, then an empty one): all present, in order, no duplicates, within budget`, async () => {
    // The phone is already a member (welcome applied) when the browser talks for a while.
    const { owner, guest: phone, roomId } = await pairUp(h, 'web', 'phone');
    const fetchesBefore = phone.sql.filter(s => s.fn === 'chat_fetch').length;
    await sendMany(h, owner, roomId, N, i => `m${String(i).padStart(3, '0')}`);
    expect(await h.count(`select count(*)::int n from public.chat_messages where room_id = $1 and kind = 'app'`, [roomId])).toBeGreaterThanOrEqual(N);

    const t0 = performance.now();
    const r = await phone.run(c => c.sync(roomId));
    const ms = performance.now() - t0;
    process.stdout.write(`perf sync.200 ${Math.round(ms)} ms (vitest, PGlite, node:sqlite in memory; not a device number)\n`);

    expect(r.joined).toBe(false);
    expect(r.newMessages).toBe(N);
    expect(r.newAlerts).toBe(0);
    const msgs = await phone.run(c => c.messages(roomId));
    expect(msgs).toHaveLength(N);
    expect(new Set(msgs.map(m => m.id)).size).toBe(N);
    expect(msgs.map(m => m.body)).toEqual(Array.from({ length: N }, (_, i) => `m${String(i).padStart(3, '0')}`));
    expect(msgs.every((m, i) => i === 0 || m.seq > msgs[i - 1].seq)).toBe(true);
    // A full page (exactly p_limit rows) makes sync() ask once more (P3-Q2); that second page is empty.
    expect(phone.sql.filter(s => s.fn === 'chat_fetch')).toHaveLength(fetchesBefore + 2);
    expect(ms).toBeLessThan(BUDGET_MS);

    // Idempotent: a second sync finds nothing and changes nothing.
    const again = await phone.run(c => c.sync(roomId));
    expect(again).toEqual({ joined: false, removed: false, newMessages: 0, newAlerts: 0 });
    expect(await phone.run(c => c.messages(roomId))).toHaveLength(N);
  }, TIMEOUT);

  // P3-Q2: a member whose first sync has to cover the welcome, the owner's nick announcements and 200
  // texts used to get the texts the first page had room for and the rest on the *next* poll. sync() now
  // keeps fetching while a page comes back full, so one call drains it: nothing duplicated, nothing lost.
  it(`a fresh member with a welcome in front of ${N} texts gets all of them from one sync (two pages), and loses nothing`, async () => {
    const owner = await makeDevice(h, 'web', 'owner');
    const phone = await makeDevice(h, 'phone', 'guest', true);
    const roomId = await owner.run(c => c.createRoom({ kind: 'secret', ttl: 300, mode: 'on_open', lifetime: 3600, name: 'qa-perf', nickname: 'Owner' }));
    const { link } = await owner.run(c => c.createInvite(roomId, { expiresIn: 3600, maxUses: 1, approval: false }));
    expect(await phone.run(c => c.redeemInvite(tokenOf(link), 'Phone'))).toBe(roomId);
    expect(await owner.run(c => c.admitPending(roomId))).toBe(1);
    await sendMany(h, owner, roomId, N, i => `f${i}`);

    const fetchesBefore = phone.sql.filter(s => s.fn === 'chat_fetch').length;
    const first = await phone.run(c => c.sync(roomId));
    expect(first).toEqual({ joined: true, removed: false, newMessages: N, newAlerts: 0 });
    // The first page (200 rows) also carried the welcome and the nick rows, so the texts spill into a second.
    const fetches = phone.sql.filter(s => s.fn === 'chat_fetch').slice(fetchesBefore);
    expect(fetches).toHaveLength(2);
    expect(Number(fetches[1].args.p_after)).toBeGreaterThan(Number(fetches[0].args.p_after));
    const msgs = await phone.run(c => c.messages(roomId));
    expect(msgs).toHaveLength(N);
    expect(new Set(msgs.map(m => m.id)).size).toBe(N);
    expect(msgs.map(m => m.body)).toEqual(Array.from({ length: N }, (_, i) => `f${i}`));
    expect((await phone.run(c => c.sync(roomId))).newMessages).toBe(0);
  }, TIMEOUT);

  it('lastSeq (room:<id>:local) and the MLS state (room:<id>:state) are each written once for a 200-row page', async () => {
    const { owner, guest: phone, roomId } = await pairUp(h, 'web', 'phone');
    await sendMany(h, owner, roomId, N, i => `b${i}`);

    const local = await countPuts(phone, `room:${roomId}:local`, () => countPuts(phone, `room:${roomId}:state`, () => phone.run(c => c.sync(roomId))));
    expect(local.result.result.newMessages).toBe(N);
    expect(local.puts).toBe(1);
    process.stdout.write(`perf sync.200 state writes: ${local.result.puts} for ${N} rows (target 1 per batch)\n`);
    // One page of 200 rows, then an empty page that writes nothing.
    expect(local.result.puts).toBe(1);
  }, TIMEOUT);

  // Target from the §11 budget (P3-Q1): one `room:<id>:state` write per applyRows batch.
  it('P3-Q1: saveState is called once per applyRows batch, not once per message', async () => {
    const { owner, guest: phone, roomId } = await pairUp(h, 'web', 'phone');
    for (let i = 0; i < 20; i++) await owner.run(c => c.send(roomId, `s${i}`, 300));
    const { result, puts } = await countPuts(phone, `room:${roomId}:state`, () => phone.run(c => c.sync(roomId)));
    expect(result.newMessages).toBe(20);
    expect(puts).toBeLessThanOrEqual(1);
  }, TIMEOUT);
});
