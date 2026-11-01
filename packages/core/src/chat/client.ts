// Secret Chat client: ties the Supabase RPCs, the MLS adapter and the local keystore together.
// Platform-neutral: everything browser- or phone-specific comes in through a ChatPlatform
// (see ./ports.ts); the web app binds it in lib/chat/client.ts. Nothing here sends plaintext
// anywhere: messages are MLS-encrypted before any network call, and the server sees device ids,
// sequence numbers and ciphertext.
//
// Membership changes (adding joiners, committing removals) are made by the room owner's
// client only, so two members never race to commit the same epoch. A joiner therefore waits
// until the owner's app is open to be admitted (see known-limitations.md).
//
// Member keys (security finding F-2). The signing key that counts is the one inside the encrypted
// group (each leaf of the MLS ratchet tree: identity = device id, key = leaf signature key), never
// the server's listing (`chat_room_members.signature_pub`). Safety numbers, "verified" and "key
// changed" are all computed from the tree, so a server that substitutes a key can no longer pass the
// out-of-band comparison. Where tree and listing agree (every honest case) the bytes are the same as
// before, so existing safety numbers and verified marks are unchanged. A disagreement is detected at:
//   1. admitPendingLocked (owner, before adding): a pending member's key package must name that
//      member's device id and carry the listed key; otherwise it is not admitted (and members()
//      shows it with keyMismatch).
//   2. applyRows, `welcome` row (joiner): joinRoom checks the Welcome's signer and every leaf of the
//      tree against the listing (mls.keyCheck); the signer must be the owner: the device and key
//      pinned in the invite link (F2-7, ./invite.ts), or, for a link made before the pin, the listed
//      owner. Otherwise nothing is kept, the device is flagged, lastSeq moves on (a genuine Welcome
//      later still applies, F2-9) and sync() rejects with ChatError('member_key_mismatch') until
//      this device has joined.
//   3. applyRows, commit rows (every member): receive() checks the committer's new leaf and every
//      added key package against the listing, and only the owner (pinned, else listed) may commit
//      (only the owner's app commits in this design: adds, removals; no self-updates). A change
//      from anyone else is skipped and recorded (`changedGroup`) and sync carries on (F2-8); a key
//      or format refusal of the owner's own commit leaves it unapplied, flags the device and rejects
//      sync() (rows before it are saved).
//   4. members() / safetyNumberWith() / markVerified(): every call compares each tree leaf with the
//      current listing (catches a listing changed after the fact), and lists every leaf the server
//      does not list as `unlisted` (it can read the chat). A mismatched member has
//      `keyMismatch: true`, its safety number throws ChatError('member_key_mismatch') and it can't
//      be marked verified.
// Device ids must be lowercase UUIDs everywhere (the stored state too, so the owner can't add
// another); a malformed credential refuses the row like a key mismatch, never silently (F2-4).
// Refusal flags are records, not blocks (F2-2): cleared when the refused row later applies, when
// the device's leaf is removed, or by marking an agreeing key verified; a flag on this device
// itself only says the server's listing was wrong about it. New unlisted leaves are not refused
// (an honest member can leave before others sync); they are shown. Before admission a pending
// member has no leaf; see known-limitations.md.

import { randomToken, newKey, importKey, encryptBytes, decryptBytes } from '../crypto';
import * as mls from './mls';
import { encodePin, ownerPin, parseInviteFragment, keyHash, type OwnerPin } from './invite';
import type { ChatPlatform, FileSource, OpenedFile, RealtimeChannelLike, SupabaseLike, SupabaseSession } from './ports';

export type RoomKind = 'quick' | 'secret' | 'business';
export type ExpiryMode = 'on_open' | 'on_send';

export type LocalMessage = {
  id: string;
  seq: number;
  mine: boolean;
  sender: string;            // device id
  body: string;
  ttl: number;               // seconds
  sentAt: number;            // ms
  expiresAt: number | null;  // ms; null = countdown not started (unopened)
  replyTo?: string;
  file?: Extract<mls.ChatPayload, { t: 'file' }>;
  viewed?: boolean;          // a view-once file this device has already opened
  pending?: boolean;         // shown on screen while it is still being sent (never stored)
  alert?: 'screenshot';      // a notice that someone pressed a screenshot shortcut, not a message
};

export type RoomSummary = {
  id: string; kind: RoomKind; role: 'owner' | 'member'; memberState: 'pending' | 'active';
  ttl: number; mode: ExpiryMode; expiresAt: string; name: string | null;
  /**
   * F2-7: true when this device knows the owner from outside the server (it is the owner, or it
   * joined with a link that pinned the owner's device and key). false: joined from a link without a
   * pin (made before the pin existed), so who runs the chat is the server's word.
   */
  ownerPinned: boolean;
};

export type DeviceRecord = { id: string; signing: mls.SigningKey; userId: string };
/** A row of `chat_room_members` as PostgREST returns it (bytea as "\\x<hex>"). */
type MemberRow = { device_id: string; role: 'owner' | 'member'; state: 'pending' | 'active'; signature_pub: string | null; key_package: string | null };
type PendingJoin = { publicBytes: Uint8Array; privatePackage: mls.DeviceKeyPackage['privatePackage']; nickname: string };
type RoomLocal = {
  name: string | null; lastSeq: number; nicknames: Record<string, string>; verified: Record<string, string>;
  /**
   * Devices named by a refused Welcome or commit (F-2): the offending key when known (bytea hex),
   * the refused row's seq and when. A record, not a permanent block: cleared when that row later
   * applies, when the device's leaf is removed, or when the member is verified on an agreeing key.
   * (`true` is the format of the first F-2 build, read as `{ seq: 0, at: 0 }`.)
   */
  mismatch?: Record<string, MismatchFlag | true>;
};
type MismatchFlag = { key: string | null; seq: number; at: number; kind?: 'welcome' | 'commit'; reason?: mls.KeyMismatchReason };
/** `room:<id>:ownerPin`: the owner as the invite link pinned it (F2-7), or `pin: null` for a link without one. */
type StoredPin = { pin: OwnerPin | null };

// ---- bytea over PostgREST: sent and received as "\x<hex>"
export function toBytea(b: Uint8Array) {
  let s = '\\x';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}
export function fromBytea(v: string | null): Uint8Array {
  if (!v) return new Uint8Array();
  const hex = v.startsWith('\\x') ? v.slice(2) : v;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export class ChatError extends Error {
  code: string;
  constructor(message: string) {
    super(message);
    this.code = /([a-z_]+)$/.exec(message)?.[1] ?? 'error';
  }
}

/**
 * What a fetch that never reached the server says, per runtime: React Native `Network request
 * failed`, Chrome `Failed to fetch`, Safari `Load failed`, Firefox `NetworkError when attempting to
 * fetch resource.`, Node/undici `fetch failed`. postgrest-js puts it in `error.message` (prefixed
 * with the error's name) and leaves `error.code` empty.
 */
const TRANSPORT_FAILURE = /network request failed|failed to fetch|load failed|networkerror|fetch failed|^fetcherror\b/i;
/** A PostgREST error code that only the server produces (SQLSTATE such as P0001, or PGRST…). */
const SERVER_CODE = /^(?:[0-9A-Z]{5}|PGRST\w+)$/;

/** `ChatError('network')` for a transport failure; the server's own errors keep their codes. */
export function toChatError(error: { message: string; code?: string }): ChatError {
  const fromServer = typeof error.code === 'string' && SERVER_CODE.test(error.code);
  if (!fromServer && TRANSPORT_FAILURE.test(error.message)) return new ChatError('network');
  return new ChatError(error.message);
}

/** Files are capped by the storage bucket (50 MB, including 28 bytes of encryption overhead). */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024 - 1024;
const BUCKET = 'chat-attachments';

/**
 * True when a member's key can't be trusted as verified: a verified member whose key in the
 * encrypted group no longer matches what was verified, or any member whose key in the group and in
 * the server's listing disagree (`keyMismatch`, possible key substitution).
 */
export function keyChanged(m: { verified: string | null; signaturePub: Uint8Array; keyMismatch?: boolean; unlisted?: boolean }) {
  return !!m.keyMismatch || !!m.unlisted || (!!m.verified && m.verified !== toBytea(m.signaturePub));
}

/**
 * What one sync() applied. `newMessages` counts text and file messages from other devices;
 * `newAlerts` counts screenshot notices, which are shown in the room but are not messages (so an
 * unread badge built on newMessages stays honest).
 */
export type SyncResult = { joined: boolean; removed: boolean; newMessages: number; newAlerts: number };

/** Delays before re-opening a room channel after CHANNEL_ERROR / TIMED_OUT / CLOSED; the last one repeats. */
export const RESUBSCRIBE_DELAYS_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 30_000];

/** Rows asked for per `chat_fetch` call (the server caps it at 500). */
export const SYNC_PAGE_SIZE = 200;
/** Pages one sync() pulls at most before returning (4 000 rows); the next sync carries on. */
export const SYNC_MAX_PAGES = 20;

export type ChatClient<S extends SupabaseSession = SupabaseSession> = ReturnType<typeof createChatClient<S>>;

/**
 * Builds a chat client bound to one platform. Each client has its own device cache and its own
 * per-room locks, so two clients in one process (e.g. two simulated browsers in a test) never
 * share state.
 */
export function createChatClient<S extends SupabaseSession = SupabaseSession>(platform: ChatPlatform<S>) {
  const ks = platform.keystore;
  const env = platform.env;

  function sb(): SupabaseLike<S> {
    if (!platform.supabase) throw new Error('not_configured');
    return platform.supabase;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
    const client = sb();
    let out: { data: unknown; error: { message: string; code?: string } | null };
    try {
      out = await client.rpc(fn, args);
    } catch {
      // The transport threw instead of returning `{ error }` (a fetch TypeError, an aborted
      // request, a rejected promise): nothing came back from the server, so it is a network error.
      // The original error is not kept: its message can carry the request URL.
      throw new ChatError('network');
    }
    if (out.error) throw toChatError(out.error);
    return out.data as T;
  }

  // ---------------------------------------------------------------------------- session & device

  /** Signed-in user, or a fresh anonymous (guest) session when `guest` is allowed. */
  async function ensureSession(guest = false) {
    const { data } = await sb().auth.getSession();
    if (data.session) return data.session;
    if (!guest) return null;
    const { data: anon, error } = await sb().auth.signInAnonymously();
    if (error || !anon.session) throw new ChatError(error?.message || 'guest_sign_in_failed');
    return anon.session;
  }

  let deviceCache: DeviceRecord | null = null;

  /** This device's chat identity for the current user, registering one on first use. */
  async function ensureDevice(): Promise<DeviceRecord> {
    const session = await ensureSession(false);
    if (!session) throw new ChatError('not_signed_in');
    if (deviceCache && deviceCache.userId === session.user.id) return deviceCache;
    const key = `device:${session.user.id}`;
    const existing = await ks.get<DeviceRecord>(key);
    if (existing) { deviceCache = existing; return existing; }
    const signing = await mls.newSigningKey();
    const label = env.deviceLabel();
    const id = await rpc<string>('chat_register_device', { p_signature_pub: toBytea(signing.publicKey), p_label: label });
    const rec: DeviceRecord = { id, signing, userId: session.user.id };
    await ks.put(key, rec);
    deviceCache = rec;
    return rec;
  }

  async function listDevices() {
    return rpc<{ id: string; label: string; created_at: string; last_seen: string; revoked_at: string | null }[]>('chat_list_devices', {});
  }

  async function revokeDevice(id: string) {
    await rpc('chat_revoke_device', { p_device: id });
    const session = await ensureSession(false);
    const mine = session ? await ks.get<DeviceRecord>(`device:${session.user.id}`) : null;
    if (mine?.id === id) await ks.wipe();
  }

  // ---------------------------------------------------------------------------- local room data

  const roomKey = (id: string, part: string) => `room:${id}:${part}`;

  // One change to a room's MLS state at a time in this client. Sending and syncing both load,
  // advance and save the state; if they overlapped, one save would undo the other's ratchet step
  // and later messages would fail to decrypt for everyone else.
  const roomLocks = new Map<string, Promise<unknown>>();
  function withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const prev = roomLocks.get(roomId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.then(() => undefined, () => undefined);
    roomLocks.set(roomId, tail);
    void tail.then(() => { if (roomLocks.get(roomId) === tail) roomLocks.delete(roomId); });
    return run;
  }

  async function loadState(roomId: string) {
    const b = await ks.get<Uint8Array>(roomKey(roomId, 'state'));
    return b ? mls.loadState(b, { strictIds: true }) : null;
  }
  async function saveState(roomId: string, state: Awaited<ReturnType<typeof mls.createRoom>>) {
    await ks.put(roomKey(roomId, 'state'), mls.saveState(state));
  }
  async function roomLocal(roomId: string): Promise<RoomLocal> {
    return (await ks.get<RoomLocal>(roomKey(roomId, 'local'))) ?? { name: null, lastSeq: 0, nicknames: {}, verified: {} };
  }
  async function setRoomLocal(roomId: string, patch: Partial<RoomLocal>) {
    await ks.put(roomKey(roomId, 'local'), { ...(await roomLocal(roomId)), ...patch });
  }

  async function forgetRoom(roomId: string) {
    await ks.delPrefix(`room:${roomId}:`);
  }

  async function messages(roomId: string): Promise<LocalMessage[]> {
    const keys = await ks.keys(roomKey(roomId, 'msg:'));
    const out: LocalMessage[] = [];
    for (const k of keys) { const m = await ks.get<LocalMessage>(k); if (m) out.push(m); }
    return out.sort((a, b) => a.seq - b.seq || a.sentAt - b.sentAt);
  }

  async function storeMessage(roomId: string, m: LocalMessage) {
    // Unopened messages are kept up to the server's absolute limit (7 days at most).
    const until = m.expiresAt ?? m.sentAt + 7 * 86400_000;
    await ks.put(roomKey(roomId, `msg:${m.id}`), m, until);
  }

  async function dropMessage(roomId: string, id: string) {
    await ks.del(roomKey(roomId, `msg:${id}`));
  }

  // ---------------------------------------------------------------------------- rooms

  /**
   * Creates a room. `nickname` is the owner's display name for this room: it is kept locally and
   * announced to members inside an encrypted `nick` control message, the same one a joiner sends
   * (see redeemInvite). Like every message, the server only ever sees its ciphertext.
   */
  async function createRoom(opts: { kind: RoomKind; ttl: number; mode: ExpiryMode; lifetime: number; accessCode?: string | null; name?: string | null; nickname?: string | null }) {
    const dev = await ensureDevice();
    const roomId = await rpc<string>('chat_create_room', {
      p_device: dev.id, p_kind: opts.kind, p_ttl_s: opts.ttl, p_expiry_mode: opts.mode,
      p_room_lifetime_s: opts.lifetime, p_access_code: opts.accessCode || null,
    });
    const kp = await mls.newKeyPackage(dev.id, dev.signing);
    const state = await mls.createRoom(roomId, kp);
    await saveState(roomId, state);
    await ks.put(roomKey(roomId, 'ownerPin'), { pin: await ownerPin(dev.id, dev.signing.publicKey) } satisfies StoredPin);
    const nickname = opts.nickname?.trim().slice(0, 40) || null;
    await setRoomLocal(roomId, { name: opts.name?.trim() || null, nicknames: nickname ? { [dev.id]: nickname } : {} });
    // Sent now like a joiner's, under the room lock. Nobody else is in the group yet, so this copy
    // is for the record only: a member who joins later cannot read traffic from before their
    // Welcome, which is why admitPending() announces the owner's nickname again after each admit.
    if (nickname) await withRoomLock(roomId, () => sendControl(roomId, { t: 'nick', name: nickname }));
    return roomId;
  }

  async function myRooms(): Promise<RoomSummary[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await rpc<any[]>('chat_my_rooms', {});
    const out: RoomSummary[] = [];
    for (const r of rows) {
      const local = await roomLocal(r.id);
      const pinned = !!(await storedOwnerPin(r.id, r.role));
      out.push({ id: r.id, kind: r.kind, role: r.role, memberState: r.member_state, ttl: r.default_ttl_s, mode: r.expiry_mode, expiresAt: r.expires_at, name: local.name, ownerPinned: pinned });
    }
    return out;
  }

  /**
   * The room's owner pin from this device's sealed storage (F2-7, F2-10). `ownerPinned` and the
   * invite links depend on it alone, never on the server's word. A room this device created before
   * pins existed gets its own pin written once, but only when this device really created the group:
   * the server says it is the owner AND its own leaf is leaf 0 of its MLS state (createGroup puts
   * the creator there; the owner is never removed, so nobody else can hold it).
   */
  async function storedOwnerPin(roomId: string, serverRole?: string): Promise<OwnerPin | null> {
    const stored = await ks.get<StoredPin>(roomKey(roomId, 'ownerPin'));
    if (stored?.pin) return stored.pin;
    if (stored || serverRole !== 'owner') return null;   // a join from a link without a pin stays unpinned
    const state = await loadState(roomId);
    if (!state) return null;
    const dev = await ensureDevice();
    if (mls.memberLeaves(state).find(l => l.leafIndex === 0)?.deviceId !== dev.id) return null;
    const pin = await ownerPin(dev.id, dev.signing.publicKey);
    await ks.put(roomKey(roomId, 'ownerPin'), { pin } satisfies StoredPin);
    return pin;
  }

  async function setRoomName(roomId: string, name: string) {
    await setRoomLocal(roomId, { name: name.trim().slice(0, 60) || null });
  }

  /**
   * Creates an invite. The token travels only in the link's #fragment, never in a request URL, and so
   * does the owner pin after it (`#<token>.1<pin>`, F2-7, see ./invite.ts): this device's id and a
   * hash of its signing key, which the joiner holds the Welcome and every commit to. Only the token
   * is sent to the server.
   */
  async function createInvite(roomId: string, opts: { expiresIn: number; maxUses: number; approval: boolean }) {
    // F2-10: the ROOM's owner pin, never this device's own (in a quick room any member may invite):
    // the owner's own, or the one a member joined with. Without one the link is unpinned and says so
    // (`ownerPinned: false`): a member who joined with an older link can't vouch for the owner.
    const pin = await storedOwnerPin(roomId, (await myRooms()).find(r => r.id === roomId)?.role);
    const token = randomToken(32);
    const id = await rpc<string>('chat_create_invite', {
      p_room: roomId, p_token: token, p_expires_s: opts.expiresIn, p_max_uses: opts.maxUses, p_requires_approval: opts.approval,
    });
    return { id, link: `${env.origin()}/chat/join#${token}${pin ? `.${encodePin(pin)}` : ''}`, ownerPinned: !!pin };
  }

  async function listInvites(roomId: string) {
    return rpc<{ id: string; expires_at: string; max_uses: number; uses: number; requires_approval: boolean; revoked_at: string | null }[]>('chat_list_invites', { p_room: roomId });
  }

  async function revokeInvite(id: string) {
    await rpc('chat_revoke_invite', { p_invite: id });
  }

  /** `invite`: the link's fragment, with or without the owner pin (old links are just the token). */
  function inviteParts(invite: string) {
    const parts = parseInviteFragment(invite);
    if (!parts) throw new ChatError('invite_invalid');
    return parts;
  }

  async function peekInvite(invite: string) {
    const { token } = inviteParts(invite);
    await ensureSession(true);
    const rows = await rpc<{ needs_code: boolean; kind: RoomKind }[]>('chat_peek_invite', { p_token: token });
    return rows[0] ?? null;
  }

  /** Joins with an invite. Signs in as a guest when needed. Returns the room id (membership is pending until admitted). */
  async function redeemInvite(invite: string, nickname: string, accessCode?: string) {
    const { token, pin } = inviteParts(invite);
    await ensureSession(true);
    const dev = await ensureDevice();
    const kp = await mls.newKeyPackage(dev.id, dev.signing);
    const rows = await rpc<{ joined_room: string | null; error: string | null }[]>('chat_redeem_invite', {
      p_token: token, p_device: dev.id, p_key_package: toBytea(kp.publicBytes), p_access_code: accessCode || null,
    });
    const r = rows[0];
    if (!r || r.error || !r.joined_room) throw new ChatError(r?.error || 'invite_invalid');
    // Kept sealed on this device; a second redeem of another link for the same room keeps the pin it has.
    const had = await ks.get<StoredPin>(roomKey(r.joined_room, 'ownerPin'));
    if (!had?.pin) await ks.put(roomKey(r.joined_room, 'ownerPin'), { pin } satisfies StoredPin);
    await ks.put(roomKey(r.joined_room, 'pending'), { publicBytes: kp.publicBytes, privatePackage: kp.privatePackage, nickname: nickname.trim().slice(0, 40) } satisfies PendingJoin);
    return r.joined_room;
  }

  /** True when a pending member's key package is for another device or carries a key other than the listed one. */
  function packageMismatch(row: MemberRow) {
    const info = mls.keyPackageInfo(fromBytea(row.key_package));
    return !info || !mls.isDeviceId(row.device_id) || info.deviceId !== row.device_id || !mls.sameKey(info.signaturePublicKey, fromBytea(row.signature_pub));
  }

  /**
   * The member list as the encrypted group and the server's listing describe it together: every
   * listed device plus every leaf of this device's group the server does not list (`unlisted`: it
   * can still read the chat, F2-1). Per device:
   * - `signaturePub`: the tree key when the device has a leaf (the listed key otherwise, e.g. pending);
   * - `inGroup`: it has a leaf in this device's copy of the group (can read new messages);
   * - `keyMismatch`: the tree (or a pending key package) disagrees with the listing now, or a refused
   *   Welcome/commit named a device that still has no leaf here;
   * - `changedGroup`: it sent a commit or proposal although it isn't the owner; skipped (F2-8);
   * - `keyHistory`: a refused Welcome/commit once named it, but its key in the group and the listing
   *   agree now ("the server once showed a different key for them; compare again").
   * A flag on this device itself means the server's listing was wrong about it; it never blocks.
   */
  async function memberView(roomId: string) {
    const dev = await ensureDevice();
    const rows = await rpc<MemberRow[]>('chat_room_members', { p_room: roomId });
    const local = await roomLocal(roomId);
    const state = await loadState(roomId);
    const leaves = state ? mls.memberLeaves(state) : [];
    const keysOf = (id: string) => leaves.filter(l => l.deviceId === id).map(l => l.signaturePublicKey);
    const conflicting = (keys: Uint8Array[]) => keys.some(k => !mls.sameKey(k, keys[0]));
    // A device that tried to change the group without being the owner (F2-8) is recorded as
    // `changedGroup`, not as a key problem.
    const flagOf = (id: string) => (id === dev.id ? undefined : local.mismatch?.[id]);
    const flagged = (id: string) => { const f = flagOf(id); return !!f && (f === true || f.reason !== 'committer'); };
    const changedGroup = (id: string) => { const f = flagOf(id); return !!f && f !== true && f.reason === 'committer'; };
    const base = (id: string) => ({ nickname: local.nicknames[id] ?? null, verified: local.verified[id] ?? null });
    const listedIds = new Set(rows.map(m => m.device_id));
    const list = rows.map(m => {
      const listed = fromBytea(m.signature_pub);
      const keys = keysOf(m.device_id);
      const treeKey = keys[0] ?? null;
      const live = keys.some(k => !mls.sameKey(k, listed))
        || (!treeKey && m.state === 'pending' && !!m.key_package && packageMismatch(m));
      return {
        deviceId: m.device_id, role: m.role, state: m.state,
        signaturePub: treeKey ?? listed, hasKeyPackage: !!m.key_package, ...base(m.device_id),
        keyMismatch: live || (flagged(m.device_id) && !treeKey),
        keyHistory: !live && !!treeKey && flagged(m.device_id), changedGroup: changedGroup(m.device_id),
        inGroup: !!treeKey, unlisted: false,
      };
    });
    for (const id of new Set(leaves.map(l => l.deviceId))) {
      if (listedIds.has(id)) continue;
      const keys = keysOf(id);
      list.push({
        deviceId: id, role: 'member', state: 'active', signaturePub: keys[0], hasKeyPackage: false, ...base(id),
        keyMismatch: conflicting(keys), keyHistory: false, changedGroup: changedGroup(id), inGroup: true, unlisted: true,
      });
    }
    return { dev, list, state, local, treeKey: (id: string) => leaves.find(l => l.deviceId === id)?.signaturePublicKey ?? null };
  }

  async function members(roomId: string) {
    return (await memberView(roomId)).list;
  }

  /** Owner only: admits pending joiners by committing an MLS add and sending each a Welcome. */
  function admitPending(roomId: string, only?: string[]) {
    return withRoomLock(roomId, () => admitPendingLocked(roomId, only));
  }
  async function admitPendingLocked(roomId: string, only?: string[]) {
    const dev = await ensureDevice();
    let state = await loadState(roomId);
    if (!state) return 0;
    const rows = (await rpc<MemberRow[]>('chat_room_members', { p_room: roomId }))
      .filter(m => m.state === 'pending' && m.key_package && (!only || only.includes(m.device_id)))
      // F-2 check 1: never add a key the server did not list for that device (members() flags it).
      .filter(m => !packageMismatch(m));
    if (!rows.length) return 0;
    const added = await mls.addMembers(state, rows.map(m => fromBytea(m.key_package)));
    const epoch = Number(mls.epoch(state));
    await rpc('chat_send', {
      p_room: roomId, p_device: dev.id, p_id: env.randomUUID(), p_kind: 'commit', p_epoch: epoch,
      p_ciphertext: toBytea(added.commit), p_activate: rows.map(m => m.device_id),
    });
    state = added.state;
    await saveState(roomId, state);
    for (const m of rows) {
      await rpc('chat_send', {
        p_room: roomId, p_device: dev.id, p_id: env.randomUUID(), p_kind: 'welcome', p_epoch: Number(mls.epoch(state)),
        p_ciphertext: toBytea(added.welcome!), p_to_device: m.device_id,
      });
    }
    // The newcomers can only read messages from after their Welcome, so the owner's nickname (set
    // in createRoom) is announced again now. Existing members simply see the same name twice.
    const myNick = (await roomLocal(roomId)).nicknames[dev.id];
    if (myNick) await sendControl(roomId, { t: 'nick', name: myNick });
    return rows.length;
  }

  /** Owner only: commits the MLS removal of devices the server already marked removed (left or revoked). */
  function commitRemovals(roomId: string) {
    return withRoomLock(roomId, () => commitRemovalsLocked(roomId));
  }
  async function commitRemovalsLocked(roomId: string) {
    const dev = await ensureDevice();
    let state = await loadState(roomId);
    if (!state) return 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const live = new Set((await rpc<any[]>('chat_room_members', { p_room: roomId })).map(m => m.device_id as string));
    const gone = mls.memberLeaves(state).map(l => l.deviceId).filter(id => id !== dev.id && !live.has(id));
    for (const id of gone) {
      const r = await mls.removeDevice(state, id);
      await rpc('chat_send', {
        p_room: roomId, p_device: dev.id, p_id: env.randomUUID(), p_kind: 'commit', p_epoch: Number(mls.epoch(state)),
        p_ciphertext: toBytea(r.commit), p_remove: [id],
      });
      state = r.state;
      await saveState(roomId, state);
    }
    return gone.length;
  }

  /** Owner removes a member: the server revokes access, then the MLS commit locks them out cryptographically. */
  function removeMember(roomId: string, deviceId: string) {
    return withRoomLock(roomId, () => removeMemberLocked(roomId, deviceId));
  }
  async function removeMemberLocked(roomId: string, deviceId: string) {
    const dev = await ensureDevice();
    const state = await loadState(roomId);
    if (!state) throw new ChatError('no_local_state');
    const r = await mls.removeDevice(state, deviceId);
    await rpc('chat_send', {
      p_room: roomId, p_device: dev.id, p_id: env.randomUUID(), p_kind: 'commit', p_epoch: Number(mls.epoch(state)),
      p_ciphertext: toBytea(r.commit), p_remove: [deviceId],
    });
    await saveState(roomId, r.state);
  }

  // ---------------------------------------------------------------------------- messaging

  /** Sends a text message. Pass `id` to match a message already shown on screen while sending. */
  async function send(roomId: string, body: string, ttl: number, replyTo?: string, id: string = env.randomUUID()) {
    const text = body.trim();
    if (!text) return null;
    if (text.length > 4000) throw new ChatError('too_long');
    const dev = await ensureDevice();
    const mine = await withRoomLock(roomId, () => sendTextLocked(roomId, dev, id, text, ttl, replyTo));
    void notifyRoom(roomId);
    return mine;
  }

  async function sendTextLocked(roomId: string, dev: DeviceRecord, id: string, text: string, ttl: number, replyTo?: string) {
    const state = await loadState(roomId);
    if (!state) throw new ChatError('no_local_state');
    const enc = await mls.encrypt(state, { t: 'text', id, body: text, ttl, replyTo });
    // Save the advanced state first: reusing a ratchet generation would break forward secrecy.
    await saveState(roomId, enc.state);
    const seq = await rpc<number>('chat_send', {
      p_room: roomId, p_device: dev.id, p_id: id, p_kind: 'app', p_epoch: Number(mls.epoch(state)),
      p_ciphertext: toBytea(enc.ciphertext), p_ttl_s: ttl,
    });
    const now = Date.now();
    const mine: LocalMessage = { id, seq: Number(seq), mine: true, sender: dev.id, body: text, ttl, sentAt: now, expiresAt: now + ttl * 1000, replyTo };
    await storeMessage(roomId, mine);
    return mine;
  }

  /**
   * Tells everyone in the room that this device pressed a screenshot shortcut. It travels as an
   * encrypted MLS message like any other, so the server can't tell it apart from chat text.
   */
  async function sendScreenshotAlert(roomId: string, ttl: number) {
    const dev = await ensureDevice();
    const id = env.randomUUID();
    return withRoomLock(roomId, async () => {
      const state = await loadState(roomId);
      if (!state) throw new ChatError('no_local_state');
      const enc = await mls.encrypt(state, { t: 'alert', id, kind: 'screenshot', ttl });
      await saveState(roomId, enc.state);
      const seq = await rpc<number>('chat_send', {
        p_room: roomId, p_device: dev.id, p_id: id, p_kind: 'app', p_epoch: Number(mls.epoch(state)),
        p_ciphertext: toBytea(enc.ciphertext), p_ttl_s: ttl,
      });
      const now = Date.now();
      const mine: LocalMessage = { id, seq: Number(seq), mine: true, sender: dev.id, body: '', ttl, sentAt: now, expiresAt: now + ttl * 1000, alert: 'screenshot' };
      await storeMessage(roomId, mine);
      return mine;
    });
  }

  // ---------------------------------------------------------------------------- attachments

  /**
   * Sends a file. It is encrypted on this device with a fresh AES-256-GCM key; only the
   * ciphertext is uploaded. The key, name and type travel inside the MLS message, so the
   * server never learns them. View-once files can be opened once per chat, then access ends.
   */
  async function sendFile(roomId: string, file: FileSource, ttl: number, viewOnce: boolean) {
    if (!file.size) throw new ChatError('empty_file');
    if (file.size > MAX_ATTACHMENT_BYTES) throw new ChatError('file_too_large');
    const dev = await ensureDevice();
    if (!(await loadState(roomId))) throw new ChatError('no_local_state');

    const { key, keyB64 } = await newKey();
    const blob = await encryptBytes(key, await file.bytes());
    const attachmentId = env.randomUUID();
    const objectPath = await rpc<string>('chat_register_attachment', {
      p_room: roomId, p_device: dev.id, p_id: attachmentId, p_size: blob.byteLength, p_view_once: viewOnce, p_ttl_s: ttl,
    });
    // Raw ciphertext bytes: the platform adapter decides how its storage client wants them
    // (the web adapter wraps them in a Blob, exactly what this code used to build here).
    const up = await sb().storage.from(BUCKET).upload(objectPath, blob, { contentType: 'application/octet-stream', upsert: false });
    if (up.error) throw new ChatError('upload_failed');

    const id = env.randomUUID();
    const payload = {
      t: 'file' as const, id, ttl, viewOnce, objectPath, key: keyB64,
      name: file.name.slice(0, 120) || 'file', mime: (file.mime || 'application/octet-stream').slice(0, 100), size: file.size,
    };
    // The state is loaded only now, under the room lock: a sync may have advanced it during the upload.
    const mine = await withRoomLock(roomId, async () => {
      const state = await loadState(roomId);
      if (!state) throw new ChatError('no_local_state');
      const enc = await mls.encrypt(state, payload);
      await saveState(roomId, enc.state);
      const seq = await rpc<number>('chat_send', {
        p_room: roomId, p_device: dev.id, p_id: id, p_kind: 'app', p_epoch: Number(mls.epoch(state)),
        p_ciphertext: toBytea(enc.ciphertext), p_ttl_s: ttl,
      });
      const now = Date.now();
      const m: LocalMessage = { id, seq: Number(seq), mine: true, sender: dev.id, body: '', ttl, sentAt: now, expiresAt: now + ttl * 1000, file: payload };
      await storeMessage(roomId, m);
      return m;
    });
    void notifyRoom(roomId);
    return mine;
  }

  /**
   * Downloads and decrypts an attachment. For someone else's view-once file this claims it
   * first: the server then allows a short download window and revokes it for good.
   * The sender can't open their own view-once file (that would use up the one view).
   */
  async function openFile(roomId: string, m: LocalMessage): Promise<OpenedFile> {
    const f = m.file;
    if (!f) throw new ChatError('not_a_file');
    if (f.viewOnce && m.mine) throw new ChatError('view_once_sent');
    if (f.viewOnce && m.viewed) throw new ChatError('gone');
    const attachmentId = f.objectPath.split('/').pop() || '';
    const path = await rpc<string>('chat_claim_attachment', { p_id: attachmentId });
    if (f.viewOnce) await storeMessage(roomId, { ...m, viewed: true });
    const dl = await sb().storage.from(BUCKET).download(path);
    if (dl.error || !dl.data) throw new ChatError('gone');
    const plain = await decryptBytes(await importKey(f.key), new Uint8Array(await dl.data.arrayBuffer()));
    return { bytes: new Uint8Array(plain), mime: f.mime || 'application/octet-stream' };
  }

  async function markViewed(roomId: string, m: LocalMessage) {
    const viewed = { ...m, viewed: true };
    await storeMessage(roomId, viewed);
    return viewed;
  }

  // ---------------------------------------------------------------------------- notifications

  /** Asks the server to send a content-free "new message" push to the room's other members. */
  async function notifyRoom(roomId: string) {
    try {
      const { data } = await sb().auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      await env.notify(roomId, token);
    } catch { /* best effort */ }
  }

  // ---------------------------------------------------------------------------- push devices (phones)

  /**
   * Registers this phone's push token for content-free "new message" nudges (migration 008,
   * `register_push_device`: upsert, owner = auth.uid()). The token is an opaque APNs / FCM device
   * token; it and the platform are the only things sent. Needs a signed-in session.
   */
  async function registerPushDevice(platform: 'ios' | 'android', token: string) {
    if (platform !== 'ios' && platform !== 'android') throw new ChatError('bad_platform');
    const t = token.trim();
    if (!t) throw new ChatError('bad_token');
    if (!(await ensureSession(false))) throw new ChatError('not_signed_in');
    await rpc('register_push_device', { p_platform: platform, p_token: t });
  }

  /** Forgets a push token registered by this user (`unregister_push_device`). Needs a signed-in session. */
  async function unregisterPushDevice(token: string) {
    const t = token.trim();
    if (!t) throw new ChatError('bad_token');
    if (!(await ensureSession(false))) throw new ChatError('not_signed_in');
    await rpc('unregister_push_device', { p_token: t });
  }

  async function sendControl(roomId: string, payload: mls.ChatPayload) {
    const dev = await ensureDevice();
    const state = await loadState(roomId);
    if (!state) return;
    const enc = await mls.encrypt(state, payload);
    await saveState(roomId, enc.state);
    await rpc('chat_send', {
      p_room: roomId, p_device: dev.id, p_id: env.randomUUID(), p_kind: 'app', p_epoch: Number(mls.epoch(state)),
      p_ciphertext: toBytea(enc.ciphertext), p_ttl_s: 86400,
    });
  }

  /**
   * Pulls everything after the last processed sequence number and applies it in order, one
   * `chat_fetch` page (SYNC_PAGE_SIZE rows) at a time, until a page comes back short (at most
   * SYNC_MAX_PAGES pages per call; the next call carries on). The counts are summed over the pages.
   * Each download happens outside the room lock so a send never waits on the network for it; only
   * the local decrypt-and-save step of each page is serialized.
   *
   * If a later page fails to download (the network dropped mid-catch-up), the pages already
   * applied are kept and their counts returned; the next sync continues from there. A failure on
   * the first page is thrown as before.
   */
  async function sync(roomId: string): Promise<SyncResult> {
    const dev = await ensureDevice();
    const total: SyncResult = { joined: false, removed: false, newMessages: 0, newAlerts: 0 };
    for (let page = 0; page < SYNC_MAX_PAGES; page++) {
      const { lastSeq: after } = await roomLocal(roomId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rows: any[];
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rows = await rpc<any[]>('chat_fetch', { p_room: roomId, p_device: dev.id, p_after: after, p_limit: SYNC_PAGE_SIZE });
      } catch (e) {
        // Removed, burned or expired: the server is authoritative, so drop our keys and copies too.
        if (e instanceof ChatError && e.code === 'not_a_member') {
          await withRoomLock(roomId, () => forgetRoom(roomId));
          return { ...total, removed: true };
        }
        if (page > 0) return total;
        throw e;
      }
      const r = await withRoomLock(roomId, () => applyRows(roomId, dev, rows));
      total.joined ||= r.joined;
      total.removed ||= r.removed;
      total.newMessages += r.newMessages;
      total.newAlerts += r.newAlerts;
      if (r.removed || rows.length < SYNC_PAGE_SIZE) break;
      // A full page that moved nothing forward (every row undecryptable, or another sync applied
      // them meanwhile and there is nothing newer) would come back identical: stop here.
      if ((await roomLocal(roomId)).lastSeq <= after) break;
    }
    return total;
  }

  /**
   * Applies one fetched page under the room lock. The MLS state and `lastSeq` are written once
   * per page, together, at the end (P3-Q1): one sealed state write instead of one per row. Each
   * row's message is stored before that write, so a crash mid-page loses nothing: the persisted
   * state and lastSeq are still the previous page's, and the whole page is fetched and decrypted
   * again (stored messages are keyed by id, so nothing is duplicated).
   *
   * `lastSeq` only moves over rows that were applied (or deliberately ignored: traffic from before
   * this device joined, a welcome that is not for it). A row that fails to decrypt (older epoch,
   * tampered, replayed) is skipped and leaves the state as it was after the last applied row; a
   * later applied row moves lastSeq past it for good, while undecryptable rows at the very end of
   * the page are tried once more on the next sync instead of being written off at once.
   *
   * A failure that is not decryption (the keystore refusing a write) rejects the sync without
   * writing this page's state or lastSeq, so the persisted pair stays consistent and the page is
   * applied again next time.
   *
   * Order of the two writes: state first, then lastSeq. The keystore has no multi-key transaction,
   * so a crash between them leaves the state one page ahead of lastSeq; that page is then fetched
   * again and its rows fail to decrypt, which costs nothing because their messages were stored
   * before either write (only a nickname announced in that page is lost). The other order would
   * risk keeping lastSeq past a commit the saved state never applied, which strands the device in
   * an old epoch, and would leave already-used message keys on disk.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function applyRows(roomId: string, dev: DeviceRecord, fetched: any[]): Promise<SyncResult> {
    const local = await roomLocal(roomId);
    const res: SyncResult = { joined: false, removed: false, newMessages: 0, newAlerts: 0 };
    // Another sync may have applied some of these while we were downloading.
    const rows = fetched.filter(r => Number(r.seq) > local.lastSeq);
    if (!rows.length) {
      // F2-9: a refused Welcome was passed over; while no genuine one has applied, keep saying so.
      if (await refusedWelcomePending(roomId, local)) throw await welcomeRefusal(roomId, local.mismatch);
      return res;
    }
    let state = await loadState(roomId);
    let lastSeq = local.lastSeq;          // seq of the last row applied or deliberately ignored
    let savedSeq = local.lastSeq;         // what the keystore holds
    let stateDirty = false;               // `state` has steps the keystore does not have yet
    let nickDirty = false;
    const nicknames = { ...local.nicknames };
    const listing = lazyListing(roomId);
    // F-2 checks 2 and 3: what a refused Welcome/commit named (device id -> offending key, if known).
    const refused = new Map<string, MismatchFlag>();   // per device: the row (seq) that named it (F2-9)
    let stopped = false;                  // a refused owner commit: nothing after it can apply
    let fetchFailure: unknown = null;     // the listing could not be fetched (F2-3)
    const applied: number[] = [];         // seqs of Welcomes/commits applied (their old flags clear)
    const goneLeaves = new Set<string>(); // devices whose leaf a commit removed (their flags clear)
    const refuse = (seq: number, e: mls.KeyMismatchError, kind: 'welcome' | 'commit') => {
      const at = Date.now();
      if (!e.deviceIds.length) refused.set('<unknown>', { key: null, seq, at, kind, reason: e.reason });
      e.deviceIds.forEach((id, i) => refused.set(id, { key: e.keys[i] ? toBytea(e.keys[i]!) : null, seq, at, kind, reason: e.reason }));
    };
    // Who the owner is (F2-7): the pin from the invite link (or this device's own, for the owner);
    // only for a room joined from a link without a pin, the server's listing.
    const pin = (await ks.get<StoredPin>(roomKey(roomId, 'ownerPin')))?.pin ?? null;
    const listedOwner = async () => (await listing.rows()).find(m => m.role === 'owner') ?? null;
    async function isOwner(deviceId: string, key: Uint8Array) {
      if (pin) return deviceId === pin.deviceId && (await keyHash(key)) === pin.keyHash;
      const owner = await listedOwner();
      return !!owner && owner.device_id === deviceId && mls.sameKey(key, fromBytea(owner.signature_pub));
    }

    for (const row of rows) {
      const seq = Number(row.seq);
      const bytes = fromBytea(row.ciphertext);
      if (row.kind === 'welcome') {
        const pending = await ks.get<PendingJoin>(roomKey(roomId, 'pending'));
        if (state || !pending) { lastSeq = seq; continue; }
        let joined: Awaited<ReturnType<typeof mls.joinRoom>>;
        try {
          const r = await mls.joinRoomWithSigner(bytes, mls.restoreKeyPackage(pending.publicBytes, pending.privatePackage), listing.lookup);
          joined = r.state;
          // F-2 check 2 (F2-1, F2-7): the Welcome must be signed by the owner (the pinned device and
          // key; the listed owner only for a link without a pin), and every leaf the owner has in the
          // group must be that key. An honest owner always signs its own Welcomes.
          if (!(await isOwner(r.signer.deviceId, r.signer.signaturePublicKey))) {
            throw new mls.KeyMismatchError([r.signer.deviceId], 'signer', [r.signer.signaturePublicKey]);
          }
          const ownerLeaves = mls.memberLeaves(joined).filter(l => l.deviceId === r.signer.deviceId);
          if (ownerLeaves.some(l => !mls.sameKey(l.signaturePublicKey, r.signer.signaturePublicKey))) {
            throw new mls.KeyMismatchError([r.signer.deviceId], 'key');
          }
        } catch (e) {
          if (listing.failure()) { fetchFailure = listing.failure(); break; }
          // Refused: nothing kept, lastSeq moves on (F2-9: a genuine Welcome later, in this page or
          // any later one, still applies); the flag keeps sync() rejecting until this device joins.
          if (e instanceof mls.KeyMismatchError) { refuse(seq, e, 'welcome'); lastSeq = seq; continue; }
          continue;  // not a welcome we can open: skipped like any undecryptable row
        }
        applied.push(seq);
        // A welcome is written at once, with its lastSeq: the nickname announcement below loads
        // and saves the state itself, and the pending key package must not outlive the join.
        state = joined;
        lastSeq = seq;
        await saveState(roomId, state);
        if (pending.nickname) { nicknames[dev.id] = pending.nickname; nickDirty = true; }
        await setRoomLocal(roomId, { lastSeq, nicknames });
        savedSeq = lastSeq; stateDirty = false; nickDirty = false;
        await ks.del(roomKey(roomId, 'pending'));
        res.joined = true;
        if (pending.nickname) {
          try {
            await sendControl(roomId, { t: 'nick', name: pending.nickname });
          } catch {
            // Not announced (offline, rate limited): as before, the join itself stands.
          }
          // sendControl may have advanced and saved the state (even when its send then failed):
          // carry on from what it saved, never from the copy in hand, or a generation is reused.
          state = await loadState(roomId);
        }
        continue;
      }
      if (!state) { lastSeq = seq; continue; }  // traffic from before we joined: not ours to read
      let got: Awaited<ReturnType<typeof mls.receive>>;
      const before: ReturnType<typeof mls.memberLeaves> = mls.memberLeaves(state);
      try {
        // F-2 check 3: only the owner may change the group (F2-1: in this design only the owner's
        // app commits adds and removals; there are no self-updates or proposals), then its changes'
        // keys against the listing.
        got = await mls.receive(state, bytes, dev.id, listing.lookup, isOwner);
      } catch (e) {
        if (listing.failure()) { fetchFailure = listing.failure(); break; }
        if (e instanceof mls.KeyMismatchError) {
          refuse(seq, e, 'commit');
          // F2-8: a change from anyone but the owner is skipped and recorded; the group stays at the
          // epoch the owner's next commit builds on, so the room carries on. A key or format refusal
          // of the owner's own commit stops this member (lastSeq stays before it).
          if (e.reason === 'committer') { lastSeq = seq; continue; }
          stopped = true; break;
        }
        continue;  // undecryptable (older epoch, tampered, replayed): skipped, see above
      }
      if (got.kind === 'commit') {
        applied.push(seq);
        const after = new Set(mls.memberLeaves(got.state).map(l => l.deviceId));
        for (const l of before) if (!after.has(l.deviceId)) goneLeaves.add(l.deviceId);
        state = got.state; lastSeq = seq; stateDirty = true;
        if (got.removedSelf) { res.removed = true; break; }
        continue;
      }
      const p = got.payload;
      if (p.t === 'nick') {
        nicknames[row.sender_device] = p.name.slice(0, 40);
        nickDirty = true;
      } else if (p.t === 'alert') {
        const sentAt = new Date(row.created_at).getTime();
        await storeMessage(roomId, {
          id: p.id, seq, mine: false, sender: row.sender_device, body: '', ttl: p.ttl,
          sentAt, expiresAt: sentAt + p.ttl * 1000, alert: 'screenshot',
        });
        res.newAlerts++;
      } else {
        const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
        await storeMessage(roomId, {
          id: p.id, seq, mine: false, sender: row.sender_device,
          body: p.t === 'text' ? p.body : '', ttl: p.ttl, sentAt: new Date(row.created_at).getTime(), expiresAt,
          replyTo: p.t === 'text' ? p.replyTo : undefined, file: p.t === 'file' ? p : undefined,
        });
        res.newMessages++;
      }
      state = got.state; lastSeq = seq; stateDirty = true;
    }
    if (res.removed) { await forgetRoom(roomId); return res; }
    if (stateDirty && state) await saveState(roomId, state);
    if (lastSeq !== savedSeq || nickDirty) await setRoomLocal(roomId, { lastSeq, nicknames });
    // F2-2: the flags are a record. Clear those whose refused row has now applied (a later sync got
    // an agreeing listing) or whose device left the group; add what this page refused.
    const prev = (await roomLocal(roomId)).mismatch ?? {};
    const flags: Record<string, MismatchFlag | true> = {};
    for (const [id, f] of Object.entries(prev)) {
      const seqOf = f === true ? 0 : f.seq;
      if (goneLeaves.has(id) || (seqOf && applied.includes(seqOf))) continue;
      flags[id] = f;
    }
    for (const [id, f] of refused) flags[id] = f;
    if (JSON.stringify(flags) !== JSON.stringify(prev)) await setRoomLocal(roomId, { mismatch: flags });
    // A refused owner commit stops this member (lastSeq stays before it, so every sync refuses it
    // again). A refused Welcome keeps sync() rejecting while this device has not joined.
    if (stopped) throw new ChatError('member_key_mismatch');
    if (!state && refusedWelcomeIn(flags)) throw await welcomeRefusal(roomId, flags);
    if (fetchFailure) throw fetchFailure;
    return res;
  }

  /**
   * The error for a room this device can't join because its Welcome was refused. In a pinned room a
   * Welcome signed by someone other than the pinned owner says so plainly
   * (`invite_owner_mismatch`: the person who invited you isn't the one letting you in); anything
   * else is `member_key_mismatch`.
   */
  async function welcomeRefusal(roomId: string, flags: RoomLocal['mismatch']) {
    const pinned = !!(await ks.get<StoredPin>(roomKey(roomId, 'ownerPin')))?.pin;
    const signer = Object.values(flags ?? {}).some(f => f !== true && f.kind === 'welcome' && f.reason === 'signer');
    return new ChatError(pinned && signer ? 'invite_owner_mismatch' : 'member_key_mismatch');
  }

  function refusedWelcomeIn(flags: RoomLocal['mismatch']) {
    return Object.values(flags ?? {}).some(f => f !== true && f.kind === 'welcome');
  }
  async function refusedWelcomePending(roomId: string, local: RoomLocal) {
    return refusedWelcomeIn(local.mismatch) && !(await ks.get<Uint8Array>(roomKey(roomId, 'state')));
  }

  /**
   * The server's key listing for one applyRows page, fetched on first use only: ts-mls asks for it
   * when it meets a credential (a Welcome or a commit), never for an application message. A failed
   * fetch is remembered so the caller can reject the sync instead of skipping the row.
   */
  function lazyListing(roomId: string) {
    let rowsP: Promise<MemberRow[]> | null = null;
    let failed: unknown = null;
    const rows = () => (rowsP ??= rpc<MemberRow[]>('chat_room_members', { p_room: roomId }).catch((e: unknown) => { failed = e; throw e; }));
    const lookup: mls.KeyDirectory = async (deviceId) => {
      const row = (await rows()).find(m => m.device_id === deviceId);
      return row ? fromBytea(row.signature_pub) : null;
    };
    return { rows, lookup, failure: () => failed };
  }

  /** Starts the recipient-side countdown. The server decides the expiry; we adopt it. */
  async function markOpened(roomId: string, m: LocalMessage) {
    if (m.mine || m.expiresAt) return m;
    const dev = await ensureDevice();
    const at = await rpc<string | null>('chat_mark_opened', { p_message: m.id, p_device: dev.id });
    const opened = { ...m, expiresAt: at ? new Date(at).getTime() : Date.now() + m.ttl * 1000 };
    await storeMessage(roomId, opened);
    return opened;
  }

  async function setTimer(roomId: string, ttl: number, mode: ExpiryMode) {
    await rpc('chat_set_timer', { p_room: roomId, p_ttl_s: ttl, p_expiry_mode: mode });
  }

  // ---------------------------------------------------------------------------- verification

  /**
   * The key to verify for `deviceId`: its leaf in this device's copy of the group (F-2). Throws
   * `member_key_mismatch` when that member's key disagrees between the group and the server's
   * listing, or this device's own leaf is not its own key; `no_local_state` before this device has
   * joined; `not_a_member` when the device has no leaf (not admitted yet). `key: null` when neither
   * the server nor the group knows the device. A device the server does not list but the group
   * holds (`unlisted`) gets a number: that is how it can be compared at all.
   */
  async function treeKeyToVerify(roomId: string, deviceId: string) {
    const view = await memberView(roomId);
    const dev = view.dev;
    const them = view.list.find(m => m.deviceId === deviceId);
    if (!them) return { dev, key: null, them: null };
    if (them.keyMismatch) throw new ChatError('member_key_mismatch');
    if (!view.state) throw new ChatError('no_local_state');
    const mine = view.treeKey(dev.id);
    if (mine && !mls.sameKey(mine, dev.signing.publicKey)) throw new ChatError('member_key_mismatch');
    const key = view.treeKey(deviceId);
    if (!key) throw new ChatError('not_a_member');
    return { dev, key, them };
  }

  /**
   * Safety number with another member, from the two signature keys inside the encrypted group (this
   * device's own key and their leaf). Byte-identical to the earlier listing-based number whenever the
   * server's listing is honest, so numbers people already compared do not change.
   */
  async function safetyNumberWith(roomId: string, deviceId: string) {
    const { dev, key } = await treeKeyToVerify(roomId, deviceId);
    if (!key) throw new ChatError('not_a_member');
    return mls.safetyNumber({ key: dev.signing.publicKey, id: dev.id }, { key, id: deviceId });
  }

  /** Records the member's key inside the group as verified, and clears an old mismatch record for them. Refuses a mismatched member. */
  async function markVerified(roomId: string, deviceId: string) {
    const { key } = await treeKeyToVerify(roomId, deviceId);
    if (!key) return;
    const local = await roomLocal(roomId);
    const mismatch = { ...local.mismatch };
    delete mismatch[deviceId];
    await setRoomLocal(roomId, { verified: { ...local.verified, [deviceId]: toBytea(key) }, mismatch });
  }

  // ---------------------------------------------------------------------------- leave, burn, panic

  async function leave(roomId: string) {
    const dev = await ensureDevice();
    await rpc('chat_leave', { p_room: roomId, p_device: dev.id });
    await forgetRoom(roomId);
  }

  async function burn(roomId: string) {
    await rpc('chat_burn', { p_room: roomId });
    await forgetRoom(roomId);
  }

  // Panic lock: hides everything immediately and requires an unlock step to come back.
  // It does not delete rooms. Where the flag lives is the platform's choice (LockStore).
  function lock() {
    platform.lock.set();
  }
  function isLocked() {
    return platform.lock.get();
  }
  /** Unlock. Accounts with a passkey must pass the OS check (Face ID / Touch ID / PIN) again. */
  async function unlock() {
    const session = await ensureSession(false);
    if (session && !session.user.is_anonymous) {
      const { data } = await sb().auth.passkey.list();
      if (data && data.length) {
        const { error } = await sb().auth.signInWithPasskey();
        if (error) throw new ChatError(error.message);
      }
    }
    platform.lock.clear();
  }

  // ---------------------------------------------------------------------------- realtime

  /**
   * Subscribes to a room's private channel. Pings carry ids only; content is always fetched and
   * decrypted. `on` receives the broadcasts (`msg`, `burned`, …) as `(event, payload)` and
   * `('subscribed', {})` each time the channel is (re)joined, which is the moment to pull once.
   *
   * When the channel reports CHANNEL_ERROR, TIMED_OUT or CLOSED (an expired token on the private
   * channel, a socket that went away), it is removed and a new one is opened after a bounded
   * backoff (RESUBSCRIBE_DELAYS_MS, the last delay repeating), with `setAuth` re-run on the current
   * session first. Pass `{ status: true }` to also receive `('status', { status, attempt })` for
   * every status, so a screen can show "reconnecting"; without it the callback sees nothing it did
   * not see before. The returned function closes the channel and cancels a pending retry.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function subscribe(roomId: string, on: (event: string, payload: any) => void, opts: { status?: boolean } = {}): () => void {
    let ch: RealtimeChannelLike | null = null;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;  // failed (re)subscriptions since the last SUBSCRIBED

    const drop = (c: RealtimeChannelLike) => {
      try {
        const r = sb().removeChannel(c) as PromiseLike<unknown> | undefined;
        if (r && typeof r.then === 'function') r.then(undefined, () => {});
      } catch { /* already gone */ }
    };

    const retry = () => {
      if (closed || timer) return;
      const delay = RESUBSCRIBE_DELAYS_MS[Math.min(attempt, RESUBSCRIBE_DELAYS_MS.length - 1)];
      attempt++;
      timer = setTimeout(() => { timer = null; void open(); }, delay);
    };

    const onStatus = (c: RealtimeChannelLike, status: string) => {
      if (closed || ch !== c) return;  // a channel we already let go of (its own CLOSED, late errors)
      if (opts.status) on('status', { status, attempt });
      if (status === 'SUBSCRIBED') { attempt = 0; on('subscribed', {}); return; }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        ch = null;
        drop(c);
        retry();
      }
    };

    async function open() {
      try {
        const { data } = await sb().auth.getSession();
        if (closed) return;
        if (data.session) await sb().realtime.setAuth(data.session.access_token);
        if (closed) return;
        const c = sb().channel(`room:${roomId}`, { config: { private: true } })
          .on('broadcast', { event: '*' }, (msg) => { if (!closed && ch === c) on(msg.event, msg.payload); });
        ch = c;
        c.subscribe((status) => onStatus(c, status));
      } catch {
        // No session lookup, or the client refused the channel (realtime-js hands back a channel
        // with the same topic until the old one has finished leaving): try again later.
        if (ch) { drop(ch); ch = null; }
        retry();
      }
    }

    void open();
    return () => {
      closed = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (ch) { drop(ch); ch = null; }
    };
  }

  return {
    ensureSession, ensureDevice, listDevices, revokeDevice,
    forgetRoom, messages, dropMessage,
    createRoom, myRooms, setRoomName, createInvite, listInvites, revokeInvite, peekInvite, redeemInvite, members,
    admitPending, commitRemovals, removeMember,
    send, sendScreenshotAlert, sendFile, openFile, markViewed, notifyRoom, sync, markOpened, setTimer,
    safetyNumberWith, markVerified,
    leave, burn, lock, isLocked, unlock, subscribe,
    registerPushDevice, unregisterPushDevice,
    keystore: ks,
  };
}
