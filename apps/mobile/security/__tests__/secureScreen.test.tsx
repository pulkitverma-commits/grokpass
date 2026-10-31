import { render } from '@testing-library/react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { Platform, Text } from 'react-native';

import { secureScreenMount, useSecureScreen } from '@/security/secureScreen';

jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(async () => {}),
  allowScreenCaptureAsync: jest.fn(async () => {}),
}));

function Screen({ k }: { k: string }) { useSecureScreen(k); return <Text>room</Text>; }

describe('useSecureScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  test('android: prevent on mount with the screen key', () => {
    secureScreenMount('room:abc', 'android');
    expect(ScreenCapture.preventScreenCaptureAsync).toHaveBeenCalledWith('room:abc');
    expect(ScreenCapture.allowScreenCaptureAsync).not.toHaveBeenCalled();
  });

  test('ios: no-op (the provider handles recording cover and screenshot notification)', () => {
    secureScreenMount('room:abc', 'ios');
    expect(ScreenCapture.preventScreenCaptureAsync).not.toHaveBeenCalled();
    expect(ScreenCapture.allowScreenCaptureAsync).not.toHaveBeenCalled();
  });

  test('W1-4: unmounting a secure screen never calls allowScreenCaptureAsync (android)', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      const r = await render(<Screen k="room:1" />);
      expect(ScreenCapture.preventScreenCaptureAsync).toHaveBeenCalledWith('room:1');
      r.unmount();
      expect(ScreenCapture.allowScreenCaptureAsync).not.toHaveBeenCalled();
    } finally {
      os.restore();
    }
  });

  test('W1-4: a rejected prevent call is swallowed and still never followed by an allow', async () => {
    (ScreenCapture.preventScreenCaptureAsync as jest.Mock).mockRejectedValueOnce(new Error('MissingActivity'));
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      const r = await render(<Screen k="room:2" />);
      await new Promise<void>((res) => setImmediate(() => res()));
      r.unmount();
      expect(ScreenCapture.allowScreenCaptureAsync).not.toHaveBeenCalled();
    } finally {
      os.restore();
    }
  });

  test('the hook runs mount with the key (default platform under jest-expo is ios → no calls)', async () => {
    const r = await render(<Screen k="secret:1" />);
    r.unmount();
    expect(ScreenCapture.preventScreenCaptureAsync).not.toHaveBeenCalled();
    expect(ScreenCapture.allowScreenCaptureAsync).not.toHaveBeenCalled();
  });
});
