// End-to-end encryption for Secret Chat: a thin adapter over ts-mls (MLS, RFC 9420).
// Everything that touches MLS goes through this file so the implementation can be
// swapped (e.g. for mls-rs compiled to WASM) without changing callers.
// ts-mls has not had a formal security audit; see docs/secret-chat/known-limitations.md.
//
// Wire format: every value that leaves the device is an encoded MLSMessage (Uint8Array).
// The server only ever stores and relays these bytes.

import {
  createApplicationMessage,
  createCommit,
  createGroup,
  joinGroup,
  processPrivateMessage,
  getCiphersuiteImpl,
  getCiphersuiteFromName,
  generateKeyPackage,
  generateKeyPackageWithKey,
  encodeMlsMessage,
  decodeMlsMessage,
  encodeGroupState,
  decodeGroupState,
  defaultCapabilities,
  defaultLifetime,
  emptyPskIndex,
  zeroOutUint8Array,
  defaultKeyRetentionConfig,
  defaultLifetimeConfig,
  defaultKeyPackageEqualityConfig,
  defaultPaddingConfig,
  defaultAuthenticationService,
  type CiphersuiteImpl,
  type ClientConfig,
  type ClientState,
  type KeyPackage,
  type PrivateKeyPackage,
  type Proposal,
} from 'ts-mls';

export const CIPHERSUITE = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519' as const;

// Pad application messages to hide exact lengths. Credentials are accepted here; identity is
// checked by the app (device registry + safety numbers), not by ts-mls' default auth service.
const clientConfig: ClientConfig = {
  keyRetentionConfig: defaultKeyRetentionConfig,
  lifetimeConfig: defaultLifetimeConfig,
  keyPackageEqualityConfig: defaultKeyPackageEqualityConfig,
  paddingConfig: defaultPaddingConfig,
  authService: defaultAuthenticationService,
};

let implPromise: Promise<CiphersuiteImpl> | null = null;
export function suite(): Promise<CiphersuiteImpl> {
  return (implPromise ??= getCiphersuiteImpl(getCiphersuiteFromName(CIPHERSUITE)));
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A device's one-time join material. `publicBytes` is uploaded; `privatePackage` never leaves the device. */
export type DeviceKeyPackage = { publicPackage: KeyPackage; privatePackage: PrivateKeyPackage; publicBytes: Uint8Array };

/** A device's long-term Ed25519 signing key. Its public half is what safety numbers verify. */
export type SigningKey = { publicKey: Uint8Array; signKey: Uint8Array };

export async function newSigningKey(): Promise<SigningKey> {
  return (await suite()).signature.keygen();
}

/**
 * Identity inside MLS is the opaque device id (a UUID), never an email or name.
 * Every KeyPackage reuses the device's signing key so its identity is stable across rooms.
 */
export async function newKeyPackage(deviceId: string, signing?: SigningKey): Promise<DeviceKeyPackage> {
  const cred = { credentialType: 'basic' as const, identity: enc.encode(deviceId) };
  const kp = signing
    ? await generateKeyPackageWithKey(cred, defaultCapabilities(), defaultLifetime, [], signing, await suite())
    : await generateKeyPackage(cred, defaultCapabilities(), defaultLifetime, [], await suite());
  const publicBytes = encodeMlsMessage({ keyPackage: kp.publicPackage, wireformat: 'mls_key_package', version: 'mls10' });
  return { publicPackage: kp.publicPackage, privatePackage: kp.privatePackage, publicBytes };
}

/** Rebuilds a stored KeyPackage from its uploaded bytes and private half. */
export function restoreKeyPackage(publicBytes: Uint8Array, privatePackage: PrivateKeyPackage): DeviceKeyPackage {
  const m = decodeOne(publicBytes);
  if (m.wireformat !== 'mls_key_package') throw new Error('not_key_package');
  return { publicPackage: m.keyPackage, privatePackage, publicBytes };
}

export function welcomeSignature(state: ClientState, deviceId: string) {
  return memberLeaves(state).find(m => m.deviceId === deviceId)?.signaturePublicKey ?? null;
}

export async function createRoom(roomId: string, own: DeviceKeyPackage): Promise<ClientState> {
  return createGroup(enc.encode(roomId), own.publicPackage, own.privatePackage, [], await suite(), clientConfig);
}

function decodeOne(bytes: Uint8Array) {
  const d = decodeMlsMessage(bytes, 0);
  if (!d) throw new Error('mls_decode_failed');
  return d[0];
}

/** Adds members from their uploaded key packages. Returns the commit (for existing members) and a welcome (for new ones). */
export async function addMembers(state: ClientState, keyPackages: Uint8Array[]) {
  const proposals: Proposal[] = keyPackages.map(b => {
    const m = decodeOne(b);
    if (m.wireformat !== 'mls_key_package') throw new Error('not_key_package');
    return { proposalType: 'add', add: { keyPackage: m.keyPackage } };
  });
  return commit(state, proposals);
}

/** Removes the leaves belonging to a device. Removed devices can't decrypt anything from the next epoch on. */
export async function removeDevice(state: ClientState, deviceId: string) {
  const leaves = memberLeaves(state).filter(m => m.deviceId === deviceId).map(m => m.leafIndex);
  if (!leaves.length) throw new Error('not_a_member');
  return commit(state, leaves.map(removed => ({ proposalType: 'remove', remove: { removed } }) as Proposal));
}

/** Empty commit: rotates the group's keys (post-compromise security). */
export async function rotate(state: ClientState) {
  return commit(state, []);
}

async function commit(state: ClientState, extraProposals: Proposal[]) {
  const r = await createCommit({ state, cipherSuite: await suite() }, { extraProposals, ratchetTreeExtension: true });
  r.consumed.forEach(zeroOutUint8Array);
  return {
    state: r.newState,
    commit: encodeMlsMessage(r.commit),
    welcome: r.welcome ? encodeMlsMessage({ welcome: r.welcome, wireformat: 'mls_welcome', version: 'mls10' }) : null,
  };
}

export async function joinRoom(welcome: Uint8Array, own: DeviceKeyPackage): Promise<ClientState> {
  const m = decodeOne(welcome);
  if (m.wireformat !== 'mls_welcome') throw new Error('not_welcome');
  return joinGroup(m.welcome, own.publicPackage, own.privatePackage, emptyPskIndex, await suite(), undefined, undefined, clientConfig);
}

/** Plaintext payload carried inside an MLS application message. */
export type ChatPayload =
  | { t: 'text'; id: string; body: string; ttl: number; replyTo?: string }
  | { t: 'file'; id: string; ttl: number; viewOnce: boolean; objectPath: string; key: string; name: string; mime: string; size: number }
  | { t: 'nick'; name: string };

export async function encrypt(state: ClientState, payload: ChatPayload) {
  const r = await createApplicationMessage(state, enc.encode(JSON.stringify(payload)), await suite());
  r.consumed.forEach(zeroOutUint8Array);
  const bytes = encodeMlsMessage({ privateMessage: r.privateMessage, wireformat: 'mls_private_message', version: 'mls10' });
  return { state: r.newState, ciphertext: bytes };
}

export type Incoming =
  | { kind: 'message'; state: ClientState; payload: ChatPayload; senderDeviceId: string | null }
  | { kind: 'commit'; state: ClientState; removedSelf: boolean };

/** Decrypts an application message or applies a commit. Throws on tampering, replay or wrong epoch. */
export async function receive(state: ClientState, bytes: Uint8Array, ownDeviceId: string): Promise<Incoming> {
  const m = decodeOne(bytes);
  if (m.wireformat !== 'mls_private_message') throw new Error('not_private_message');
  const r = await processPrivateMessage(state, m.privateMessage, emptyPskIndex, await suite());
  r.consumed.forEach(zeroOutUint8Array);
  if (r.kind === 'applicationMessage') {
    const payload = parsePayload(r.message);
    return { kind: 'message', state: r.newState, payload, senderDeviceId: null };
  }
  const removedSelf = r.newState.groupActiveState.kind !== 'active' || !memberLeaves(r.newState).some(l => l.deviceId === ownDeviceId);
  return { kind: 'commit', state: r.newState, removedSelf };
}

function parsePayload(bytes: Uint8Array): ChatPayload {
  const v = JSON.parse(dec.decode(bytes));
  if (!v || typeof v !== 'object' || !['text', 'file', 'nick'].includes(v.t)) throw new Error('bad_payload');
  return v as ChatPayload;
}

export function memberLeaves(state: ClientState) {
  const out: { leafIndex: number; deviceId: string; signaturePublicKey: Uint8Array }[] = [];
  state.ratchetTree.forEach((node, i) => {
    if (node && node.nodeType === 'leaf' && i % 2 === 0) {
      const cred = node.leaf.credential;
      if (cred.credentialType === 'basic') out.push({ leafIndex: i / 2, deviceId: dec.decode(cred.identity), signaturePublicKey: node.leaf.signaturePublicKey });
    }
  });
  return out;
}

export function epoch(state: ClientState): bigint {
  return state.groupContext.epoch;
}

/** Serialized group state for the local (encrypted) keystore. Contains private keys. */
export function saveState(state: ClientState): Uint8Array {
  return encodeGroupState(state);
}

export function loadState(bytes: Uint8Array): ClientState {
  const d = decodeGroupState(bytes, 0);
  if (!d) throw new Error('state_decode_failed');
  return { ...d[0], clientConfig };
}

/**
 * Safety number for verifying a contact out of band, built like Signal's: a 30-digit
 * fingerprint per signature key (5,200 rounds of SHA-256 over version || key || stable id),
 * the two fingerprints sorted and joined into 60 digits so both sides see the same value.
 */
export async function safetyNumber(a: { key: Uint8Array; id: string }, b: { key: Uint8Array; id: string }): Promise<string> {
  const [fa, fb] = await Promise.all([fingerprint(a.key, a.id), fingerprint(b.key, b.id)]);
  return [fa, fb].sort().join('');
}

async function fingerprint(key: Uint8Array, id: string): Promise<string> {
  const version = new Uint8Array([0, 1]);
  const idBytes = enc.encode(id);
  let h = concat(concat(version, key), idBytes);
  for (let i = 0; i < 5200; i++) h = new Uint8Array(await crypto.subtle.digest('SHA-256', concat(h, key)));
  let digits = '';
  for (let i = 0; i < 30; i += 5) {
    const n = (h[i] * 2 ** 32 + h[i + 1] * 2 ** 24 + h[i + 2] * 2 ** 16 + h[i + 3] * 2 ** 8 + h[i + 4]) % 100000;
    digits += String(n).padStart(5, '0');
  }
  return digits;
}

function concat(a: Uint8Array, b: Uint8Array) {
  const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o;
}
