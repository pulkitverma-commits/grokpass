// Buttons. Primary is the lime accent on dark text (the web's .c-btn); secondary is the white
// Apple-style block; ghost is outlined; destructive is the danger red. Every variant is at least
// 44 pt tall and announces itself as a button.
import { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, type PressableProps, StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, radii, spacing, touchTarget } from '../theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'link';

export type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  title: string;
  variant?: ButtonVariant;
  icon?: IconName;
  /** A custom leading element (e.g. a brand mark) instead of `icon`. */
  leading?: ReactNode;
  busy?: boolean;
  small?: boolean;
  block?: boolean;
  style?: ViewStyle;
  testID?: string;
};

export function Button({ title, variant = 'primary', icon, leading, busy, small, block = true, disabled, style, accessibilityLabel, testID, ...rest }: ButtonProps) {
  const off = disabled || busy;
  const fg = variant === 'primary' ? colors.accentText : variant === 'secondary' ? colors.accentText : variant === 'destructive' ? colors.white : colors.text;
  const tone = variant === 'primary' || variant === 'secondary' ? 'inverse' : variant === 'destructive' ? 'text' : 'text';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      testID={testID}
      hitSlop={variant === 'link' ? 8 : undefined}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        small && styles.small,
        block && variant !== 'link' && styles.block,
        pressed && !off && styles.pressed,
        off && styles.disabled,
        style,
      ]}
      {...rest}
    >
      {busy ? <ActivityIndicator color={fg} /> : leading ? <View>{leading}</View> : icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <Text variant={small ? 'sub' : 'body'} tone={tone} style={[variant === 'destructive' && { color: colors.white }, variant === 'link' && styles.linkText]} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: touchTarget + 4, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  block: { alignSelf: 'stretch' },
  small: { minHeight: touchTarget, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.white },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.ghostBorder },
  destructive: { backgroundColor: colors.danger },
  link: { backgroundColor: 'transparent', paddingHorizontal: spacing.xs, minHeight: touchTarget },
  linkText: { textDecorationLine: 'underline' },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.92 },
  disabled: { opacity: 0.45 },
});
