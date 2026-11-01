// Default full-screen cover. The provider renders it instead of / over the app while locked, while
// the app is inactive or in the background (app switcher thumbnail), and while the screen is being
// recorded or mirrored on iOS. mobile-ui's Locked screen (U3) replaces its contents; keep this a
// plain component with no dependencies on chat state.
import { StyleSheet, Text, View } from 'react-native';

import { COVER_LABEL } from './constants';

export function LockCover({ children }: { children?: React.ReactNode }) {
  return (
    <View testID="app.cover" accessibilityRole="none" accessibilityLabel={COVER_LABEL} style={styles.cover}>
      {children ?? <Text style={styles.brand}>OnePeek</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 1000, backgroundColor: '#0A0C0F', alignItems: 'center', justifyContent: 'center' },
  brand: { color: '#FFFFFF', fontSize: 22, letterSpacing: 1 },
});
