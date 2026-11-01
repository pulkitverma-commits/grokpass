// Brand mark: the app icon plus the "OnePeek" wordmark. The wordmark is text so it scales with
// dynamic type and reads to screen readers.
import { Image, StyleSheet, View } from 'react-native';
import { colors } from '../theme';
import { Text } from './Text';

const icon = require('../assets/images/icon.png');

export function Logo({ size = 28, showMark = true }: { size?: number; showMark?: boolean }) {
  return (
    <View style={styles.row} accessible accessibilityRole="image" accessibilityLabel="OnePeek">
      {showMark ? <Image source={icon} style={{ width: size, height: size, borderRadius: size / 4 }} accessibilityIgnoresInvertColors /> : null}
      <Text variant="title" style={[styles.word, { fontSize: size * 0.75, color: colors.accent }]}>OnePeek</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  word: { letterSpacing: -0.3 },
});
