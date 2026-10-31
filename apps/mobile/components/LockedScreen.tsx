// Locked screen (design 03). The SecurityProvider renders this as its `cover`: while the app is
// locked (cold start, auto-lock, Panic Exit) it is the only thing on screen and offers one action,
// unlock through the OS check; while the app is merely inactive or being recorded (content still
// mounted underneath) it shows the brand only, so the app switcher and a recording see nothing.
// Reads nothing from chat: no room names, no counts, no message content ever reach this view.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { DEVICE_INSECURE_WARNING, LockCover, useSecurity } from '@/security';
import { colors, radii, spacing } from '../theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Logo } from './Logo';
import { Notice } from './Notice';
import { Text } from './Text';
import { getLockStore } from '@/lib/chat';

const METHOD: Record<string, { icon: IconName; name: string }> = {
  face: { icon: 'face', name: 'Face ID' },
  fingerprint: { icon: 'fingerprint', name: 'your fingerprint' },
  passcode: { icon: 'lock', name: 'your phone passcode' },
  none: { icon: 'lock', name: 'this phone' },
};

/** Whether Panic Exit set the persistent flag (the store is local; nothing is fetched). */
function panicked(): boolean {
  try { return getLockStore().get(); } catch { return false; }
}

export function LockedScreen() {
  const { locked, unlock, biometrics, deviceInsecure } = useSecurity();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function tryUnlock() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const ok = await unlock();
      if (!ok) setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (!locked) {
    // Inactive / recording cover: brand only, no controls, content stays mounted underneath.
    return (
      <LockCover>
        <Logo size={34} />
      </LockCover>
    );
  }

  const method = METHOD[deviceInsecure ? 'none' : biometrics] ?? METHOD.passcode!;
  const byPanic = panicked();
  return (
    <LockCover>
      <View style={styles.screen} testID="locked.screen">
        <View style={styles.top}>
          <Logo size={34} />
        </View>
        <View style={styles.middle}>
          <View style={styles.iconBox} accessible={false}>
            <Icon name={method.icon} size={64} color={colors.accent} />
          </View>
          <Text variant="display" tone="heading" center accessibilityRole="header">Chats locked</Text>
          <Text variant="sub" tone="muted" center style={styles.sub}>
            {deviceInsecure ? 'Unlock to see your conversations on this phone.' : `Unlock with ${method.name} to see your conversations on this phone.`}
          </Text>
          {deviceInsecure ? <Notice tone="error" icon="alert" text={DEVICE_INSECURE_WARNING} testID="locked.insecure" /> : null}
          {failed ? <Notice tone="error" text="Couldn’t unlock. Try again." testID="locked.failed" /> : null}
        </View>
        <View style={styles.bottom}>
          <Button title={failed ? 'Try again' : 'Unlock'} busy={busy} onPress={tryUnlock} accessibilityLabel="Unlock OnePeek" testID="locked.unlock" />
          {biometrics === 'face' || biometrics === 'fingerprint' ? (
            <Button title="Use phone passcode" variant="link" busy={busy} onPress={tryUnlock} accessibilityHint="The phone asks for its passcode if the biometric check is skipped" testID="locked.passcode" />
          ) : null}
          <View style={styles.card} accessible accessibilityLabel={`${byPanic ? 'Locked by Panic Exit. ' : ''}Chats also lock after 1 minute in the background. Nothing was deleted.`}>
            {byPanic ? <Text variant="title">Locked by Panic Exit</Text> : null}
            <Text variant="meta" tone="muted">Chats also lock after 1 minute in the background. Nothing was deleted.</Text>
          </View>
        </View>
      </View>
    </LockCover>
  );
}

const styles = StyleSheet.create({
  screen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.gutter, paddingTop: 72, paddingBottom: 40, backgroundColor: colors.bg },
  top: { alignItems: 'center' },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  iconBox: { width: 128, height: 128, borderRadius: 34, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  sub: { paddingHorizontal: spacing.xl, marginBottom: spacing.md },
  bottom: { gap: spacing.sm },
  card: { marginTop: spacing.md, padding: spacing.lg, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, gap: 4 },
});
