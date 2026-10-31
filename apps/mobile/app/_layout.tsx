// Root layout. The native WebCrypto (react-native-quick-crypto) is installed before any screen or
// core module can run crypto; installRnCrypto() throws if a required primitive is missing, so a
// broken build fails at launch rather than silently falling back to JS crypto.
import { installRnCrypto } from '@onepeek/core/src/rn';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

installRnCrypto();

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0A0C0F' } }} />
    </>
  );
}
