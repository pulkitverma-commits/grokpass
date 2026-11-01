// Share-intent plumbing (N6): one hook, mounted once in the root layout, that turns "the OS handed
// OnePeek something to share" into exactly one `router.push('/share', { text?, uris? })` per share.
//
// Sources:
//   Android  modules/share-intent (ACTION_SEND / ACTION_SEND_MULTIPLE; cold start via getPendingShare on
//            mount, warm start via the `onShare` signal). Items are plaintext copies in <cache>/share-intent/.
//   iOS      the Share Extension writes to the App Group container and opens `onepeek://share`; the hook
//            reads the container on mount, on every AppState → active and when that URL arrives
//            (apps/mobile/security/appGroup.ts), moving the files into <cache>/share-intent/.
//
// Contract with mobile-ui (app/share.tsx): params are `{ text?: string; uris?: string[] }`, exactly.
// Text that is a OnePeek secret or invite link is passed through as `text` unchanged; the share
// screen dispatches it (parseOnePeekLink). The screen must call `useSecureScreen('share')` itself;
// this hook additionally asserts FLAG_SECURE right before routing so the first frame is covered.
//
// Plaintext lifetime: the copies exist from the share until `consumeShare()` (mobile-ui calls it when
// the share has been encrypted and sent, or cancelled) or the next launch, whichever comes first:
// `sweepShareCache()` runs on mount before anything is read, so a kill mid-share leaves nothing past
// one launch. The OS and the source app keep their own copy of the shared content; that is theirs.
// Nothing here logs anything; no param ever carries a size, a name or the text to a log.
import { Directory, Paths } from 'expo-file-system';
import { useLinkingURL } from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { addShareListener, clearPendingShare, getPendingShare, type PendingShare } from '@/modules/share-intent';
import { readAppGroupShare, SHARE_DIR } from './appGroup';
import { isShareWakeUrl } from './links';
import { secureScreenMount } from './secureScreen';

export type { PendingShare };

/** Route the share is delivered to (mobile-ui's app/share.tsx). */
export const SHARE_ROUTE = '/share';
/** FLAG_SECURE key asserted before the share screen is pushed. */
export const SHARE_SECURE_KEY = 'share';

let sweep: Promise<void> | null = null;

/** Deletes every plaintext copy under <cache>/share-intent/. Never throws. */
export function sweepShareCache(): Promise<void> {
  const run = (async () => {
    try {
      const d = new Directory(Paths.cache, SHARE_DIR);
      if (d.exists) d.delete();
    } catch { /* best effort: the next launch tries again */ }
  })();
  sweep = run;
  return run;
}

/** mobile-ui calls this when the share screen is done with the items (sent or cancelled). */
export function consumeShare(): Promise<void> {
  clearPendingShare();
  return sweepShareCache();
}

/** Reads whatever the platform holds, once. Android: the native module. iOS: the App Group container. */
export async function readPendingShare(os: string = Platform.OS): Promise<PendingShare | null> {
  if (sweep) await sweep.catch(() => {});
  if (os === 'android') return getPendingShare();
  if (os === 'ios') return readAppGroupShare();
  return null;
}

/** Params exactly as the share screen expects them; null when there is nothing to deliver. */
export function shareParams(p: PendingShare | null): { text?: string; uris?: string[] } | null {
  if (!p) return null;
  const out: { text?: string; uris?: string[] } = {};
  if (typeof p.text === 'string' && p.text.trim().length > 0) out.text = p.text;
  if (Array.isArray(p.uris) && p.uris.length > 0) out.uris = p.uris;
  return out.text || out.uris ? out : null;
}

/**
 * Mount once, inside the router (root layout). Routes each incoming share to `/share` exactly once
 * and sweeps the share cache on launch. "Once" comes from the sources: the Android module hands a
 * share out a single time and the App Group reader wipes what it read, so a cold-start read followed
 * by the first `active` or the wake-up URL finds nothing the second time. A genuine second share of
 * the same content is delivered again (no content-based dedupe on purpose).
 */
export function useShareIntent(): void {
  const router = useRouter();
  const url = useLinkingURL();
  const busy = useRef(false);

  const deliver = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const params = shareParams(await readPendingShare());
      if (!params) return;
      secureScreenMount(SHARE_SECURE_KEY);
      router.push({ pathname: SHARE_ROUTE, params });
    } finally {
      busy.current = false;
    }
  };

  // Launch: sweep leftovers first, then look for a share that launched the app.
  useEffect(() => {
    let alive = true;
    sweepShareCache().then(() => { if (alive) void deliver(); });
    const offShare = addShareListener(() => { if (alive) void deliver(); });
    const sub = AppState.addEventListener('change', (s) => {
      if (alive && s === 'active' && Platform.OS === 'ios') void deliver();
    });
    return () => { alive = false; offShare(); sub.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // iOS wake-up from the extension (cold start: initial URL; warm start: onURLReceived).
  useEffect(() => {
    if (isShareWakeUrl(url)) void deliver();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
}
