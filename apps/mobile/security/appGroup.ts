// iOS App Group reader (N6). The Share Extension (plugins/withShareExtension.js, experimental) runs in
// its own process and cannot hand bytes to the app directly; it writes the shared items into the App
// Group container, which both targets can read:
//   <group>/share-intent/pending.json    { "v": 1, "items": [ { "kind": "text", "text": "…" },
//                                                            { "kind": "file", "name": "<random>.<ext>" } ] }
//   <group>/share-intent/<random>.<ext>  the file items (random names: the real name never touches disk)
// and then opens `onepeek://share`. The app reads the container on launch / foreground / that URL
// through expo-file-system's `Paths.appleSharedContainers` (keyed by App Group identifier; needs the
// `com.apple.security.application-groups` entitlement on the app target, which the plugin adds:
// https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/#appleSharedContainers,
// https://developer.apple.com/documentation/foundation/filemanager/containerurl(forsecurityapplicationgroupidentifier:)).
// Each file is moved into the app's own <cache>/share-intent/ (so the share screen handles the same
// file:// URIs on both platforms and the group container, which the extension process can also read,
// is empty again at once); the manifest is deleted. Nothing is logged.
import { Directory, File, Paths } from 'expo-file-system';
import type { PendingShare } from '@/modules/share-intent';

/** The App Group shared by the app and its Share Extension (plugins/withShareExtension.js `appGroup`). */
export const APP_GROUP = 'group.io.onepeek.app';
/** Directory name inside the group container and inside the app cache. */
export const SHARE_DIR = 'share-intent';
const MANIFEST = 'pending.json';
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ITEMS = 50;
const SAFE_NAME = /^[a-f0-9]{16,64}(\.[a-z0-9]{1,8})?$/;

type ShareItem = { kind: 'text'; text: string } | { kind: 'file'; name: string };

/** The group container's share directory, or null when the app has no such App Group (no entitlement, Android, jest). */
export function groupShareDir(group: string = APP_GROUP): Directory | null {
  try {
    const containers = Paths.appleSharedContainers;
    const root = containers?.[group];
    if (!root) return null;
    return new Directory(root, SHARE_DIR);
  } catch {
    return null;
  }
}

function parseManifest(text: string): ShareItem[] | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || (parsed as { v?: unknown }).v !== 1) return null;
  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length > MAX_ITEMS) return null;
  const out: ShareItem[] = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const kind = (it as { kind?: unknown }).kind;
    if (kind === 'text' && typeof (it as { text?: unknown }).text === 'string') out.push({ kind: 'text', text: (it as { text: string }).text });
    else if (kind === 'file' && typeof (it as { name?: unknown }).name === 'string' && SAFE_NAME.test((it as { name: string }).name)) out.push({ kind: 'file', name: (it as { name: string }).name });
  }
  return out;
}

/**
 * Reads and consumes whatever the Share Extension left in the App Group container. Resolves null when
 * there is nothing (or no container). Files are moved into the app cache; the manifest and anything
 * else in the group directory are deleted, so a second call resolves null.
 */
export async function readAppGroupShare(group: string = APP_GROUP): Promise<PendingShare | null> {
  const dir = groupShareDir(group);
  if (!dir) return null;
  try {
    if (!dir.exists) return null;
    const manifest = new File(dir, MANIFEST);
    if (!manifest.exists) { wipe(dir); return null; }
    if ((manifest.size ?? 0) > MAX_MANIFEST_BYTES) { wipe(dir); return null; }
    const items = parseManifest(await manifest.text());
    if (!items) { wipe(dir); return null; }
    const out: PendingShare = {};
    const uris: string[] = [];
    let text = '';
    const dest = new Directory(Paths.cache, SHARE_DIR);
    for (const it of items) {
      if (it.kind === 'text') { text = text ? `${text}\n${it.text}` : it.text; continue; }
      const src = new File(dir, it.name);
      if (!src.exists) continue;
      try {
        if (!dest.exists) dest.create({ intermediates: true, idempotent: true });
        const target = new File(dest, it.name);
        await src.move(target);
        uris.push(target.uri);
      } catch { /* unreadable item: skipped; wiped below */ }
    }
    if (text) out.text = text;
    if (uris.length) out.uris = uris;
    wipe(dir);
    return out.text || out.uris ? out : null;
  } catch {
    try { wipe(dir); } catch { /* best effort */ }
    return null;
  }
}

/** Deletes the group share directory and everything in it (the next share recreates it). */
function wipe(dir: Directory): void {
  try { if (dir.exists) dir.delete(); } catch { /* best effort */ }
}
