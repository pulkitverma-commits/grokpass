import { render } from '@testing-library/react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { Text } from 'react-native';

import { secureScreenMount, secureScreenUnmount, useSecureScreen } from '@/security/secureScreen';

jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(async () => {}),
  allowScreenCaptureAsync: jest.fn(async () => {}),
}));

function Screen({ k }: { k: string }) { useSecureScreen(k); return <Text>room</Text>; }

describe('useSecureScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  test('android: prevent on mount with the screen key, allow on unmount', () => {
    secureScreenMount('room:abc', 'android');
    expect(ScreenCapture.preventScreenCaptureAsync).toHaveBeenCalledWith('room:abc');
    secureScreenUnmount('room:abc', 'android');
    expect(ScreenCapture.allowScreenCaptureAsync).toHaveBeenCalledWith('room:abc');
  });

  test('ios: no-op (the provider handles recording cover and screenshot notification)', () => {
    secureScreenMount('room:abc', 'ios');
    secureScreenUnmount('room:abc', 'ios');
    expect(ScreenCapture.preventScreenCaptureAsync).not.toHaveBeenCalled();
    expect(ScreenCapture.allowScreenCaptureAsync).not.toHaveBeenCalled();
  });

  test('the hook runs mount and unmount with the key (default platform under jest-expo is ios → no calls)', async () => {
    const r = await render(<Screen k="secret:1" />);
    r.unmount();
    expect(ScreenCapture.preventScreenCaptureAsync).not.toHaveBeenCalled();
  });
});
