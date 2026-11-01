/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
// useShareIntent: routes once per share with the exact params, asserts FLAG_SECURE first, sweeps the
// share cache on launch and on consume, and re-reads on the warm-start signals (Android onShare; iOS:
// a new share intent from expo-share-intent's hook, which is imported, reset and routed).
import { takeHandoff } from '@/lib/links';
import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { consumeShare, packageHookOptions, shareParams, SHARE_ROUTE, useShareIntent } from '@/security/shareIntent';
import { router, resetRouter } from '../../test/expo-router-mock';

const mockFs = { dirs: new Set<string>(), files: new Map<string, string>() };
const CACHE = 'file:///data/user/0/io.onepeek.app/cache';
type Pending = { text?: string; uris?: string[] } | null;
const mockNative: {
  pending: Pending;
  getPendingShare: jest.Mock<Promise<Pending>, []>;
  clearPendingShare: jest.Mock;
  listeners: Set<() => void>;
} = {
  pending: null,
  getPendingShare: jest.fn(async (): Promise<Pending> => {
    const p = mockNative.pending;
    mockNative.pending = null;
    return p;
  }),
  clearPendingShare: jest.fn(),
  listeners: new Set<() => void>(),
};
type Intent = { text: string | null; webUrl: string | null; files: { path: string }[] | null; type: string | null };
const EMPTY: Intent = { text: null, webUrl: null, files: null, type: null };
const mockPkg: {
  intent: Intent;
  options: unknown;
  resetShareIntent: jest.Mock;
  clearShareIntent: jest.Mock;
  renders: number;
} = { intent: EMPTY, options: null, resetShareIntent: jest.fn(), clearShareIntent: jest.fn(), renders: 0 };
/** What the importer "produces" for a given intent (the real one is tested in iosShare.test.ts). */
const mockImport = jest.fn(async (intent: Intent): Promise<Pending> => {
  const out: { text?: string; uris?: string[] } = {};
  if (intent.text) out.text = intent.text;
  else if (intent.webUrl) out.text = intent.webUrl;
  if (intent.files?.length)
    out.uris = intent.files.map((f, i) => `${CACHE}/share-intent/${String(i).padStart(24, '0')}.bin`);
  return out.text || out.uris ? out : null;
});
const mockSweepGroup = jest.fn();
const mockLink = { url: null as string | null };
const mockSecure = jest.fn();

jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('expo-linking', () => ({ useLinkingURL: () => mockLink.url, clearInitialURL: jest.fn() }));
jest.mock('expo-share-intent', () => ({
  getShareExtensionKey: () => 'onepeekShareKey',
  ShareIntentModule: { clearShareIntent: (key: string) => mockPkg.clearShareIntent(key) },
  useShareIntent: (options: unknown) => {
    mockPkg.options = options;
    mockPkg.renders += 1;
    const i = mockPkg.intent;
    return {
      isReady: true,
      hasShareIntent: !!(i.text || i.webUrl || i.files),
      shareIntent: i,
      resetShareIntent: mockPkg.resetShareIntent,
      error: null,
    };
  },
}));
jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
    }
    get exists() {
      return mockFs.dirs.has(this.uri);
    }
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
  addShareListener: (cb: () => void) => {
    mockNative.listeners.add(cb);
    return () => mockNative.listeners.delete(cb);
  },
  nativeAvailable: true,
}));
jest.mock('@/security/iosShare', () => ({
  SHARE_DIR: 'share-intent',
  APP_GROUP: 'group.io.onepeek.app',
  importShareIntent: (intent: Intent) => mockImport(intent),
  sweepGroupContainer: () => mockSweepGroup(),
}));
jest.mock('@/security/secureScreen', () => ({ secureScreenMount: (k: string) => mockSecure(k) }));

// Passive effects flush on a macrotask in this jest setup (see jest.config.js note on the two React copies).
const flush = async () => {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise<void>((r) => setImmediate(r));
    });
  }
};

let os: { restore(): void } | undefined;
beforeEach(() => {
  resetRouter();
  mockFs.dirs.clear();
  mockFs.files.clear();
  mockNative.pending = null;
  mockNative.getPendingShare.mockClear();
  mockNative.clearPendingShare.mockClear();
  mockNative.listeners.clear();
  mockPkg.intent = EMPTY;
  mockPkg.options = null;
  mockPkg.resetShareIntent.mockClear();
  mockPkg.clearShareIntent.mockClear();
  mockPkg.renders = 0;
  mockImport.mockClear();
  mockSweepGroup.mockClear();
  mockLink.url = null;
  mockSecure.mockClear();
  os = jest.replaceProperty(Platform, 'OS', 'android');
});
afterEach(() => {
  os?.restore();
});

describe('shareParams', () => {
  test('exact contract: text and uris only, nothing else, null when empty', () => {
    expect(shareParams(null)).toBeNull();
    expect(shareParams({})).toBeNull();
    expect(shareParams({ text: '   ' })).toBeNull();
    expect(shareParams({ uris: [] })).toBeNull();
    expect(shareParams({ text: 'hi' })).toEqual({ text: 'hi' });
    expect(shareParams({ uris: ['file:///a'] })).toEqual({ uris: ['file:///a'] });
    expect(shareParams({ text: 'hi', uris: ['file:///a', 'file:///b'] })).toEqual({
      text: 'hi',
      uris: ['file:///a', 'file:///b'],
    });
    expect(Object.keys(shareParams({ text: 'hi', uris: ['file:///a'] })!)).toEqual(['text', 'uris']);
    // `dropped` (P2-4 skipped-item count) never becomes a route param.
    expect(shareParams({ text: 'hi', dropped: 3 })).toEqual({ text: 'hi' });
    expect(shareParams({ dropped: 3 })).toBeNull();
  });
});

describe('useShareIntent (Android)', () => {
  test('cold start: sweeps leftovers first, then routes once to /share with { text, uris } and asserts FLAG_SECURE before', async () => {
    mockFs.dirs.add(`${CACHE}/share-intent`);
    mockFs.files.set(`${CACHE}/share-intent/old.jpg`, 'leftover');
    mockNative.pending = { text: 'hello', uris: [`${CACHE}/share-intent/abc.jpg`] };
    await renderHook(() => useShareIntent());
    await flush();
    expect(mockFs.files.has(`${CACHE}/share-intent/old.jpg`)).toBe(false);
    expect(mockNative.getPendingShare).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({
      pathname: SHARE_ROUTE,
      params: { text: 'hello', uris: [`${CACHE}/share-intent/abc.jpg`] },
    });
    expect(mockSecure).toHaveBeenCalledWith('share');
    expect(mockSecure.mock.invocationCallOrder[0]!).toBeLessThan(router.push.mock.invocationCallOrder[0]!);
  });

  test('the package hook is mounted but disabled on Android; its Android native module is never consulted and the container is never swept', async () => {
    await renderHook(() => useShareIntent());
    await flush();
    expect(mockPkg.renders).toBeGreaterThan(0);
    expect(mockPkg.options).toEqual({ disabled: true, resetOnBackground: false, debug: false });
    expect(packageHookOptions('ios').debug).toBe(false);
    expect(packageHookOptions('web').disabled).toBe(true);
    expect(mockSweepGroup).not.toHaveBeenCalled();
    expect(mockImport).not.toHaveBeenCalled();
  });

  test('a OnePeek secret link shared as text is parked in the hand-off and routed by id only (P2-5)', async () => {
    const link = 'https://onepeek.io/s/Ab3dEfGh2k#' + 'k'.repeat(43);
    mockNative.pending = { text: link };
    await renderHook(() => useShareIntent());
    await flush();
    expect(router.push).toHaveBeenCalledWith({ pathname: '/s/[id]', params: { id: 'Ab3dEfGh2k' } });
    expect(JSON.stringify(router.push.mock.calls)).not.toContain('#');
    expect(takeHandoff('secret')).toBe(link);
  });

  test('a OnePeek invite link shared as text goes to Join through the hand-off (P2-5)', async () => {
    const link = 'https://onepeek.io/chat/join#' + 't'.repeat(40);
    mockNative.pending = { text: link };
    await renderHook(() => useShareIntent());
    await flush();
    expect(router.push).toHaveBeenCalledWith('/chat/join');
    expect(JSON.stringify(router.push.mock.calls)).not.toContain('#');
    expect(takeHandoff('invite')).toBe(link);
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
    await act(async () => {
      for (const l of mockNative.listeners) l();
    });
    await flush();
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: SHARE_ROUTE,
      params: { uris: ['file:///x/1.png', 'file:///x/2.png'] },
    });
    await act(async () => {
      for (const l of mockNative.listeners) l();
    });
    await flush();
    expect(router.push).toHaveBeenCalledTimes(1);
    // The same content shared again is a new share and is delivered again.
    mockNative.pending = { uris: ['file:///x/1.png', 'file:///x/2.png'] };
    await act(async () => {
      for (const l of mockNative.listeners) l();
    });
    await flush();
    expect(router.push).toHaveBeenCalledTimes(2);
  });

  test('unmount removes the listener', async () => {
    const { unmount } = await renderHook(() => useShareIntent());
    await flush();
    await unmount();
    await flush();
    expect(mockNative.listeners.size).toBe(0);
  });
});

describe('useShareIntent (iOS, expo-share-intent)', () => {
  beforeEach(() => {
    os?.restore();
    os = jest.replaceProperty(Platform, 'OS', 'ios');
  });

  test('the package hook runs enabled; the Android module is never read on iOS', async () => {
    await renderHook(() => useShareIntent());
    await flush();
    expect(mockPkg.options).toEqual({ disabled: false, resetOnBackground: false, debug: false });
    expect(mockNative.getPendingShare).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  test('cold start with a share: the package state is imported (files moved), the package reset, FLAG_SECURE asserted, /share pushed once with { text, uris }', async () => {
    mockLink.url = 'onepeek://dataUrl=onepeekShareKey?nonce=1#media';
    mockPkg.intent = { text: 'from ext', webUrl: null, files: [{ path: 'file:///group/A.jpg' }], type: 'media' };
    await renderHook(() => useShareIntent());
    await flush();
    expect(mockImport).toHaveBeenCalledTimes(1);
    expect(mockImport).toHaveBeenCalledWith(mockPkg.intent);
    expect(mockPkg.resetShareIntent).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({
      pathname: SHARE_ROUTE,
      params: { text: 'from ext', uris: [`${CACHE}/share-intent/000000000000000000000000.bin`] },
    });
    expect(mockSecure).toHaveBeenCalledWith('share');
    expect(mockSecure.mock.invocationCallOrder[0]!).toBeLessThan(router.push.mock.invocationCallOrder[0]!);
    // Import (move) happens before the reset, so a reset-on-foreground re-read can never see files we have not taken.
    expect(mockImport.mock.invocationCallOrder[0]!).toBeLessThan(mockPkg.resetShareIntent.mock.invocationCallOrder[0]!);
  });

  test('launch that IS the package wake-up does not sweep the container first (the files are about to be moved); an ordinary launch does', async () => {
    mockLink.url = 'onepeek://dataUrl=onepeekShareKey?nonce=2#file';
    await renderHook(() => useShareIntent());
    await flush();
    expect(mockSweepGroup).not.toHaveBeenCalled();
    mockLink.url = null;
    await renderHook(() => useShareIntent());
    await flush();
    expect(mockSweepGroup).toHaveBeenCalledTimes(1);
    mockLink.url = 'https://onepeek.io/s/Ab3dEfGh2k#' + 'k'.repeat(43);
    await renderHook(() => useShareIntent());
    await flush();
    expect(mockSweepGroup).toHaveBeenCalledTimes(2);
  });

  test('a URL-only share arrives as text; the shared text is the full text when there is one', async () => {
    mockPkg.intent = { text: null, webUrl: 'https://example.com/a', files: null, type: 'weburl' };
    const { rerender } = await renderHook(() => useShareIntent());
    await flush();
    expect(router.push).toHaveBeenLastCalledWith({ pathname: SHARE_ROUTE, params: { text: 'https://example.com/a' } });
    mockPkg.intent = {
      text: 'look https://example.com/b',
      webUrl: 'https://example.com/b',
      files: null,
      type: 'weburl',
    };
    await act(async () => {
      rerender(undefined);
    });
    await flush();
    expect(router.push).toHaveBeenCalledTimes(2);
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: SHARE_ROUTE,
      params: { text: 'look https://example.com/b' },
    });
  });

  test('warm start: a new intent object routes again, once; re-renders with the same state object do not; an intent that imports to nothing routes nothing but is still reset', async () => {
    const { rerender } = await renderHook(() => useShareIntent());
    await flush();
    expect(router.push).not.toHaveBeenCalled();
    mockPkg.intent = { text: 'woken', webUrl: null, files: null, type: 'text' };
    await act(async () => {
      rerender(undefined);
    });
    await flush();
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenLastCalledWith({ pathname: SHARE_ROUTE, params: { text: 'woken' } });
    await act(async () => {
      rerender(undefined);
    });
    await act(async () => {
      rerender(undefined);
    });
    await flush();
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(mockImport).toHaveBeenCalledTimes(1);
    // Files the package lists but that are already gone: imported to null → no route, package still reset.
    mockImport.mockResolvedValueOnce(null);
    mockPkg.intent = { text: null, webUrl: null, files: [{ path: 'file:///group/gone.png' }], type: 'media' };
    await act(async () => {
      rerender(undefined);
    });
    await flush();
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(mockPkg.resetShareIntent).toHaveBeenCalledTimes(2);
    expect(mockSecure).toHaveBeenCalledTimes(1);
  });

  test('a secret link opening the app is not a share: nothing imported, nothing routed by this hook', async () => {
    mockLink.url = 'https://onepeek.io/s/Ab3dEfGh2k#' + 'k'.repeat(43);
    await renderHook(() => useShareIntent());
    await flush();
    expect(mockImport).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  test("consumeShare on iOS also clears the package's UserDefaults copy (clearShareIntent under the scheme key) and sweeps the group container", async () => {
    await consumeShare();
    expect(mockPkg.clearShareIntent).toHaveBeenCalledWith('onepeekShareKey');
    expect(mockSweepGroup).toHaveBeenCalledTimes(1);
  });
});

test('consumeShare clears the native pending share and deletes <cache>/share-intent/ (Android: the container sweep is iOS-only)', async () => {
  mockFs.dirs.add(`${CACHE}/share-intent`);
  mockFs.files.set(`${CACHE}/share-intent/abc.jpg`, 'plain');
  await consumeShare();
  expect(mockNative.clearPendingShare).toHaveBeenCalledTimes(1);
  expect(mockFs.dirs.has(`${CACHE}/share-intent`)).toBe(false);
  expect(mockFs.files.size).toBe(0);
  expect(mockSweepGroup).not.toHaveBeenCalled();
  expect(mockPkg.clearShareIntent).not.toHaveBeenCalled();
});
