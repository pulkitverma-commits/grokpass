import { Link } from 'expo-router';
import { Text, View } from 'react-native';

// Placeholder until mobile-ui lands the Welcome and Chats screens (Phase 1).
export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A0C0F', gap: 16 }}>
      <Text style={{ color: '#E6E8EB', fontSize: 20 }}>OnePeek</Text>
      {__DEV__ ? (
        <Link href="/spike" style={{ color: '#C8F135', padding: 12, minHeight: 44 }}>
          Run the Phase 0 crypto spike
        </Link>
      ) : null}
    </View>
  );
}
