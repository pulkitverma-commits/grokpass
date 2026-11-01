// List row (the web's .c-row): leading element, title, subtitle, trailing element or chevron.
// At least 56 pt tall; the whole row is one touch target when onPress is set.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, rowHeight, spacing } from '../theme';
import { Icon } from './Icon';
import { Text } from './Text';

type Props = {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  divider?: boolean;
  tone?: 'text' | 'danger';
  style?: ViewStyle;
};

export function ListRow({ leading, title, subtitle, trailing, chevron, onPress, accessibilityLabel, accessibilityHint, testID, divider = true, tone = 'text', style }: Props) {
  const body = (
    <>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.main}>
        <Text variant="title" tone={tone === 'danger' ? 'danger' : 'text'} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text variant="meta" tone="muted" numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      {chevron ? <Icon name="chevronRight" size={18} color={colors.faint} /> : null}
    </>
  );
  const rowStyle = [styles.row, divider && styles.divider, style];
  if (!onPress) return <View style={rowStyle} testID={testID} accessible accessibilityLabel={accessibilityLabel ?? `${title}${subtitle ? `, ${subtitle}` : ''}`}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${title}${subtitle ? `, ${subtitle}` : ''}`}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={({ pressed }) => [rowStyle, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: rowHeight, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 14, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  leading: { flexShrink: 0 },
  main: { flex: 1, minWidth: 0, gap: 2 },
  trailing: { flexShrink: 0, alignItems: 'flex-end', gap: 6 },
  pressed: { backgroundColor: colors.fill },
});
