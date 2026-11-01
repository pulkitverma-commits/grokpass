// F-2: safety numbers, "verified" and "key changed" come from the signature keys inside the MLS
// group, and a server that substitutes a member's key is caught (security review phase 3, §4.2 F-2).
// Real MLS, real SQL on PGlite; the "malicious server" is the test editing rows the server controls
// (chat_members.key_package, chat_devices.signature_pub) or delivering a Welcome it built itself.
import { describe, it, expect, beforeAll } from 'vitest';
import { toBytea, fromBytea, keyChanged, ChatError } from '../src/chat/client';
import * as mls from '../src/chat/mls';
import { bootDb, type Harness } from './harness';
import { makeDevice, pairUp, tokenOf, type Device } from './devices';

const TIMEOUT = 120_000;
let h: Harness;
beforeAll(async () => { h = await bootDb(); }, TIMEOUT);

async function listedKey(deviceId: string) {
  return (await h.db.query<{ k: Uint8Array }>(`select signature_pub k from public.chat_devices where id = $1`, [deviceId])).rows[0].k;
}
/** What safetyNumberWith returned before F-2: own key against the server-listed key. */
async function oldSafetyNumber(me: Device, roomId: string, them: string) {
  const dev = await me.run(c => c.ensureDevice());
  return mls.safetyNumber({ key: dev.signing.publicKey, id: dev.id }, { key: await listedKey(them), id: them });
}
async function codeOf(p: Promise<unknown>) {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(ChatError);
  return (e as ChatError).code;
}
async function localOf(d: Device, roomId: string) {
  return d.run(c => c.keystore.get<{ verified: Record<string, string>; mismatch?: Record<string, true> }>(`room:${roomId}:local`));
}
async function stateOf(d: Device, roomId: string) {
  const b = await d.run(c => c.keystore.get<Uint8Array>(`room:${roomId}:state`));
  return b ? mls.loadState(b) : null;
}
async function devId(d: Device) { return (await d.run(c => c.ensureDevice())).id; }

/** Owner + guest in a room where the guest has redeemed but is not admitted yet. */
async function pendingPair() {
  const owner = await makeDevice(h, 'web', 'owner');
  const guest = await makeDevice(h, 'web', 'guest', true);
  const roomId = await owner.run(c => c.createRoom({ kind: 'secret', ttl: 300, mode: 'on_open', lifetime: 3600, nickname: 'Owner' }));
  const { link } = await owner.run(c => c.createInvite(roomId, { expiresIn: 3600, maxUses: 2, approval: true }));
  await guest.run(c => c.redeemInvite(tokenOf(link), 'Guest'));
  return { owner, guest, roomId, link, guestId: await devId(guest), ownerId: await devId(owner) };
}

describe('F-2: member keys come from the MLS tree', () => {
  it('honest room: the tree holds the listed keys, numbers are byte-identical to the listing-based ones, verified marks are the same bytes', async () => {
    const { owner, guest, roomId } = await pairUp(h, 'web', 'web');
    const [o, g] = [await devId(owner), await devId(guest)];
    const tree = mls.leafSignatureKeys((await stateOf(owner, roomId))!);
    expect([...tree.keys()].sort()).toEqual([o, g].sort());
    expect(tree.get(g)).toEqual(await listedKey(g));
    expect(tree.get(o)).toEqual(await listedKey(o));

    const fromOwner = await owner.run(c => c.safetyNumberWith(roomId, g));
    const fromGuest = await guest.run(c => c.safetyNumberWith(roomId, o));
    expect(fromOwner).toMatch(/^\d{60}$/);
    expect(fromOwner).toBe(fromGuest);
    expect(fromOwner).toBe(await oldSafetyNumber(owner, roomId, g));
    expect(fromGuest).toBe(await oldSafetyNumber(guest, roomId, o));

    for (const m of await owner.run(c => c.members(roomId))) expect(m.keyMismatch).toBe(false);
    await owner.run(c => c.markVerified(roomId, g));
    // Stored exactly as before (the listed key's bytea), so marks made before F-2 still hold.
    expect((await localOf(owner, roomId))!.verified[g]).toBe(toBytea(await listedKey(g)));
    const mg = (await owner.run(c => c.members(roomId))).find(m => m.deviceId === g)!;
    expect(keyChanged(mg)).toBe(false);
  }, TIMEOUT);

  it('a substituted key package (server swaps Bob\'s package for one with its own key): the owner refuses to admit, flags the mismatch and never verifies', async () => {
    const { owner, guest, roomId, guestId } = await pendingPair();
    const forged = await mls.newKeyPackage(guestId);   // the server's own signing key, Bob's device id
    await h.db.query(`update public.chat_members set key_package = $1 where device_id = $2`, [forged.publicBytes, guestId]);

    expect(await owner.run(c => c.admitPending(roomId))).toBe(0);
    const bob = (await owner.run(c => c.members(roomId))).find(m => m.deviceId === guestId)!;
    expect(bob.state).toBe('pending');
    expect(bob.keyMismatch).toBe(true);
    expect(keyChanged(bob)).toBe(true);
    expect(await codeOf(owner.run(c => c.safetyNumberWith(roomId, guestId)))).toBe('member_key_mismatch');
    expect(await codeOf(owner.run(c => c.markVerified(roomId, guestId)))).toBe('member_key_mismatch');
    expect((await localOf(owner, roomId))!.verified).toEqual({});
    // Nothing was committed and Bob never got a Welcome.
    expect(await h.count(`select count(*)::int n from public.chat_messages where room_id = $1 and kind in ('commit', 'welcome')`, [roomId])).toBe(0);
    expect((await guest.run(c => c.sync(roomId))).joined).toBe(false);
    // A package for another device id under Bob's row is refused the same way.
    const other = await mls.newKeyPackage(crypto.randomUUID(), (await guest.run(c => c.ensureDevice())).signing);
    await h.db.query(`update public.chat_members set key_package = $1 where device_id = $2`, [other.publicBytes, guestId]);
    expect(await owner.run(c => c.admitPending(roomId))).toBe(0);
  }, TIMEOUT);

  it('a substituted listing (server rewrites Bob\'s signature_pub after he joined): member_key_mismatch on both sides, never marked verified', async () => {
    const { owner, guest, roomId } = await pairUp(h, 'web', 'web');
    const [o, g] = [await devId(owner), await devId(guest)];
    await owner.run(c => c.markVerified(roomId, g));
    const before = (await localOf(owner, roomId))!.verified[g];
    const fake = await mls.newSigningKey();
    await h.db.query(`update public.chat_devices set signature_pub = $1 where id = $2`, [fake.publicKey, g]);

    const seenByOwner = (await owner.run(c => c.members(roomId))).find(m => m.deviceId === g)!;
    expect(seenByOwner.keyMismatch).toBe(true);
    expect(seenByOwner.signaturePub).toEqual(mls.leafSignatureKeys((await stateOf(owner, roomId))!).get(g));  // the tree key, not the server's
    expect(keyChanged(seenByOwner)).toBe(true);
    expect(await codeOf(owner.run(c => c.safetyNumberWith(roomId, g)))).toBe('member_key_mismatch');
    expect(await codeOf(owner.run(c => c.markVerified(roomId, g)))).toBe('member_key_mismatch');
    expect((await localOf(owner, roomId))!.verified[g]).toBe(before);   // unchanged, not re-marked to the fake

    // Bob sees his own listing disagree with the group, so his number for the owner is refused too.
    expect((await guest.run(c => c.members(roomId))).find(m => m.deviceId === g)!.keyMismatch).toBe(true);
    expect(await codeOf(guest.run(c => c.safetyNumberWith(roomId, o)))).toBe('member_key_mismatch');
    expect(await codeOf(guest.run(c => c.markVerified(roomId, o)))).toBe('member_key_mismatch');
    expect((await localOf(guest, roomId))!.verified).toEqual({});
    // Messages still flow: the warning is shown, the chat is not silently broken.
    await owner.run(c => c.send(roomId, 'still here', 300));
    expect((await guest.run(c => c.sync(roomId))).newMessages).toBe(1);
  }, TIMEOUT);

  it('a commit that adds a key the server does not list is refused by the other members (sync rejects member_key_mismatch, the commit is not applied)', async () => {
    const { owner, guest: carol, roomId } = await pairUp(h, 'web', 'web');
    const o = await devId(owner);
    // Bob redeems honestly; then an owner client that does not check (an old build) adds a package
    // the server forged for Bob's device id.
    const bob = await makeDevice(h, 'web', 'bob', true);
    const { link } = await owner.run(c => c.createInvite(roomId, { expiresIn: 3600, maxUses: 1, approval: true }));
    await bob.run(c => c.redeemInvite(tokenOf(link), 'Bob'));
    const b = await devId(bob);
    const forged = await mls.newKeyPackage(b);
    const ownerState = (await stateOf(owner, roomId))!;
    const added = await mls.addMembers(ownerState, [forged.publicBytes]);
    const r = await owner.fake.rpc('chat_send', {
      p_room: roomId, p_device: o, p_id: crypto.randomUUID(), p_kind: 'commit', p_epoch: Number(mls.epoch(ownerState)),
      p_ciphertext: toBytea(added.commit), p_activate: [b],
    });
    expect(r.error).toBeNull();

    const epochBefore = mls.epoch((await stateOf(carol, roomId))!);
    expect(await codeOf(carol.run(c => c.sync(roomId)))).toBe('member_key_mismatch');
    expect(mls.epoch((await stateOf(carol, roomId))!)).toBe(epochBefore);        // not applied
    expect(mls.leafSignatureKeys((await stateOf(carol, roomId))!).has(b)).toBe(false);
    const seen = (await carol.run(c => c.members(roomId))).find(m => m.deviceId === b)!;
    expect(seen.keyMismatch).toBe(true);
    expect(await codeOf(carol.run(c => c.safetyNumberWith(roomId, b)))).toBe('member_key_mismatch');
    // It stays refused on the next sync (lastSeq did not move past it).
    expect(await codeOf(carol.run(c => c.sync(roomId)))).toBe('member_key_mismatch');
  }, TIMEOUT);

  it('a Welcome the server built itself (posing as the owner with its own key) is refused: no state kept, sync rejects member_key_mismatch', async () => {
    const { owner, guest, roomId, guestId, ownerId } = await pendingPair();
    const rows = (await owner.fake.rpc('chat_room_members', { p_room: roomId })).data as { device_id: string; key_package: string }[];
    const bobPackage = fromBytea(rows.find(m => m.device_id === guestId)!.key_package);
    const fakeOwner = await mls.newKeyPackage(ownerId);         // the owner's device id, the server's key
    const fakeRoom = await mls.createRoom(roomId, fakeOwner);
    const added = await mls.addMembers(fakeRoom, [bobPackage]);
    await h.db.query(`update public.chat_members set state = 'active', key_package = null where device_id = $1`, [guestId]);
    const r = await owner.fake.rpc('chat_send', {
      p_room: roomId, p_device: ownerId, p_id: crypto.randomUUID(), p_kind: 'welcome', p_epoch: 1,
      p_ciphertext: toBytea(added.welcome!), p_to_device: guestId,
    });
    expect(r.error).toBeNull();

    expect(await codeOf(guest.run(c => c.sync(roomId)))).toBe('member_key_mismatch');
    expect(await stateOf(guest, roomId)).toBeNull();
    expect(await guest.run(c => c.keystore.get(`room:${roomId}:pending`))).toBeTruthy();   // still waiting for a real Welcome
    expect((await localOf(guest, roomId))!.mismatch).toEqual({ [ownerId]: true });
    expect((await guest.run(c => c.members(roomId))).find(m => m.deviceId === ownerId)!.keyMismatch).toBe(true);
    expect(await codeOf(guest.run(c => c.safetyNumberWith(roomId, ownerId)))).toBe('member_key_mismatch');
    expect(await codeOf(guest.run(c => c.sync(roomId)))).toBe('member_key_mismatch');
  }, TIMEOUT);

  it('a legitimate re-join with a new key: no mismatch (tree and listing agree), keyChanged true from the tree, a new safety number', async () => {
    const { owner, guest, roomId } = await pairUp(h, 'web', 'web');
    const g = await devId(guest);
    await owner.run(c => c.markVerified(roomId, g));
    const oldNumber = await owner.run(c => c.safetyNumberWith(roomId, g));
    await owner.run(c => c.removeMember(roomId, g));

    // The same device id comes back with a new signing key that the server lists and the new key
    // package carries (what a key-rotation re-join looks like to the owner).
    const rotated = await mls.newSigningKey();
    const kp = await mls.newKeyPackage(g, rotated);
    await h.db.query(`update public.chat_devices set signature_pub = $1 where id = $2`, [rotated.publicKey, g]);
    await h.db.query(`update public.chat_members set state = 'pending', removed_at = null, key_package = $1 where device_id = $2`, [kp.publicBytes, g]);
    expect(await owner.run(c => c.admitPending(roomId))).toBe(1);

    const m = (await owner.run(c => c.members(roomId))).find(x => x.deviceId === g)!;
    expect(m.keyMismatch).toBe(false);
    expect(m.signaturePub).toEqual(rotated.publicKey);
    expect(m.verified).not.toBeNull();
    expect(keyChanged(m)).toBe(true);
    const newNumber = await owner.run(c => c.safetyNumberWith(roomId, g));
    expect(newNumber).not.toBe(oldNumber);
    await owner.run(c => c.markVerified(roomId, g));
    expect(keyChanged((await owner.run(c => c.members(roomId))).find(x => x.deviceId === g)!)).toBe(false);
  }, TIMEOUT);
});
