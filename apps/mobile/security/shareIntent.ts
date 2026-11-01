// Share-intent plumbing (N6): one hook, mounted once in the root layout, that turns "the OS handed
// OnePeek something to share" into exactly one `router.push('/share', { text?, uris?, nonce?, dropped? })`
// per share.
//
// Sources:
//   Android  modules/share-intent (ACTION_SEND / ACTION_SEND_MULTIPLE; cold start via getPendingShare on
//            mount, warm start via the `onShare` signal). Items are plaintext copies in <cache>/share-intent/<nonce>/.
//   iOS      expo-share-intent (config plugin: Share Extension target + App Group; hook: `useShareIntent`).
//            Its extension copies the items into the App Group container and wakes the app with
//            `onepeek://dataUrl=onepeekShareKey?nonce=…#<type>`; its hook reads them (cold start: initial URL,
//            warm start: URL event / AppState active). `security/iosShare.ts` moves the files into
//            <cache>/share-intent/<nonce>/ and deletes this share's leftovers in the container by name; then
//            `resetShareIntent()` clears the package. The package's hook is called here, once, with `disabled`
//            on every other platform, so its Android native module (still compiled: autolinking) is never
//            asked for anything: Android has one path.
//
// Contract with mobile-ui (app/share.tsx): params are `{ text?: string; uris?: string[]; nonce?: string;
// dropped?: string }`, exactly: `nonce` names the share's own directory (24 hex) and goes back into
// `consumeShare(nonce)`; `dropped` is the count of items the receivers skipped (P3-6), shown as a notice.
// Text that is a OnePeek secret or invite link, bare or inside a sentence (P3-5), never travels as a param:
// the link is parked in lib/links' hand-off and the destination is routed by id. The screen must call
// `useSecureScreen('share')` itself; this hook additionally asserts FLAG_SECURE right before routing so
// the first frame is covered.
//
// Plaintext lifetime: the copies exist from the share until `consumeShare(nonce)` (mobile-ui calls it when
// the share has been encrypted and sent, or cancelled, or the screen leaves any other way) or until a
// launch finds their directory older than SHARE_SWEEP_AGE_MS, whichever comes first: `sweepShareCache()`
// runs on mount before anything is read, so a kill mid-share leaves nothing past one launch plus ten
// minutes. It leaves younger directories alone because the bridge remounts after every unlock (the Stack
// unmounts while locked) and a share may be on screen or in flight then (P3-3). On iOS the App Group
// container root is swept too, on mount unless this launch IS the package's wake-up (its files are read
// and moved a moment later); that sweep skips files written in the last ten seconds (another share
// arriving) and does nothing while an import is in flight. Consume removes only the container names its
// own share listed (`releaseImport`). The OS and the source app keep
// their own copy of the shared content; that is theirs.
// Nothing here logs anything; no param ever carries a size, a name or the text to a log.
import { Directory, File, Paths } from 'expo-file-system';
import { useLinkingURL } from 'expo-linking';
import { useRouter } from 'expo-router';
import {
  getShareExtensionKey,
  ShareIntentModule,
  useShareIntent as usePackageShareIntent,
  type ShareIntent,
} from 'expo-share-intent';
import { useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { addShareListener, clearPendingShare, getPendingShare, SHARE_NONCE_RE, type PendingShare } from '@/modules/share-intent';
import { importShareIntent, releaseImport, SHARE_DIR, sweepGroupContainer } from './iosShare';
import { isShareWakeUrl } from './links';
import { classify, stashHandoff } from '@/lib/links';
import { secureScreenMount } from './secureScreen';

export type { PendingShare };

/** Route the share is delivered to (mobile-ui's app/share.tsx). */
export const SHARE_ROUTE = '/share';
/** FLAG_SECURE key asserted before the share screen is pushed. */
export const SHARE_SECURE_KEY = 'share';
/** A per-share directory older than this at launch (or bridge remount) belongs to no live share and is deleted. */
export const SHARE_SWEEP_AGE_MS = 10 * 60_000;

/** What the share screen receives (see the contract above). */
export type ShareParams = { text?: string; uris?: string[]; nonce?: string; dropped?: string };

/**
 * Options for expo-share-intent's hook: iOS only (Android is modules/share-intent); no reset when the app
 * goes to the background (the import below may still be moving files; the key is cleared after it); no
 * debug logging ever (it would print the shared text and file paths).
 */
export function packageHookOptions(os: string = Platform.OS) {
  return { disabled: os !== 'ios', resetOnBackground: false, debug: false } as const;
}

let sweep: Promise<void> | null = null;

/** The newest modification time known for a per-share directory (its own, or its files'), or null. */
function newestChange(dir: Directory): number | null {
  let newest: number | null = null;
  const note = (t: unknown) => {
    if (typeof t === 'number' && Number.isFinite(t) && (newest === null || t > newest)) newest = t;
  };
  try { note(dir.info().modificationTime); } catch { /* unknown */ }
  try {
    for (const entry of dir.list()) if (entry instanceof File) note(entry.modificationTime);
  } catch { /* unknown */ }
  return newest;
}

/**
 * Deletes the plaintext copies under <cache>/share-intent/ that no live share can still own: per-share
 * directories (and stray files from an older layout) whose newest change is older than `maxAgeMs`, or
 * whose age cannot be read. Younger ones are a share in flight (P3-3). Never throws.
 */
export function sweepShareCache(maxAgeMs: number = SHARE_SWEEP_AGE_MS, now: number = Date.now()): Promise<void> {
  const run = (async () => {
    try {
      const root = new Directory(Paths.cache, SHARE_DIR);
      if (!root.exists) return;
      for (const entry of root.list()) {
        try {
          const at = entry instanceof Directory ? newestChange(entry) : (entry as File).modificationTime;
          if (typeof at === 'number' && now - at < maxAgeMs) continue;
          entry.delete();
        } catch { /* best effort */ }
      }
    } catch {
      /* best effort: the next launch tries again */
    }
  })();
  sweep = run;
  return run;
}

/** Deletes one share's directory, <cache>/share-intent/<nonce>/. A malformed nonce deletes nothing. Never throws. */
export function deleteShareDir(nonce: string | null | undefined): void {
  if (typeof nonce !== 'string' || !SHARE_NONCE_RE.test(nonce)) return;
  try {
    const d = new Directory(Paths.cache, SHARE_DIR, nonce);
    if (d.exists) d.delete();
  } catch {
    /* best effort: the launch sweep removes it after SHARE_SWEEP_AGE_MS */
  }
}

/**
 * iOS: clears expo-share-intent's copy of the share (the JSON in the App Group's UserDefaults; the same
 * thing its `resetShareIntent()` does natively) so it does not outlive the files. Never throws.
 */
export function resetPackageShare(): void {
  try {
    ShareIntentModule?.clearShareIntent(getShareExtensionKey());
  } catch {
    /* no native module (jest, web) */
  }
}

/**
 * mobile-ui calls this when the share screen is done with the items (sent, cancelled, or left any other
 * way). `nonce` is the share's own directory, from the route params: only that directory is deleted, so a
 * second share on screen keeps its copies (P3-3). A text-only share has no directory and passes nothing.
 */
export function consumeShare(nonce?: string | null): Promise<void> {
  clearPendingShare();
  if (Platform.OS === 'ios') {
    resetPackageShare();
    releaseImport(nonce);   // this share's container names only; never a blanket sweep here (P3-3)
  }
  deleteShareDir(nonce);
  return Promise.resolve();
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
export function shareParams(p: PendingShare | null): ShareParams | null {
  if (!p) return null;
  const out: ShareParams = {};
  if (typeof p.text === 'string' && p.text.trim().length > 0) out.text = p.text;
  if (Array.isArray(p.uris) && p.uris.length > 0) {
    out.uris = p.uris;
    if (typeof p.nonce === 'string' && SHARE_NONCE_RE.test(p.nonce)) out.nonce = p.nonce;
  }
  if (!out.text && !out.uris) return null;
  if (typeof p.dropped === 'number' && p.dropped > 0) out.dropped = String(Math.floor(p.dropped));
  return out;
}

/**
 * Mount once, inside the router (root layout). Routes each incoming share to `/share` exactly once
 * and sweeps stale share directories on launch. "Once" comes from the sources: the Android module hands a
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
    // A shared OnePeek link never travels as a route param (review P2-5), whether the text is the bare
    // link or a sentence around it (P3-5: the same substring classifier the share screen uses): the full
    // link is parked in the one-shot hand-off and the destination screen reads it from there.
    if (params.text && !params.uris) {
      const link = classify(params.text);
      if (link.kind === 'secret') {
        stashHandoff('secret', link.url);
        clearPendingShare(); // the Intent must not keep the link (P3-7)
        secureScreenMount(SHARE_SECURE_KEY);
        router.push({ pathname: '/s/[id]', params: { id: link.id } });
        return;
      }
      if (link.kind === 'invite') {
        stashHandoff('invite', link.url);
        clearPendingShare();
        router.push('/chat/join');
        return;
      }
    }
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

  // Launch (and every remount after an unlock): sweep stale leftovers first, then look for a share that
  // launched the app (Android). On iOS the container is swept now unless the package is about to read it
  // (this launch is its wake-up URL).
  useEffect(() => {
    let alive = true;
    if (Platform.OS === 'ios' && !isShareWakeUrl(url)) sweepGroupContainer();
    sweepShareCache().then(() => {
      if (alive && Platform.OS === 'android') void deliverAndroid();
    });
    const offShare = addShareListener(() => {
      if (alive) void deliverAndroid();
    });
    return () => {
      alive = false;
      offShare();
    };
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
