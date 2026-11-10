// One-time secrets (onepeek.io links) from the app: the Phase 2 contract (`isSecretLink`,
// `createSecretLink`, `peekSecretLink`, `openSecretLink`) on top of packages/core/src/secrets.ts,
// which reproduces the website byte for byte (header JSON, ciphertext, `create_secret` arguments,
// `/api/open` body, `/s/<id>#<key>` link). Screens import ONLY the names exported here.
//
// What this file adds to the core: the app's Supabase client (lib/chat getSupabase()), the phone's
// `fetch`, the literal site origin (no env override: `checkOnePeekUrl` refuses anything but
// https://onepeek.io), the device time zone, and the anonymous per-install client id for the free
// quota (SecureStore, like the web's localStorage `onepass.client`). Links are parsed on the device
// (`parseSecretLink`); the fragment key goes into the core's decrypt call and nowhere else. Nothing
// here logs: not links, keys, text or file names.
import {
  createSecret, peekSecret, openSecret, parseSecretLink, requestUnlockCode as coreRequestUnlockCode,
  verifyUnlockCode as coreVerifyUnlockCode, localTz, randomToken, SecretError,
  type FileSource, type SecretHeader, type WifiSecret, type SecretsDeps, type SecretsSupabase,
  type SecretPeek as CoreSecretPeek, type OpenedSecret as CoreOpenedSecret,
} from '@onepeek/core';
import { bodyToArrayBuffer, checkOnePeekUrl } from '@onepeek/core/src/rn';
import * as SecureStore from 'expo-secure-store';
import { getSupabase } from './chat';

export { SecretError };
export type { SecretHeader, WifiSecret };

export type SecretInput =
  | { kind: 'text'; text: string }
  | { kind: 'wifi'; wifi: WifiSecret }
  | { kind: 'file'; file: FileSource };
export type SecretOptions = {
  /** Link lifetime in seconds (same choices as the web: 5 min .. 7 days). */
  ttlSeconds: number;
  /** Views before the link burns (web: 1, 3, 5, 10). */
  views: number;
  /** Seconds the viewer gets once opened; 0 = none (web `timer`). */
  timer?: number;
  /** Blur until held with a watermark (web `guard`). */
  guard?: boolean;
  noCopy?: boolean;
  noSave?: boolean;
};
export type SecretLink = { id: string; url: string };

/**
 * What the viewer learns before opening (mirrors the web `Peek`): never the content. The contract
 * fields (`header`, `viewsLeft`, `maxViews`, `locked`, `lockHint`, `notYet`) plus the core's extras
 * (`window`, `countries`, `fence`, `openAfter`, `expiresAt`, `kind`, `shareLocation`).
 */
export type SecretPeek = CoreSecretPeek;

/**
 * The contract's three variants (`text` / `wifi` / `file`, each with `header`) plus what the viewer
 * screen shows after opening: `viewsLeft`, `final` (deleted from OnePeek) and `viewerPlace`.
 */
export type OpenedSecret = CoreOpenedSecret;

// ---------------------------------------------------------------------------- wiring

/** The one origin links are built on and the API lives at. A literal: the core refuses anything else. */
const SITE_URL = checkOnePeekUrl('siteUrl', 'https://onepeek.io');

/** SecureStore entry for the anonymous quota id (`[A-Za-z0-9_-]{16,64}`, as lib/quota on the web). */
export const CLIENT_ID_KEY = 'onepeek.client';
const CLIENT_ID = /^[A-Za-z0-9_-]{16,64}$/;
const accessibility = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
let clientIdCache: string | null = null;

/**
 * Returns this install's quota id, creating it on first use. The id is not a secret (it travels in
 * every `create_secret` call) but it is this phone's identity for the free quota, so it is kept in
 * the keychain, this device only, and survives reinstall as the OS allows (until a sign-out or a
 * reset wipes it: forgetClientId). If the keychain cannot be read (phone still locked at launch) a
 * fresh id is used for this process only.
 */
export async function getClientId(): Promise<string> {
  if (clientIdCache) return clientIdCache;
  let id: string | null = null;
  try { id = await SecureStore.getItemAsync(CLIENT_ID_KEY, accessibility); } catch { id = null; }
  if (!id || !CLIENT_ID.test(id)) {
    id = randomToken(18);
    try { await SecureStore.setItemAsync(CLIENT_ID_KEY, id, accessibility); } catch { /* process-local id */ }
  }
  clientIdCache = id;
  return id;
}

/** Test seam: forgets the cached id so the next call reads SecureStore again. */
export function resetClientIdCache(): void {
  clientIdCache = null;
}

/**
 * Removes this install's quota id from the keychain and from memory (review P2-9). Called by
 * lib/chat on sign-out and on "Reset chats on this phone": the next secret starts a fresh quota
 * identity instead of carrying one across accounts and resets. Never throws.
 */
export async function forgetClientId(): Promise<void> {
  clientIdCache = null;
  try { await SecureStore.deleteItemAsync(CLIENT_ID_KEY, accessibility); } catch { /* nothing stored, or the keychain is locked */ }
}

/**
 * The core's Supabase port over the app's client: `download()` bodies are normalised for React
 * Native (`bodyToArrayBuffer`: RN's Blob may lack `arrayBuffer()`), everything else is delegated.
 */
function secretsSupabase(): SecretsSupabase | null {
  const sb = getSupabase();
  if (!sb) return null;
  return {
    rpc: (fn, args) => sb.rpc(fn, args),
    storage: {
      from(bucket) {
        const b = sb.storage.from(bucket);
        return {
          upload: (path, body, options) => b.upload(path, body, options),
          async download(path) {
            const res = await b.download(path);
            if (res.error || !res.data) return { data: null, error: res.error ?? { message: 'empty' } };
            const raw: unknown = res.data;
            return { data: { arrayBuffer: () => bodyToArrayBuffer(raw) }, error: null };
          },
          remove: paths => b.remove(paths),
        };
      },
    },
  };
}

function deps(): SecretsDeps {
  return {
    supabase: secretsSupabase(),
    fetch: (url, init) => fetch(url, init),
    apiBase: SITE_URL,
    origin: SITE_URL,
    tz: localTz,
    clientId: getClientId,
    ref: () => null,   // referral codes come from `?ref=` on the website; the app has none
  };
}

function parse(url: string): { id: string; keyB64: string } {
  const p = parseSecretLink(url);
  if (!p) throw new SecretError('bad_link');
  return p;
}

// ---------------------------------------------------------------------------- contract

/**
 * True for `https://onepeek.io/s/<id>#<key>` (and `www.`) and the app's own `onepeek://s/<id>#<key>`,
 * with a sane id (`[A-Za-z0-9]{6,32}`) and a 32-byte base64url key: the only links the app opens as
 * secrets. Anything else (http, a port, another host or path, a malformed key) is false.
 */
export function isSecretLink(url: string): boolean {
  return parseSecretLink(url) !== null;
}

/**
 * Encrypts on this phone and creates the link the way app/page.tsx does. Throws a SecretError with
 * a stable `code` (see packages/core/src/secrets.ts createSecret): `empty`, `too_long`,
 * `file_too_large`, `quota_exceeded`, `plan_required` (`plan`), `expiry_too_long`,
 * `feature_unavailable`, `upload_failed`, `create_failed`, `not_configured`, ...
 */
export async function createSecretLink(input: SecretInput, opts: SecretOptions): Promise<SecretLink> {
  return createSecret(deps(), input, {
    ttlSeconds: opts.ttlSeconds, views: opts.views, timer: opts.timer, guard: opts.guard, noCopy: opts.noCopy, noSave: opts.noSave,
  });
}

/** Peeks without burning: the decrypted header and the lock state. Codes: `bad_link`, `bad_key`, `gone`, `not_configured`. */
export async function peekSecretLink(url: string): Promise<SecretPeek> {
  const { id, keyB64 } = parse(url);
  return peekSecret(deps(), id, keyB64);
}

/**
 * Opens (counts a view, burning on the last one) through `${site}/api/open` and decrypts here.
 * `unlock.token` is the one-use token from verifyUnlockCode() for a link locked to a recipient;
 * `unlock.email` is accepted for the contract but is not sent (the web only shows it in the
 * watermark). Codes: `bad_link`, `bad_key`, `gone`, the lock codes (`recipient_locked`,
 * `timelock_until`, `timelock_window`, `country_blocked`, `geofence_*`; nothing burned, `retryable`),
 * `open_failed`, `network`, `download_failed`, `not_configured`.
 */
export async function openSecretLink(url: string, unlock?: { email?: string; token?: string }): Promise<OpenedSecret> {
  const { id, keyB64 } = parse(url);
  return openSecret(deps(), id, keyB64, { unlockToken: unlock?.token ?? null });
}

/** Lock to a recipient, step 1: emails a 6-digit code to `email` (see the core for the codes). */
export async function requestUnlockCode(url: string, email: string): Promise<void> {
  const { id } = parse(url);
  return coreRequestUnlockCode(deps(), id, email);
}

/** Lock to a recipient, step 2: checks the code; the returned token goes to openSecretLink(url, { token }). */
export async function verifyUnlockCode(url: string, code: string): Promise<string> {
  const { id } = parse(url);
  return coreVerifyUnlockCode(deps(), id, code);
}
