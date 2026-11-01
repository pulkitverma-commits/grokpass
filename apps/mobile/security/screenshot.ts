// N2: screenshot notification. iOS tells the app after a screenshot was taken
// (UIApplication.userDidTakeScreenshotNotification via expo-screen-capture addScreenshotListener,
// https://docs.expo.dev/versions/v58.0.0/sdk/screen-capture/). Nothing here can prevent one. On
// Android the listener also fires (Activity.ScreenCaptureCallback on 14+), but with FLAG_SECURE the
// image is black, so the alert is still sent and still truthful ("may have taken a screenshot").
import * as ScreenCapture from 'expo-screen-capture';
import { useEffect } from 'react';

import { getChat } from '@/lib/chat';

/** Non-hook subscription. Returns an unsubscribe function. */
export function onScreenshot(cb: () => void): () => void {
  const sub = ScreenCapture.addScreenshotListener(cb);
  return () => sub.remove();
}

/**
 * While mounted with a room id, a screenshot sends the encrypted screenshot alert for that room
 * through the core (never the server directly). `ttl` is the room's current timer so the alert
 * expires with the messages around it. Failures are swallowed: an alert is best effort and must
 * never surface room data in an error path.
 */
export function useScreenshotAlert(roomId: string | null, ttl: number): void {
  useEffect(() => {
    if (!roomId) return;
    return onScreenshot(() => {
      getChat().sendScreenshotAlert(roomId, ttl).catch(() => { /* best effort */ });
    });
  }, [roomId, ttl]);
}
