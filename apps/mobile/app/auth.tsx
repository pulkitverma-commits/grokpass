// Auth callback (`onepeek://auth?...` from the email link or an OAuth redirect that bypassed the
// in-app browser). The URL carries tokens: it is handed to the core once and never shown or logged.
import { useLinkingURL } from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button } from '../components/Button';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { colors, spacing } from '../theme';
import { auth } from '@/lib/chat';

export default function AuthCallbackScreen() {
  const url = useLinkingURL();
  const router = useRouter();
  const handled = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url || handled.current === url) return;
    handled.current = url;
    let alive = true;
    auth.completeFromUrl(url)
      .then((ok) => { if (!alive) return; if (ok) router.replace('/'); else setFailed(true); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [url, router]);

  return (
    <Screen testID="auth.screen">
      <View style={styles.body}>
        {failed ? (
          <>
            <Notice tone="error" icon="alert" text="That sign-in link didn’t work. It may have expired or already been used." testID="auth.error" />
            <Button title="Back to sign in" onPress={() => router.replace('/sign-in')} testID="auth.retry" />
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.accent} />
            <Text variant="sub" tone="muted" center accessibilityLiveRegion="polite">Finishing sign-in…</Text>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ body: { flex: 1, justifyContent: 'center', gap: spacing.lg } });
