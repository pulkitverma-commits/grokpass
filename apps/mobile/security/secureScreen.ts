// N1 per-screen hook. Android: re-asserts FLAG_SECURE for the screen's lifetime through
// expo-screen-capture (preventScreenCaptureAsync adds FLAG_SECURE, allowScreenCaptureAsync clears it
// once no key is held; see node_modules/expo-screen-capture/build/ScreenCapture.js). The config
// plugin already sets the flag in MainActivity.onCreate and the provider holds APP_SECURE_KEY for
// the app's lifetime, so the per-screen allow on unmount never reaches the native clear: the
// protection is explicit for chat and secret screens and present everywhere else by default.
// iOS: no-op beyond what the provider does (recording cover, screenshot notification).
import * as ScreenCapture from 'expo-screen-capture';
import { useEffect } from 'react';
import { Platform } from 'react-native';

export function secureScreenMount(key: string, os: string = Platform.OS): void {
  if (os !== 'android') return;
  ScreenCapture.preventScreenCaptureAsync(key).catch(() => { /* missing activity: the plugin's flag still applies */ });
}

export function secureScreenUnmount(key: string, os: string = Platform.OS): void {
  if (os !== 'android') return;
  ScreenCapture.allowScreenCaptureAsync(key).catch(() => {});
}

/** Call from every chat and secret screen with a key unique to that screen (e.g. `room:<id>`). */
export function useSecureScreen(key: string): void {
  useEffect(() => {
    secureScreenMount(key);
    return () => secureScreenUnmount(key);
  }, [key]);
}
