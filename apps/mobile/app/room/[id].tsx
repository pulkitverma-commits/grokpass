// Conversation placeholder so navigation compiles in wave 1. U5 (wave 2) replaces this file with
// the real screen: hold-to-read, timers, replies, files, view-once, screenshot notices, composer.
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useChat } from '../../components/ChatProvider';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { spacing } from '../../theme';
import { roomTitle } from '@/lib/format';

export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { chat, guard } = useChat();
  const [title, setTitle] = useState('Chat');
  useEffect(() => {
    let alive = true;
    guard(() => chat().myRooms()).then((rooms) => {
      const r = rooms.find((x) => x.id === id);
      if (alive && r) setTitle(roomTitle(r));
    }).catch(() => {});
    return () => { alive = false; };
  }, [id, chat, guard]);
  return (
    <Screen header={<Header title={title} />} testID="room.screen">
      <View style={styles.body}>
        <Text variant="sub" tone="muted" center>The conversation screen is coming in the next build.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ body: { flex: 1, justifyContent: 'center', gap: spacing.md } });
