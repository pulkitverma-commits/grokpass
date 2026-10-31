import { act, render } from '@testing-library/react-native';
import { useEffect } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import { Text } from 'react-native';

import { getChat, getLockStore } from '@/lib/chat';
import { AUTO_LOCK_MS } from '@/security/constants';
import { SecurityProvider, useSecurity, type SecurityState } from '@/security/SecurityProvider';

jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  getEnrolledLevelAsync: jest.fn(async () => 3),
  supportedAuthenticationTypesAsync: jest.fn(async () => [2]),
  isEnrolledAsync: jest.fn(async () => true),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));
jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(async () => {}),
  allowScreenCaptureAsync: jest.fn(async () => {}),
  addScreenshotListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('@/modules/screen-state', () => {
  let listener: ((c: boolean) => void) | null = null;
  return {
    nativeAvailable: true,
    isCaptured: jest.fn(() => false),
    addCapturedListener: jest.fn((cb: (c: boolean) => void) => { listener = cb; return () => { listener = null; }; }),
    excludeFromBackup: jest.fn(async () => true),
    __emitCaptured: (c: boolean) => listener?.(c),
  };
});
jest.mock('@/lib/chat', () => {
  let flag = false;
  const store = {
    set: jest.fn(() => { flag = true; }),
    get: jest.fn(() => flag),
    clear: jest.fn(() => { flag = false; }),
    reload: jest.fn(),
    ready: Promise.resolve(),
    pending: Promise.resolve(),
    __setFlag: (v: boolean) => { flag = v; },
  };
  const chat = {
    lock: jest.fn(() => store.set()),
    isLocked: jest.fn(() => store.get()),
    unlock: jest.fn(async () => { store.clear(); }),
    sendScreenshotAlert: jest.fn(async () => ({})),
  };
  return { getChat: () => chat, getLockStore: () => store };
});

// AppState: capture the listener the provider registers and drive it from the test.
const RN = jest.requireActual('react-native');
let appStateListener: ((s: string) => void) | null = null;
beforeEach(() => {
  appStateListener = null;
  jest.spyOn(RN.AppState, 'addEventListener').mockImplementation(((_type: string, cb: (s: string) => void) => {
    appStateListener = cb;
    return { remove: jest.fn() };
  }) as unknown as (...args: unknown[]) => never);
  // setImmediate stays real: passive effects flush on a macrotask in this setup (see screenshot.test).
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  jest.setSystemTime(1_700_000_000_000);
  (getLockStore() as unknown as { __setFlag(v: boolean): void }).__setFlag(false);
  ((getLockStore() as unknown as { reload: jest.Mock }).reload).mockClear();
  (getChat().lock as jest.Mock).mockClear();
  (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({ success: true });
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

let sec: SecurityState | null = null;
function Probe() {
  const s = useSecurity();
  useEffect(() => { sec = s; });
  return <Text>probe</Text>;
}

async function mount() {
  const r = await render(
    <SecurityProvider>
      <Probe />
      <Text>SECRET CONTENT</Text>
    </SecurityProvider>,
  );
  await flush();
  return r;
}

const flush = async () => { await new Promise<void>((r) => setImmediate(r)); await act(async () => { await Promise.resolve(); }); await new Promise<void>((r) => setImmediate(r)); };
const appState = async (s: string) => { await act(async () => { appStateListener?.(s); await Promise.resolve(); }); await flush(); };

describe('SecurityProvider', () => {
  test('cold start is locked: children are not rendered, cover is', async () => {
    const r = await mount();
    expect(r.queryByText('SECRET CONTENT')).toBeNull();
    expect(r.getByTestId('app.cover')).toBeTruthy();
  });

  test('unlock success renders children and removes the cover; biometrics is reported', async () => {
    const r = await mount();
    // Probe is a child, so it is not mounted while locked: unlock through a child-less provider.
    // Use a second tree whose cover carries the probe instead.
    await r.unmount();
    const t = await render(
      <SecurityProvider cover={<Probe />}>
        <Text>SECRET CONTENT</Text>
      </SecurityProvider>,
    );
    await flush();
    expect(sec!.locked).toBe(true);
    expect(sec!.biometrics).toBe('face');
    expect(sec!.deviceInsecure).toBe(false);
    let ok = false;
    await act(async () => { ok = await sec!.unlock(); });
    await flush();
    expect(ok).toBe(true);
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith(expect.objectContaining({ promptMessage: 'Unlock OnePeek', disableDeviceFallback: false }));
    expect(t.getByText('SECRET CONTENT')).toBeTruthy();
    expect(t.queryByTestId('app.cover')).toBeNull();
  });

  test('unlock failure (cancel) keeps the app locked', async () => {
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({ success: false, error: 'user_cancel' });
    const t = await render(<SecurityProvider cover={<Probe />}><Text>SECRET CONTENT</Text></SecurityProvider>);
    await flush();
    let ok = true;
    await act(async () => { ok = await sec!.unlock(); });
    await flush();
    expect(ok).toBe(false);
    expect(t.queryByText('SECRET CONTENT')).toBeNull();
    expect(getChat().unlock).not.toHaveBeenCalled();
  });

  async function unlockedTree() {
    const t = await render(<SecurityProvider cover={<Probe />}><Probe /><Text>SECRET CONTENT</Text></SecurityProvider>);
    await flush();
    await act(async () => { await sec!.unlock(); });
    await flush();
    expect(t.getByText('SECRET CONTENT')).toBeTruthy();
    return t;
  }

  test('59 s in the background does not relock; the cover shows while inactive', async () => {
    const t = await unlockedTree();
    await appState('background');
    expect(t.getByTestId('app.cover')).toBeTruthy();         // app-switcher cover
    expect(t.getByText('SECRET CONTENT')).toBeTruthy();      // but content stays mounted
    jest.advanceTimersByTime(59_000);
    await appState('active');
    expect(t.queryByTestId('app.cover')).toBeNull();
    expect(t.getByText('SECRET CONTENT')).toBeTruthy();
    expect(sec!.locked).toBe(false);
  });

  test('61 s in the background relocks and unmounts the content', async () => {
    const t = await unlockedTree();
    await appState('inactive');                               // the first leave starts the clock
    jest.advanceTimersByTime(30_000);
    await appState('background');                             // does not restart it
    jest.advanceTimersByTime(31_000);
    await appState('active');
    expect(sec!.locked).toBe(true);
    expect(t.queryByText('SECRET CONTENT')).toBeNull();
    expect(t.getByTestId('app.cover')).toBeTruthy();
    expect(AUTO_LOCK_MS).toBe(60_000);
  });

  test('panic locks immediately, persists the flag and tells the core; unlock then clears it through the core', async () => {
    const t = await unlockedTree();
    act(() => { sec!.panic(); });
    await flush();
    expect(t.queryByText('SECRET CONTENT')).toBeNull();
    expect(t.getByTestId('app.cover')).toBeTruthy();
    expect(getLockStore().set).toHaveBeenCalled();
    expect(getChat().lock).toHaveBeenCalledTimes(1);
    expect(getLockStore().get()).toBe(true);                  // survives: the store holds the flag
    await act(async () => { await sec!.unlock(); });
    await flush();
    expect(getChat().unlock).toHaveBeenCalledTimes(1);
    expect(getLockStore().get()).toBe(false);
    expect(t.getByText('SECRET CONTENT')).toBeTruthy();
  });

  test('on active the lock store is reloaded and a flag set elsewhere locks the app', async () => {
    const t = await unlockedTree();
    await appState('background');
    (getLockStore() as unknown as { __setFlag(v: boolean): void }).__setFlag(true);   // set by another process / screen
    await appState('active');
    expect((getLockStore() as unknown as { reload: jest.Mock }).reload).toHaveBeenCalled();
    expect(sec!.locked).toBe(true);
    expect(t.queryByText('SECRET CONTENT')).toBeNull();
  });

  test('lockNow locks without the panic flag', async () => {
    const t = await unlockedTree();
    act(() => { sec!.lockNow(); });
    await flush();
    expect(t.queryByText('SECRET CONTENT')).toBeNull();
    expect(getLockStore().get()).toBe(false);
  });

  test('captured (iOS recording) shows the cover without locking; a recording cover is independent of the app-switcher one', async () => {
    const t = await unlockedTree();
    const emit = (jest.requireMock('@/modules/screen-state') as { __emitCaptured(c: boolean): void }).__emitCaptured;
    act(() => emit(true));
    await flush();
    expect(sec!.captured).toBe(true);
    expect(t.getByTestId('app.cover')).toBeTruthy();
    expect(t.getByText('SECRET CONTENT')).toBeTruthy();      // covered, not unmounted
    await appState('background');
    await appState('active');                                 // the switcher logic does not clear the recording cover
    expect(t.getByTestId('app.cover')).toBeTruthy();
    act(() => emit(false));
    await flush();
    expect(t.queryByTestId('app.cover')).toBeNull();
  });

  test('insecure device: deviceInsecure is true and unlock succeeds without a prompt', async () => {
    (LocalAuthentication.getEnrolledLevelAsync as jest.Mock).mockResolvedValueOnce(0);
    const t = await render(<SecurityProvider cover={<Probe />}><Text>SECRET CONTENT</Text></SecurityProvider>);
    await flush();
    expect(sec!.deviceInsecure).toBe(true);
    expect(sec!.biometrics).toBe('none');
    (LocalAuthentication.authenticateAsync as jest.Mock).mockClear();
    await act(async () => { await sec!.unlock(); });
    await flush();
    expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
    expect(t.getByText('SECRET CONTENT')).toBeTruthy();
  });
});
