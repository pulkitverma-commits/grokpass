// Recovery screen for `keystore_unavailable`: the phone's wrapping key is gone (restored backup, new
// phone) while sealed chat rows exist. Keys are never backed up by design, so the only way forward is
// to forget the chats stored on this phone. Two taps: the second button is the confirmation.
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { spacing } from '../theme';
import { resetThisPhone } from '@/lib/chat';

export default function ResetScreen() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function reset() {
    setErr(''); setBusy(true);
    try {
      await resetThisPhone();
      router.replace('/welcome');
    } catch {
      setErr('The reset didn’t finish. Try again.');
      setBusy(false);
    }
  }

  return (
    <Screen
      testID="reset.screen"
      footer={
        <>
          {confirming ? (
            <Button title="Yes, reset chats on this phone" variant="destructive" busy={busy} onPress={reset} testID="reset.confirm" />
          ) : (
            <Button title="Reset chats on this phone" variant="destructive" onPress={() => setConfirming(true)} testID="reset.reset" />
          )}
          <Button title="Not now" variant="ghost" disabled={busy} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} testID="reset.cancel" />
        </>
      }
    >
      <View style={styles.body}>
        <Avatar icon="key" size={64} accent />
        <Text variant="h1" tone="heading" accessibilityRole="header" center>This phone’s chat keys are missing</Text>
        <Text variant="sub" tone="muted" center>
          The key that protects chats on this phone couldn’t be found. That happens after restoring from a backup or moving to a new phone, because keys are never backed up.
        </Text>
        <Text variant="sub" tone="muted" center>
          Without it, the chats stored here can’t be opened. Resetting forgets them on this phone only; nothing changes on your other devices, and you can start or join new chats right away.
        </Text>
        {confirming ? <Notice tone="error" icon="alert" text="This can’t be undone. Chats stored on this phone will be gone." /> : null}
        {err ? <Notice tone="error" text={err} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ body: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.lg, paddingHorizontal: spacing.sm } });
