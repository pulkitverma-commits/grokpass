// Shared expo-router mock for screen tests: `jest.mock('expo-router', () => require('../../test/expo-router-mock'))`.
// Navigation is recorded on `router` so a test can assert where a screen went.
import { useEffect } from 'react';
import { Text } from 'react-native';

export const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};

export const resetRouter = () => { router.push.mockReset(); router.replace.mockReset(); router.back.mockReset(); router.canGoBack.mockReset().mockReturnValue(true); segments = []; };

export const useRouter = () => router;
export const useFocusEffect = (cb: () => void | (() => void)) => { useEffect(cb, [cb]); };
let segments: string[] = [];
/** The route segments `useSegments()` reports (layout tests). Reset to [] by resetRouter(). */
export const setSegments = (s: string[]) => { segments = s; };
export const useSegments = () => segments;
export const usePathname = () => '/';
export let localParams: Record<string, string> = {};
export const setLocalParams = (p: Record<string, string>) => { localParams = p; };
export const useLocalSearchParams = () => localParams;
export const Link = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
export const Stack = Object.assign(() => null, { Screen: () => null });
