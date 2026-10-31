// Platform ports for the Secret Chat core. Everything that differs between a browser and a phone
// is reached through one of these small interfaces; the core itself touches no `window`,
// `navigator`, `localStorage`, `indexedDB`, `File` or `fetch`.
//
// Web implementations live in ../adapters/web/ (the code that used to be inline in
// lib/chat/client.ts and lib/chat/keystore.ts). React Native implementations are task C3.

/**
 * Local, encrypted key-value storage. Values are sealed with AES-256-GCM under a wrapping key
 * that the platform keeps out of reach of application code (a non-extractable WebCrypto key in
 * IndexedDB on the web; the OS keystore on a phone). The record key is bound as additional data
 * so a sealed blob cannot be moved from one key to another.
 */
export interface KeyStore {
  /** Returns null when missing, expired (the record is then deleted), unreadable or tampered. */
  get<T>(key: string): Promise<T | null>;
  /** Stores a value encrypted. `expiresAt` (ms since epoch) makes get() refuse it afterwards. */
  put(key: string, value: unknown, expiresAt?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Deletes every record whose key starts with `prefix` (e.g. everything for one room). */
  delPrefix(prefix: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
  /** Removes expired records; returns how many were removed. */
  sweep(): Promise<number>;
  /** Destroys the wrapping key first (making every record unreadable at once), then the records. */
  wipe(): Promise<void>;
}

// ---- Supabase. Typed structurally so the real SupabaseClient and a test fake both satisfy it.

export type SupabaseError = { message: string };

export type SupabaseSession = {
  access_token: string;
  user: { id: string; is_anonymous?: boolean };
};

export interface RealtimeChannelLike {
  on(type: 'broadcast', filter: { event: string }, callback: (msg: { event: string; payload: unknown }) => void): RealtimeChannelLike;
  subscribe(callback?: (status: string) => void): RealtimeChannelLike;
}

/**
 * The subset of `@supabase/supabase-js`'s SupabaseClient that the chat client uses. `S` is the
 * session type the real client returns (supabase-js's `Session`), so `ensureSession()` hands
 * callers the full object; the core itself only reads `access_token` and `user.id`/`is_anonymous`.
 */
export interface SupabaseLike<S extends SupabaseSession = SupabaseSession> {
  auth: {
    getSession(): Promise<{ data: { session: S | null } }>;
    signInAnonymously(): Promise<{ data: { session: S | null }; error: SupabaseError | null }>;
    /** Passkey (WebAuthn) support. Only called for non-anonymous sessions in unlock(). */
    passkey: { list(): Promise<{ data: unknown[] | null }> };
    signInWithPasskey(): Promise<{ error: SupabaseError | null }>;
  };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: SupabaseError | null }>;
  storage: {
    from(bucket: string): {
      upload(path: string, body: Blob, options: { contentType: string; upsert: boolean }): Promise<{ error: SupabaseError | null }>;
      download(path: string): Promise<{ data: Blob | null; error: SupabaseError | null }>;
    };
  };
  channel(name: string, options: { config: { private: boolean } }): RealtimeChannelLike;
  removeChannel(channel: RealtimeChannelLike): unknown;
  realtime: { setAuth(token: string): unknown };
}

// ---- Environment

export interface ChatEnv {
  /** Origin used to build invite links, e.g. `https://onepeek.io`. */
  origin(): string;
  /** Human-readable label registered with a new chat device, e.g. "Chrome on Mac". */
  deviceLabel(): string;
  /** RFC 4122 v4 UUID. */
  randomUUID(): string;
  /**
   * Asks the server for a content-free "new message" push to a room's other members. Best
   * effort: implementations may return early (no network) and must never throw to the caller.
   */
  notify(roomId: string, accessToken: string): Promise<void>;
}

/** Panic-lock flag: hides every chat screen until unlock() succeeds. It does not delete rooms. */
export interface LockStore {
  set(): void;
  get(): boolean;
  clear(): void;
}

// ---- Files

/** A file to send: replaces the browser `File`. `bytes()` reads the whole content once. */
export interface FileSource {
  name: string;
  mime: string;
  size: number;
  bytes(): Promise<Uint8Array>;
}

/** A decrypted attachment. The web wrapper turns it back into a `Blob`. */
export type OpenedFile = { bytes: Uint8Array; mime: string };

// ---- Everything together

export interface ChatPlatform<S extends SupabaseSession = SupabaseSession> {
  /** `null` when the app is not configured; every call then fails with `not_configured`. */
  supabase: SupabaseLike<S> | null;
  keystore: KeyStore;
  env: ChatEnv;
  lock: LockStore;
}
