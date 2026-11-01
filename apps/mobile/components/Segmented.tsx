// Segmented control (the web's .c-seg): one row of equal options, the chosen one raised.
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radii, spacing, touchTarget } from '../theme';
import { Text } from './Text';

export type SegmentOption<T> = { value: T; label: string; testID?: string };

type Props<T> = { options: readonly SegmentOption<T>[]; value: T; onChange: (v: T) => void; label: string; testID?: string };

export function Segmented<T extends string | number>({ options, value, onChange, label, testID }: Props<T>) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={label} testID={testID}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on }}
            accessibilityLabel={o.label}
            testID={o.testID}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [styles.seg, on && styles.on, pressed && styles.pressed]}
          >
            <Text variant="sub" tone={on ? 'accent' : 'muted'} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.xs, padding: spacing.xs, backgroundColor: colors.fill, borderRadius: radii.md },
  seg: { flex: 1, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm, paddingHorizontal: 6 },
  on: { backgroundColor: colors.segOn },
  pressed: { opacity: 0.8 },
});
