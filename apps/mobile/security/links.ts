// OnePeek link parser (N6). One strict function decides what a URL from a Universal Link / App Link,
// a deep link, a pasted string, a share intent or a scanned QR code means, so no screen re-implements
// host checks. Written by hand (Hermes' URL / URLSearchParams are incomplete, see lib/chat.ts
// parseAuthCallback) and strict on purpose: anything that is not exactly one of the shapes below is
// null, including look-alike hosts (`onepeek.io.evil`, `evilonepeek.io`, `onepeek.io@evil`), plain
// http, a port, user info, a missing or malformed fragment and an oversize key.
//
// Shapes (the web app is the spec):
//   secret   https://onepeek.io/s/<id>#<key>       id: 10 chars of the create_secret alphabet
//            https://www.onepeek.io/s/<id>#<key>    (supabase/migrations/003: A-Z a-z 2-9 without I O l 0 1)
//            onepeek://s/<id>#<key>                 key: 32 bytes base64url, no padding = exactly 43 chars
//                                                   (packages/core/src/crypto.ts toB64Url / importKey)
//   invite   https://onepeek.io/chat/join#<token>[.<pin>]   token: base64url, 32..128 chars (randomToken(32) gives 43);
//            onepeek://chat/join#<token>[.<pin>]            pin (F2-7, packages/core/src/chat/invite.ts): `1` + 64 base64url
//                                                           chars (owner device id + SHA-256 of its signing key).
//                                                           Old links carry the token alone; any other `.` suffix is null.
//   verify   onepeek-verify:<60 digits>             the safety-number QR (components/room/RoomMenu.tsx; mls.ts safetyNumber)
//   auth     onepeek://auth[?...][#...]             the OAuth / email-link callback; parameters are NOT parsed here
//                                                   (lib/chat.ts parseAuthCallback does that)
//
// Where the fragment lives and where it does not (audit, SDK 58; file:line in security/README.md):
//   - It never reaches a server: fragments are not sent in HTTP requests, and the app opens nothing from it.
//   - expo-router drops it: `fromDeepLink()` builds host + pathname + ?query and ignores `URL.hash`
//     (node_modules/expo-router/build/fork/extractPathFromURL.js), so router state, `useLocalSearchParams`,
//     `usePathname` and any navigation-state persistence never contain it.
//   - It is in the full URL expo-linking hands out (`useLinkingURL`, `getLinkingURL`, `Linking.getInitialURL`),
//     which is the only place screens may read it from, through this parser.
import * as Linking from 'expo-linking';
import { clearIntentData } from '@/modules/share-intent';

export type OnePeekLink =
  | { kind: 'secret'; id: string; key: string }
  | { kind: 'invite'; token: string; pin?: string }
  | { kind: 'verify'; digits: string }
  | { kind: 'auth' };

const SECRET_ID = /^[A-HJ-NP-Za-km-z2-9]{10}$/;
const SECRET_KEY = /^[A-Za-z0-9_-]{43}$/;
const INVITE_FRAGMENT = /^([A-Za-z0-9_-]{32,128})(?:\.(1[A-Za-z0-9_-]{64}))?$/;
const VERIFY_DIGITS = /^[0-9]{60}$/;
const WEB_HOSTS = new Set(['onepeek.io', 'www.onepeek.io']);
const MAX_URL = 2048;

/** Splits `rest` (everything after `scheme://`) into authority, path, query and fragment without decoding. */
function split(rest: string): { authority: string; path: string; query: string; fragment: string | null } {
  const hash = rest.indexOf('#');
  const fragment = hash === -1 ? null : rest.slice(hash + 1);
  const beforeHash = hash === -1 ? rest : rest.slice(0, hash);
  const q = beforeHash.indexOf('?');
  const query = q === -1 ? '' : beforeHash.slice(q + 1);
  const hp = q === -1 ? beforeHash : beforeHash.slice(0, q);
  const slash = hp.indexOf('/');
  const authority = slash === -1 ? hp : hp.slice(0, slash);
  const path = slash === -1 ? '' : hp.slice(slash);
  return { authority, path, query, fragment };
}

function fromPath(path: string, fragment: string | null): OnePeekLink | null {
  const p = path.replace(/\/+$/, '');
  const secret = /^\/s\/([^/]+)$/.exec(p);
  if (secret) {
    const id = secret[1]!;
    if (!SECRET_ID.test(id) || fragment === null || !SECRET_KEY.test(fragment)) return null;
    return { kind: 'secret', id, key: fragment };
  }
  if (p === '/chat/join') {
    const m = fragment === null ? null : INVITE_FRAGMENT.exec(fragment);
    if (!m) return null;
    return m[2] ? { kind: 'invite', token: m[1]!, pin: m[2] } : { kind: 'invite', token: m[1]! };
  }
  return null;
}

/**
 * Classifies a URL or scanned string. Returns null for anything that is not exactly a OnePeek secret
 * link, invite link, safety-number QR or auth callback. Never throws; never logs.
 */
export function parseOnePeekLink(input: string | null | undefined): OnePeekLink | null {
  if (typeof input !== 'string') return null;
  const url = input.trim();
  if (!url || url.length > MAX_URL || /[\s\u0000-\u001f]/.test(url)) return null;

  const verify = /^onepeek-verify:([0-9]+)$/i.exec(url);
  if (verify) return VERIFY_DIGITS.test(verify[1]!) ? { kind: 'verify', digits: verify[1]! } : null;

  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url);
  if (!scheme) return null;
  const rest = url.slice(scheme[0].length);
  const { authority, path, fragment } = split(rest);
  // No user info, no port, no empty authority. Hosts are compared case-insensitively.
  if (!authority || /[@:[\]]/.test(authority)) return null;
  const host = authority.toLowerCase();

  switch (scheme[1]!.toLowerCase()) {
    case 'https':
      if (!WEB_HOSTS.has(host)) return null;
      return fromPath(path, fragment);
    case 'onepeek': {
      // onepeek://auth, onepeek://auth/, onepeek://auth?x=y, onepeek://auth#x=y (and nothing else on that host)
      if (host === 'auth') return path === '' || path === '/' ? { kind: 'auth' } : null;
      // onepeek://s/<id>#<key>, onepeek://chat/join#<token>: the first segment is the URL "host".
      return fromPath(`/${host}${path}`, fragment);
    }
    default:
      return null;
  }
}

/** True for https://onepeek.io/s/<id>#<key> (and www / onepeek://). */
export function isSecretLink(url: string | null | undefined): boolean {
  return parseOnePeekLink(url)?.kind === 'secret';
}

/** True for an invite link. */
export function isInviteLink(url: string | null | undefined): boolean {
  return parseOnePeekLink(url)?.kind === 'invite';
}

/**
 * The URL expo-share-intent's Share Extension wakes the app with (iOS): `onepeek://dataUrl=<key>?nonce=…#<type>`
 * (`<key>` is `onepeekShareKey`, the UserDefaults key in the App Group). No content is on it. `parseOnePeekLink`
 * returns null for it (host `dataUrl=…` is not a known path); expo-router needs `app/+native-intent.tsx` to
 * redirect it (README N6b).
 */
export function isShareWakeUrl(url: string | null | undefined): boolean {
  if (typeof url !== 'string') return false;
  return /^onepeek:\/\/dataUrl=[A-Za-z0-9_-]+(?:[?#].*)?$/i.test(url.trim());
}

/**
 * Forgets the URL that launched or resumed the app once its fragment has been consumed (a secret key
 * imported, an invite redeemed): expo-linking's cached initial URL (`clearInitialURL`, both platforms;
 * `useLinkingURL` keeps the value it already handed out in component state, which goes with the screen)
 * and, on Android, the activity Intent's data (react-native's `Linking.getInitialURL()` reads it).
 * Call it from the viewer after `importKey`, not before: `useLinkingURL()` on a remount would otherwise
 * see null.
 */
export function forgetLinkingURL(): void {
  try { Linking.clearInitialURL(); } catch { /* web / Expo Go */ }
  clearIntentData();
}
