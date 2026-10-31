// Access to the core ChatClient for screens. `guard()` wraps a core call so the one error that needs
// a whole-app answer, `keystore_unavailable` (the wrapping key is gone while sealed rows exist, e.g.
// after a restore), sends the user to the recovery screen instead of surfacing as a generic failure.
import { useRouter } from 'expo-router';
import { createContext, type PropsWithChildren, useCallback, useContext, useMemo } from 'react';
import { getChat } from '@/lib/chat';
import { errorCode } from '@/lib/format';

type Chat = ReturnType<typeof getChat>;

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
      if (errorCode(e) === 'keystore_unavailable') router.replace('/reset');
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
