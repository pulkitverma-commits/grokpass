// Secret Chat client: ties the Supabase RPCs, the MLS adapter and the local keystore together.
// Browser only. Nothing here sends plaintext anywhere: messages are MLS-encrypted before any
// network call, and the server sees device ids, sequence numbers and ciphertext.
//
// Membership changes (adding joiners, committing removals) are made by the room owner's
// client only, so two members never race to commit the same epoch. A joiner therefore waits
// until the owner's app is open to be admitted (see known-limitations.md).

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { randomToken, newKey, importKey, encryptBytes, decryptBytes } from '../crypto';
import * as mls from './mls';
import * as ks from './keystore';

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
};

export type RoomSummary = {
  id: string; kind: RoomKind; role: 'owner' | 'member'; memberState: 'pending' | 'active';
  ttl: number; mode: ExpiryMode; expiresAt: string; name: string | null;
};

type DeviceRecord = { id: string; signing: mls.SigningKey; userId: string };
type PendingJoin = { publicBytes: Uint8Array; privatePackage: mls.DeviceKeyPackage['privatePackage']; nickname: string };
type RoomLocal = { name: string | null; lastSeq: number; nicknames: Record<string, string>; verified: Record<string, string> };

function sb(): SupabaseClient {
  if (!supabase) throw new Error('not_configured');
  return supabase;
}

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

async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw new ChatError(error.message);
  return data as T;
}

export class ChatError extends Error {
  code: string;
  constructor(message: string) {
    super(message);
    this.code = /([a-z_]+)$/.exec(message)?.[1] ?? 'error';
  }
}

// ---------------------------------------------------------------------------- session & device

/** Signed-in user, or a fresh anonymous (guest) session when `guest` is allowed. */
export async function ensureSession(guest = false) {
  const { data } = await sb().auth.getSession();
  if (data.session) return data.session;
  if (!guest) return null;
  const { data: anon, error } = await sb().auth.signInAnonymously();
  if (error || !anon.session) throw new ChatError(error?.message || 'guest_sign_in_failed');
  return anon.session;
}

let deviceCache: DeviceRecord | null = null;

/** This browser's chat device for the current user, registering one on first use. */
export async function ensureDevice(): Promise<DeviceRecord> {
  const session = await ensureSession(false);
  if (!session) throw new ChatError('not_signed_in');
  if (deviceCache && deviceCache.userId === session.user.id) return deviceCache;
  const key = `device:${session.user.id}`;
  const existing = await ks.get<DeviceRecord>(key);
  if (existing) { deviceCache = existing; return existing; }
  const signing = await mls.newSigningKey();
  const label = deviceLabel();
  const id = await rpc<string>('chat_register_device', { p_signature_pub: toBytea(signing.publicKey), p_label: label });
  const rec: DeviceRecord = { id, signing, userId: session.user.id };
  await ks.put(key, rec);
  deviceCache = rec;
  return rec;
}

function deviceLabel() {
  if (typeof navigator === 'undefined') return 'Browser';
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Linux';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

export async function listDevices() {
  return rpc<{ id: string; label: string; created_at: string; last_seen: string; revoked_at: string | null }[]>('chat_list_devices', {});
}

export async function revokeDevice(id: string) {
  await rpc('chat_revoke_device', { p_device: id });
  const session = await ensureSession(false);
  const mine = session ? await ks.get<DeviceRecord>(`device:${session.user.id}`) : null;
  if (mine?.id === id) await ks.wipe();
}

// ---------------------------------------------------------------------------- local room data

const roomKey = (id: string, part: string) => `room:${id}:${part}`;

// One change to a room's MLS state at a time in this tab. Sending and syncing both load,
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
  return b ? mls.loadState(b) : null;
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

export async function forgetRoom(roomId: string) {
  await ks.delPrefix(`room:${roomId}:`);
}

export async function messages(roomId: string): Promise<LocalMessage[]> {
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

export async function dropMessage(roomId: string, id: string) {
  await ks.del(roomKey(roomId, `msg:${id}`));
}

// ---------------------------------------------------------------------------- rooms

export async function createRoom(opts: { kind: RoomKind; ttl: number; mode: ExpiryMode; lifetime: number; accessCode?: string | null; name?: string | null }) {
  const dev = await ensureDevice();
  const roomId = await rpc<string>('chat_create_room', {
    p_device: dev.id, p_kind: opts.kind, p_ttl_s: opts.ttl, p_expiry_mode: opts.mode,
    p_room_lifetime_s: opts.lifetime, p_access_code: opts.accessCode || null,
  });
  const kp = await mls.newKeyPackage(dev.id, dev.signing);
  const state = await mls.createRoom(roomId, kp);
  await saveState(roomId, state);
  await setRoomLocal(roomId, { name: opts.name?.trim() || null });
  return roomId;
}

export async function myRooms(): Promise<RoomSummary[]> {
  const rows = await rpc<any[]>('chat_my_rooms', {});
  const out: RoomSummary[] = [];
  for (const r of rows) {
    const local = await roomLocal(r.id);
    out.push({ id: r.id, kind: r.kind, role: r.role, memberState: r.member_state, ttl: r.default_ttl_s, mode: r.expiry_mode, expiresAt: r.expires_at, name: local.name });
  }
  return out;
}

export async function setRoomName(roomId: string, name: string) {
  await setRoomLocal(roomId, { name: name.trim().slice(0, 60) || null });
}

/** Creates an invite. The token travels only in the link's #fragment, never in a request URL. */
export async function createInvite(roomId: string, opts: { expiresIn: number; maxUses: number; approval: boolean }) {
  const token = randomToken(32);
  const id = await rpc<string>('chat_create_invite', {
    p_room: roomId, p_token: token, p_expires_s: opts.expiresIn, p_max_uses: opts.maxUses, p_requires_approval: opts.approval,
  });
  return { id, link: `${window.location.origin}/chat/join#${token}` };
}

export async function listInvites(roomId: string) {
  return rpc<{ id: string; expires_at: string; max_uses: number; uses: number; requires_approval: boolean; revoked_at: string | null }[]>('chat_list_invites', { p_room: roomId });
}

export async function revokeInvite(id: string) {
  await rpc('chat_revoke_invite', { p_invite: id });
}

export async function peekInvite(token: string) {
  await ensureSession(true);
  const rows = await rpc<{ needs_code: boolean; kind: RoomKind }[]>('chat_peek_invite', { p_token: token });
  return rows[0] ?? null;
}

/** Joins with an invite. Signs in as a guest when needed. Returns the room id (membership is pending until admitted). */
export async function redeemInvite(token: string, nickname: string, accessCode?: string) {
  await ensureSession(true);
  const dev = await ensureDevice();
  const kp = await mls.newKeyPackage(dev.id, dev.signing);
  const rows = await rpc<{ joined_room: string | null; error: string | null }[]>('chat_redeem_invite', {
    p_token: token, p_device: dev.id, p_key_package: toBytea(kp.publicBytes), p_access_code: accessCode || null,
  });
  const r = rows[0];
  if (!r || r.error || !r.joined_room) throw new ChatError(r?.error || 'invite_invalid');
  await ks.put(roomKey(r.joined_room, 'pending'), { publicBytes: kp.publicBytes, privatePackage: kp.privatePackage, nickname: nickname.trim().slice(0, 40) } satisfies PendingJoin);
  return r.joined_room;
}

export async function members(roomId: string) {
  const rows = await rpc<any[]>('chat_room_members', { p_room: roomId });
  const local = await roomLocal(roomId);
  return rows.map(m => ({
    deviceId: m.device_id as string, role: m.role as 'owner' | 'member', state: m.state as 'pending' | 'active',
    signaturePub: fromBytea(m.signature_pub), hasKeyPackage: !!m.key_package,
    nickname: local.nicknames[m.device_id] ?? null, verified: local.verified[m.device_id] ?? null,
  }));
}

/** Owner only: admits pending joiners by committing an MLS add and sending each a Welcome. */
export function admitPending(roomId: string, only?: string[]) {
  return withRoomLock(roomId, () => admitPendingLocked(roomId, only));
}
async function admitPendingLocked(roomId: string, only?: string[]) {
  const dev = await ensureDevice();
  let state = await loadState(roomId);
  if (!state) return 0;
  const rows = (await rpc<any[]>('chat_room_members', { p_room: roomId }))
    .filter(m => m.state === 'pending' && m.key_package && (!only || only.includes(m.device_id)));
  if (!rows.length) return 0;
  const added = await mls.addMembers(state, rows.map(m => fromBytea(m.key_package)));
  const epoch = Number(mls.epoch(state));
  await rpc('chat_send', {
    p_room: roomId, p_device: dev.id, p_id: crypto.randomUUID(), p_kind: 'commit', p_epoch: epoch,
    p_ciphertext: toBytea(added.commit), p_activate: rows.map(m => m.device_id),
  });
  state = added.state;
  await saveState(roomId, state);
  for (const m of rows) {
    await rpc('chat_send', {
      p_room: roomId, p_device: dev.id, p_id: crypto.randomUUID(), p_kind: 'welcome', p_epoch: Number(mls.epoch(state)),
      p_ciphertext: toBytea(added.welcome!), p_to_device: m.device_id,
    });
  }
  return rows.length;
}

/** Owner only: commits the MLS removal of devices the server already marked removed (left or revoked). */
export function commitRemovals(roomId: string) {
  return withRoomLock(roomId, () => commitRemovalsLocked(roomId));
}
async function commitRemovalsLocked(roomId: string) {
  const dev = await ensureDevice();
  let state = await loadState(roomId);
  if (!state) return 0;
  const live = new Set((await rpc<any[]>('chat_room_members', { p_room: roomId })).map(m => m.device_id as string));
  const gone = mls.memberLeaves(state).map(l => l.deviceId).filter(id => id !== dev.id && !live.has(id));
  for (const id of gone) {
    const r = await mls.removeDevice(state, id);
    await rpc('chat_send', {
      p_room: roomId, p_device: dev.id, p_id: crypto.randomUUID(), p_kind: 'commit', p_epoch: Number(mls.epoch(state)),
      p_ciphertext: toBytea(r.commit), p_remove: [id],
    });
    state = r.state;
    await saveState(roomId, state);
  }
  return gone.length;
}

/** Owner removes a member: the server revokes access, then the MLS commit locks them out cryptographically. */
export function removeMember(roomId: string, deviceId: string) {
  return withRoomLock(roomId, () => removeMemberLocked(roomId, deviceId));
}
async function removeMemberLocked(roomId: string, deviceId: string) {
  const dev = await ensureDevice();
  let state = await loadState(roomId);
  if (!state) throw new ChatError('no_local_state');
  const r = await mls.removeDevice(state, deviceId);
  await rpc('chat_send', {
    p_room: roomId, p_device: dev.id, p_id: crypto.randomUUID(), p_kind: 'commit', p_epoch: Number(mls.epoch(state)),
    p_ciphertext: toBytea(r.commit), p_remove: [deviceId],
  });
  await saveState(roomId, r.state);
}

// ---------------------------------------------------------------------------- messaging

/** Sends a text message. Pass `id` to match a message already shown on screen while sending. */
export async function send(roomId: string, body: string, ttl: number, replyTo?: string, id: string = crypto.randomUUID()) {
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

// ---------------------------------------------------------------------------- attachments

/** Files are capped by the storage bucket (50 MB, including 28 bytes of encryption overhead). */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024 - 1024;
const BUCKET = 'chat-attachments';

/**
 * Sends a file. It is encrypted on this device with a fresh AES-256-GCM key; only the
 * ciphertext is uploaded. The key, name and type travel inside the MLS message, so the
 * server never learns them. View-once files can be opened once per chat, then access ends.
 */
export async function sendFile(roomId: string, file: File, ttl: number, viewOnce: boolean) {
  if (!file.size) throw new ChatError('empty_file');
  if (file.size > MAX_ATTACHMENT_BYTES) throw new ChatError('file_too_large');
  const dev = await ensureDevice();
  if (!(await loadState(roomId))) throw new ChatError('no_local_state');

  const { key, keyB64 } = await newKey();
  const blob = await encryptBytes(key, await file.arrayBuffer());
  const attachmentId = crypto.randomUUID();
  const objectPath = await rpc<string>('chat_register_attachment', {
    p_room: roomId, p_device: dev.id, p_id: attachmentId, p_size: blob.byteLength, p_view_once: viewOnce, p_ttl_s: ttl,
  });
  const up = await sb().storage.from(BUCKET).upload(objectPath, new Blob([blob as BlobPart], { type: 'application/octet-stream' }), {
    contentType: 'application/octet-stream', upsert: false,
  });
  if (up.error) throw new ChatError('upload_failed');

  const id = crypto.randomUUID();
  const payload = {
    t: 'file' as const, id, ttl, viewOnce, objectPath, key: keyB64,
    name: file.name.slice(0, 120) || 'file', mime: (file.type || 'application/octet-stream').slice(0, 100), size: file.size,
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
export async function openFile(roomId: string, m: LocalMessage): Promise<Blob> {
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
  return new Blob([plain], { type: f.mime || 'application/octet-stream' });
}

export async function markViewed(roomId: string, m: LocalMessage) {
  const viewed = { ...m, viewed: true };
  await storeMessage(roomId, viewed);
  return viewed;
}

// ---------------------------------------------------------------------------- notifications

/** Asks the server to send a content-free "new message" push to the room's other members. */
export async function notifyRoom(roomId: string) {
  try {
    const { data } = await sb().auth.getSession();
    const token = data.session?.access_token;
    if (!token || typeof fetch === 'undefined' || typeof window === 'undefined') return;
    await fetch('/api/chat/notify', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ room: roomId }),
    });
  } catch { /* best effort */ }
}

async function sendControl(roomId: string, payload: mls.ChatPayload) {
  const dev = await ensureDevice();
  const state = await loadState(roomId);
  if (!state) return;
  const enc = await mls.encrypt(state, payload);
  await saveState(roomId, enc.state);
  await rpc('chat_send', {
    p_room: roomId, p_device: dev.id, p_id: crypto.randomUUID(), p_kind: 'app', p_epoch: Number(mls.epoch(state)),
    p_ciphertext: toBytea(enc.ciphertext), p_ttl_s: 86400,
  });
}

export type SyncResult = { joined: boolean; removed: boolean; newMessages: number };

/** Pulls everything after the last processed sequence number and applies it in order. */
export function sync(roomId: string): Promise<SyncResult> {
  return withRoomLock(roomId, () => syncLocked(roomId));
}

async function syncLocked(roomId: string): Promise<SyncResult> {
  const dev = await ensureDevice();
  const local = await roomLocal(roomId);
  let rows: any[];
  try {
    rows = await rpc<any[]>('chat_fetch', { p_room: roomId, p_device: dev.id, p_after: local.lastSeq, p_limit: 200 });
  } catch (e) {
    // Removed, burned or expired: the server is authoritative, so drop our keys and copies too.
    if (e instanceof ChatError && e.code === 'not_a_member') { await forgetRoom(roomId); return { joined: false, removed: true, newMessages: 0 }; }
    throw e;
  }
  let state = await loadState(roomId);
  let lastSeq = local.lastSeq;
  const nicknames = { ...local.nicknames };
  const res: SyncResult = { joined: false, removed: false, newMessages: 0 };

  for (const row of rows) {
    lastSeq = Math.max(lastSeq, Number(row.seq));
    const bytes = fromBytea(row.ciphertext);
    try {
      if (row.kind === 'welcome') {
        const pending = await ks.get<PendingJoin>(roomKey(roomId, 'pending'));
        if (state || !pending) continue;
        state = await mls.joinRoom(bytes, mls.restoreKeyPackage(pending.publicBytes, pending.privatePackage));
        await saveState(roomId, state);
        await ks.del(roomKey(roomId, 'pending'));
        res.joined = true;
        if (pending.nickname) {
          nicknames[dev.id] = pending.nickname;
          await setRoomLocal(roomId, { lastSeq, nicknames });
          await sendControl(roomId, { t: 'nick', name: pending.nickname });
          state = await loadState(roomId);
        }
        continue;
      }
      if (!state) continue;  // traffic from before we joined: not ours to read
      const got = await mls.receive(state, bytes, dev.id);
      state = got.state;
      if (got.kind === 'commit') {
        await saveState(roomId, state);
        if (got.removedSelf) { res.removed = true; break; }
        continue;
      }
      await saveState(roomId, state);
      const p = got.payload;
      if (p.t === 'nick') { nicknames[row.sender_device] = p.name.slice(0, 40); continue; }
      const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
      await storeMessage(roomId, {
        id: p.id, seq: Number(row.seq), mine: false, sender: row.sender_device,
        body: p.t === 'text' ? p.body : '', ttl: p.ttl, sentAt: new Date(row.created_at).getTime(), expiresAt,
        replyTo: p.t === 'text' ? p.replyTo : undefined, file: p.t === 'file' ? p : undefined,
      });
      res.newMessages++;
    } catch {
      // Undecryptable (older epoch, tampered, replayed): skip it. The server can't tell us otherwise.
    }
  }
  if (res.removed) { await forgetRoom(roomId); return res; }
  await setRoomLocal(roomId, { lastSeq, nicknames });
  return res;
}

/** Starts the recipient-side countdown. The server decides the expiry; we adopt it. */
export async function markOpened(roomId: string, m: LocalMessage) {
  if (m.mine || m.expiresAt) return m;
  const dev = await ensureDevice();
  const at = await rpc<string | null>('chat_mark_opened', { p_message: m.id, p_device: dev.id });
  const opened = { ...m, expiresAt: at ? new Date(at).getTime() : Date.now() + m.ttl * 1000 };
  await storeMessage(roomId, opened);
  return opened;
}

export async function setTimer(roomId: string, ttl: number, mode: ExpiryMode) {
  await rpc('chat_set_timer', { p_room: roomId, p_ttl_s: ttl, p_expiry_mode: mode });
}

// ---------------------------------------------------------------------------- verification

export async function safetyNumberWith(roomId: string, deviceId: string) {
  const dev = await ensureDevice();
  const list = await members(roomId);
  const them = list.find(m => m.deviceId === deviceId);
  if (!them) throw new ChatError('not_a_member');
  return mls.safetyNumber({ key: dev.signing.publicKey, id: dev.id }, { key: them.signaturePub, id: deviceId });
}

export async function markVerified(roomId: string, deviceId: string) {
  const list = await members(roomId);
  const them = list.find(m => m.deviceId === deviceId);
  if (!them) return;
  const local = await roomLocal(roomId);
  await setRoomLocal(roomId, { verified: { ...local.verified, [deviceId]: toBytea(them.signaturePub) } });
}

/** True when a verified member's key no longer matches what was verified (possible key substitution). */
export function keyChanged(m: { verified: string | null; signaturePub: Uint8Array }) {
  return !!m.verified && m.verified !== toBytea(m.signaturePub);
}

// ---------------------------------------------------------------------------- leave, burn, panic

export async function leave(roomId: string) {
  const dev = await ensureDevice();
  await rpc('chat_leave', { p_room: roomId, p_device: dev.id });
  await forgetRoom(roomId);
}

export async function burn(roomId: string) {
  await rpc('chat_burn', { p_room: roomId });
  await forgetRoom(roomId);
}

// Panic lock: hides everything immediately and requires an unlock step to come back.
// It does not delete rooms. Kept in sessionStorage + localStorage so other tabs lock too.
const LOCK = 'onepeek.chat.locked';
export function lock() {
  try { localStorage.setItem(LOCK, '1'); } catch { /* ignore */ }
  try { new BroadcastChannel('onepeek-chat').postMessage({ t: 'lock' }); } catch { /* ignore */ }
}
export function isLocked() {
  try { return localStorage.getItem(LOCK) === '1'; } catch { return false; }
}
/** Unlock. Accounts with a passkey must pass the OS check (Face ID / Touch ID / PIN) again. */
export async function unlock() {
  const session = await ensureSession(false);
  if (session && !session.user.is_anonymous) {
    const { data } = await sb().auth.passkey.list();
    if (data && data.length) {
      const { error } = await sb().auth.signInWithPasskey();
      if (error) throw new ChatError(error.message);
    }
  }
  try { localStorage.removeItem(LOCK); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------- realtime

/** Subscribes to a room's private channel. Pings carry ids only; content is always fetched and decrypted. */
export function subscribe(roomId: string, on: (event: string, payload: any) => void): () => void {
  let ch: RealtimeChannel | null = null;
  let closed = false;
  (async () => {
    const { data } = await sb().auth.getSession();
    if (data.session) await sb().realtime.setAuth(data.session.access_token);
    if (closed) return;
    ch = sb().channel(`room:${roomId}`, { config: { private: true } })
      .on('broadcast', { event: '*' }, (msg) => on(msg.event, msg.payload))
      .subscribe((status) => { if (status === 'SUBSCRIBED') on('subscribed', {}); });
  })();
  return () => { closed = true; if (ch) sb().removeChannel(ch); };
}

export { ks as keystore };
