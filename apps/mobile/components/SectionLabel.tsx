// Upper-case mono section heading (the designs' "MESSAGES DISAPPEAR AFTER").
import { StyleSheet } from 'react-native';
import { spacing } from '../theme';
import { Text } from './Text';

export function SectionLabel({ children }: { children: string }) {
  return <Text variant="label" tone="muted" style={styles.label} accessibilityRole="header">{children}</Text>;
}

const styles = StyleSheet.create({ label: { marginTop: spacing.xxl, marginBottom: spacing.sm, marginHorizontal: spacing.xs } });
