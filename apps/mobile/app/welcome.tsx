// Welcome (design 01). First screen for a signed-out phone.
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Image, StyleSheet, View } from 'react-native';
import { Button } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { colors, radii, spacing } from '../theme';

const icon = require('../assets/images/icon.png');

// Honest copy: Android blocks screenshots in chats (FLAG_SECURE); iOS only tells the app one was
// taken, and the chat is told. "Blocked or flagged" is what each platform actually does.
const POINTS: { icon: IconName; text: string }[] = [
  { icon: 'lock', text: 'End-to-end encrypted. OnePeek can’t read a word.' },
  { icon: 'eye', text: 'Hold to read. Screenshots blocked or flagged.' },
  { icon: 'flame', text: 'Messages vanish on a timer. Burn a chat any time.' },
];

export default function WelcomeScreen() {
  const router = useRouter();
  return (
    <Screen
      testID="welcome.screen"
      footer={
        <>
          <Button title="Get started" onPress={() => router.push('/sign-in')} testID="welcome.getStarted" />
          <Button title="I have an invite link" variant="ghost" onPress={() => router.push('/join')} testID="welcome.invite" />
          <View style={styles.signInRow}>
            <Text variant="meta" tone="muted">Already have an account?</Text>
            <Button title="Sign in" variant="link" block={false} small onPress={() => router.push('/sign-in')} testID="welcome.signIn" />
          </View>
          <Text variant="meta" tone="muted" center>
            By continuing you agree to the{' '}
            <Text variant="meta" tone="accent" accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync('https://onepeek.io/terms')}>Terms</Text>
            {' '}and{' '}
            <Text variant="meta" tone="accent" accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync('https://onepeek.io/privacy')}>Privacy Policy</Text>.
          </Text>
        </>
      }
    >
      <View style={styles.hero}>
        <Image source={icon} style={styles.mark} accessibilityIgnoresInvertColors accessible accessibilityRole="image" accessibilityLabel="OnePeek" />
        <Text variant="display" tone="heading" center accessibilityRole="header">Private chats{'\n'}that disappear.</Text>
        <Text variant="sub" tone="muted" center>Talk, share files and send one-time secrets.{'\n'}Encrypted on your phone, gone on a timer.</Text>
      </View>
      <View style={styles.points}>
        {POINTS.map((p) => (
          <View key={p.icon} style={styles.point} accessible accessibilityLabel={p.text}>
            <View style={styles.pointIcon}><Icon name={p.icon} size={20} color={colors.accent} /></View>
            <Text variant="sub" style={styles.pointText}>{p.text}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  mark: { width: 104, height: 104, borderRadius: 28, marginBottom: spacing.sm },
  points: { gap: spacing.lg, paddingBottom: spacing.xl },
  point: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  pointIcon: { width: 40, height: 40, borderRadius: radii.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  pointText: { flex: 1 },
  signInRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
});
