// Share-intent plumbing (N6): one hook, mounted once in the root layout, that turns "the OS handed
// OnePeek something to share" into exactly one `router.push('/share', { text?, uris? })` per share.
//
// Sources:
//   Android  modules/share-intent (ACTION_SEND / ACTION_SEND_MULTIPLE; cold start via getPendingShare on
//            mount, warm start via the `onShare` signal). Items are plaintext copies in <cache>/share-intent/.
//   iOS      expo-share-intent (config plugin: Share Extension target + App Group; hook: `useShareIntent`).
//            Its extension copies the items into the App Group container and wakes the app with
//            `onepeek://dataUrl=onepeekShareKey?nonce=…#<type>`; its hook reads them (cold start: initial URL,
//            warm start: URL event / AppState active). `security/iosShare.ts` moves the files into
//            <cache>/share-intent/ and sweeps the container; then `resetShareIntent()` clears the package.
//            The package's hook is called here, once, with `disabled` on every other platform, so its Android
//            native module (still compiled: autolinking) is never asked for anything: Android has one path.
//
// Contract with mobile-ui (app/share.tsx): params are `{ text?: string; uris?: string[] }`, exactly.
// Text that is a OnePeek secret or invite link is passed through as `text` unchanged; the share
// screen dispatches it (parseOnePeekLink). The screen must call `useSecureScreen('share')` itself;
// this hook additionally asserts FLAG_SECURE right before routing so the first frame is covered.
//
// Plaintext lifetime: the copies exist from the share until `consumeShare()` (mobile-ui calls it when
// the share has been encrypted and sent, or cancelled) or the next launch, whichever comes first:
// `sweepShareCache()` runs on mount before anything is read, so a kill mid-share leaves nothing past
// one launch. On iOS the App Group container root is swept too, on mount unless this launch IS the
// package's wake-up (its files are read and moved a moment later), at every import and at consume. The OS
// and the source app keep their own copy of the shared content; that is theirs.
// Nothing here logs anything; no param ever carries a size, a name or the text to a log.
import { Directory, Paths } from 'expo-file-system';
import { useLinkingURL } from 'expo-linking';
import { useRouter } from 'expo-router';
import { getShareExtensionKey, ShareIntentModule, useShareIntent as usePackageShareIntent, type ShareIntent } from 'expo-share-intent';
import { useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { addShareListener, clearPendingShare, getPendingShare, type PendingShare } from '@/modules/share-intent';
import { importShareIntent, SHARE_DIR, sweepGroupContainer } from './iosShare';
import { isShareWakeUrl } from './links';
import { secureScreenMount } from './secureScreen';

export type { PendingShare };

/** Route the share is delivered to (mobile-ui's app/share.tsx). */
export const SHARE_ROUTE = '/share';
/** FLAG_SECURE key asserted before the share screen is pushed. */
export const SHARE_SECURE_KEY = 'share';

/**
 * Options for expo-share-intent's hook: iOS only (Android is modules/share-intent); no reset when the app
 * goes to the background (the import below may still be moving files; the key is cleared after it); no
 * debug logging ever (it would print the shared text and file paths).
 */
export function packageHookOptions(os: string = Platform.OS) {
  return { disabled: os !== 'ios', resetOnBackground: false, debug: false } as const;
}

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

/**
 * iOS: clears expo-share-intent's copy of the share (the JSON in the App Group's UserDefaults; the same
 * thing its `resetShareIntent()` does natively) so it does not outlive the files. Never throws.
 */
export function resetPackageShare(): void {
  try { ShareIntentModule?.clearShareIntent(getShareExtensionKey()); } catch { /* no native module (jest, web) */ }
}

/** mobile-ui calls this when the share screen is done with the items (sent or cancelled). */
export function consumeShare(): Promise<void> {
  clearPendingShare();
  if (Platform.OS === 'ios') {
    resetPackageShare();
    sweepGroupContainer();
  }
  return sweepShareCache();
}

/**
 * Reads whatever the Android module holds, once. On iOS shares do not sit anywhere the app can poll:
 * they arrive through expo-share-intent's hook (see `useShareIntent`), so this resolves null there.
 */
export async function readPendingShare(os: string = Platform.OS): Promise<PendingShare | null> {
  if (sweep) await sweep.catch(() => {});
  if (os === 'android') return getPendingShare();
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
 * share out a single time; on iOS the package's intent is imported (files moved out of the container)
 * and reset, so the same state object is never delivered twice and a re-read after the reset finds
 * nothing. A genuine second share of the same content is a new intent and is delivered again (no
 * content-based dedupe on purpose). No provider is needed around this: the package's hook is called here.
 */
export function useShareIntent(): void {
  const router = useRouter();
  const url = useLinkingURL();
  const pkgOptions = useMemo(() => packageHookOptions(), []);
  const pkg = usePackageShareIntent(pkgOptions);
  const busy = useRef(false);
  const delivered = useRef<ShareIntent | null>(null);

  const route = (p: PendingShare | null) => {
    const params = shareParams(p);
    if (!params) return;
    secureScreenMount(SHARE_SECURE_KEY);
    router.push({ pathname: SHARE_ROUTE, params });
  };

  const deliverAndroid = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      route(await readPendingShare());
    } finally {
      busy.current = false;
    }
  };

  // Launch: sweep leftovers first, then look for a share that launched the app (Android). On iOS the
  // container is swept now unless the package is about to read it (this launch is its wake-up URL).
  useEffect(() => {
    let alive = true;
    if (Platform.OS === 'ios' && !isShareWakeUrl(url)) sweepGroupContainer();
    sweepShareCache().then(() => { if (alive && Platform.OS === 'android') void deliverAndroid(); });
    const offShare = addShareListener(() => { if (alive) void deliverAndroid(); });
    return () => { alive = false; offShare(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // iOS: the package's state changed. Import (move files), reset the package, route.
  const intent = pkg.hasShareIntent ? pkg.shareIntent : null;
  useEffect(() => {
    if (!intent || delivered.current === intent) return;
    delivered.current = intent;
    void (async () => {
      if (sweep) await sweep.catch(() => {});
      const p = await importShareIntent(intent);
      pkg.resetShareIntent();
      route(p);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);
}
