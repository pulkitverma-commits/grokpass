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

    // Bob sees the server list a wrong key for him (shown on his own row), but that is the server's
    // listing being wrong about this device, not a member to distrust (F2-2): his number for the
    // owner is still computed from the two real keys, the same digits as before the lie.
    expect((await guest.run(c => c.members(roomId))).find(m => m.deviceId === g)!.keyMismatch).toBe(true);
    expect(await guest.run(c => c.safetyNumberWith(roomId, o))).toBe(await oldSafetyNumber(guest, roomId, o));
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
    expect((await localOf(guest, roomId))!.mismatch).toEqual({ [ownerId]: { key: toBytea(fakeOwner.publicPackage.leafNode.signaturePublicKey), seq: expect.any(Number), at: expect.any(Number), kind: 'welcome', reason: 'key' } });   // keyCheck refuses the listed owner's wrong key inside joinGroup
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

  // ---------------------------------------------------------------------------- review f2-tree-keys.md

  /** Owner + Carol (paired) + Bob admitted honestly, everyone synced. */
  async function trio() {
    const { owner, guest: carol, roomId } = await pairUp(h, 'web', 'web');
    const bob = await makeDevice(h, 'web', 'bob', true);
    const { link } = await owner.run(c => c.createInvite(roomId, { expiresIn: 3600, maxUses: 1, approval: true }));
    await bob.run(c => c.redeemInvite(tokenOf(link), 'Bob'));
    expect(await owner.run(c => c.admitPending(roomId))).toBe(1);
    expect((await bob.run(c => c.sync(roomId))).joined).toBe(true);
    await carol.run(c => c.sync(roomId));
    return { owner, carol, bob, roomId, o: await devId(owner), b: await devId(bob), cId: await devId(carol) };
  }

  it('F2-1 (1): a Welcome signed by a server device X that also holds the owner\'s real leaf is refused (signer is not the listed owner)', async () => {
    const { owner, guest, roomId, guestId, ownerId } = await pendingPair();
    const rows = (await owner.fake.rpc('chat_room_members', { p_room: roomId })).data as { device_id: string; key_package: string }[];
    const bobPackage = fromBytea(rows.find(m => m.device_id === guestId)!.key_package);
    // A package with the owner's real signing key (what any package the owner ever uploaded is).
    const ownerReal = await mls.newKeyPackage(ownerId, (await owner.run(c => c.ensureDevice())).signing);
    const x = await mls.newKeyPackage(crypto.randomUUID());     // the server's own device, never listed
    const fake = await mls.createRoom(roomId, x);
    const added = await mls.addMembers(fake, [ownerReal.publicBytes, bobPackage]);
    await h.db.query(`update public.chat_members set state = 'active', key_package = null where device_id = $1`, [guestId]);
    const r = await owner.fake.rpc('chat_send', {
      p_room: roomId, p_device: ownerId, p_id: crypto.randomUUID(), p_kind: 'welcome', p_epoch: 1,
      p_ciphertext: toBytea(added.welcome!), p_to_device: guestId,
    });
    expect(r.error).toBeNull();
    expect(await codeOf(guest.run(c => c.sync(roomId)))).toBe('member_key_mismatch');
    expect(await stateOf(guest, roomId)).toBeNull();
    expect(Object.keys((await localOf(guest, roomId))!.mismatch!)).toEqual([mls.leafSignatureKeys(added.state).keys().next().value]);
  }, TIMEOUT);

  it('F2-1 (2)+(3): a leaf the server stops listing still shows (unlisted, keyChanged) and is counted among the devices that can read the chat', async () => {
    const { carol, roomId, b } = await trio();
    const before = await carol.run(c => c.members(roomId));
    expect(before.filter(m => m.inGroup)).toHaveLength(3);
    expect(before.every(m => !m.unlisted)).toBe(true);
    await h.db.query(`delete from public.chat_members where device_id = $1`, [b]);   // the server hides Bob
    const after = await carol.run(c => c.members(roomId));
    const hidden = after.find(m => m.deviceId === b)!;
    expect(hidden).toMatchObject({ unlisted: true, inGroup: true, state: 'active', keyMismatch: false });
    expect(keyChanged(hidden)).toBe(true);
    expect(after.filter(m => m.inGroup)).toHaveLength(3);
    // It can be compared: a number from the tree key.
    expect(await carol.run(c => c.safetyNumberWith(roomId, b))).toMatch(/^\d{60}$/);
  }, TIMEOUT);

  it('F2-1 (4) + F2-8: a commit from a member that is not the owner is skipped and recorded; the room carries on and the owner\'s removal of that member applies for everyone', async () => {
    const { owner, carol, bob, roomId, b } = await trio();
    const st = (await stateOf(bob, roomId))!;
    const rot = await mls.rotate(st);
    const r = await bob.fake.rpc('chat_send', {
      p_room: roomId, p_device: b, p_id: crypto.randomUUID(), p_kind: 'commit', p_epoch: Number(mls.epoch(st)), p_ciphertext: toBytea(rot.commit),
    });
    expect(r.error).toBeNull();
    const epochBefore = mls.epoch((await stateOf(carol, roomId))!);
    await carol.run(c => c.sync(roomId));                                  // no rejection: skipped
    expect(mls.epoch((await stateOf(carol, roomId))!)).toBe(epochBefore);  // not applied
    expect((await localOf(carol, roomId))!.mismatch![b]).toMatchObject({ kind: 'commit', reason: 'committer' });
    expect((await carol.run(c => c.members(roomId))).find(m => m.deviceId === b)).toMatchObject({ changedGroup: true, keyMismatch: false, keyHistory: false });
    await owner.run(c => c.sync(roomId));                                  // the owner skips it too

    await owner.run(c => c.send(roomId, 'after the rogue commit', 300));
    await owner.run(c => c.removeMember(roomId, b));
    expect((await carol.run(c => c.sync(roomId))).newMessages).toBe(1);
    expect((await carol.run(c => c.messages(roomId))).map(m => m.body)).toContain('after the rogue commit');
    expect(mls.leafSignatureKeys((await stateOf(carol, roomId))!).has(b)).toBe(false);   // removal applied
    expect((await localOf(carol, roomId))!.mismatch ?? {}).toEqual({});                   // its record went with its leaf
  }, TIMEOUT);

  it('F2-7: with the owner pinned in the link, a server that lists its own device X as owner (Alice demoted) and has X sign a Welcome holding Alice\'s real leaf is refused', async () => {
    const { owner: alice, guest: bob, roomId, link, guestId, ownerId } = await pendingPair();
    const x = await makeDevice(h, 'web', 'x');
    const xDev = await x.run(c => c.ensureDevice());
    await h.db.query(`update public.chat_members set role = 'member' where device_id = $1`, [ownerId]);
    await h.db.query(`insert into public.chat_members(room_id, device_id, user_id, role, state) values ($1, $2, $3, 'owner', 'active')`, [roomId, xDev.id, x.userId]);
    const rows = (await alice.fake.rpc('chat_room_members', { p_room: roomId })).data as { device_id: string; key_package: string }[];
    const bobPackage = fromBytea(rows.find(m => m.device_id === guestId)!.key_package);
    const aliceReal = await mls.newKeyPackage(ownerId, (await alice.run(c => c.ensureDevice())).signing);
    const fake = await mls.createRoom(roomId, await mls.newKeyPackage(xDev.id, xDev.signing));
    const added = await mls.addMembers(fake, [aliceReal.publicBytes, bobPackage]);
    await h.db.query(`update public.chat_members set state = 'active', key_package = null where device_id = $1`, [guestId]);
    const r = await x.fake.rpc('chat_send', {
      p_room: roomId, p_device: xDev.id, p_id: crypto.randomUUID(), p_kind: 'welcome', p_epoch: 1,
      p_ciphertext: toBytea(added.welcome!), p_to_device: guestId,
    });
    expect(r.error).toBeNull();
    expect(link.split('#')[1]).toMatch(/\.1[A-Za-z0-9_-]{64}$/);
    expect(await codeOf(bob.run(c => c.sync(roomId)))).toBe('member_key_mismatch');
    expect(await stateOf(bob, roomId)).toBeNull();
    expect((await localOf(bob, roomId))!.mismatch![xDev.id]).toMatchObject({ kind: 'welcome', reason: 'signer' });
    expect((await bob.run(c => c.myRooms())).find(x2 => x2.id === roomId)!.ownerPinned).toBe(true);
  }, TIMEOUT);

  it('F2-7 compatibility: an old link without a pin still joins (owner from the listing) and the room says the owner is not pinned', async () => {
    const owner = await makeDevice(h, 'web', 'owner');
    const guest = await makeDevice(h, 'web', 'guest', true);
    const roomId = await owner.run(c => c.createRoom({ kind: 'secret', ttl: 300, mode: 'on_open', lifetime: 3600 }));
    const { link } = await owner.run(c => c.createInvite(roomId, { expiresIn: 3600, maxUses: 1, approval: false }));
    const bare = link.split('#')[1].split('.')[0];      // what a link made before F2-7 carries
    expect(await guest.run(c => c.peekInvite(bare))).toEqual({ needs_code: false, kind: 'secret' });
    expect(await guest.run(c => c.redeemInvite(bare, 'Old'))).toBe(roomId);
    expect(await owner.run(c => c.admitPending(roomId))).toBe(1);
    expect((await guest.run(c => c.sync(roomId))).joined).toBe(true);
    expect((await guest.run(c => c.myRooms())).find(x => x.id === roomId)!.ownerPinned).toBe(false);
    expect((await owner.run(c => c.myRooms())).find(x => x.id === roomId)!.ownerPinned).toBe(true);
    await owner.run(c => c.send(roomId, 'hello old link', 300));
    expect((await guest.run(c => c.sync(roomId))).newMessages).toBe(1);
    // A malformed pin is not silently dropped: the link is refused as invalid.
    await expect(guest.run(c => c.peekInvite(`${bare}.1${'A'.repeat(10)}`))).rejects.toMatchObject({ code: 'invite_invalid' });
  }, TIMEOUT);

  it('F2-9: refusals are recorded per row; a fake Welcome more than a page before the genuine one does not stop the join', async () => {
    const { owner, guest, roomId, guestId, ownerId } = await pendingPair();
    const rows = (await owner.fake.rpc('chat_room_members', { p_room: roomId })).data as { device_id: string; key_package: string }[];
    const bobPackage = fromBytea(rows.find(m => m.device_id === guestId)!.key_package);
    const fake = await mls.createRoom(roomId, await mls.newKeyPackage(crypto.randomUUID()));
    const forged = await mls.addMembers(fake, [bobPackage]);
    await h.db.query(`update public.chat_members set state = 'active' where device_id = $1`, [guestId]);
    await owner.fake.rpc('chat_send', { p_room: roomId, p_device: ownerId, p_id: crypto.randomUUID(), p_kind: 'welcome', p_epoch: 1, p_ciphertext: toBytea(forged.welcome!), p_to_device: guestId });
    // More than a page of traffic the guest can't read, then the owner's genuine admit.
    for (let i = 0; i < 210; i++) {
      if (i % 100 === 0) await h.db.query(`delete from public.chat_rate_limits where bucket = 'send'`);
      await owner.run(c => c.send(roomId, `pre-join ${i}`, 300));
    }
    await h.db.query(`update public.chat_members set state = 'pending', key_package = $1 where device_id = $2`, [bobPackage, guestId]);
    await h.db.query(`delete from public.chat_rate_limits where bucket = 'send'`);
    expect(await owner.run(c => c.admitPending(roomId))).toBe(1);
    // First sync: the refused Welcome and a full page; it rejects while not joined. A later one joins.
    expect(await codeOf(guest.run(c => c.sync(roomId)))).toBe('member_key_mismatch');
    let joined = false;
    for (let i = 0; i < 3 && !joined; i++) joined = await guest.run(c => c.sync(roomId)).then(r => r.joined, () => false);
    expect(joined).toBe(true);
    expect(await stateOf(guest, roomId)).not.toBeNull();
    await owner.run(c => c.send(roomId, 'after the genuine join', 300));
    expect((await guest.run(c => c.sync(roomId))).newMessages).toBeGreaterThanOrEqual(1);
  }, TIMEOUT);

  it('F2-2: a listing that lied for one sync leaves no permanent mark: the refused commit applies on the next honest sync and the flag clears', async () => {
    const { owner, carol, roomId } = await trio();
    const dave = await makeDevice(h, 'web', 'dave', true);
    const { link } = await owner.run(c => c.createInvite(roomId, { expiresIn: 3600, maxUses: 1, approval: true }));
    await dave.run(c => c.redeemInvite(tokenOf(link), 'Dave'));
    const d = await devId(dave);
    expect(await owner.run(c => c.admitPending(roomId))).toBe(1);
    const real = await listedKey(d);
    await h.db.query(`update public.chat_devices set signature_pub = $1 where id = $2`, [(await mls.newSigningKey()).publicKey, d]);
    expect(await codeOf(carol.run(c => c.sync(roomId)))).toBe('member_key_mismatch');
    expect((await localOf(carol, roomId))!.mismatch![d]).toMatchObject({ seq: expect.any(Number) });
    await h.db.query(`update public.chat_devices set signature_pub = $1 where id = $2`, [real, d]);
    await carol.run(c => c.sync(roomId));
    expect((await localOf(carol, roomId))!.mismatch ?? {}).toEqual({});
    const seen = (await carol.run(c => c.members(roomId))).find(m => m.deviceId === d)!;
    expect(seen).toMatchObject({ keyMismatch: false, keyHistory: false, inGroup: true });
    expect(await carol.run(c => c.safetyNumberWith(roomId, d))).toMatch(/^\d{60}$/);
  }, TIMEOUT);

  it('F2-2: an old flag on a member whose group key agrees now is history, not a block; marking verified clears it', async () => {
    const { owner, guest, roomId } = await pairUp(h, 'web', 'web');
    const g = await devId(guest);
    const local = await localOf(owner, roomId);
    await owner.run(c => c.keystore.put(`room:${roomId}:local`, { ...local, mismatch: { [g]: true } }));
    const m = (await owner.run(c => c.members(roomId))).find(x => x.deviceId === g)!;
    expect(m).toMatchObject({ keyMismatch: false, keyHistory: true });
    expect(await owner.run(c => c.safetyNumberWith(roomId, g))).toBe(await oldSafetyNumber(owner, roomId, g));
    await owner.run(c => c.markVerified(roomId, g));
    expect((await localOf(owner, roomId))!.mismatch).toEqual({});
    expect((await owner.run(c => c.members(roomId))).find(x => x.deviceId === g)!.keyHistory).toBe(false);
  }, TIMEOUT);

  it('F2-3: a listing that can\'t be fetched mid-page keeps the rows already applied, then rejects the sync', async () => {
    const { owner, carol, roomId } = await trio();
    await owner.run(c => c.send(roomId, 'one', 300));
    await owner.run(c => c.send(roomId, 'two', 300));
    const dave = await makeDevice(h, 'web', 'dave', true);
    const { link } = await owner.run(c => c.createInvite(roomId, { expiresIn: 3600, maxUses: 1, approval: true }));
    await dave.run(c => c.redeemInvite(tokenOf(link), 'Dave'));
    expect(await owner.run(c => c.admitPending(roomId))).toBe(1);   // a commit after the two texts
    const rpc = carol.fake.rpc;
    carol.fake.rpc = async (fn, args) => fn === 'chat_room_members' ? { data: null, error: { message: 'TypeError: Network request failed' } } : rpc(fn, args);
    const seqBefore = (await localOf(carol, roomId) as unknown as { lastSeq: number }).lastSeq;
    expect(await codeOf(carol.run(c => c.sync(roomId)))).toBe('network');
    const after = (await localOf(carol, roomId) as unknown as { lastSeq: number }).lastSeq;
    expect(after).toBeGreaterThan(seqBefore);   // the two texts were applied and saved
    expect((await carol.run(c => c.messages(roomId))).map(m => m.body)).toEqual(expect.arrayContaining(['one', 'two']));
    carol.fake.rpc = rpc;
    await carol.run(c => c.sync(roomId));
    expect(mls.leafSignatureKeys((await stateOf(carol, roomId))!).has(await devId(dave))).toBe(true);
  }, TIMEOUT);

  it('F2-4: a commit adding a non-UUID identity is a loud member_key_mismatch for the other members, not a silent skip', async () => {
    const { owner, carol, roomId, o } = await trio();
    const loose = mls.loadState((await owner.run(c => c.keystore.get<Uint8Array>(`room:${roomId}:state`)))!);   // the bare adapter's format check
    const odd = await mls.newKeyPackage('device-a');
    const added = await mls.addMembers(loose, [odd.publicBytes]);
    const r = await owner.fake.rpc('chat_send', {
      p_room: roomId, p_device: o, p_id: crypto.randomUUID(), p_kind: 'commit', p_epoch: Number(mls.epoch(loose)), p_ciphertext: toBytea(added.commit),
    });
    expect(r.error).toBeNull();
    expect(await codeOf(carol.run(c => c.sync(roomId)))).toBe('member_key_mismatch');
    // And the owner's own client would not have added it: its stored state checks ids strictly.
    const strict = mls.loadState((await owner.run(c => c.keystore.get<Uint8Array>(`room:${roomId}:state`)))!, { strictIds: true });
    await expect(mls.addMembers(strict, [odd.publicBytes])).rejects.toThrow();
  }, TIMEOUT);
});
