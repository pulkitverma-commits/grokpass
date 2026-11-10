// Page container: dark background, safe area, keyboard avoidance and an optional scroll body.
import type { PropsWithChildren, ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme';

type Props = PropsWithChildren<{
  /** Scrolls the body (forms, lists of options). Off for screens that own a FlatList. */
  scroll?: boolean;
  /** Pinned under the body, above the home indicator (primary actions). */
  footer?: ReactNode;
  /** Fixed header above the body (title row, back button). */
  header?: ReactNode;
  padded?: boolean;
  testID?: string;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
}>;

export function Screen({ children, scroll, footer, header, padded = true, testID, style, contentStyle }: Props) {
  const pad = padded ? styles.padded : undefined;
  return (
    <SafeAreaView style={[styles.root, style]} edges={['top', 'left', 'right', 'bottom']} testID={testID}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {header ? <View style={[styles.header, pad]}>{header}</View> : null}
        {scroll ? (
          <ScrollView style={styles.flex} contentContainerStyle={[pad, styles.scrollBody, contentStyle]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.flex, pad, contentStyle]}>{children}</View>
        )}
        {footer ? <View style={[styles.footer, pad]}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  padded: { paddingHorizontal: spacing.gutter },
  header: { paddingTop: spacing.sm, paddingBottom: spacing.sm },
  scrollBody: { paddingBottom: spacing.xxl },
  footer: { paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
});
