import { describe, it, expect } from 'vitest';
import * as mls from './mls';

const text = (body: string, id = crypto.randomUUID()) => ({ t: 'text' as const, id, body, ttl: 60 });

/** Alice creates a room and adds Bob (and optionally Carol). Returns everyone's state. */
async function room(withCarol = false) {
  const aliceKp = await mls.newKeyPackage('dev-alice');
  const bobKp = await mls.newKeyPackage('dev-bob');
  const carolKp = withCarol ? await mls.newKeyPackage('dev-carol') : null;
  let alice = await mls.createRoom('room-1', aliceKp);
  const added = await mls.addMembers(alice, [bobKp.publicBytes, ...(carolKp ? [carolKp.publicBytes] : [])]);
  alice = added.state;
  const bob = await mls.joinRoom(added.welcome!, bobKp);
  const carol = carolKp ? await mls.joinRoom(added.welcome!, carolKp) : null;
  return { alice, bob, carol };
}

describe('Secret Chat MLS adapter', () => {
  it('round-trips an encrypted message between two devices', async () => {
    let { alice, bob } = await room();
    const sent = await mls.encrypt(alice, text('hello bob'));
    const got = await mls.receive(bob, sent.ciphertext, 'dev-bob');
    expect(got.kind).toBe('message');
    if (got.kind === 'message') expect(got.payload).toMatchObject({ t: 'text', body: 'hello bob' });
  });

  it('never puts the plaintext in the ciphertext', async () => {
    const { alice } = await room();
    const marker = 'PLAINTEXT-MARKER-1234567890';
    const { ciphertext } = await mls.encrypt(alice, text(marker));
    expect(Buffer.from(ciphertext).toString('latin1')).not.toContain(marker);
    expect(Buffer.from(ciphertext).toString('base64')).not.toContain(Buffer.from(marker).toString('base64'));
  });

  it('rejects modified ciphertext', async () => {
    const { alice, bob } = await room();
    const { ciphertext } = await mls.encrypt(alice, text('integrity'));
    const tampered = ciphertext.slice();
    tampered[tampered.length - 5] ^= 0x01;
    await expect(mls.receive(bob, tampered, 'dev-bob')).rejects.toThrow();
  });

  it('rejects a replayed message', async () => {
    let { alice, bob } = await room();
    const { ciphertext } = await mls.encrypt(alice, text('once'));
    const first = await mls.receive(bob, ciphertext, 'dev-bob');
    bob = first.state;
    await expect(mls.receive(bob, ciphertext, 'dev-bob')).rejects.toThrow();
  });

  it('keeps rooms isolated: a member of one room cannot read another', async () => {
    const a = await room();
    const b = await room();
    const { ciphertext } = await mls.encrypt(a.alice, text('room A only'));
    await expect(mls.receive(b.bob, ciphertext, 'dev-bob')).rejects.toThrow();
  });

  it('locks a removed member out of later messages, while others keep reading', async () => {
    let { alice, bob, carol } = await room(true);
    const removal = await mls.removeDevice(alice, 'dev-bob');
    alice = removal.state;
    const bobSees = await mls.receive(bob!, removal.commit, 'dev-bob');
    expect(bobSees.kind === 'commit' && bobSees.removedSelf).toBe(true);
    const carolSees = await mls.receive(carol!, removal.commit, 'dev-carol');
    carol = carolSees.state;

    const after = await mls.encrypt(alice, text('bob is gone'));
    await expect(mls.receive(bobSees.state, after.ciphertext, 'dev-bob')).rejects.toThrow();
    const c = await mls.receive(carol, after.ciphertext, 'dev-carol');
    expect(c.kind === 'message' && c.payload.t === 'text' && c.payload.body).toBe('bob is gone');
  });

  it('advances the epoch on key rotation and still decrypts', async () => {
    let { alice, bob } = await room();
    const before = mls.epoch(alice);
    const r = await mls.rotate(alice);
    alice = r.state;
    bob = (await mls.receive(bob, r.commit, 'dev-bob')).state;
    expect(mls.epoch(alice)).toBe(before + BigInt(1));
    expect(mls.epoch(bob)).toBe(mls.epoch(alice));
    const m = await mls.receive(bob, (await mls.encrypt(alice, text('after rotate'))).ciphertext, 'dev-bob');
    expect(m.kind).toBe('message');
  });

  it('saves and restores group state', async () => {
    const { alice, bob } = await room();
    const restored = mls.loadState(mls.saveState(bob));
    const { ciphertext } = await mls.encrypt(alice, text('persisted'));
    const m = await mls.receive(restored, ciphertext, 'dev-bob');
    expect(m.kind === 'message' && m.payload.t === 'text' && m.payload.body).toBe('persisted');
  });

  it('lists members by device id', async () => {
    const { alice } = await room(true);
    expect(mls.memberLeaves(alice).map(m => m.deviceId).sort()).toEqual(['dev-alice', 'dev-bob', 'dev-carol']);
  });

  it('computes a symmetric 60-digit safety number that changes with the key', async () => {
    const { alice } = await room();
    const [a, b] = mls.memberLeaves(alice);
    const ab = await mls.safetyNumber({ key: a.signaturePublicKey, id: a.deviceId }, { key: b.signaturePublicKey, id: b.deviceId });
    const ba = await mls.safetyNumber({ key: b.signaturePublicKey, id: b.deviceId }, { key: a.signaturePublicKey, id: a.deviceId });
    expect(ab).toMatch(/^\d{60}$/);
    expect(ab).toBe(ba);
    const other = (await mls.newKeyPackage('dev-bob')).publicPackage.leafNode.signaturePublicKey;
    const changed = await mls.safetyNumber({ key: a.signaturePublicKey, id: a.deviceId }, { key: other, id: b.deviceId });
    expect(changed).not.toBe(ab);
  });
});
