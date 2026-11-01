// Inline notice (info / error) and a short-lived toast. Both are live regions so screen readers
// hear them without focus moving.
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from '../theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Tone = 'info' | 'error' | 'success';

export function Notice({ text, tone = 'info', icon, testID }: { text: string; tone?: Tone; icon?: IconName; testID?: string }) {
  const fg = tone === 'error' ? colors.danger : tone === 'success' ? colors.secure : colors.muted;
  return (
    <View style={[styles.notice, tone === 'error' && styles.error, tone === 'success' && styles.success]} accessibilityLiveRegion="polite" accessibilityRole="alert" testID={testID}>
      {icon ? <Icon name={icon} size={16} color={fg} /> : null}
      <Text variant="meta" style={[styles.noticeText, { color: fg }]}>{text}</Text>
    </View>
  );
}

/** Shows `message` for ~1.8 s whenever it changes to a non-empty string. */
export function Toast({ message, testID }: { message: string; testID?: string }) {
  const [shown, setShown] = useState('');
  // Adjusting state during render (the React pattern for "derive from the last prop change"):
  // a new non-empty message becomes the shown text without an effect-driven extra render.
  const [lastMessage, setLastMessage] = useState(message);
  if (message !== lastMessage) {
    setLastMessage(message);
    if (message) setShown(message);
  }
  const [op] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!message) return;
    Animated.sequence([
      Animated.timing(op, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(op, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) setShown(''); });
  }, [message, op]);
  if (!shown) return null;
  return (
    <Animated.View style={[styles.toast, { opacity: op }]} pointerEvents="none" accessibilityLiveRegion="polite" testID={testID}>
      <Text variant="meta" tone="inverse">{shown}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.fill, borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 10 },
  error: { backgroundColor: colors.dangerSoft },
  success: { backgroundColor: colors.secureSoft },
  noticeText: { flex: 1 },
  toast: { position: 'absolute', bottom: 96, alignSelf: 'center', backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: 16, paddingVertical: 10 },
});
