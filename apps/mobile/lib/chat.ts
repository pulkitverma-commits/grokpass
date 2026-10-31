// App glue between the screens / security module and packages/core: one ChatClient (Supabase + the
// React Native keystore + the RN platform), the panic-lock store, the auth flows and the recovery
// reset. Every other module imports ONLY the names below (the Phase 1 contract); their signatures do
// not change.
//
// Contract:
// - getChat(): the single ChatClient for this app (Supabase + RN keystore + RN platform).
// - getLockStore(): the panic-lock flag store (SecureStore, this device only).
// - auth: session helpers. Sign-in with Apple (identity token + nonce), Google through the system
//   browser (startOAuth returns the URL, completeFromUrl finishes with the onepeek://auth callback),
//   email link (also completed by completeFromUrl), guest (anonymous), sign out.
// - resetThisPhone(): wipes the local keystore, lock and session. Used by the recovery screen shown
//   when the core reports `keystore_unavailable` (wrapping key gone while sealed rows exist).
//
// What never leaves this phone unencrypted: chat keys and messages (sealed rows in onepeek-chat.db),
// the Supabase session with its refresh token (sealed rows in onepeek-auth.db; the wrapping keys sit
// in SecureStore WHEN_UNLOCKED_THIS_DEVICE_ONLY). Nothing here logs: not URLs, codes or tokens.
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

export type AuthSession = { userId: string; email: string | null; isAnonymous: boolean };

/** Deep link the auth flows return to. Must be allow-listed in Supabase Auth → Redirect URLs. */
export const AUTH_REDIRECT_URL = 'onepeek://auth';

// ---------------------------------------------------------------------------- configuration

type Extra = { supabaseUrl?: string; supabaseAnonKey?: string; siteUrl?: string };

function extra(): Required<Extra> {
  const e = (Constants.expoConfig?.extra ?? {}) as Extra;
  return {
    supabaseUrl: (e.supabaseUrl ?? '').trim(),
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

export const auth = {
  async getSession(): Promise<AuthSession | null> {
    const { data } = await sb().auth.getSession();
    return toAuthSession(data.session);
  },

  onChange(cb: (s: AuthSession | null) => void): () => void {
    const { data } = sb().auth.onAuthStateChange((_event, s) => cb(toAuthSession(s)));
    return () => data.subscription.unsubscribe();
  },

  /** Sign in with Apple: the identity token from expo-apple-authentication and the raw nonce it was requested with. */
  async signInWithApple(identityToken: string, nonce: string): Promise<void> {
    const { error } = await sb().auth.signInWithIdToken({ provider: 'apple', token: identityToken, nonce });
    if (error) throw new Error(error.message);
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
   * phone into someone else's account). Returns whether a session now exists.
   */
  async completeFromUrl(url: string): Promise<boolean> {
    const p = parseAuthCallback(url);
    if (!p || p.error || p.error_code) return false;
    const a = sb().auth;
    if (p.code) {
      const { error } = await a.exchangeCodeForSession(p.code);
      if (error) return false;
    } else if (p.token_hash && p.type) {
      const { error } = await a.verifyOtp({ token_hash: p.token_hash, type: p.type as EmailOtpType });
      if (error) return false;
    } else {
      return false;
    }
    const { data } = await a.getSession();
    return !!data.session;
  },

  async sendEmailLink(email: string): Promise<void> {
    const { error } = await sb().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: AUTH_REDIRECT_URL } });
    if (error) throw new Error(error.message);
  },

  async signInAsGuest(): Promise<void> {
    await getChat().ensureSession(true);
  },

  /**
   * Signs this phone out. `scope: 'local'` revokes this device's refresh token and removes the
   * sealed session here; the user's browsers and other phones stay signed in (a global sign-out
   * from a phone would be surprising). auth-js removes the local session even when the revoke call
   * fails, so the phone is signed out in every case; a network error is reported after that.
   */
  async signOut(): Promise<void> {
    const { error } = await sb().auth.signOut({ scope: 'local' });
    if (error) throw new Error(error.message);
  },
};

// ---------------------------------------------------------------------------- recovery

/**
 * "Reset chats on this phone": destroys the chat wrapping key and every sealed row (rooms, messages,
 * device identity), the sealed session, and the panic-lock flag, then drops the singletons so the
 * next getChat() builds fresh ones. Used by the recovery screen for `keystore_unavailable`, where the
 * rows are already unreadable, and nowhere else. Server-side state (room membership, the old device
 * record) is untouched; this device simply joins again as a new one.
 */
export async function resetThisPhone(): Promise<void> {
  const b = built;
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
}

// ---------------------------------------------------------------------------- push (TEMP STUB)
// core-crypto's real `push` export is merged on mobile/integration; this branch predates it. The
// stub only lets the branch typecheck (Settings imports `push`); the lead drops this block at merge.
export const push = {
  async register(_platform: 'ios' | 'android', _token: string): Promise<void> { throw new Error('push_unavailable'); },
  async unregister(): Promise<void> { throw new Error('push_unavailable'); },
  async current(): Promise<boolean> { return false; },
};
