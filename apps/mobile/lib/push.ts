// Push registration, through `push` from @/lib/chat (core-crypto wave 2: `push.register(platform,
// token)`, `push.unregister()`, `push.current()`; it seals the token and unregisters on sign-out /
// reset). This shim exists only because the merged lib on this branch predates that export: it
// resolves `push` at call time and fails closed with `push_unavailable` when it is missing, so
// Settings never calls `getChat().registerPushDevice` itself (security review W1-2). Once the lead
// merges core-crypto's lib, `getPush()` returns the real object unchanged.
import * as chatLib from '@/lib/chat';

export type PushApi = {
  register(platform: 'ios' | 'android', token: string): Promise<void>;
  unregister(): Promise<void>;
  current(): Promise<boolean>;
};

const unavailable: PushApi = {
  register: async () => { throw new Error('push_unavailable'); },
  unregister: async () => { throw new Error('push_unavailable'); },
  current: async () => false,
};

export function getPush(): PushApi {
  return (chatLib as unknown as { push?: PushApi }).push ?? unavailable;
}
