// JS binding for the local native module (modules/share-intent/{android,ios}). Loaded with
// `requireOptionalNativeModule` so Expo Go, jest and the web bundle get a stub that reports "nothing
// pending" instead of crashing. On iOS the native side is a stub too: shared items arrive through
// expo-share-intent's hook (apps/mobile/security/shareIntent.ts + iosShare.ts), not through this module.
import { NativeModule, requireOptionalNativeModule } from 'expo';
import { File, Paths } from 'expo-file-system';
import { MAX_SHARE_BYTES, MAX_SHARE_ITEMS } from '@/security/constants';

/**
 * What the share screen receives: shared text and/or file:// URIs of copies in <cache>/share-intent/<nonce>/.
 * `nonce` names that directory (24 hex, one per share, P3-3) so the screen can consume exactly its own
 * copies; `dropped` counts items the receiver skipped (not content://, our own authority, over
 * MAX_SHARE_ITEMS, MAX_SHARE_ITEM_BYTES or the per-share MAX_SHARE_BYTES, unreadable). Both reach the share
 * screen as route params (a directory name and a count: no content).
 */
export type PendingShare = { text?: string; uris?: string[]; nonce?: string; dropped?: number };

export type ShareIntentEvents = {
  /** A new share arrived while the app was alive. Payload is a bare counter: call getPendingShare(). */
  onShare: (payload: { token: number }) => void;
};

declare class ShareIntentNative extends NativeModule<ShareIntentEvents> {
  getPendingShare(): Promise<{ text?: unknown; uris?: unknown; nonce?: unknown; dropped?: unknown } | null>;
  clearPendingShare(): void;
  clearIntentData(): void;
}

const native = requireOptionalNativeModule<ShareIntentNative>('ShareIntent');

export const nativeAvailable = native !== null;

/** The shape of a per-share directory name: what the Kotlin module's `randomName()` produces. */
export const SHARE_NONCE_RE = /^[0-9a-f]{24}$/;

/** The directory every delivered URI must live under: the module's copies, nothing else on the device. */
export function shareCacheDir(): string {
  const base = Paths.cache.uri.replace(/\/+$/, '');
  return `${base}/share-intent/`;
}

/** `<cache>/share-intent/<nonce>/`: where one share's copies are (P3-3). Null for a malformed nonce. */
export function shareDirFor(nonce: unknown): string | null {
  return typeof nonce === 'string' && SHARE_NONCE_RE.test(nonce) ? `${shareCacheDir()}${nonce}/` : null;
}

/**
 * JS-side guard (security review P2-4), the same rules as the Kotlin side so a URI that is not one of
 * OUR copies never reaches the share screen even if the native filter regressed: `file://` URIs that are
 * direct children of `dir` only (a `file:///data/data/io.onepeek.app/databases/x.db` is dropped), with no
 * `..` segment, at most MAX_SHARE_ITEMS. `dir` is the share's own directory (`shareDirFor(nonce)`).
 * Returns the kept URIs and how many were dropped.
 */
export function filterShareUris(input: unknown, dir: string = shareCacheDir()): { uris: string[]; dropped: number } {
  if (!Array.isArray(input)) return { uris: [], dropped: 0 };
  const kept: string[] = [];
  for (const u of input) {
    if (typeof u !== 'string' || !u.startsWith(dir) || u.includes('/../') || u.endsWith('/..') || u.length === dir.length) continue;
    if (u.slice(dir.length).includes('/')) continue; // a copy is a direct child of the directory
    kept.push(u);
  }
  const uris = kept.slice(0, MAX_SHARE_ITEMS);
  return { uris, dropped: input.length - uris.length };
}

/**
 * JS-side mirror of the Kotlin per-share byte total (P3-6): keeps copies while their sizes add up to at
 * most `limit`, deletes the rest (they are our own copies, under our directory) and counts them dropped.
 * A copy whose size cannot be read is dropped too. Never throws.
 */
export function capShareBytes(uris: string[], limit: number = MAX_SHARE_BYTES): { uris: string[]; dropped: number } {
  const kept: string[] = [];
  let total = 0;
  let dropped = 0;
  for (const u of uris) {
    let size = -1;
    try { size = new File(u).size; } catch { /* unreadable: dropped below */ }
    if (size >= 0 && total + size <= limit) {
      total += size;
      kept.push(u);
    } else {
      dropped += 1;
      try { new File(u).delete(); } catch { /* the launch sweep removes it */ }
    }
  }
  return { uris: kept, dropped };
}

/**
 * Returns the pending share's items (copied into <cache>/share-intent/<nonce>/ by the native side); null
 * when nothing is pending. Each share is returned once. Without a well-formed nonce no file is accepted.
 */
export async function getPendingShare(): Promise<PendingShare | null> {
  if (!native) return null;
  try {
    const p = await native.getPendingShare();
    if (!p) return null;
    const out: PendingShare = {};
    if (typeof p.text === 'string' && p.text.length > 0) out.text = p.text;
    const dir = shareDirFor(p.nonce);
    const filtered = dir ? filterShareUris(p.uris, dir) : { uris: [], dropped: Array.isArray(p.uris) ? p.uris.length : 0 };
    const capped = capShareBytes(filtered.uris);
    if (capped.uris.length) {
      out.uris = capped.uris;
      out.nonce = p.nonce as string;
    }
    const nativeDropped = typeof p.dropped === 'number' && p.dropped > 0 ? Math.floor(p.dropped) : 0;
    const dropped = filtered.dropped + capped.dropped + nativeDropped;
    if (dropped > 0) out.dropped = dropped;
    return out.text || out.uris ? out : null;
  } catch {
    return null;
  }
}

/** Drops anything still pending and strips the launching Intent (Android). */
export function clearPendingShare(): void {
  try { native?.clearPendingShare(); } catch { /* no activity */ }
}

/**
 * Android: removes data/action/extras from the activity's Intent so a consumed link (fragment
 * included) or share cannot be read again by this module or by react-native's Linking.getInitialURL().
 */
export function clearIntentData(): void {
  try { native?.clearIntentData(); } catch { /* no activity */ }
}

/** Subscribes to "a share arrived" signals (warm start). Returns an unsubscribe function. */
export function addShareListener(cb: () => void): () => void {
  if (!native) return () => {};
  const sub = native.addListener('onShare', () => cb());
  return () => sub.remove();
}
