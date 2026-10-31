// Labelled text input with helper and error text. `mono` switches to Geist Mono for access
// codes and tokens. The error is announced through accessibilityLiveRegion / the error hint.
import { useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';
import { colors, fonts, maxFontSizeMultiplier, radii, spacing, touchTarget, type } from '../theme';
import { Text } from './Text';

export type FieldProps = TextInputProps & {
  label?: string;
  helper?: string;
  error?: string;
  mono?: boolean;
  testID?: string;
};

export function Field({ label, helper, error, mono, style, testID, accessibilityLabel, onFocus, onBlur, ...rest }: FieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? <Text variant="meta" tone="muted" style={styles.label}>{label}</Text> : null}
      <TextInput
        allowFontScaling
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        placeholderTextColor={colors.faint}
        selectionColor={colors.accent}
        keyboardAppearance="dark"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={error ?? helper}
        testID={testID}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        style={[styles.input, mono && styles.mono, focused && styles.focused, !!error && styles.error, style]}
        {...rest}
      />
      {error ? (
        <Text variant="meta" tone="danger" style={styles.hint} accessibilityLiveRegion="polite">{error}</Text>
      ) : helper ? (
        <Text variant="meta" tone="muted" style={styles.hint}>{helper}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  label: { marginBottom: 6, marginHorizontal: spacing.xs },
  input: { minHeight: touchTarget + 6, fontFamily: fonts.ui, ...type.body, color: colors.text, backgroundColor: colors.fill, borderRadius: radii.md, borderWidth: 1, borderColor: 'transparent', paddingHorizontal: 14, paddingVertical: spacing.md },
  mono: { fontFamily: fonts.mono, letterSpacing: 0.5 },
  focused: { borderColor: colors.focus, backgroundColor: colors.surface },
  error: { borderColor: colors.danger },
  hint: { marginTop: 6, marginHorizontal: spacing.xs },
});
