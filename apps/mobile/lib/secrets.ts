// One-time secrets (onepeek.io links) from the app. PLACEHOLDER: core-crypto implements the bodies in
// Phase 2 (task C4) on top of packages/core/src/secrets.ts; screens import ONLY these names with these
// signatures, so the lead can swap in the real implementation at merge.
//
// The spec is the website: app/page.tsx (create: `create_secret` RPC, link `${origin}/s/${id}#${keyB64}`),
// app/s/[id]/page.tsx and app/api/open/route.ts (peek + open, decrypt in the client). The key never
// leaves the URL fragment except into the core's decrypt call; nothing about the content reaches the server.
import type { FileSource, SecretHeader, WifiSecret } from '@onepeek/core';

export type SecretInput = { kind: 'text'; text: string } | { kind: 'file'; file: FileSource };
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

/** What the viewer learns before opening (mirrors the web `Peek`): never the content. */
export type SecretPeek = {
  header: SecretHeader;
  viewsLeft: number | null;
  maxViews: number | null;
  locked: boolean;
  lockHint: string | null;
  notYet: string | null;
};

export type OpenedSecret =
  | { kind: 'text'; text: string; header: SecretHeader }
  | { kind: 'wifi'; wifi: WifiSecret; header: SecretHeader }
  | { kind: 'file'; bytes: Uint8Array; name: string; mime: string; header: SecretHeader };

const notWired = (): never => {
  throw new Error('lib/secrets is not wired yet');
};

/** True for https://onepeek.io/s/<id>#<key> (and www), the only links the app opens as secrets. */
export function isSecretLink(url: string): boolean {
  void url;
  return notWired();
}

export async function createSecretLink(input: SecretInput, opts: SecretOptions): Promise<SecretLink> {
  void input;
  void opts;
  return notWired();
}

export async function peekSecretLink(url: string): Promise<SecretPeek> {
  void url;
  return notWired();
}

export async function openSecretLink(url: string, unlock?: { email?: string; token?: string }): Promise<OpenedSecret> {
  void url;
  void unlock;
  return notWired();
}
