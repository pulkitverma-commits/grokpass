// Small pill (the web's .c-pill): neutral, secure (green), accent (lime count) or danger.
import { StyleSheet, View } from 'react-native';
import { colors, radii } from '../theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Props = { label: string; tone?: 'neutral' | 'secure' | 'accent' | 'danger'; icon?: IconName; testID?: string };

export function Badge({ label, tone = 'neutral', icon, testID }: Props) {
  const fg = tone === 'secure' ? colors.secure : tone === 'accent' ? colors.accentText : tone === 'danger' ? colors.danger : colors.muted;
  return (
    <View style={[styles.pill, styles[tone]]} accessible accessibilityLabel={label} testID={testID}>
      {icon ? <Icon name={icon} size={12} color={fg} /> : null}
      <Text variant="meta" style={{ color: fg, lineHeight: 16 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill, alignSelf: 'flex-start' },
  neutral: { backgroundColor: colors.fill },
  secure: { backgroundColor: colors.secureSoft },
  accent: { backgroundColor: colors.accent },
  danger: { backgroundColor: colors.dangerSoft },
});
