// Secret Chat client for the web app. The implementation lives in
// packages/core/src/chat/client.ts (shared with the mobile apps); this file binds it to the
// browser once, with the app's Supabase client, the IndexedDB keystore and the window/
// navigator/localStorage bits (packages/core/src/adapters/web/platform.ts), and re-exports the
// same names with the same signatures the app has always imported from '@/lib/chat/client'.
//
// Nothing here sends plaintext anywhere: messages are MLS-encrypted before any network call,
// and the server sees device ids, sequence numbers and ciphertext.

import { supabase } from '../supabase';
import { createChatClient, type LocalMessage } from '../../packages/core/src/chat/client';
import { createWebPlatform, fileSource, toBlob, webLock } from '../../packages/core/src/adapters/web/platform';
import { keystore as ks } from './keystore';

export { ChatError, toBytea, fromBytea, keyChanged, MAX_ATTACHMENT_BYTES, SYNC_PAGE_SIZE, SYNC_MAX_PAGES, RESUBSCRIBE_DELAYS_MS } from '../../packages/core/src/chat/client';
export { parseInviteFragment, INVITE_FRAGMENT_RE } from '../../packages/core/src/chat/invite';
export type { RoomKind, ExpiryMode, LocalMessage, RoomSummary, SyncResult, DeviceRecord, ChatClient } from '../../packages/core/src/chat/client';
export type { ChatPlatform, FileSource, OpenedFile, KeyStore, SupabaseLike, ChatEnv, LockStore } from '../../packages/core/src/chat/ports';

// One client per page (module singleton), like the module-level functions it replaces.
const client = createChatClient(createWebPlatform({ supabase, keystore: ks }));

export const {
  ensureSession, ensureDevice, listDevices, revokeDevice,
  forgetRoom, messages, dropMessage,
  createRoom, myRooms, setRoomName, createInvite, listInvites, revokeInvite, peekInvite, redeemInvite, members,
  admitPending, commitRemovals, removeMember,
  send, sendScreenshotAlert, markViewed, notifyRoom, sync, markOpened, setTimer,
  safetyNumberWith, markVerified,
  leave, burn, lock, isLocked, unlock, subscribe,
} = client;

/**
 * Sends a file. It is encrypted on this device with a fresh AES-256-GCM key; only the
 * ciphertext is uploaded. The key, name and type travel inside the MLS message, so the
 * server never learns them. View-once files can be opened once per chat, then access ends.
 */
export function sendFile(roomId: string, file: File, ttl: number, viewOnce: boolean) {
  return client.sendFile(roomId, fileSource(file), ttl, viewOnce);
}

/**
 * Downloads and decrypts an attachment. For someone else's view-once file this claims it
 * first: the server then allows a short download window and revokes it for good.
 * The sender can't open their own view-once file (that would use up the one view).
 */
export async function openFile(roomId: string, m: LocalMessage): Promise<Blob> {
  return toBlob(await client.openFile(roomId, m));
}

/** True while chats are hidden: Panic-locked, or passkey-locked and not yet unlocked in this page. */
export async function chatsLocked() {
  return isLocked() || (await ks.passkey.status()) === 'locked';
}

/**
 * Unlocks chats with one check. With the passkey lock on, unlocking the keys already needs the
 * passkey (Face ID / Touch ID / PIN), so that also clears a Panic lock; otherwise it's the usual
 * unlock (which asks for a passkey sign-in when the account has one).
 */
export async function unlockChats() {
  if ((await ks.passkey.status()) !== 'off') {
    await ks.passkey.unlock();
    webLock.clear();
    return;
  }
  await unlock();
}

export { ks as keystore };
