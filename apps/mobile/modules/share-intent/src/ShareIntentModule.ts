// JS binding for the local native module (modules/share-intent/{android,ios}). Loaded with
// `requireOptionalNativeModule` so Expo Go, jest and the web bundle get a stub that reports "nothing
// pending" instead of crashing. On iOS the native side is a stub too: shared items arrive through
// expo-share-intent's hook (apps/mobile/security/shareIntent.ts + iosShare.ts), not through this module.
import { NativeModule, requireOptionalNativeModule } from 'expo';
import { Paths } from 'expo-file-system';
import { MAX_SHARE_ITEMS } from '@/security/constants';

/**
 * What the share screen receives: shared text and/or file:// URIs of copies in <cache>/share-intent/.
 * `dropped` counts items the receiver skipped (not content://, our own authority, over MAX_SHARE_ITEMS or
 * MAX_SHARE_ITEM_BYTES, unreadable); it never reaches a route param (shareParams copies text and uris only).
 */
export type PendingShare = { text?: string; uris?: string[]; dropped?: number };

export type ShareIntentEvents = {
  /** A new share arrived while the app was alive. Payload is a bare counter: call getPendingShare(). */
  onShare: (payload: { token: number }) => void;
};

declare class ShareIntentNative extends NativeModule<ShareIntentEvents> {
  getPendingShare(): Promise<{ text?: unknown; uris?: unknown; dropped?: unknown } | null>;
  clearPendingShare(): void;
  clearIntentData(): void;
}

const native = requireOptionalNativeModule<ShareIntentNative>('ShareIntent');

export const nativeAvailable = native !== null;

/** The directory every delivered URI must live in: the module's copies, nothing else on the device. */
export function shareCacheDir(): string {
  const base = Paths.cache.uri.replace(/\/+$/, '');
  return `${base}/share-intent/`;
}

/**
 * JS-side guard (security review P2-4), the same rules as the Kotlin side so a URI that is not one of
 * OUR copies never reaches the share screen even if the native filter regressed: `file://` URIs under
 * <cache>/share-intent/ only (a `file:///data/data/io.onepeek.app/databases/x.db` is dropped), with no
 * `..` segment, at most MAX_SHARE_ITEMS. Returns the kept URIs and how many were dropped.
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

/** Copies the pending share's items into the cache and returns them; null when nothing is pending. Each share is returned once. */
export async function getPendingShare(): Promise<PendingShare | null> {
  if (!native) return null;
  try {
    const p = await native.getPendingShare();
    if (!p) return null;
    const out: PendingShare = {};
    if (typeof p.text === 'string' && p.text.length > 0) out.text = p.text;
    const { uris, dropped } = filterShareUris(p.uris);
    if (uris.length) out.uris = uris;
    const nativeDropped = typeof p.dropped === 'number' && p.dropped > 0 ? Math.floor(p.dropped) : 0;
    if (dropped + nativeDropped > 0) out.dropped = dropped + nativeDropped;
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
