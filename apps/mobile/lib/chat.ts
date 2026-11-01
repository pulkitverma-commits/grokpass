// App glue between the screens / security module and packages/core: one ChatClient (Supabase + the
// React Native keystore + the RN platform), the panic-lock store, the auth flows and the recovery
// reset. Every other module imports ONLY the names below (the Phase 1 contract); their signatures do
// not change.
//
// Contract:
// - getChat(): the single ChatClient for this app (Supabase + RN keystore + RN platform).
// - getSupabase(): the same Supabase client, for lib/secrets (create_secret / peek_secret and the
//   `secrets` bucket); null when the app is not configured.
// - getLockStore(): the panic-lock flag store (SecureStore, this device only).
// - auth: session helpers. Sign-in with Apple (identity token + nonce), Google through the system
//   browser (startOAuth returns the URL, completeFromUrl finishes with the onepeek://auth callback),
//   email link (also completed by completeFromUrl; the link is bound to the address requested on this
//   phone, review W1-1, kept in SecureStore so the link still completes after the app was killed in
//   between), guest (anonymous), sign out. setForeground(active) starts / stops the
//   session auto-refresh with the AppState (the Expo-documented pattern: on React Native supabase-js
//   has no `window` focus events, so the root layout drives it). onSignedIn(cb) is the VERIFIED
//   sign-in signal (review P2-1): it fires once per sign-in this module completed itself (Apple,
//   Google / email through completeFromUrl after the address check, guest) and never from Supabase's
//   SIGNED_IN event, which also fires for the attacker's session an email link can carry during the
//   W1-1 window. Anything that acts on "a user just signed in" (push re-registration) listens here;
//   onChange is for rendering state only.
// - push: this phone's push token. register() calls the core RPC and keeps the token sealed in the auth
//   store; unregister() forgets it server-side first. signOut() and resetThisPhone() unregister before
//   the session goes, so a token never outlives the account that registered it (review W1-2).
// - resetThisPhone(): wipes the local keystore, lock and session. Used by the recovery screen shown
//   when the core reports `keystore_unavailable` (wrapping key gone while sealed rows exist).
//
// What never leaves this phone unencrypted: chat keys and messages (sealed rows in onepeek-chat.db),
// the Supabase session with its refresh token (sealed rows in onepeek-auth.db; the wrapping keys sit
// in SecureStore WHEN_UNLOCKED_THIS_DEVICE_ONLY, as does the pending email address). Nothing here
// logs: not URLs, codes or tokens.
import { createChatClient, type ChatClient, type KeyStore } from '@onepeek/core';
import {
  assertRuntimeSupport, createRnAuthStorage, createRnKeyStore, createRnLockStore, createRnPlatform,
  type RnAuthStorage, type RnLockStore,
} from '@onepeek/core/src/rn';
import { createClient, type EmailOtpType, type Session, type SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { clearPickerCaches } from './files';
import { clearHandoffs } from './links';
import { forgetClientId } from './secrets';

export type AuthSession = { userId: string; email: string | null; isAnonymous: boolean };

/** Deep link the auth flows return to. Must be allow-listed in Supabase Auth → Redirect URLs. */
export const AUTH_REDIRECT_URL = 'onepeek://auth';

// ---------------------------------------------------------------------------- configuration

type Extra = { supabaseUrl?: string; supabaseAnonKey?: string; siteUrl?: string };

/**
 * The only shape a Supabase URL may take: the project host, https, no path, port or trailing slash
 * (the same pattern the fetch-literal lint enforces). The sealed session's refresh token and every RPC
 * go to this host, so a build whose env points anywhere else gets no client at all (`not_configured`)
 * rather than a client that talks to that host (review W1-6).
 */
const SUPABASE_URL = /^https:\/\/[a-z0-9-]+\.supabase\.co$/;

function extra(): Required<Extra> {
  const e = (Constants.expoConfig?.extra ?? {}) as Extra;
  const url = (e.supabaseUrl ?? '').trim();
  return {
    supabaseUrl: SUPABASE_URL.test(url) ? url : '',
    supabaseAnonKey: (e.supabaseAnonKey ?? '').trim(),
    // app.config.ts pins this to https://onepeek.io (review S0b M2); createRnEnv validates it again.
    siteUrl: (e.siteUrl ?? 'https://onepeek.io').trim(),
  };
}

/**
 * The label registered with a new chat device: model and OS only ("iPhone 15 · iOS 18.1"), never
 * `Device.deviceName` (the name the user typed into Settings, often their own name).
 */
function deviceLabel(): string {
  const os = [Device.osName ?? Platform.OS, Device.osVersion ?? ''].join(' ').trim();
  return [Device.modelName, os].filter(Boolean).join(' · ') || Platform.OS;
}

// ---------------------------------------------------------------------------- singletons

type Built = {
  supabase: SupabaseClient | null;
  keystore: KeyStore;
  authStorage: RnAuthStorage;
  chat: ChatClient;
};

let built: Built | null = null;
let lockStore: RnLockStore | null = null;

function build(): Built {
  // installRnCrypto() ran in app/_layout.tsx before anything else; if it left a primitive missing
  // this fails here, at the first use, with the list of what is absent, rather than mid-chat.
  assertRuntimeSupport();
  const cfg = extra();
  const keystore = createRnKeyStore({ secureStore: SecureStore, sqlite: SQLite });
  const authStorage = createRnAuthStorage({ secureStore: SecureStore, sqlite: SQLite });
  // No URL or key: the core's `supabase: null` makes every network call fail with `not_configured`
  // instead of the app crashing at launch.
  const supabase = cfg.supabaseUrl && cfg.supabaseAnonKey
    ? createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: {
          storage: authStorage,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,   // callbacks come in through completeFromUrl(), never from a page URL
          flowType: 'pkce',
        },
      })
    : null;
  const platform = createRnPlatform<Session>({
    supabase, keystore, lockStore: getLockStore(), siteUrl: cfg.siteUrl, deviceLabel: deviceLabel(),
  });
  return { supabase, keystore, authStorage, chat: createChatClient(platform) };
}

function get(): Built {
  built ??= build();
  return built;
}

export function getChat(): ChatClient {
  return get().chat;
}

/** The app's Supabase client for modules outside chat (lib/secrets). Null when not configured. */
export function getSupabase(): SupabaseClient | null {
  return get().supabase;
}

export function getLockStore(): RnLockStore {
  lockStore ??= createRnLockStore(SecureStore);
  return lockStore;
}

// ---------------------------------------------------------------------------- auth

function sb(): SupabaseClient {
  const s = get().supabase;
  if (!s) throw new Error('not_configured');
  return s;
}

function toAuthSession(s: Session | null): AuthSession | null {
  return s ? { userId: s.user.id, email: s.user.email ?? null, isAnonymous: !!s.user.is_anonymous } : null;
}

// An email link's `token_hash` is a bearer: GoTrue derives it from the address and the OTP, so whoever
// holds a magic link for any account can build a callback that signs this phone into that account
// (login CSRF, review W1-1). The PKCE `code` is bound to the verifier in sealed storage; the hash is
// not, so the app binds it itself: the address sendEmailLink() asked for on this phone, for the OTP
// lifetime, and the resulting session must belong to that address. The address and its timestamp are
// kept in SecureStore (WHEN_UNLOCKED_THIS_DEVICE_ONLY: never in a backup, never on another device) so
// the link still completes when the user taps it after the app was killed in between (W1-1 residual);
// module memory is only a cache of that row. One link per request: the row goes after the first
// token_hash it is checked against, matching or not, on expiry, on sign-out and on reset.
const EMAIL_LINK_TTL_MS = 60 * 60 * 1000;   // GoTrue's default OTP lifetime
const EMAIL_LINK_TYPES: ReadonlySet<string> = new Set<EmailOtpType>(['magiclink', 'email']);
/** SecureStore key of the pending address: `{ "email": <lower-cased>, "at": <ms since epoch> }`. */
export const PENDING_EMAIL_KEY = 'onepeek.pending-email';
type PendingEmail = { email: string; at: number };
// undefined: not read from SecureStore yet (cold start); null: known to be absent.
let pendingEmail: PendingEmail | null | undefined;

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** The pending address, from memory or (once per process) from SecureStore. Anything malformed is null. */
async function loadPendingEmail(): Promise<PendingEmail | null> {
  if (pendingEmail !== undefined) return pendingEmail;
  let found: PendingEmail | null = null;
  try {
    const raw = await SecureStore.getItemAsync(PENDING_EMAIL_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<PendingEmail>;
      if (typeof v.email === 'string' && v.email && typeof v.at === 'number' && Number.isFinite(v.at)) {
        found = { email: v.email, at: v.at };
      }
    }
  } catch {
    /* unreadable row: treated as absent, and the next write replaces it */
  }
  pendingEmail = found;
  return found;
}

/** Writes (or, with null, removes) the pending address in memory and SecureStore. Never throws. */
async function setPendingEmail(next: PendingEmail | null): Promise<void> {
  pendingEmail = next;
  try {
    if (next) {
      await SecureStore.setItemAsync(PENDING_EMAIL_KEY, JSON.stringify(next), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } else {
      await SecureStore.deleteItemAsync(PENDING_EMAIL_KEY);
    }
  } catch {
    /* SecureStore unavailable: memory still holds the value for this process */
  }
}

/**
 * Parses an `onepeek://auth` callback into its query and fragment parameters. Returns null for any
 * other URL: another scheme, another host, `onepeek://auth.evil` or `onepeek://auth@evil`. Written
 * by hand because Hermes' URL / URLSearchParams are incomplete, and so the raw URL is handed to
 * nothing else.
 */
export function parseAuthCallback(url: string): Record<string, string> | null {
  if (typeof url !== 'string') return null;
  const head = /^onepeek:\/\/auth\/?(?=$|[?#])/i.exec(url);
  if (!head) return null;
  const rest = url.slice(head[0].length);
  const hash = rest.indexOf('#');
  const query = hash === -1 ? rest : rest.slice(0, hash);
  const fragment = hash === -1 ? '' : rest.slice(hash + 1);
  const out: Record<string, string> = {};
  for (const part of [query.replace(/^\?/, ''), fragment]) {
    for (const pair of part.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const k = eq === -1 ? pair : pair.slice(0, eq);
      const v = eq === -1 ? '' : pair.slice(eq + 1);
      try {
        out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' '));
      } catch {
        /* malformed escape: skip the pair */
      }
    }
  }
  return out;
}

// Verified sign-in listeners (P2-1). Module memory, independent of the Supabase client: a reset
// rebuilds the client but the screens' subscriptions stay.
const signedInListeners = new Set<(s: AuthSession) => void>();

/** Tells the onSignedIn listeners about the session just installed. Only the success paths call it. */
function emitSignedIn(session: Session | null): void {
  const s = toAuthSession(session);
  if (!s) return;
  for (const cb of [...signedInListeners]) {
    try { cb(s); } catch { /* a listener's failure is its own */ }
  }
}

export const auth = {
  async getSession(): Promise<AuthSession | null> {
    const { data } = await sb().auth.getSession();
    return toAuthSession(data.session);
  },

  /** Supabase's own session events (rendering state). See onSignedIn for acting on a sign-in. */
  onChange(cb: (s: AuthSession | null) => void): () => void {
    const { data } = sb().auth.onAuthStateChange((_event, s) => cb(toAuthSession(s)));
    return () => data.subscription.unsubscribe();
  },

  /**
   * Fires after a sign-in THIS module completed and checked: signInWithApple, signInAsGuest, and
   * completeFromUrl's success path (Google's PKCE code; an email link only after its session was
   * found to belong to the address requested on this phone). Never fired from Supabase's SIGNED_IN
   * event, so the attacker's session of a mismatched email link (W1-1) is never reported here, and a
   * listener cannot act on it. Returns the unsubscribe function.
   */
  onSignedIn(cb: (s: AuthSession) => void): () => void {
    signedInListeners.add(cb);
    return () => { signedInListeners.delete(cb); };
  },

  /** Sign in with Apple: the identity token from expo-apple-authentication and the raw nonce it was requested with. */
  async signInWithApple(identityToken: string, nonce: string): Promise<void> {
    const { data, error } = await sb().auth.signInWithIdToken({ provider: 'apple', token: identityToken, nonce });
    if (error) throw new Error(error.message);
    emitSignedIn(data.session);
  },

  /** Returns the provider URL to open in the system browser; the browser comes back to onepeek://auth. */
  async startOAuth(provider: 'google'): Promise<string> {
    const { data, error } = await sb().auth.signInWithOAuth({
      provider,
      options: { redirectTo: AUTH_REDIRECT_URL, skipBrowserRedirect: true },
    });
    if (error || !data?.url) throw new Error(error?.message ?? 'oauth_start_failed');
    return data.url;
  },

  /**
   * Finishes a sign-in from the `onepeek://auth` callback: the PKCE `code` (Google, and email links
   * sent with the default template) or `token_hash` + `type` (email links sent with a TokenHash
   * template). Any other URL, a provider error, or a failed exchange returns false; implicit-flow
   * tokens in the fragment are deliberately not accepted (a crafted link could otherwise sign this
   * phone into someone else's account). A `token_hash` is accepted only while sendEmailLink() has a
   * pending address on this phone (younger than the OTP lifetime), only for `type` magiclink / email,
   * and only if the session it yields belongs to that address; any other session is signed out again
   * and the link refused. Returns whether a session now exists; onSignedIn listeners are told only
   * then (P2-1), after every check above.
   */
  async completeFromUrl(url: string): Promise<boolean> {
    const p = parseAuthCallback(url);
    if (!p || p.error || p.error_code) return false;
    const a = sb().auth;
    if (p.code) {
      const { error } = await a.exchangeCodeForSession(p.code);
      if (error) return false;
    } else if (p.token_hash && p.type) {
      const pending = await loadPendingEmail();
      const expired = !!pending && Date.now() - pending.at > EMAIL_LINK_TTL_MS;
      if (expired) await setPendingEmail(null);
      if (!pending || expired || !EMAIL_LINK_TYPES.has(p.type)) return false;
      const { data, error } = await a.verifyOtp({ token_hash: p.token_hash, type: p.type as EmailOtpType });
      if (error) return false;
      await setPendingEmail(null);   // one link per request, matching or not
      const email = data.session?.user.email;
      if (!email || normalizeEmail(email) !== pending.email) {
        // Someone else's account: drop the session this phone just got, locally and server-side.
        try { await a.signOut({ scope: 'local' }); } catch { /* the local session is removed regardless */ }
        return false;
      }
    } else {
      return false;
    }
    const { data } = await a.getSession();
    if (!data.session) return false;
    emitSignedIn(data.session);
    return true;
  },

  /**
   * Sends a magic link and remembers the address (SecureStore, this device only): completeFromUrl()
   * accepts a `token_hash` only for it, also after the app was killed before the link was tapped.
   */
  async sendEmailLink(email: string): Promise<void> {
    const address = email.trim();
    const { error } = await sb().auth.signInWithOtp({ email: address, options: { emailRedirectTo: AUTH_REDIRECT_URL } });
    if (error) throw new Error(error.message);
    await setPendingEmail({ email: normalizeEmail(address), at: Date.now() });
  },

  async signInAsGuest(): Promise<void> {
    await getChat().ensureSession(true);
    const { data } = await sb().auth.getSession();
    emitSignedIn(data.session);
  },

  /**
   * Called by the root layout from AppState: `true` when the app comes to the foreground, `false`
   * when it goes to the background. supabase-js refreshes the session on a timer only while this
   * is on (`startAutoRefresh` / `stopAutoRefresh`), so a phone that was in the background for
   * hours refreshes as soon as it is back, and no timer runs while suspended. A no-op when the app
   * is not configured.
   */
  setForeground(active: boolean): void {
    const s = get().supabase;
    if (!s) return;
    if (active) s.auth.startAutoRefresh();
    else s.auth.stopAutoRefresh();
  },

  /**
   * Signs this phone out. `scope: 'local'` revokes this device's refresh token and removes the
   * sealed session here; the user's browsers and other phones stay signed in (a global sign-out
   * from a phone would be surprising). auth-js removes the local session even when the revoke call
   * fails, so the phone is signed out in every case; a network error is reported after that. The
   * push token goes first (it needs the session), best effort: sign-out never waits on it. The
   * secrets quota id (lib/secrets CLIENT_ID_KEY) goes too (P2-9): it is not account-bound, but a
   * sign-out should not leave an identifier that links the next account's secrets to this one's.
   */
  async signOut(): Promise<void> {
    await setPendingEmail(null);
    try { await push.unregister(); } catch { /* offline or not registered: the row is moved by the next owner (008) */ }
    const { error } = await sb().auth.signOut({ scope: 'local' });
    await forgetClientId();
    if (error) throw new Error(error.message);
  },
};

// ---------------------------------------------------------------------------- push token

/** Sealed row in onepeek-auth.db (under the auth storage's prefix); never SecureStore, never logged. */
const PUSH_TOKEN_KEY = 'onepeek.push.token';

/**
 * This phone's push token. The token is an opaque APNs / FCM device token: it reaches exactly two
 * places, the core RPC and the sealed auth store (so unregister() can name it after a restart). It is
 * never kept in plain SecureStore, never logged and never put in an error.
 */
export const push = {
  /** Registers the token with the server (`register_push_device`) and keeps it sealed for unregister(). */
  async register(platform: 'ios' | 'android', token: string): Promise<void> {
    const t = token.trim();
    await getChat().registerPushDevice(platform, t);
    const store = get().authStorage;
    const previous = await store.getItem(PUSH_TOKEN_KEY);
    await store.setItem(PUSH_TOKEN_KEY, t);
    if (previous && previous !== t) {
      // The platform rotated the token: forget the old one so it does not linger in push_devices.
      try { await getChat().unregisterPushDevice(previous); } catch { /* best effort */ }
    }
  },

  /** Forgets the stored token server-side (`unregister_push_device`) and locally. No token: nothing to do. */
  async unregister(): Promise<void> {
    const store = get().authStorage;
    const token = await store.getItem(PUSH_TOKEN_KEY);
    if (!token) return;
    try {
      await getChat().unregisterPushDevice(token);
    } finally {
      await store.removeItem(PUSH_TOKEN_KEY);
    }
  },

  /** Whether this phone holds a registered token. */
  async current(): Promise<boolean> {
    return !!(await get().authStorage.getItem(PUSH_TOKEN_KEY));
  },
};

// ---------------------------------------------------------------------------- recovery

/**
 * "Reset chats on this phone": destroys the chat wrapping key and every sealed row (rooms, messages,
 * device identity), the sealed session, and the panic-lock flag, then drops the singletons so the
 * next getChat() builds fresh ones. Used by the recovery screen for `keystore_unavailable`, where the
 * rows are already unreadable, and nowhere else. Server-side state (room membership, the old device
 * record) is untouched; this device simply joins again as a new one. Also sweeps the picker and viewer
 * cache directories (lib/files) so no plaintext attachment copy survives the reset, forgets the pending
 * email address and drops any link parked in lib/links' hand-off (P3-2).
 */
export async function resetThisPhone(): Promise<void> {
  await setPendingEmail(null);
  clearHandoffs();
  const b = built;
  if (b?.supabase) {
    // The push token first: the RPC needs the session that is revoked just below. Best effort.
    try { await push.unregister(); } catch { /* offline or none: the wipe below removes the sealed token */ }
  }
  built = null;
  if (b?.supabase) {
    // Best effort: revoke this device's refresh token and remove the sealed session row. The wipe
    // below destroys the row's key in any case.
    try { b.supabase.auth.stopAutoRefresh(); } catch { /* not started */ }
    try { await b.supabase.auth.signOut({ scope: 'local' }); } catch { /* offline: the wipe covers it */ }
  }
  const keystore = b?.keystore ?? createRnKeyStore({ secureStore: SecureStore, sqlite: SQLite });
  await keystore.wipe();
  const authStorage = b?.authStorage ?? createRnAuthStorage({ secureStore: SecureStore, sqlite: SQLite });
  await authStorage.wipe();
  getLockStore().clear();
  // The secrets quota id (P2-9): a reset starts the free quota over rather than keep a device-wide
  // identifier across the wipe. The server already tolerates a cleared browser doing the same.
  await forgetClientId();
  // Plaintext copies the pickers and the viewer left in the cache (review W2-2 / W2-3): "Forgets every
  // chat and key stored here" has to include the files that were sent or opened from this phone.
  await clearPickerCaches();
}
