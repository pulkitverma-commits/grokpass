// Offline and reconnect through the core (docs/mobile/test-plan.md §5.3 O1, O2, O6 at the client
// boundary): a phone whose Supabase stand-in fails like a phone with no network, then recovers, in a
// room with a browser that keeps talking. Real MLS, real SQL on PGlite, the real RN keystore on
// node:sqlite in memory; only the phone's transport is switched off and on (see test/devices.ts).
//
// What a phone with no network sees from supabase-js: postgrest-js catches the fetch rejection and
// returns `{ data: null, error: { message: 'TypeError: Network request failed', ... } }`; the client's
// `rpc()` wraps that in a ChatError whose `code` is the last `[a-z_]+` run of the message (`failed`).
// Realtime: `subscribe()` opens one private channel and reports `subscribed`; it has no handler for
// CHANNEL_ERROR / TIMED_OUT / CLOSED and never re-subscribes on its own (finding P3-Q3; the room screen
// compensates with a 4 s poll and a pull on foreground).
import { describe, it, expect, beforeAll } from 'vitest';
import { ChatError, type LocalMessage } from '../src/chat/client';
import * as mls from '../src/chat/mls';
import { hasNodeSqlite } from './rn-mocks';
import { bootDb, type Harness } from './harness';
import { pairUp, makeDevice, type Device } from './devices';

const TIMEOUT = 120_000;

let h: Harness;
beforeAll(async () => { h = await bootDb(); }, TIMEOUT);

const bodies = (ms: LocalMessage[]) => ms.map(m => m.body);
const settle = () => new Promise(r => setTimeout(r, 0));

async function stateOf(d: Device, roomId: string) {
  const b = await d.run(c => c.keystore.get<Uint8Array>(`room:${roomId}:state`));
  return b ? mls.loadState(b) : null;
}
async function lastSeqOf(d: Device, roomId: string) {
  return (await d.run(c => c.keystore.get<{ lastSeq: number }>(`room:${roomId}:local`)))?.lastSeq ?? 0;
}
async function serverCount(roomId: string) {
  return h.count(`select count(*)::int n from public.chat_messages where room_id = $1 and kind = 'app'`, [roomId]);
}

const describeOffline = hasNodeSqlite ? describe : describe.skip;

describeOffline('offline / reconnect: phone loses the network, the browser keeps talking', () => {
  it('O1: send while offline rejects with a ChatError (the same code every time) and leaves no message, no lastSeq change, nothing on the server', async () => {
    const { owner: web, guest: phone, roomId } = await pairUp(h, 'web', 'phone');
    await web.run(c => c.send(roomId, 'before', 300));
    expect((await phone.run(c => c.sync(roomId))).newMessages).toBe(1);
    const before = { msgs: bodies(await phone.run(c => c.messages(roomId))), lastSeq: await lastSeqOf(phone, roomId), server: await serverCount(roomId) };
    const epochBefore = mls.epoch((await stateOf(phone, roomId))!);

    phone.transport.mode = 'error';
    const codes: string[] = [];
    for (const body of ['lost-1', 'lost-2', 'lost-3']) {
      const err = await phone.run(c => c.send(roomId, body, 300)).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(ChatError);
      codes.push((err as ChatError).code);
    }
    // Stable across failures (today derived from the fetch message: 'failed'; P3-Q4 asks for a named code).
    expect(new Set(codes).size).toBe(1);
    expect(codes[0]).toMatch(/^[a-z_]+$/);
    expect(phone.transport.blocked).toEqual(['chat_send', 'chat_send', 'chat_send']);

    // No partial local state: the failed messages are not stored (no optimistic row), lastSeq is unchanged,
    // the pending-join slot is untouched, and nothing reached the server.
    expect(bodies(await phone.run(c => c.messages(roomId)))).toEqual(before.msgs);
    expect(await lastSeqOf(phone, roomId)).toBe(before.lastSeq);
    expect(await phone.run(c => c.keystore.get(`room:${roomId}:pending`))).toBeNull();
    expect(await serverCount(roomId)).toBe(before.server);
    // The epoch does not move on a failed send (only commits move it). The ratchet generation does:
    // the state is saved before the RPC so a crash can never reuse a generation. That is the one piece
    // of local state a failed send leaves behind, and O1-reconnect below proves the room survives it.
    expect(mls.epoch((await stateOf(phone, roomId))!)).toBe(epochBefore);
    // notify() is only ever called after a successful send.
    await settle();
    expect(phone.notify).not.toHaveBeenCalled();
  }, TIMEOUT);

  it('O1 (transport rejects instead of returning an error): send still rejects and leaves no partial state', async () => {
    const { guest: phone, roomId } = await pairUp(h, 'web', 'phone');
    const before = { msgs: await phone.run(c => c.messages(roomId)), lastSeq: await lastSeqOf(phone, roomId), server: await serverCount(roomId) };
    phone.transport.mode = 'reject';
    await expect(phone.run(c => c.send(roomId, 'lost', 300))).rejects.toThrow('Network request failed');
    expect(await phone.run(c => c.messages(roomId))).toEqual(before.msgs);
    expect(await lastSeqOf(phone, roomId)).toBe(before.lastSeq);
    expect(await serverCount(roomId)).toBe(before.server);
  }, TIMEOUT);

  it('O1-reconnect: after failed sends the phone sends again and the browser decrypts it; the lost ones never appear anywhere', async () => {
    const { owner: web, guest: phone, roomId } = await pairUp(h, 'web', 'phone');
    phone.transport.mode = 'error';
    await expect(phone.run(c => c.send(roomId, 'lost-a', 300))).rejects.toBeInstanceOf(ChatError);
    await expect(phone.run(c => c.send(roomId, 'lost-b', 300))).rejects.toBeInstanceOf(ChatError);
    phone.transport.mode = 'up';

    const sent = await phone.run(c => c.send(roomId, 'back online', 300));
    expect(sent?.body).toBe('back online');
    const r = await web.run(c => c.sync(roomId));
    expect(r.newMessages).toBe(1);
    // The skipped generations (two encrypts that never left the phone) do not stop the browser from reading the third.
    expect(bodies(await web.run(c => c.messages(roomId)))).toEqual(['back online']);
    expect(bodies(await phone.run(c => c.messages(roomId)))).toEqual(['back online']);
    expect(mls.epoch((await stateOf(web, roomId))!)).toBe(mls.epoch((await stateOf(phone, roomId))!));
    // Both directions still work afterwards.
    await web.run(c => c.send(roomId, 'ack', 300));
    expect((await phone.run(c => c.sync(roomId))).newMessages).toBe(1);
    expect(bodies(await phone.run(c => c.messages(roomId)))).toEqual(['back online', 'ack']);
  }, TIMEOUT);

  it('O2: sync while offline rejects and changes nothing; the first sync after reconnect catches up in order, once', async () => {
    const { owner: web, guest: phone, roomId } = await pairUp(h, 'web', 'phone');
    await web.run(c => c.send(roomId, 'w0', 300));
    expect((await phone.run(c => c.sync(roomId))).newMessages).toBe(1);

    phone.transport.mode = 'error';
    for (let i = 1; i <= 5; i++) await web.run(c => c.send(roomId, `w${i}`, 300));
    const offlineSync = await phone.run(c => c.sync(roomId)).then(() => null, (e: unknown) => e);
    expect(offlineSync).toBeInstanceOf(ChatError);
    expect((offlineSync as ChatError).code).not.toBe('not_a_member');   // a network error must never be read as "removed"
    expect(bodies(await phone.run(c => c.messages(roomId)))).toEqual(['w0']);
    expect(await stateOf(phone, roomId)).not.toBeNull();               // nothing forgotten
    expect(phone.transport.blocked).toEqual(['chat_fetch']);

    phone.transport.mode = 'up';
    const r = await phone.run(c => c.sync(roomId));
    expect(r).toEqual({ joined: false, removed: false, newMessages: 5, newAlerts: 0 });
    const msgs = await phone.run(c => c.messages(roomId));
    expect(bodies(msgs)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4', 'w5']);
    expect(new Set(msgs.map(m => m.id)).size).toBe(6);
    expect((await phone.run(c => c.sync(roomId))).newMessages).toBe(0);
    expect(bodies(await phone.run(c => c.messages(roomId)))).toEqual(['w0', 'w1', 'w2', 'w3', 'w4', 'w5']);
  }, TIMEOUT);

  it('O2 (lock): three concurrent syncs and a send on reconnect apply the backlog exactly once and keep the ratchet consistent', async () => {
    const { owner: web, guest: phone, roomId } = await pairUp(h, 'web', 'phone');
    phone.transport.mode = 'error';
    for (let i = 0; i < 8; i++) await web.run(c => c.send(roomId, `k${i}`, 300));
    await expect(phone.run(c => c.sync(roomId))).rejects.toBeInstanceOf(ChatError);
    phone.transport.mode = 'up';

    // Realtime ping, foreground pull and the 4 s poll can all fire at once when the network returns.
    const [a, b, c, sent] = await phone.run(cl => Promise.all([cl.sync(roomId), cl.sync(roomId), cl.sync(roomId), cl.send(roomId, 'mine', 300)]));
    expect(a.newMessages + b.newMessages + c.newMessages).toBe(8);
    expect(sent?.body).toBe('mine');
    const msgs = await phone.run(cl => cl.messages(roomId));
    expect(bodies(msgs.filter(m => !m.mine))).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7']);
    expect(new Set(msgs.map(m => m.id)).size).toBe(9);
    expect(phone.sql.filter(s => s.fn === 'chat_fetch' && Number(s.args.p_after) === 0).length).toBeGreaterThanOrEqual(1);

    expect((await web.run(cl => cl.sync(roomId))).newMessages).toBe(1);
    expect(bodies(await web.run(cl => cl.messages(roomId))).filter(x => x === 'mine')).toEqual(['mine']);
    expect(mls.epoch((await stateOf(web, roomId))!)).toBe(mls.epoch((await stateOf(phone, roomId))!));
  }, TIMEOUT);

  it('O6: messages sent by the web while the phone was offline arrive once, even when the realtime ping is delivered late and triggers a second sync', async () => {
    const { owner: web, guest: phone, roomId } = await pairUp(h, 'web', 'phone');
    const seen: string[] = [];
    const synced: number[] = [];
    // What the room screen does: on 'msg' pull (sync). The handler is wired before the outage.
    const off = phone.run(async c => c.subscribe(roomId, (event) => { seen.push(event); if (event === 'msg') void c.sync(roomId).then(r => synced.push(r.newMessages)); }));
    await settle();
    const ch = phone.realtime.channels[0];
    expect(ch).toBeDefined();
    expect(ch.name).toBe(`room:${roomId}`);
    ch.emitStatus('SUBSCRIBED');
    expect(seen).toEqual(['subscribed']);

    phone.transport.mode = 'error';
    ch.emitStatus('CHANNEL_ERROR');
    await web.run(c => c.send(roomId, 'while you were away', 300));
    await web.run(c => c.send(roomId, 'and this', 300));
    // The pings for those sends never reached the phone.
    phone.transport.mode = 'up';

    const r = await phone.run(c => c.sync(roomId));           // the pull on foreground / the poll
    expect(r.newMessages).toBe(2);
    ch.emitStatus('SUBSCRIBED');
    ch.broadcast('msg', { room: roomId });                       // a late ping for a message already applied
    await settle(); await settle();
    await new Promise(res => setTimeout(res, 50));
    expect(synced).toEqual([0]);
    const msgs = await phone.run(c => c.messages(roomId));
    expect(bodies(msgs)).toEqual(['while you were away', 'and this']);
    expect(new Set(msgs.map(m => m.id)).size).toBe(2);
    (await off)();
  }, TIMEOUT);

  it('P3-Q3 (documented): a channel that errors or closes is not re-subscribed by the core; unsubscribe removes the one channel', async () => {
    const { guest: phone, roomId } = await pairUp(h, 'web', 'phone');
    const events: string[] = [];
    const off = await phone.run(async c => c.subscribe(roomId, (e) => { events.push(e); }));
    await settle();
    expect(phone.realtime.channels).toHaveLength(1);
    expect(phone.realtime.setAuthCalls).toEqual([phone.token]);     // the private channel is authorised with the session token
    const ch = phone.realtime.channels[0];
    expect(ch.options).toEqual({ config: { private: true } });
    ch.emitStatus('SUBSCRIBED');
    ch.emitStatus('CHANNEL_ERROR');
    ch.emitStatus('TIMED_OUT');
    ch.emitStatus('CLOSED');
    await settle();
    // Nothing happens on those statuses: no new channel, no removal, no event to the screen.
    expect(phone.realtime.channels).toHaveLength(1);
    expect(phone.realtime.removed).toHaveLength(0);
    expect(events).toEqual(['subscribed']);
    // A broadcast on the old channel object still reaches the handler (realtime-js rejoins the same
    // channel by itself after a socket reconnect; the core adds nothing on top).
    ch.broadcast('msg', {});
    ch.broadcast('burned', {});
    expect(events).toEqual(['subscribed', 'msg', 'burned']);
    off();
    expect(phone.realtime.removed).toEqual([ch]);
  }, TIMEOUT);

  it('subscribe() torn down before the session lookup resolves never opens a channel', async () => {
    const phone = await makeDevice(h, 'phone', 'solo');
    const off = phone.c.subscribe('00000000-0000-4000-8000-000000000000', () => {});
    off();
    await settle(); await settle();
    expect(phone.realtime.channels).toHaveLength(0);
    expect(phone.realtime.removed).toHaveLength(0);
  }, TIMEOUT);
});
