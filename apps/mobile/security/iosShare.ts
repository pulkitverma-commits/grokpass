// iOS share receive (N6b): consumes what `expo-share-intent` delivers and makes it look exactly like the
// Android module's output ({ text?, uris? } with file:// copies in <cache>/share-intent/).
//
// How the package delivers (expo-share-intent 9.0.0, read from its sources):
//   - The Share Extension (its own process) copies every shared file into the ROOT of the App Group
//     container as <UUID>.<ext> (plus a <base64>.jpg thumbnail per video), stores the item list as JSON in
//     the group's UserDefaults under `<scheme>ShareKey` and opens `<scheme>://dataUrl=<key>?nonce=…#<type>`.
//   - In the app, its `useShareIntent()` hook sees that URL (expo-linking `useLinkingURL`), asks the native
//     module to read the UserDefaults entry and exposes `{ text, webUrl, files[{ path, mimeType, … }] }`.
//   - `resetShareIntent()` only nils the UserDefaults key. IT NEVER DELETES THE FILES. So this module moves
//     each referenced file into <cache>/share-intent/<24 hex>.<ext> (random name: the original name never
//     reaches the cache or a route param) and then deletes every remaining regular file in the container root
//     (thumbnails, leftovers of a share the app never read). Directories there (`Library/Preferences`, the
//     UserDefaults suite) are left alone.
// The container is reached through expo-file-system's `Paths.appleSharedContainers['group.io.onepeek.app']`
// (https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/#appleSharedContainers); it is empty on Android, in
// jest and in a build without the entitlement. Nothing here logs anything.
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import type { ShareIntent } from 'expo-share-intent';
import type { PendingShare } from '@/modules/share-intent';
import { MAX_SHARE_ITEM_BYTES, MAX_SHARE_ITEMS } from './constants';

/** The App Group shared by the app and the extension (`iosAppGroupIdentifier` in app.config.ts). */
export const APP_GROUP = 'group.io.onepeek.app';
/** Directory name inside the app cache that holds the plaintext copies (both platforms). */
export const SHARE_DIR = 'share-intent';
const SAFE_EXT = /^[a-z0-9]{1,8}$/;

/** The group container, or null when the app has no such App Group (no entitlement, Android, jest). */
export function groupContainer(group: string = APP_GROUP): Directory | null {
  try {
    const dir = Paths.appleSharedContainers?.[group];
    return dir ?? null;
  } catch {
    return null;
  }
}

/** Deletes every regular file in the group container root (never directories). Never throws. */
export function sweepGroupContainer(group: string = APP_GROUP): void {
  const dir = groupContainer(group);
  if (!dir) return;
  try {
    if (!dir.exists) return;
    for (const entry of dir.list()) {
      if (entry instanceof File) {
        try { entry.delete(); } catch { /* best effort */ }
      }
    }
  } catch { /* best effort */ }
}

function randomName(ext: string): string {
  const bytes = Crypto.getRandomBytes(12);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return ext ? `${hex}.${ext}` : hex;
}

function safeExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  const ext = name.slice(dot + 1).toLowerCase();
  return SAFE_EXT.test(ext) ? ext : '';
}

/**
 * Turns the package's share intent into `{ text?, uris?, dropped? }`: `text` is the shared text, or the
 * URL when only a URL was shared; files are MOVED out of the group container into <cache>/share-intent/
 * under random names, then the container root is swept. Caps as on Android (P2-4): MAX_SHARE_ITEMS items,
 * MAX_SHARE_ITEM_BYTES per item (an oversize item is skipped and swept, the others still go through);
 * `dropped` counts the skipped ones. Resolves null when nothing usable was shared.
 * Call `resetShareIntent()` right after (the caller owns the hook).
 */
export async function importShareIntent(intent: Pick<ShareIntent, 'text' | 'webUrl' | 'files'> | null | undefined, group: string = APP_GROUP): Promise<PendingShare | null> {
  if (!intent) return null;
  const out: PendingShare = {};
  const text = typeof intent.text === 'string' && intent.text.trim() ? intent.text : typeof intent.webUrl === 'string' && intent.webUrl.trim() ? intent.webUrl : '';
  if (text) out.text = text;
  const uris: string[] = [];
  const all = Array.isArray(intent.files) ? intent.files : [];
  const files = all.slice(0, MAX_SHARE_ITEMS);
  if (files.length) {
    const dest = new Directory(Paths.cache, SHARE_DIR);
    for (const f of files) {
      const path = f && typeof f.path === 'string' ? f.path : '';
      if (!path.startsWith('file://')) continue;
      try {
        const src = new File(path);
        if (!src.exists) continue;
        if (src.size > MAX_SHARE_ITEM_BYTES) continue; // oversize: skipped, swept below
        if (!dest.exists) dest.create({ intermediates: true, idempotent: true });
        const target = new File(dest, randomName(safeExtension(src.name)));
        await src.move(target);
        uris.push(target.uri);
      } catch { /* unreadable item: skipped; swept below */ }
    }
  }
  sweepGroupContainer(group);
  if (uris.length) out.uris = uris;
  if (all.length - uris.length > 0) out.dropped = all.length - uris.length;
  return out.text || out.uris ? out : null;
}
