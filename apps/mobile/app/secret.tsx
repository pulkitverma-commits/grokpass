// One-time secret entry point (Phase 2, U8). A placeholder route so the Chats screen's affordance
// has somewhere honest to go.
import { StyleSheet, View } from 'react-native';
import { Header } from '../components/Header';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { spacing } from '../theme';

export default function SecretScreen() {
  return (
    <Screen header={<Header title="One-time secret" />} testID="secret.screen">
      <View style={styles.body}>
        <Text variant="sub" tone="muted" center>Sending one-time secrets from the app is coming in a later build. For now, create one at onepeek.io.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ body: { flex: 1, justifyContent: 'center', gap: spacing.md } });
