// JS binding of the Android share receiver: the P2-4 guard and the P3-3 / P3-6 shape. Whatever the native
// side hands over, only file:// URIs that are direct children of THIS share's <cache>/share-intent/<nonce>/
// reach the app, at most MAX_SHARE_ITEMS, at most MAX_SHARE_BYTES together, and the skipped count is
// reported (as a count: see shareIntent.test.tsx for what becomes a route param).
import { capShareBytes, filterShareUris, getPendingShare, shareCacheDir, shareDirFor } from '@/modules/share-intent';
import { MAX_SHARE_BYTES, MAX_SHARE_ITEM_BYTES, MAX_SHARE_ITEMS } from '@/security/constants';

const CACHE = 'file:///data/user/0/io.onepeek.app/cache';
const NONCE = '0123456789abcdef01234567';
const mockNative: { result: unknown; getPendingShare: jest.Mock } = { result: null, getPendingShare: jest.fn(async () => mockNative.result) };
const mockFs = { sizes: new Map<string, number>(), deleted: [] as string[] };

jest.mock('expo', () => ({
  NativeModule: class {},
  requireOptionalNativeModule: () => ({ getPendingShare: () => mockNative.getPendingShare(), clearPendingShare: jest.fn(), clearIntentData: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })) }),
}));
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///data/user/0/io.onepeek.app/cache/' } },
  File: class {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    get size() { const s = mockFs.sizes.get(this.uri); if (s === undefined) throw new Error('unreadable'); return s; }
    delete() { mockFs.deleted.push(this.uri); mockFs.sizes.delete(this.uri); }
  },
}));

const dir = `${CACHE}/share-intent/`;
const shareDir = `${dir}${NONCE}/`;
const ok = (n: string) => `${shareDir}${n}`;
const sized = (uri: string, size = 3) => { mockFs.sizes.set(uri, size); return uri; };

beforeEach(() => { mockNative.result = null; mockNative.getPendingShare.mockClear(); mockFs.sizes.clear(); mockFs.deleted.length = 0; });

test('shareCacheDir is <cache>/share-intent/ with one trailing slash; shareDirFor adds a well-formed nonce only', () => {
  expect(shareCacheDir()).toBe(dir);
  expect(shareDirFor(NONCE)).toBe(shareDir);
  for (const bad of ['', 'abc', NONCE.toUpperCase(), `${NONCE}/`, '../' + NONCE.slice(3), 'x'.repeat(24), 42, null, undefined]) expect(shareDirFor(bad)).toBeNull();
});

test('a file:// URI into our own private storage is dropped (share-intent injection), our copies are kept', () => {
  const r = filterShareUris([
    ok('0123456789abcdef01234567.jpg'),
    'file:///data/data/io.onepeek.app/databases/onepeek-chat.db',
    'file:///data/user/0/io.onepeek.app/shared_prefs/SecureStore.xml',
    'file:///data/user/0/io.onepeek.app/files/keys.bin',
    `${CACHE}/picker/x.png`, // cache, but not our share directory
    `${dir}flat.png`, // the share root itself: an older layout, not this share's directory
    `${dir}ffffffffffffffffffffffff/other.png`, // another share's directory (P3-3)
    'content://media/external/images/1', // native never returns these; refused here too
    ok('../../databases/onepeek-chat.db'),
    ok('sub/dir.bin'),
    ok(''),
    42,
  ], shareDir);
  expect(r.uris).toEqual([ok('0123456789abcdef01234567.jpg')]);
  expect(r.dropped).toBe(11);
});

test('at most MAX_SHARE_ITEMS (10): an 11-item list keeps the first ten and reports one dropped', () => {
  const list = Array.from({ length: 11 }, (_, i) => ok(`${String(i).padStart(24, '0')}.png`));
  const r = filterShareUris(list, shareDir);
  expect(MAX_SHARE_ITEMS).toBe(10);
  expect(r.uris).toEqual(list.slice(0, 10));
  expect(r.dropped).toBe(1);
});

test('P3-6: capShareBytes keeps copies while they add up to MAX_SHARE_BYTES (one attachment), deletes and counts the rest', () => {
  expect(MAX_SHARE_BYTES).toBe(MAX_SHARE_ITEM_BYTES);
  const MB = 1024 * 1024;
  const list = Array.from({ length: 10 }, (_, i) => sized(ok(`${String(i).padStart(24, '0')}.mov`), 40 * MB));
  const r = capShareBytes(list);
  expect(r.uris).toEqual([list[0]]);          // 40 MB fits; the second would make 80 MB
  expect(r.dropped).toBe(9);
  expect(mockFs.deleted).toEqual(list.slice(1)); // the over-budget copies are removed, not left for the sweep
  // Small items all fit; exactly at the cap is fine; an unreadable copy is dropped.
  mockFs.deleted.length = 0;
  const small = [sized(ok('a.png'), 10), sized(ok('b.png'), MAX_SHARE_BYTES - 10), ok('unreadable.png')];
  const r2 = capShareBytes(small);
  expect(r2.uris).toEqual(small.slice(0, 2));
  expect(r2.dropped).toBe(1);
  expect(mockFs.deleted).toEqual([ok('unreadable.png')]);
});

test('getPendingShare: files are accepted only under <cache>/share-intent/<nonce>/ for the nonce the native side names; the counts add up', async () => {
  mockNative.result = { text: 'hi', uris: [sized(ok('a.png')), 'file:///data/data/io.onepeek.app/databases/x.db'], nonce: NONCE, dropped: 2 };
  await expect(getPendingShare()).resolves.toEqual({ text: 'hi', uris: [ok('a.png')], nonce: NONCE, dropped: 3 });
  // No nonce (a regressed native side): no file is accepted, the text still is, every URI counts as dropped.
  mockNative.result = { text: 'hi', uris: [sized(ok('a.png'))] };
  await expect(getPendingShare()).resolves.toEqual({ text: 'hi', dropped: 1 });
  // A nonce that does not match the directory the URIs live in: dropped.
  mockNative.result = { uris: [sized(ok('a.png'))], nonce: 'ffffffffffffffffffffffff' };
  await expect(getPendingShare()).resolves.toBeNull();
  mockNative.result = { uris: ['file:///data/data/io.onepeek.app/databases/x.db'], nonce: NONCE };
  await expect(getPendingShare()).resolves.toBeNull();
  mockNative.result = { text: '', uris: [], nonce: NONCE };
  await expect(getPendingShare()).resolves.toBeNull();
  mockNative.result = { text: 'clean' };
  await expect(getPendingShare()).resolves.toEqual({ text: 'clean' });
});

test('P3-6: getPendingShare applies the byte total after the directory filter', async () => {
  const MB = 1024 * 1024;
  const list = [sized(ok('0.bin'), 30 * MB), sized(ok('1.bin'), 30 * MB), sized(ok('2.bin'), 5 * MB)];
  mockNative.result = { uris: list, nonce: NONCE };
  // 30 + 30 would pass 50 MB: the second is dropped; the third (5 MB) still fits after it.
  await expect(getPendingShare()).resolves.toEqual({ uris: [list[0], list[2]], nonce: NONCE, dropped: 1 });
  expect(mockFs.deleted).toEqual([list[1]]);
});
