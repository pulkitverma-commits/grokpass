/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
// useShareIntent: routes once per share with the exact params, asserts FLAG_SECURE first, sweeps the
// share cache on launch and on consume, and re-reads on the warm-start signals (Android onShare,
// iOS AppState active / onepeek://share).
import { act, renderHook } from '@testing-library/react-native';
import { AppState, Platform } from 'react-native';
import { consumeShare, shareParams, SHARE_ROUTE, useShareIntent } from '@/security/shareIntent';
import { router, resetRouter } from '../../test/expo-router-mock';

const mockFs = { dirs: new Set<string>(), files: new Map<string, string>() };
const CACHE = 'file:///data/user/0/io.onepeek.app/cache';
type Pending = { text?: string; uris?: string[] } | null;
const mockNative: { pending: Pending; getPendingShare: jest.Mock<Promise<Pending>, []>; clearPendingShare: jest.Mock; listeners: Set<() => void> } = {
  pending: null,
  getPendingShare: jest.fn(async (): Promise<Pending> => { const p = mockNative.pending; mockNative.pending = null; return p; }),
  clearPendingShare: jest.fn(),
  listeners: new Set<() => void>(),
};
const mockGroup = { pending: null as { text?: string; uris?: string[] } | null };
const mockLink = { url: null as string | null };
const mockSecure = jest.fn();

jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('expo-linking', () => ({ useLinkingURL: () => mockLink.url, clearInitialURL: jest.fn() }));
jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) { this.uri = parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/'); }
    get exists() { return mockFs.dirs.has(this.uri); }
    delete() {
      mockFs.dirs.delete(this.uri);
      for (const k of Array.from(mockFs.files.keys())) if (k.startsWith(`${this.uri}/`)) mockFs.files.delete(k);
    }
  }
  return { Directory, File: class {}, Paths: { cache: { uri: CACHE } } };
});
jest.mock('@/modules/share-intent', () => ({
  getPendingShare: () => mockNative.getPendingShare(),
  clearPendingShare: () => mockNative.clearPendingShare(),
  clearIntentData: jest.fn(),
  addShareListener: (cb: () => void) => { mockNative.listeners.add(cb); return () => mockNative.listeners.delete(cb); },
  nativeAvailable: true,
}));
jest.mock('@/security/appGroup', () => ({
  SHARE_DIR: 'share-intent',
  APP_GROUP: 'group.io.onepeek.app',
  readAppGroupShare: jest.fn(async () => { const p = mockGroup.pending; mockGroup.pending = null; return p; }),
}));
jest.mock('@/security/secureScreen', () => ({ secureScreenMount: (k: string) => mockSecure(k) }));

// Passive effects flush on a macrotask in this jest setup (see jest.config.js note on the two React copies).
const flush = async () => {
  for (let i = 0; i < 3; i++) {
    await act(async () => { await new Promise<void>((r) => setImmediate(r)); });
  }
};
const appStateListeners: ((s: string) => void)[] = [];

beforeEach(() => {
  resetRouter();
  mockFs.dirs.clear(); mockFs.files.clear();
  mockNative.pending = null; mockNative.getPendingShare.mockClear(); mockNative.clearPendingShare.mockClear(); mockNative.listeners.clear();
  mockGroup.pending = null; mockLink.url = null; mockSecure.mockClear();
  appStateListeners.length = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, cb) => { appStateListeners.push(cb as (s: string) => void); return { remove: () => {} }; });
  os = jest.replaceProperty(Platform, 'OS', 'android');
});
afterEach(() => { os?.restore(); });
let os: { restore(): void } | undefined;

describe('shareParams', () => {
  test('exact contract: text and uris only, nothing else, null when empty', () => {
    expect(shareParams(null)).toBeNull();
    expect(shareParams({})).toBeNull();
    expect(shareParams({ text: '   ' })).toBeNull();
    expect(shareParams({ uris: [] })).toBeNull();
    expect(shareParams({ text: 'hi' })).toEqual({ text: 'hi' });
    expect(shareParams({ uris: ['file:///a'] })).toEqual({ uris: ['file:///a'] });
    expect(shareParams({ text: 'hi', uris: ['file:///a', 'file:///b'] })).toEqual({ text: 'hi', uris: ['file:///a', 'file:///b'] });
    expect(Object.keys(shareParams({ text: 'hi', uris: ['file:///a'] })!)).toEqual(['text', 'uris']);
  });
});

describe('useShareIntent (Android)', () => {
  test('cold start: sweeps leftovers first, then routes once to /share with { text, uris } and asserts FLAG_SECURE before', async () => {
    mockFs.dirs.add(`${CACHE}/share-intent`); mockFs.files.set(`${CACHE}/share-intent/old.jpg`, 'leftover');
    mockNative.pending = { text: 'hello', uris: [`${CACHE}/share-intent/abc.jpg`] };
    await renderHook(() => useShareIntent());
    await flush();
    expect(mockFs.files.has(`${CACHE}/share-intent/old.jpg`)).toBe(false);
    expect(mockNative.getPendingShare).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({ pathname: SHARE_ROUTE, params: { text: 'hello', uris: [`${CACHE}/share-intent/abc.jpg`] } });
    expect(mockSecure).toHaveBeenCalledWith('share');
    expect(mockSecure.mock.invocationCallOrder[0]!).toBeLessThan(router.push.mock.invocationCallOrder[0]!);
  });

  test('a OnePeek link shared as text goes through as text (mobile-ui dispatches it)', async () => {
    const link = 'https://onepeek.io/s/Ab3dEfGh2k#' + 'k'.repeat(43);
    mockNative.pending = { text: link };
    await renderHook(() => useShareIntent());
    await flush();
    expect(router.push).toHaveBeenCalledWith({ pathname: SHARE_ROUTE, params: { text: link } });
  });

  test('nothing pending: no route, no FLAG_SECURE call', async () => {
    await renderHook(() => useShareIntent());
    await flush();
    expect(router.push).not.toHaveBeenCalled();
    expect(mockSecure).not.toHaveBeenCalled();
  });

  test('warm start: the onShare signal reads and routes again, once per signal; an empty signal routes nothing', async () => {
    await renderHook(() => useShareIntent());
    await flush();
    expect(mockNative.listeners.size).toBe(1);
    mockNative.pending = { uris: ['file:///x/1.png', 'file:///x/2.png'] };
    await act(async () => { for (const l of mockNative.listeners) l(); });
    await flush();
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenLastCalledWith({ pathname: SHARE_ROUTE, params: { uris: ['file:///x/1.png', 'file:///x/2.png'] } });
    await act(async () => { for (const l of mockNative.listeners) l(); });
    await flush();
    expect(router.push).toHaveBeenCalledTimes(1);
    // The same content shared again is a new share and is delivered again.
    mockNative.pending = { uris: ['file:///x/1.png', 'file:///x/2.png'] };
    await act(async () => { for (const l of mockNative.listeners) l(); });
    await flush();
    expect(router.push).toHaveBeenCalledTimes(2);
  });

  test('Android ignores AppState active (no container to poll); iOS wake URL is ignored on Android too', async () => {
    await renderHook(() => useShareIntent());
    await flush();
    mockNative.pending = { text: 'late' };
    await act(async () => { for (const l of appStateListeners) l('active'); });
    await flush();
    expect(router.push).not.toHaveBeenCalled();
  });

  test('unmount removes the listeners', async () => {
    const { unmount } = await renderHook(() => useShareIntent());
    await flush();
    await unmount();
    await flush();
    expect(mockNative.listeners.size).toBe(0);
  });
});

describe('useShareIntent (iOS)', () => {
  beforeEach(() => { os?.restore(); os = jest.replaceProperty(Platform, 'OS', 'ios'); });

  test('cold start reads the App Group container and routes once', async () => {
    mockGroup.pending = { text: 'from ext', uris: [`${CACHE}/share-intent/aa.jpg`] };
    await renderHook(() => useShareIntent());
    await flush();
    expect(mockNative.getPendingShare).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({ pathname: SHARE_ROUTE, params: { text: 'from ext', uris: [`${CACHE}/share-intent/aa.jpg`] } });
  });

  test('onepeek://share arriving later re-reads the container; foreground (active) too; nothing new → no route', async () => {
    const { rerender } = await renderHook(() => useShareIntent());
    await flush();
    expect(router.push).not.toHaveBeenCalled();
    mockGroup.pending = { text: 'woken' };
    mockLink.url = 'onepeek://share';
    await act(async () => { rerender(undefined); });
    await flush();
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenLastCalledWith({ pathname: SHARE_ROUTE, params: { text: 'woken' } });
    await act(async () => { for (const l of appStateListeners) l('active'); });
    await flush();
    expect(router.push).toHaveBeenCalledTimes(1);
    mockGroup.pending = { uris: ['file:///c/share-intent/bb.pdf'] };
    await act(async () => { for (const l of appStateListeners) l('active'); });
    await flush();
    expect(router.push).toHaveBeenCalledTimes(2);
  });

  test('a secret link is not a wake URL: it does not trigger a container read', async () => {
    await renderHook(() => useShareIntent());
    await flush();
    const { readAppGroupShare } = jest.requireMock('@/security/appGroup') as { readAppGroupShare: jest.Mock };
    const before = readAppGroupShare.mock.calls.length;
    mockLink.url = 'https://onepeek.io/s/Ab3dEfGh2k#' + 'k'.repeat(43);
    await flush();
    expect(readAppGroupShare.mock.calls.length).toBe(before);
  });
});

test('consumeShare clears the native pending share and deletes <cache>/share-intent/', async () => {
  mockFs.dirs.add(`${CACHE}/share-intent`); mockFs.files.set(`${CACHE}/share-intent/abc.jpg`, 'plain');
  await consumeShare();
  expect(mockNative.clearPendingShare).toHaveBeenCalledTimes(1);
  expect(mockFs.dirs.has(`${CACHE}/share-intent`)).toBe(false);
  expect(mockFs.files.size).toBe(0);
});
