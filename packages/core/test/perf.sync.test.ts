// Performance of a 200-message sync through the core (docs/mobile/test-plan.md §11): a phone that was
// admitted while the browser kept talking pulls one full `chat_fetch` page (p_limit 200) and decrypts
// it. Real MLS, real SQL on PGlite, the real RN keystore on node:sqlite in memory. The budget here is
// deliberately generous (this is a laptop running Postgres in WebAssembly, not a phone): the point of
// the assertion is "completes in one batch, nothing duplicated, nothing lost", and the number it prints
// is a baseline for the device measurement, not a substitute for it.
//
// The second half counts keystore writes during that batch. Every ratchet step is saved before the
// next row is decrypted (forward secrecy: a crash must never reuse a generation), so today applyRows
// writes `room:<id>:state` once per row and `room:<id>:local` (lastSeq) once per batch. The §11 target is
// one state write per batch; that expectation is written as `it.fails` so it stays red-flag-free until
// core-crypto changes the batching and then turns into an ordinary passing test (see §11.4).
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
  it(`syncs ${N} messages in one chat_fetch page: all present, in order, no duplicates, within budget`, async () => {
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
    // One fetch page (p_limit 200) was enough: exactly one chat_fetch for this sync.
    expect(phone.sql.filter(s => s.fn === 'chat_fetch')).toHaveLength(fetchesBefore + 1);
    expect(ms).toBeLessThan(BUDGET_MS);

    // Idempotent: a second sync finds nothing and changes nothing.
    const again = await phone.run(c => c.sync(roomId));
    expect(again).toEqual({ joined: false, removed: false, newMessages: 0, newAlerts: 0 });
    expect(await phone.run(c => c.messages(roomId))).toHaveLength(N);
  }, TIMEOUT);

  // Finding P3-Q2 (core-crypto): `sync()` fetches one page of 200 rows and stops. A member whose first
  // sync has to cover the welcome, the owner's nick announcements and 200 texts gets the texts the page
  // has room for and the rest on the *next* sync (the room screen polls every 4 s, so nothing is lost,
  // but "200-message sync" is two round trips for a fresh member). This test pins the shape: nothing
  // duplicated, nothing lost, drained by the second call.
  it(`a fresh member with a welcome in front of ${N} texts needs two syncs (one page of 200 rows), and loses nothing`, async () => {
    const owner = await makeDevice(h, 'web', 'owner');
    const phone = await makeDevice(h, 'phone', 'guest', true);
    const roomId = await owner.run(c => c.createRoom({ kind: 'secret', ttl: 300, mode: 'on_open', lifetime: 3600, name: 'qa-perf', nickname: 'Owner' }));
    const { link } = await owner.run(c => c.createInvite(roomId, { expiresIn: 3600, maxUses: 1, approval: false }));
    expect(await phone.run(c => c.redeemInvite(tokenOf(link), 'Phone'))).toBe(roomId);
    expect(await owner.run(c => c.admitPending(roomId))).toBe(1);
    await sendMany(h, owner, roomId, N, i => `f${i}`);

    const first = await phone.run(c => c.sync(roomId));
    expect(first.joined).toBe(true);
    expect(first.newMessages).toBeLessThan(N);          // the page also carried the welcome and the nick rows
    expect(first.newMessages).toBeGreaterThan(N - 10);
    const second = await phone.run(c => c.sync(roomId));
    expect(first.newMessages + second.newMessages).toBe(N);
    const msgs = await phone.run(c => c.messages(roomId));
    expect(msgs).toHaveLength(N);
    expect(new Set(msgs.map(m => m.id)).size).toBe(N);
    expect(msgs.map(m => m.body)).toEqual(Array.from({ length: N }, (_, i) => `f${i}`));
    expect((await phone.run(c => c.sync(roomId))).newMessages).toBe(0);
  }, TIMEOUT);

  it('lastSeq (room:<id>:local) is written once per applyRows batch, and the batch is one keystore write per row today', async () => {
    const { owner, guest: phone, roomId } = await pairUp(h, 'web', 'phone');
    await sendMany(h, owner, roomId, N, i => `b${i}`);

    const local = await countPuts(phone, `room:${roomId}:local`, () => countPuts(phone, `room:${roomId}:state`, () => phone.run(c => c.sync(roomId))));
    expect(local.result.result.newMessages).toBe(N);
    expect(local.puts).toBe(1);
    // Documented behaviour, not the target: see the `it.fails` below and test-plan §11.4.
    process.stdout.write(`perf sync.200 state writes: ${local.result.puts} for ${N} rows (target 1 per batch)\n`);
    expect(local.result.puts).toBeGreaterThanOrEqual(1);
    expect(local.result.puts).toBeLessThanOrEqual(N);
  }, TIMEOUT);

  // Target from the §11 budget: one `room:<id>:state` write per applyRows batch. Red today by design
  // (applyRows saves after every row). When core-crypto batches the save, this test starts passing,
  // vitest reports it as failed ("expected to fail"), and qa removes `.fails`.
  it.fails('TARGET (core-crypto P3-Q1): saveState is called once per applyRows batch, not once per message', async () => {
    const { owner, guest: phone, roomId } = await pairUp(h, 'web', 'phone');
    for (let i = 0; i < 20; i++) await owner.run(c => c.send(roomId, `s${i}`, 300));
    const { result, puts } = await countPuts(phone, `room:${roomId}:state`, () => phone.run(c => c.sync(roomId)));
    expect(result.newMessages).toBe(20);
    expect(puts).toBeLessThanOrEqual(1);
  }, TIMEOUT);
});
