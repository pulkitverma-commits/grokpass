// JS binding for the local native module (modules/screen-state/{ios,android}). Loaded with
// `requireOptionalNativeModule` so Expo Go, jest and the web bundle (where the module does not
// exist) get a stub that reports "not captured" and "nothing excluded" instead of crashing; the
// provider surfaces that through `nativeAvailable` so a dev build without the module is visible.
import { NativeModule, requireOptionalNativeModule } from 'expo';

export type ScreenStateEvents = {
  onCapturedChange: (payload: { captured: boolean }) => void;
};

declare class ScreenStateNative extends NativeModule<ScreenStateEvents> {
  isCaptured(): boolean;
  excludeFromBackup(path: string, isDirectory: boolean): Promise<boolean>;
}

const native = requireOptionalNativeModule<ScreenStateNative>('ScreenState');

export const nativeAvailable = native !== null;

export function isCaptured(): boolean {
  try {
    return native ? native.isCaptured() : false;
  } catch {
    return false;
  }
}

/** Subscribes to capture-state changes. Returns an unsubscribe function. No-op without the native module. */
export function addCapturedListener(cb: (captured: boolean) => void): () => void {
  if (!native) return () => {};
  const sub = native.addListener('onCapturedChange', (e) => cb(!!e.captured));
  return () => sub.remove();
}

/** Marks a file or directory as excluded from backups (iOS). Resolves false when nothing was marked. */
export async function excludeFromBackup(path: string, isDirectory: boolean): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.excludeFromBackup(path, isDirectory);
  } catch {
    return false;
  }
}
