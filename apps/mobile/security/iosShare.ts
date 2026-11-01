// iOS share receive (N6b): consumes what `expo-share-intent` delivers and makes it look exactly like the
// Android module's output ({ text?, uris?, nonce?, dropped? } with file:// copies in <cache>/share-intent/<nonce>/).
//
// How the package delivers (expo-share-intent 9.0.0, read from its sources):
//   - The Share Extension (its own process) copies every shared file into the ROOT of the App Group
//     container as <UUID>.<ext> (plus a <base64>.jpg thumbnail per video), stores the item list as JSON in
//     the group's UserDefaults under `<scheme>ShareKey` and opens `<scheme>://dataUrl=<key>?nonce=…#<type>`.
//   - In the app, its `useShareIntent()` hook sees that URL (expo-linking `useLinkingURL`), asks the native
//     module to read the UserDefaults entry and exposes `{ text, webUrl, files[{ path, mimeType, … }] }`.
//   - `resetShareIntent()` only nils the UserDefaults key. IT NEVER DELETES THE FILES. So this module moves
//     each referenced file into <cache>/share-intent/<nonce>/<24 hex>.<ext> (random names: the original name
//     never reaches the cache or a route param; one directory per share, P3-3) and then deletes, by name,
//     what else this share left in the container: the listed files it did not move (oversize, unreadable)
//     and their thumbnails. It does NOT sweep the whole container root while importing: a second share's
//     extension may be writing there at that moment (P3-3). `sweepGroupContainer()` (launch, consume) is
//     the catch-all for leftovers and skips anything written in the last GROUP_SWEEP_GRACE_MS for the same
//     reason, and does nothing while an import is in flight. Directories there (`Library/Preferences`, the
//     UserDefaults suite) are always left alone.
// The container is reached through expo-file-system's `Paths.appleSharedContainers['group.io.onepeek.app']`
// (https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/#appleSharedContainers); it is empty on Android, in
// jest and in a build without the entitlement. Nothing here logs anything.
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import type { ShareIntent } from 'expo-share-intent';
import type { PendingShare } from '@/modules/share-intent';
import { MAX_SHARE_BYTES, MAX_SHARE_ITEM_BYTES, MAX_SHARE_ITEMS } from './constants';

/** The App Group shared by the app and the extension (`iosAppGroupIdentifier` in app.config.ts). */
export const APP_GROUP = 'group.io.onepeek.app';
/** Directory name inside the app cache that holds the plaintext copies (both platforms). */
export const SHARE_DIR = 'share-intent';
/** A container file modified more recently than this is a share being written: the sweep leaves it (P3-3). */
export const GROUP_SWEEP_GRACE_MS = 10_000;
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

// Imports in flight. While one is moving files out of the container, no blanket sweep runs (P3-3).
let importing = 0;
// Per share (nonce): the container names its intent listed (and their thumbnail names), so consuming
// that share removes exactly those, by name, and nothing a later share wrote there (P3-3).
const importedNames = new Map<string, string[]>();

/**
 * Deletes regular files in the group container root (never directories), except those modified in the
 * last GROUP_SWEEP_GRACE_MS (a share the extension is writing right now) and, when a file's modification
 * time is unknown, nothing is assumed: it is deleted. A no-op while an import is in flight. Never throws.
 */
export function sweepGroupContainer(group: string = APP_GROUP, now: number = Date.now()): void {
  if (importing > 0) return;
  const dir = groupContainer(group);
  if (!dir) return;
  try {
    if (!dir.exists) return;
    for (const entry of dir.list()) {
      if (!(entry instanceof File)) continue;
      try {
        const at = entry.modificationTime;
        if (typeof at === 'number' && now - at < GROUP_SWEEP_GRACE_MS) continue;
        entry.delete();
      } catch { /* best effort */ }
    }
  } catch { /* best effort */ }
}

function randomHex(): string {
  const bytes = Crypto.getRandomBytes(12);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function randomName(ext: string): string {
  const hex = randomHex();
  return ext ? `${hex}.${ext}` : hex;
}

function safeExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  const ext = name.slice(dot + 1).toLowerCase();
  return SAFE_EXT.test(ext) ? ext : '';
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 of an ASCII / Latin-1 string, without padding (Hermes has no reliable btoa). */
function base64Ascii(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 3) {
    const a = s.charCodeAt(i) & 0xff;
    const b = i + 1 < s.length ? s.charCodeAt(i + 1) & 0xff : -1;
    const c = i + 2 < s.length ? s.charCodeAt(i + 2) & 0xff : -1;
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b < 0 ? 0 : b) >> 4)]!;
    if (b >= 0) out += B64[((b & 15) << 2) | ((c < 0 ? 0 : c) >> 6)]!;
    if (c >= 0) out += B64[c & 63]!;
  }
  return out;
}

/** The thumbnail names the extension may have written for a shared video: `<base64(name)>.jpg`, padded or not. */
function thumbnailNames(name: string): string[] {
  const raw = base64Ascii(name);
  const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
  return padded === raw ? [`${raw}.jpg`] : [`${raw}.jpg`, `${padded}.jpg`];
}

function deleteIfPresent(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch { /* best effort: the next sweep (after the grace period) gets it */ }
}

/**
 * Turns the package's share intent into `{ text?, uris?, nonce?, dropped? }`: `text` is the shared text, or the
 * URL when only a URL was shared; files are MOVED out of the group container into <cache>/share-intent/<nonce>/
 * under random names (`nonce` is returned so the share screen can `consumeShare(nonce)` exactly this
 * directory). Caps as on Android: MAX_SHARE_ITEMS items, MAX_SHARE_ITEM_BYTES per item (P2-4) and
 * MAX_SHARE_BYTES for the whole share (P3-6); an item past a cap is not moved, the others still go through,
 * `dropped` counts the skipped ones. Afterwards the files this intent listed but did not move, and the
 * thumbnails of every listed file, are deleted by name; nothing else in the container is touched.
 * Resolves null when nothing usable was shared. Call `resetShareIntent()` right after (the caller owns the hook).
 */
export async function importShareIntent(intent: Pick<ShareIntent, 'text' | 'webUrl' | 'files'> | null | undefined, group: string = APP_GROUP): Promise<PendingShare | null> {
  if (!intent) return null;
  const out: PendingShare = {};
  const text = typeof intent.text === 'string' && intent.text.trim() ? intent.text : typeof intent.webUrl === 'string' && intent.webUrl.trim() ? intent.webUrl : '';
  if (text) out.text = text;
  const uris: string[] = [];
  const all = Array.isArray(intent.files) ? intent.files : [];
  if (all.length) {
    importing += 1;
    try {
      const nonce = randomHex();
      const dest = new Directory(Paths.cache, SHARE_DIR, nonce);
      const container = groupContainer(group);
      let budget = MAX_SHARE_BYTES;
      const listed: string[] = [];
      for (const [index, f] of all.entries()) {
        const path = f && typeof f.path === 'string' ? f.path : '';
        if (!path.startsWith('file://')) continue;
        let src: File | null = null;
        let storedName = '';   // the container name, read before the move renames `src`
        try {
          src = new File(path);
          storedName = src.name;
          if (!src.exists) continue;
          const size = src.size;
          // Past MAX_SHARE_ITEMS the item is only deleted below, never moved (P2-4).
          if (index < MAX_SHARE_ITEMS && size <= MAX_SHARE_ITEM_BYTES && size <= budget) {
            if (!dest.exists) dest.create({ intermediates: true, idempotent: true });
            const target = new File(dest, randomName(safeExtension(src.name)));
            await src.move(target);
            budget -= size;
            uris.push(target.uri);
          }
        } catch { /* unreadable item: skipped; deleted by name below */ }
        // This share's leftovers, by name: the file itself when it was not moved (over a cap, unreadable)
        // and the thumbnail the extension writes for a video. Never the rest of the container (P3-3).
        if (src) deleteIfPresent(new File(path));
        if (container) {
          const names = new Set<string>();
          if (storedName) for (const t of thumbnailNames(storedName)) names.add(t);
          const original = (f as { fileName?: unknown }).fileName;
          if (typeof original === 'string' && original) for (const t of thumbnailNames(original)) names.add(t);
          for (const t of names) deleteIfPresent(new File(container, t));
          if (storedName) listed.push(storedName);
          listed.push(...names);
        }
      }
      if (uris.length) {
        out.uris = uris;
        out.nonce = nonce;
        importedNames.set(nonce, listed);
      }
    } finally {
      importing -= 1;
    }
  }
  if (all.length - uris.length > 0) out.dropped = all.length - uris.length;
  return out.text || out.uris ? out : null;
}

/**
 * The share `nonce` is done (consumeShare): deletes, by name, whatever is still at the container root
 * under the names its intent listed (normally nothing: the files were moved and the leftovers deleted at
 * import) and forgets the record. Never a blanket sweep, so a share being written now is untouched
 * (P3-3). Unknown or missing nonce: nothing happens. Never throws.
 */
export function releaseImport(nonce: string | null | undefined, group: string = APP_GROUP): void {
  if (typeof nonce !== 'string') return;
  const names = importedNames.get(nonce);
  importedNames.delete(nonce);
  if (!names) return;
  const container = groupContainer(group);
  if (!container) return;
  for (const n of names) deleteIfPresent(new File(container, n));
}
