// @onepeek/core public surface. The web app imports these files by relative path
// (lib/crypto.ts, lib/chat/*.ts); apps/mobile imports the package by name.

export * from './crypto';
export * from './time';
export * from './secrets';
export * as mls from './chat/mls';
export * from './chat/ports';
export { pack, unpack, seal, unseal, isExpired, type Sealed } from './chat/keystore';
export {
  createChatClient, ChatError, toBytea, fromBytea, keyChanged, MAX_ATTACHMENT_BYTES,
  type ChatClient, type RoomKind, type ExpiryMode, type LocalMessage, type RoomSummary, type SyncResult, type DeviceRecord,
} from './chat/client';
export { parseInviteFragment, INVITE_FRAGMENT_RE, type OwnerPin } from './chat/invite';
export { createWebKeyStore } from './adapters/web/keystore';
export { createWebPlatform, withBlobUploads, webEnv, webLock, fileSource, toBlob } from './adapters/web/platform';

// Approved logging path: a no-op logger and a redactor for anything that must never carry secrets.
export { log, redact } from './log';
