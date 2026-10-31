// Typography. One component so every piece of text gets the app face, the colour tokens and the
// dynamic-type cap (allowFontScaling with maxFontSizeMultiplier) without repeating them.
import { Text as RNText, type TextProps as RNTextProps, StyleSheet } from 'react-native';
import { colors, fonts, maxFontSizeMultiplier, type } from '../theme';

export type TextVariant = keyof typeof type;
export type TextTone = 'text' | 'heading' | 'muted' | 'faint' | 'accent' | 'secure' | 'danger' | 'inverse';

export type TextProps = RNTextProps & {
  variant?: TextVariant;
  tone?: TextTone;
  /** Geist Mono: codes, safety numbers, timers, section labels. */
  mono?: boolean;
  center?: boolean;
};

const toneColor: Record<TextTone, string> = {
  text: colors.text,
  heading: colors.heading,
  muted: colors.muted,
  faint: colors.faint,
  accent: colors.accent,
  secure: colors.secure,
  danger: colors.danger,
  inverse: colors.accentText,
};

export function Text({ variant = 'body', tone = 'text', mono, center, style, ...rest }: TextProps) {
  return (
    <RNText
      allowFontScaling
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      {...rest}
      style={[
        styles.base,
        type[variant],
        { color: toneColor[tone], fontFamily: mono || variant === 'label' || variant === 'mono' ? fonts.mono : fonts.ui },
        variant === 'label' && styles.label,
        center && styles.center,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: { fontFamily: fonts.ui },
  label: { textTransform: 'uppercase' },
  center: { textAlign: 'center' },
});
