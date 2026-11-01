// JS binding of the Android share receiver: the P2-4 guard. Whatever the native side hands over, only
// file:// URIs that are direct children of <cache>/share-intent/ reach the app, at most MAX_SHARE_ITEMS,
// and the skipped count is reported (never as a route param: see shareIntent.test.tsx).
import { filterShareUris, getPendingShare, shareCacheDir } from '@/modules/share-intent';
import { MAX_SHARE_ITEMS } from '@/security/constants';

const CACHE = 'file:///data/user/0/io.onepeek.app/cache';
const mockNative: { result: unknown; getPendingShare: jest.Mock } = { result: null, getPendingShare: jest.fn(async () => mockNative.result) };

jest.mock('expo', () => ({
  NativeModule: class {},
  requireOptionalNativeModule: () => ({ getPendingShare: () => mockNative.getPendingShare(), clearPendingShare: jest.fn(), clearIntentData: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })) }),
}));
jest.mock('expo-file-system', () => ({ Paths: { cache: { uri: 'file:///data/user/0/io.onepeek.app/cache/' } } }));

const dir = `${CACHE}/share-intent/`;
const ok = (n: string) => `${dir}${n}`;

beforeEach(() => { mockNative.result = null; mockNative.getPendingShare.mockClear(); });

test('shareCacheDir is <cache>/share-intent/ with one trailing slash', () => {
  expect(shareCacheDir()).toBe(dir);
});

test('a file:// URI into our own private storage is dropped (share-intent injection), our copies are kept', () => {
  const r = filterShareUris([
    ok('0123456789abcdef01234567.jpg'),
    'file:///data/data/io.onepeek.app/databases/onepeek-chat.db',
    'file:///data/user/0/io.onepeek.app/shared_prefs/SecureStore.xml',
    'file:///data/user/0/io.onepeek.app/files/keys.bin',
    `${CACHE}/picker/x.png`, // cache, but not our share directory
    'content://media/external/images/1', // native never returns these; refused here too
    ok('../../databases/onepeek-chat.db'),
    ok('sub/dir.bin'),
    ok(''),
    42,
  ]);
  expect(r.uris).toEqual([ok('0123456789abcdef01234567.jpg')]);
  expect(r.dropped).toBe(9);
});

test('at most MAX_SHARE_ITEMS (10): an 11-item list keeps the first ten and reports one dropped', () => {
  const list = Array.from({ length: 11 }, (_, i) => ok(`${String(i).padStart(24, '0')}.png`));
  const r = filterShareUris(list);
  expect(MAX_SHARE_ITEMS).toBe(10);
  expect(r.uris).toEqual(list.slice(0, 10));
  expect(r.dropped).toBe(1);
});

test('getPendingShare applies the filter, adds the native `dropped` count, and returns null when nothing usable is left', async () => {
  mockNative.result = { text: 'hi', uris: [ok('a.png'), 'file:///data/data/io.onepeek.app/databases/x.db'], dropped: 2 };
  await expect(getPendingShare()).resolves.toEqual({ text: 'hi', uris: [ok('a.png')], dropped: 3 });
  mockNative.result = { uris: ['file:///data/data/io.onepeek.app/databases/x.db'] };
  await expect(getPendingShare()).resolves.toBeNull();
  mockNative.result = { text: '', uris: [] };
  await expect(getPendingShare()).resolves.toBeNull();
  mockNative.result = { text: 'clean' };
  await expect(getPendingShare()).resolves.toEqual({ text: 'clean' });
});
