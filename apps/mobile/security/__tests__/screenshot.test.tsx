import { act, render } from '@testing-library/react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { Text } from 'react-native';

import { getChat } from '@/lib/chat';
import { onScreenshot, useScreenshotAlert } from '@/security/screenshot';

const mockShot: { fire: (() => void) | null } = { fire: null };
jest.mock('expo-screen-capture', () => ({
  addScreenshotListener: jest.fn((cb: () => void) => { mockShot.fire = cb; return { remove: () => { mockShot.fire = null; } }; }),
}));
jest.mock('@/lib/chat', () => {
  const chat = { sendScreenshotAlert: jest.fn(async () => ({})) };
  return { getChat: () => chat };
});

// Passive effects in this jest setup flush on a macrotask, not inside act (see jest.config.js note on
// the two React copies), so every mount / unmount is followed by one macrotask tick.
const flushEffects = () => new Promise<void>((r) => setImmediate(r));

function Room({ roomId, ttl }: { roomId: string | null; ttl: number }) { useScreenshotAlert(roomId, ttl); return <Text>room</Text>; }

describe('useScreenshotAlert', () => {
  beforeEach(() => { jest.clearAllMocks(); mockShot.fire = null; });

  test('a screenshot while a room is open sends exactly one alert with the room id and ttl, through the core', async () => {
    const r = await render(<Room roomId="room-1" ttl={30} />);
    await flushEffects();
    await act(async () => { mockShot.fire?.(); });
    expect(getChat().sendScreenshotAlert).toHaveBeenCalledTimes(1);
    expect(getChat().sendScreenshotAlert).toHaveBeenCalledWith('room-1', 30);
    await r.unmount();
    await flushEffects();
    expect(mockShot.fire).toBeNull();                                  // unsubscribed
  });

  test('no room → nothing is subscribed or sent', async () => {
    await render(<Room roomId={null} ttl={30} />);
    await flushEffects();
    expect(ScreenCapture.addScreenshotListener).not.toHaveBeenCalled();
    expect(mockShot.fire).toBeNull();
    expect(getChat().sendScreenshotAlert).not.toHaveBeenCalled();
  });

  test('a failed send is swallowed', async () => {
    (getChat().sendScreenshotAlert as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    await render(<Room roomId="room-1" ttl={30} />);
    await flushEffects();
    await act(async () => { mockShot.fire?.(); await Promise.resolve(); });
    expect(getChat().sendScreenshotAlert).toHaveBeenCalledTimes(1);
  });

  test('onScreenshot returns an unsubscribe', () => {
    const off = onScreenshot(() => {});
    expect(mockShot.fire).not.toBeNull();
    off();
    expect(mockShot.fire).toBeNull();
  });
});
