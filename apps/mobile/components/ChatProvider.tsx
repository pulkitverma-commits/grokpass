// Access to the core ChatClient for screens. `guard()` wraps a core call so the one error that needs
// a whole-app answer, `keystore_unavailable` (the wrapping key is gone while sealed rows exist, e.g.
// after a restore), sends the user to the recovery screen instead of surfacing as a generic failure.
import { useRouter } from 'expo-router';
import { createContext, type PropsWithChildren, useCallback, useContext, useMemo } from 'react';
import { getChat } from '@/lib/chat';
import { errorCode } from '@/lib/format';

type Chat = ReturnType<typeof getChat>;

// ---------------------------------------------------------------------------- reset pass (review F-7)

// The recovery screen (/reset) wipes every chat on the phone in two taps, so it acts only when the app
// itself sent the user there: guard() below on `keystore_unavailable`, or Settings → "Reset chats on
// this phone". Those callers arm a one-shot pass right before navigating; a deep link
// (`onepeek://reset` from another app or a message) finds none and the screen sends it home. Memory
// only, valid for RESET_PASS_MS, spent by the screen once it has mounted.
const RESET_PASS_MS = 30_000;
let resetPassAt = 0;

/** Arms the one-shot pass for /reset. Call right before `router.push` / `replace('/reset')`. */
export function allowReset(): void {
  resetPassAt = Date.now();
}

/** Whether an unexpired pass is armed. Does not spend it. */
export function resetAllowed(): boolean {
  return resetPassAt > 0 && Date.now() - resetPassAt <= RESET_PASS_MS;
}

/** Spends the pass: the next visit to /reset needs a new allowReset(). */
export function consumeReset(): void {
  resetPassAt = 0;
}

type ChatContextValue = {
  /** The client. Built lazily so a screen that never touches chat never touches the keystore. */
  chat: () => Chat;
  /** Runs a core call; routes to /reset on `keystore_unavailable`, rethrows everything. */
  guard: <T>(work: () => Promise<T>) => Promise<T>;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: PropsWithChildren) {
  const router = useRouter();
  const guard = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (e) {
      // The pass lets /reset act; a deep link to it has none and goes home (review F-7).
      if (errorCode(e) === 'keystore_unavailable') { allowReset(); router.replace('/reset'); }
      throw e;
    }
  }, [router]);
  const value = useMemo<ChatContextValue>(() => ({ chat: () => getChat(), guard }), [guard]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const v = useContext(ChatContext);
  if (!v) throw new Error('useChat must be used inside ChatProvider');
  return v;
}
