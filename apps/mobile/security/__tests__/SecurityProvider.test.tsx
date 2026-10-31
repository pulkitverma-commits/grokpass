import { act, render } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as ScreenCapture from 'expo-screen-capture';
import { useEffect } from 'react';
import { Text } from 'react-native';

import { getChat, getLockStore } from '@/lib/chat';
import { APP_SECURE_KEY, AUTO_LOCK_MS, SECURE_RETRY_MS } from '@/security/constants';
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
  (ScreenCapture.preventScreenCaptureAsync as jest.Mock).mockResolvedValue(undefined);
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

  // W1-4: the app-wide FLAG_SECURE key is asserted on mount and on every foreground, never released.
  test('W1-4: the app key is asserted on mount and re-asserted on every active transition', async () => {
    await unlockedTree();
    const calls = () => (ScreenCapture.preventScreenCaptureAsync as jest.Mock).mock.calls.filter((c) => c[0] === APP_SECURE_KEY).length;
    expect(calls()).toBe(1);
    await appState('background');
    await appState('active');
    expect(calls()).toBe(2);
    await appState('inactive');
    await appState('active');
    expect(calls()).toBe(3);
    expect(ScreenCapture.allowScreenCaptureAsync).not.toHaveBeenCalled();
  });

  test('W1-4: an initial throw (MissingActivity) is retried once after a delay and again on active', async () => {
    (ScreenCapture.preventScreenCaptureAsync as jest.Mock).mockRejectedValueOnce(new Error('MissingActivity'));
    const appKeyCalls = () => (ScreenCapture.preventScreenCaptureAsync as jest.Mock).mock.calls.filter((c) => c[0] === APP_SECURE_KEY).length;
    const { t } = await tree();
    expect(appKeyCalls()).toBe(1);                              // the failed one
    await act(async () => { jest.advanceTimersByTime(SECURE_RETRY_MS); });
    await flush();
    expect(appKeyCalls()).toBe(2);                              // the delayed retry
    await appState('background');
    await appState('active');
    expect(appKeyCalls()).toBe(3);                              // re-asserted on foreground
    expect(ScreenCapture.allowScreenCaptureAsync).not.toHaveBeenCalled();
    expect(t.getByTestId('app.cover')).toBeTruthy();           // still locked: the throw changed nothing else
  });

  test('W1-4: a throw that persists through the retry does not loop; the next active tries again', async () => {
    (ScreenCapture.preventScreenCaptureAsync as jest.Mock)
      .mockRejectedValueOnce(new Error('MissingActivity'))
      .mockRejectedValueOnce(new Error('MissingActivity'));
    const appKeyCalls = () => (ScreenCapture.preventScreenCaptureAsync as jest.Mock).mock.calls.filter((c) => c[0] === APP_SECURE_KEY).length;
    await tree();
    await act(async () => { jest.advanceTimersByTime(SECURE_RETRY_MS * 10); });
    await flush();
    expect(appKeyCalls()).toBe(2);                              // mount + one retry, no more
    await appState('background');
    await appState('active');
    expect(appKeyCalls()).toBe(3);
  });

  // W1-7: an unlock that was awaiting the prompt when a relock happened must not unlock afterwards.
  test('W1-7: an unlock in flight across a 61 s background trip resolves true but the app stays locked; a fresh unlock works', async () => {
    let resolvePrompt: ((v: { success: boolean }) => void) | null = null;
    (LocalAuthentication.authenticateAsync as jest.Mock).mockImplementationOnce(
      () => new Promise<{ success: boolean }>((res) => { resolvePrompt = res; }),
    );
    const { t, sec } = await tree();
    let pending: Promise<boolean> | null = null;
    await act(async () => { pending = sec().unlock(); await Promise.resolve(); });
    expect(resolvePrompt).not.toBeNull();                       // the prompt is up
    await appState('background');
    jest.advanceTimersByTime(AUTO_LOCK_MS + 1_000);
    await appState('active');                                   // relock: generation bumped
    expect(sec().locked).toBe(true);
    let stale: boolean | null = null;
    await act(async () => { resolvePrompt!({ success: true }); stale = await pending!; });
    await flush();
    expect(stale).toBe(false);
    expect(sec().locked).toBe(true);
    expect(t.queryByText('SECRET CONTENT')).toBeNull();
    expect(t.getByTestId('app.cover')).toBeTruthy();
    expect(getChat().unlock).not.toHaveBeenCalled();            // the core was never touched by the stale unlock
    // A fresh unlock (new prompt) succeeds.
    let ok = false;
    await act(async () => { ok = await sec().unlock(); });
    await flush();
    expect(ok).toBe(true);
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(2);
    expect(sec().locked).toBe(false);
    expect(t.getByText('SECRET CONTENT')).toBeTruthy();
  });

  test('W1-7: lockNow during an unlock in flight makes the result stale', async () => {
    let resolvePrompt: ((v: { success: boolean }) => void) | null = null;
    (LocalAuthentication.authenticateAsync as jest.Mock).mockImplementationOnce(
      () => new Promise<{ success: boolean }>((res) => { resolvePrompt = res; }),
    );
    const { t, sec } = await tree();
    let pending: Promise<boolean> | null = null;
    await act(async () => { pending = sec().unlock(); await Promise.resolve(); });
    await act(async () => { sec().lockNow(); });
    await flush();
    let stale: boolean | null = null;
    await act(async () => { resolvePrompt!({ success: true }); stale = await pending!; });
    await flush();
    expect(stale).toBe(false);
    expect(sec().locked).toBe(true);
    expect(t.queryByText('SECRET CONTENT')).toBeNull();
  });

  test('W1-7: panic while the core unlock is in flight keeps the app locked and the flag set', async () => {
    // Set the panic flag first so unlock() reaches chat.unlock(); make that call hang.
    mockStore().__setFlag(true);
    let resolveCore: (() => void) | null = null;
    (getChat().unlock as jest.Mock).mockImplementationOnce(() => new Promise<void>((res) => { resolveCore = res; }));
    const { t, sec } = await tree();
    let pending: Promise<boolean> | null = null;
    await act(async () => { pending = sec().unlock(); await Promise.resolve(); await Promise.resolve(); });
    await flush();
    expect(resolveCore).not.toBeNull();
    await act(async () => { sec().panic(); });
    await flush();
    let stale: boolean | null = null;
    await act(async () => { resolveCore!(); stale = await pending!; });
    await flush();
    expect(stale).toBe(false);
    expect(sec().locked).toBe(true);
    expect(t.queryByText('SECRET CONTENT')).toBeNull();
    expect(getLockStore().get()).toBe(true);                    // panic's flag is still there
  });
});
