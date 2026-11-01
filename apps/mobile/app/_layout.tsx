// Root layout. The native WebCrypto (react-native-quick-crypto) is installed before any screen or
// core module can run crypto; installRnCrypto() throws if a required primitive is missing, so a
// broken build fails at launch rather than silently falling back to JS crypto.
import { installRnCrypto } from '@onepeek/core/src/rn';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SecurityProvider, useShareIntent } from '@/security';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ChatProvider } from '../components/ChatProvider';
import { LockedScreen } from '../components/LockedScreen';
import { PushRefresher } from '../components/PushRefresher';
import { colors, fontAssets } from '../theme';
import { auth, type AuthSession } from '@/lib/chat';
import { clearPickerCaches } from '@/lib/files';

installRnCrypto();

// The splash stays up until the fonts are in and the session is known, so the first frame is
// the right screen in the right face (no flash of Welcome for a signed-in user).
SplashScreen.preventAutoHideAsync().catch(() => {});

/** Routes a signed-out user may see. Joining is public (guests), and the recovery screen must always open. */
const PUBLIC = new Set(['welcome', 'sign-in', 'auth', 'join', 'chat', 'reset']);

function useSession() {
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    auth
      .getSession()
      .then((s) => alive && setSession(s))
      .catch(() => alive && setSession(null));
    let off = () => {};
    try {
      off = auth.onChange((s) => alive && setSession(s));
    } catch {
      /* lib/chat not wired: stay signed out */
    }
    return () => {
      alive = false;
      off();
    };
  }, []);
  return session;
}

/**
 * Sends signed-out users to Welcome and signed-in users away from the sign-in screens.
 *
 * Invariant (review W1-1 / W2-9): AuthGate never redirects away from `auth` on a session change.
 * `auth.completeFromUrl` installs the session an email link carries BEFORE it has checked that the
 * link was requested on this phone, and signs a mismatched session out a moment later; in between,
 * `onChange` reports a session that may belong to someone else. The only exit from `auth` is the
 * screen's own `router.replace('/')` once completeFromUrl has returned `ok`. Do not add a
 * "signed in → go home" rule that fires on `auth`, and do not mount a syncing screen there.
 */
function AuthGate({ session }: { session: AuthSession | null }) {
  const segments = useSegments();
  const router = useRouter();
  const first = segments[0] ?? '';
  useEffect(() => {
    if (!session && !PUBLIC.has(first)) router.replace('/welcome');
    else if (session && (first === 'welcome' || first === 'sign-in')) router.replace('/');
  }, [session, first, router]);
  return null;
}

/** Routes a share-sheet delivery (text or files) to the share screen exactly once (native-security N6). */
function ShareIntentBridge() {
  useShareIntent();
  return null;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const session = useSession();
  const ready = (fontsLoaded || !!fontError) && session !== undefined;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  // Plaintext left in the cache by a kill mid-send or mid-view (picker copies, viewer temp files) goes
  // on every launch (reviews W2-2, W2-3).
  useEffect(() => {
    clearPickerCaches().catch(() => {});
  }, []);
  if (!ready) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <ChatProvider>
          <PushRefresher />
          <SecurityProvider cover={<LockedScreen />}>
            <StatusBar style="light" />
            <AuthGate session={session} />
            <ShareIntentBridge />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
                animation: 'fade_from_bottom',
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
              <Stack.Screen name="new" options={{ presentation: 'modal' }} />
              <Stack.Screen name="join" options={{ presentation: 'modal' }} />
              <Stack.Screen name="chat/join" options={{ presentation: 'modal' }} />
              <Stack.Screen name="settings" />
              <Stack.Screen name="reset" options={{ gestureEnabled: false }} />
            </Stack>
          </SecurityProvider>
        </ChatProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
