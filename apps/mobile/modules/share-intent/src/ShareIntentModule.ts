// JS binding for the local native module (modules/share-intent/{android,ios}). Loaded with
// `requireOptionalNativeModule` so Expo Go, jest and the web bundle get a stub that reports "nothing
// pending" instead of crashing. On iOS the native side is a stub too: shared items arrive through the
// App Group container (apps/mobile/security/appGroup.ts), not through this module.
import { NativeModule, requireOptionalNativeModule } from 'expo';

/** What the share screen receives: shared text and/or file:// URIs of copies in <cache>/share-intent/. */
export type PendingShare = { text?: string; uris?: string[] };

export type ShareIntentEvents = {
  /** A new share arrived while the app was alive. Payload is a bare counter: call getPendingShare(). */
  onShare: (payload: { token: number }) => void;
};

declare class ShareIntentNative extends NativeModule<ShareIntentEvents> {
  getPendingShare(): Promise<PendingShare | null>;
  clearPendingShare(): void;
  clearIntentData(): void;
}

const native = requireOptionalNativeModule<ShareIntentNative>('ShareIntent');

export const nativeAvailable = native !== null;

/** Copies the pending share's items into the cache and returns them; null when nothing is pending. Each share is returned once. */
export async function getPendingShare(): Promise<PendingShare | null> {
  if (!native) return null;
  try {
    const p = await native.getPendingShare();
    if (!p) return null;
    const out: PendingShare = {};
    if (typeof p.text === 'string' && p.text.length > 0) out.text = p.text;
    if (Array.isArray(p.uris)) {
      const uris = p.uris.filter((u): u is string => typeof u === 'string' && u.startsWith('file://'));
      if (uris.length) out.uris = uris;
    }
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
