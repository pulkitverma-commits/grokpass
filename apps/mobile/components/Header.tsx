// Screen header: back/close button plus a title, matching the "< New chat" rows in the designs.
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, touchTarget } from '../theme';
import { Icon } from './Icon';
import { Text } from './Text';

type Props = { title?: string; close?: boolean; onBack?: () => void; testID?: string; right?: React.ReactNode };

export function Header({ title, close, onBack, testID, right }: Props) {
  const router = useRouter();
  const back = onBack ?? (() => { if (router.canGoBack()) router.back(); else router.replace('/'); });
  return (
    <View style={styles.row}>
      <Pressable onPress={back} accessibilityRole="button" accessibilityLabel={close ? 'Close' : 'Back'} hitSlop={8} style={styles.btn} testID={testID ?? (close ? 'header.close' : 'header.back')}>
        <Icon name={close ? 'close' : 'chevronLeft'} size={24} color={colors.text} />
      </Pressable>
      {title ? <Text variant="h1" tone="heading" style={styles.title} accessibilityRole="header" numberOfLines={1}>{title}</Text> : <View style={styles.title} />}
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: touchTarget },
  btn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center', marginLeft: -10 },
  title: { flex: 1 },
});
