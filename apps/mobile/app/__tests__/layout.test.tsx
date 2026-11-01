/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
// Root layout: the AuthGate invariant (review W2-9) and the launch-time cache sweep (W2-2 / W2-3).
import { act, render, waitFor } from '@testing-library/react-native';
import RootLayout from '../_layout';
import { auth, resetChatMock } from '../../test/chat-mock';
import { resetRouter, router, setSegments } from '../../test/expo-router-mock';

type Session = { userId: string; email: string | null; isAnonymous: boolean };
const SESSION: Session = { userId: 'u-1', email: 'owner@example.test', isAnonymous: false };
const mockFiles = { clearPickerCaches: jest.fn(async () => {}) };

jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('@/lib/chat', () => require('../../test/chat-mock').chatMock);
jest.mock('@/lib/files', () => ({ clearPickerCaches: () => mockFiles.clearPickerCaches() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-gesture-handler', () => { const { View } = require('react-native'); return { GestureHandlerRootView: View }; });
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(async () => {}), hideAsync: jest.fn(async () => {}) }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-notifications', () => ({ getPermissionsAsync: async () => ({ granted: false }), getDevicePushTokenAsync: jest.fn(), addPushTokenListener: () => ({ remove() {} }) }));
jest.mock('@onepeek/core/src/rn', () => ({ installRnCrypto: jest.fn() }));
jest.mock('@/security', () => ({ SecurityProvider: ({ children }: { children: React.ReactNode }) => children, useShareIntent: () => {} }));
jest.mock('../../components/LockedScreen', () => ({ LockedScreen: () => null }));

/** The `auth.onChange` callback the layout registered, so a test can report a session change. */
let emit: ((s: Session | null) => void) | null = null;

beforeEach(() => {
  resetChatMock(); resetRouter();
  mockFiles.clearPickerCaches.mockClear();
  emit = null;
  auth.onChange.mockImplementation((cb: unknown) => { emit = cb as (s: Session | null) => void; return () => { emit = null; }; });
});

async function mount(segments: string[], session: Session | null) {
  setSegments(segments);
  auth.getSession.mockResolvedValue(session);
  await render(<RootLayout />);
  await waitFor(() => expect(auth.getSession).toHaveBeenCalled());
  await waitFor(() => expect(emit).not.toBeNull());
}

test('the gate is live: a signed-out user on a private route goes to Welcome, a signed-in one leaves sign-in', async () => {
  await mount(['settings'], null);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/welcome'));
  resetRouter();
  await act(async () => { emit!(SESSION); });
  // Still on settings: nothing to do for a signed-in user there.
  expect(router.replace).not.toHaveBeenCalled();
});

test('signed in while on sign-in → home', async () => {
  await mount(['sign-in'], null);
  expect(router.replace).not.toHaveBeenCalled();
  await act(async () => { emit!(SESSION); });
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
});

test('invariant (W2-9): on `auth` no redirect fires when a session appears, changes, or goes away', async () => {
  await mount(['auth'], null);
  expect(router.replace).not.toHaveBeenCalled();
  // completeFromUrl installs the link's session before the email check: the gate must not act on it.
  await act(async () => { emit!(SESSION); });
  await act(async () => { emit!({ ...SESSION, userId: 'u-attacker', email: 'attacker@example.test' }); });
  // ...and signs it out a moment later when it is not the address requested on this phone.
  await act(async () => { emit!(null); });
  await new Promise((r) => setTimeout(r, 0));
  expect(router.replace).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
});

test('the picker and viewer caches are swept once on launch (W2-2 / W2-3)', async () => {
  await mount(['index'], SESSION);
  await waitFor(() => expect(mockFiles.clearPickerCaches).toHaveBeenCalledTimes(1));
});
