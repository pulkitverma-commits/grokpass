// Round avatar: initials from a nickname, or a kind icon for rooms. The accent variant is the
// lime-tinted disc the designs use for Secret rooms and the selected kind.
import { StyleSheet, View } from 'react-native';
import { colors } from '../theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Props = { name?: string | null; icon?: IconName; size?: number; accent?: boolean };

export function initials(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

export function Avatar({ name, icon, size = 40, accent }: Props) {
  return (
    <View style={[styles.disc, { width: size, height: size, borderRadius: size / 2 }, accent && styles.accent]} accessible={false}>
      {icon ? <Icon name={icon} size={Math.round(size * 0.45)} color={accent ? colors.accent : colors.muted} /> : (
        <Text variant="sub" tone={accent ? 'accent' : 'muted'} style={{ fontSize: Math.round(size * 0.38) }}>{initials(name)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  disc: { backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' },
  accent: { backgroundColor: colors.accentSoft },
});
