// Settings (design 12), the wave-1 minimum: who is signed in, sign out, reset this phone. The full
// list (Face ID lock, auto-lock, timers, devices, safety number) is U7 in wave 2.
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Avatar } from '../components/Avatar';
import { Header } from '../components/Header';
import { ListRow } from '../components/ListRow';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { SectionLabel } from '../components/SectionLabel';
import { Text } from '../components/Text';
import { colors, radii, spacing } from '../theme';
import { auth, type AuthSession } from '@/lib/chat';

export default function SettingsScreen() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { auth.getSession().then(setSession).catch(() => setSession(null)); }, []);

  async function signOut() {
    setErr(''); setBusy(true);
    try { await auth.signOut(); router.replace('/welcome'); }
    catch { setErr('Sign out didn’t finish. Try again.'); setBusy(false); }
  }

  const who = session === undefined ? '' : !session ? 'Not signed in' : session.isAnonymous ? 'You’re using chat as a guest on this device.' : `Signed in as ${session.email ?? 'your account'}`;

  return (
    <Screen scroll header={<Header title="Settings" />} testID="settings.screen">
      <View style={styles.card}>
        <ListRow divider={false} leading={<Avatar name={session?.email ?? (session?.isAnonymous ? 'Guest' : null)} size={46} accent />} title={session?.isAnonymous ? 'Guest' : (session?.email ?? 'Account')} subtitle={who} testID="settings.account" />
      </View>

      <SectionLabel>Chats on this phone</SectionLabel>
      <View style={styles.card}>
        <ListRow title="Reset chats on this phone" subtitle="Forgets every chat and key stored here. Other devices are not affected." chevron onPress={() => router.push('/reset')} testID="settings.reset" />
        {__DEV__ ? <ListRow title="Run the Phase 0 crypto spike" subtitle="Development builds only" chevron onPress={() => router.push('/spike')} testID="settings.spike" divider={false} /> : null}
      </View>

      <SectionLabel>Account</SectionLabel>
      <View style={styles.card}>
        <ListRow title={busy ? 'Signing out…' : 'Sign out'} subtitle={session?.isAnonymous ? 'A guest session can’t be signed back into; its chats stay on this phone until they expire.' : undefined} onPress={busy ? undefined : signOut} testID="settings.signOut" divider={false} />
      </View>
      {err ? <View style={styles.err}><Notice tone="error" text={err} /></View> : null}

      <Text variant="meta" tone="muted" center style={styles.foot}>
        Your chat keys stay in this phone’s secure storage and are never backed up to the cloud.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  err: { marginTop: spacing.md },
  foot: { marginTop: spacing.xxl, paddingHorizontal: spacing.lg },
});
