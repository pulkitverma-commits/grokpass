import { act, render } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useEffect } from 'react';
import { Text } from 'react-native';

import { getChat, getLockStore } from '@/lib/chat';
import { AUTO_LOCK_MS } from '@/security/constants';
import { LockCover } from '@/security/LockCover';
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

type MockStore = { reload: jest.Mock; __setFlag(v: boolean): void };
const mockStore = () => getLockStore() as unknown as MockStore;
const emitCaptured = (jest.requireMock('@/modules/screen-state') as { __emitCaptured(c: boolean): void }).__emitCaptured;

// AppState: capture the listener the provider registers and drive it from the test.
const RN = jest.requireActual('react-native');
let appStateListener: ((s: string) => void) | null = null;
beforeEach(() => {
  appStateListener = null;
  jest.spyOn(RN.AppState, 'addEventListener').mockImplementation(((_type: string, cb: (s: string) => void) => {
    appStateListener = cb;
    return { remove: jest.fn() };
  }) as unknown as (...args: unknown[]) => never);
  // setImmediate stays real: passive effects flush on a macrotask in this setup (two React copies in
  // the monorepo; see jest.config.js). Date and timers are faked for the auto-lock clock.
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  jest.setSystemTime(1_700_000_000_000);
  mockStore().__setFlag(false);
  jest.clearAllMocks();
  (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({ success: true });
  (LocalAuthentication.getEnrolledLevelAsync as jest.Mock).mockResolvedValue(3);
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

// Each test owns a sink; the probe reports the context from an effect (never during render), so a
// late effect from a previous test's tree cannot leak into this one. Only async act() is used: a
// sync act() call leaves passive effects unflushed for the rest of the file in this setup.
type Sink = { sec: SecurityState | null };
type Report = (s: SecurityState) => void;
function Probe({ report }: { report: Report }) {
  const s = useSecurity();
  useEffect(() => { report(s); });
  return <Text>probe</Text>;
}
/** Cover that keeps the default LockCover (testID app.cover) and exposes the context. */
function CoverProbe({ report }: { report: Report }) { return <><Probe report={report} /><LockCover /></>; }

const macro = () => new Promise<void>((r) => setImmediate(r));
const flush = async () => { await macro(); await act(async () => { await Promise.resolve(); }); await macro(); };
const appState = async (s: string) => { await act(async () => { appStateListener?.(s); await Promise.resolve(); }); await flush(); };

async function tree() {
  const sink: Sink = { sec: null };
  const report: Report = (v) => { sink.sec = v; };
  const t = await render(
    <SecurityProvider cover={<CoverProbe report={report} />}>
      <Probe report={report} />
      <Text>SECRET CONTENT</Text>
    </SecurityProvider>,
  );
  await flush();
  const sec = () => { if (!sink.sec) throw new Error('no context'); return sink.sec; };
  const unlock = async () => { let ok = false; await act(async () => { ok = await sec().unlock(); }); await flush(); return ok; };
  return { t, sec, unlock };
}

async function unlockedTree() {
  const x = await tree();
  expect(await x.unlock()).toBe(true);
  expect(x.t.getByText('SECRET CONTENT')).toBeTruthy();
  expect(x.t.queryByTestId('app.cover')).toBeNull();
  return x;
}

describe('SecurityProvider', () => {
  test('cold start is locked: children are not rendered, cover is', async () => {
    const { t, sec } = await tree();
    expect(sec().locked).toBe(true);
    expect(t.queryByText('SECRET CONTENT')).toBeNull();
    expect(t.getByTestId('app.cover')).toBeTruthy();
  });

  test('unlock success renders children and removes the cover; biometrics is reported', async () => {
    const { t, sec, unlock } = await tree();
    expect(sec().biometrics).toBe('face');
    expect(sec().deviceInsecure).toBe(false);
    expect(await unlock()).toBe(true);
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith(expect.objectContaining({ promptMessage: 'Unlock OnePeek', disableDeviceFallback: false }));
    expect(t.getByText('SECRET CONTENT')).toBeTruthy();
    expect(t.queryByTestId('app.cover')).toBeNull();
    expect(sec().locked).toBe(false);
  });

  test('unlock failure (cancel) keeps the app locked', async () => {
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({ success: false, error: 'user_cancel' });
    const { t, unlock } = await tree();
    expect(await unlock()).toBe(false);
    expect(t.queryByText('SECRET CONTENT')).toBeNull();
    expect(getChat().unlock).not.toHaveBeenCalled();
  });

  test('59 s in the background does not relock; the cover shows while inactive', async () => {
    const { t, sec } = await unlockedTree();
    await appState('background');
    expect(t.getByTestId('app.cover')).toBeTruthy();         // app-switcher cover
    expect(t.getByText('SECRET CONTENT')).toBeTruthy();      // but content stays mounted
    jest.advanceTimersByTime(59_000);
    await appState('active');
    expect(t.queryByTestId('app.cover')).toBeNull();
    expect(t.getByText('SECRET CONTENT')).toBeTruthy();
    expect(sec().locked).toBe(false);
  });

  test('61 s in the background relocks and unmounts the content', async () => {
    const { t, sec } = await unlockedTree();
    await appState('inactive');                               // the first leave starts the clock
    jest.advanceTimersByTime(30_000);
    await appState('background');                             // does not restart it
    jest.advanceTimersByTime(31_000);
    await appState('active');
    expect(sec().locked).toBe(true);
    expect(t.queryByText('SECRET CONTENT')).toBeNull();
    expect(t.getByTestId('app.cover')).toBeTruthy();
    expect(AUTO_LOCK_MS).toBe(60_000);
  });

  test('panic locks immediately, persists the flag and tells the core; unlock then clears it through the core', async () => {
    const { t, sec, unlock } = await unlockedTree();
    await act(async () => { sec().panic(); });
    await flush();
    expect(t.queryByText('SECRET CONTENT')).toBeNull();
    expect(t.getByTestId('app.cover')).toBeTruthy();
    expect(getLockStore().set).toHaveBeenCalled();
    expect(getChat().lock).toHaveBeenCalledTimes(1);
    expect(getLockStore().get()).toBe(true);                  // survives: the store holds the flag
    expect(await unlock()).toBe(true);
    expect(getChat().unlock).toHaveBeenCalledTimes(1);
    expect(getLockStore().get()).toBe(false);
    expect(t.getByText('SECRET CONTENT')).toBeTruthy();
  });

  test('on active the lock store is reloaded and a flag set elsewhere locks the app', async () => {
    const { t, sec } = await unlockedTree();
    await appState('background');
    mockStore().__setFlag(true);                              // set by another process / screen
    await appState('active');
    expect(mockStore().reload).toHaveBeenCalled();
    expect(sec().locked).toBe(true);
    expect(t.queryByText('SECRET CONTENT')).toBeNull();
  });

  test('lockNow locks without the panic flag', async () => {
    const { t, sec } = await unlockedTree();
    await act(async () => { sec().lockNow(); });
    await flush();
    expect(t.queryByText('SECRET CONTENT')).toBeNull();
    expect(getLockStore().get()).toBe(false);
  });

  test('captured (iOS recording) shows the cover without locking; independent of the app-switcher cover', async () => {
    const { t, sec } = await unlockedTree();
    await act(async () => { emitCaptured(true); });
    await flush();
    expect(sec().captured).toBe(true);
    expect(sec().locked).toBe(false);
    expect(t.getByTestId('app.cover')).toBeTruthy();
    expect(t.getByText('SECRET CONTENT')).toBeTruthy();      // covered, not unmounted
    await appState('background');
    await appState('active');                                 // the switcher logic does not clear the recording cover
    expect(t.getByTestId('app.cover')).toBeTruthy();
    await act(async () => { emitCaptured(false); });
    await flush();
    expect(t.queryByTestId('app.cover')).toBeNull();
  });

  test('insecure device: deviceInsecure is true and unlock succeeds without a prompt', async () => {
    (LocalAuthentication.getEnrolledLevelAsync as jest.Mock).mockResolvedValue(0);
    const { t, sec, unlock } = await tree();
    expect(sec().deviceInsecure).toBe(true);
    expect(sec().biometrics).toBe('none');
    (LocalAuthentication.authenticateAsync as jest.Mock).mockClear();
    expect(await unlock()).toBe(true);
    expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
    expect(t.getByText('SECRET CONTENT')).toBeTruthy();
  });
});
