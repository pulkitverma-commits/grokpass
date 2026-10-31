// App glue between the screens / security module and packages/core. PLACEHOLDER: the core-crypto
// agent replaces the bodies in Phase 1 (task "app glue"); every other module imports ONLY the names
// below, with exactly these signatures, so the lead can swap in the real implementation at merge.
//
// Contract:
// - getChat(): the single ChatClient for this app (Supabase + RN keystore + RN platform).
// - getLockStore(): the panic-lock flag store (SecureStore, this device only).
// - auth: session helpers. Sign-in with Apple (identity token + nonce), Google through the system
//   browser (startOAuth returns the URL, completeFromUrl finishes with the onepeek://auth callback),
//   email link (also completed by completeFromUrl), guest (anonymous), sign out.
// - resetThisPhone(): wipes the local keystore, lock and session. Used by the recovery screen shown
//   when the core reports `keystore_unavailable` (wrapping key gone while sealed rows exist).
import type { ChatClient } from '@onepeek/core';
import type { RnLockStore } from '@onepeek/core/src/rn';

export type AuthSession = { userId: string; email: string | null; isAnonymous: boolean };

/** Deep link the auth flows return to. Must be allow-listed in Supabase Auth → Redirect URLs. */
export const AUTH_REDIRECT_URL = 'onepeek://auth';

const notWired = (): never => {
  throw new Error('lib/chat is not wired yet');
};

export function getChat(): ChatClient {
  return notWired();
}

export function getLockStore(): RnLockStore {
  return notWired();
}

export const auth = {
  async getSession(): Promise<AuthSession | null> {
    return notWired();
  },
  onChange(cb: (s: AuthSession | null) => void): () => void {
    void cb;
    return notWired();
  },
  async signInWithApple(identityToken: string, nonce: string): Promise<void> {
    void identityToken;
    void nonce;
    notWired();
  },
  async startOAuth(provider: 'google'): Promise<string> {
    void provider;
    return notWired();
  },
  async completeFromUrl(url: string): Promise<boolean> {
    void url;
    return notWired();
  },
  async sendEmailLink(email: string): Promise<void> {
    void email;
    notWired();
  },
  async signInAsGuest(): Promise<void> {
    notWired();
  },
  async signOut(): Promise<void> {
    notWired();
  },
};

export async function resetThisPhone(): Promise<void> {
  notWired();
}
