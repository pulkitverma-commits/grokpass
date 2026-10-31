// N1 per-screen hook. Android: asserts FLAG_SECURE when a chat or secret screen mounts, through
// expo-screen-capture's preventScreenCaptureAsync. There is deliberately NO matching "allow" on
// unmount (W1-4): the app never wants FLAG_SECURE off. expo-screen-capture keeps a set of keys and
// calls the native clear (window.clearFlags(FLAG_SECURE)) as soon as the set is empty, and it drops a
// key from that set when the native prevent call throws (MissingActivity on a cold start before the
// activity is attached). So "provider holds an app key, screens release theirs" is not safe: one
// failed app-key call plus one room unmount would clear the flag the config plugin set in
// MainActivity.onCreate for the rest of the process. The flag is app-wide by design (plugin +
// provider re-assert on every foreground); this hook only re-asserts it, it never releases anything.
// iOS: no-op beyond what the provider does (recording cover, screenshot notification).
import * as ScreenCapture from 'expo-screen-capture';
import { useEffect } from 'react';
import { Platform } from 'react-native';

export function secureScreenMount(key: string, os: string = Platform.OS): void {
  if (os !== 'android') return;
  ScreenCapture.preventScreenCaptureAsync(key).catch(() => { /* missing activity: the plugin's flag still applies */ });
}

/** Call from every chat and secret screen with a key unique to that screen (e.g. `room:<id>`). */
export function useSecureScreen(key: string): void {
  useEffect(() => {
    secureScreenMount(key);
    // Unmount is a no-op on purpose: see the header comment.
  }, [key]);
}
