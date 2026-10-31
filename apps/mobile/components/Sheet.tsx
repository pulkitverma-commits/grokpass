// Bottom sheet: a modal that slides up over a dimmed backdrop with a grab handle. Dismissed by the
// backdrop, the hardware back button, the handle, or a drag down on the handle.
import { type PropsWithChildren, useEffect, useMemo, useState } from 'react';
import { Animated, Modal, PanResponder, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing, touchTarget } from '../theme';
import { Text } from './Text';

type Props = PropsWithChildren<{ open: boolean; onClose: () => void; title?: string; testID?: string }>;

export function Sheet({ open, onClose, title, children, testID }: Props) {
  const insets = useSafeAreaInsets();
  const [y] = useState(() => new Animated.Value(40));
  useEffect(() => {
    if (open) { y.setValue(40); Animated.spring(y, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 4 }).start(); }
  }, [open, y]);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
    onPanResponderMove: (_, g) => { if (g.dy > 0) y.setValue(g.dy); },
    onPanResponderRelease: (_, g) => { if (g.dy > 80 || g.vy > 0.8) onClose(); else Animated.spring(y, { toValue: 0, useNativeDriver: true }).start(); },
  }), [y, onClose]);
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <Animated.View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.sm, transform: [{ translateY: y }] }]} accessibilityViewIsModal testID={testID}>
          <View {...pan.panHandlers} style={styles.handleZone}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12} style={styles.handleHit}>
              <View style={styles.handle} />
            </Pressable>
          </View>
          {title ? <Text variant="h2" tone="heading" style={styles.title} accessibilityRole="header">{title}</Text> : null}
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false} contentContainerStyle={styles.body}>{children}</ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', backgroundColor: colors.surface, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 18 },
  handleZone: { alignItems: 'center', paddingTop: spacing.sm },
  handleHit: { minHeight: touchTarget / 2, minWidth: touchTarget, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 36, height: 5, borderRadius: 3, backgroundColor: colors.line },
  title: { marginTop: spacing.xs, marginBottom: 14 },
  body: { paddingBottom: spacing.sm },
});
