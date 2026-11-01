// iOS App Group reader against an in-memory stand-in for expo-file-system (File / Directory / Paths),
// with the group container pre-filled the way the Share Extension writes it.
import { APP_GROUP, groupShareDir, readAppGroupShare, SHARE_DIR } from '@/security/appGroup';

type Fs = { files: Map<string, string>; dirs: Set<string>; group: string | null };
const mockFs: Fs = { files: new Map(), dirs: new Set(), group: null };
const CACHE = 'file:///var/mobile/Containers/Data/Application/APP/Library/Caches';
const GROUP = 'file:///private/var/mobile/Containers/Shared/AppGroup/GRP';

jest.mock('expo-file-system', () => {
  const join = (parts: unknown[]) => parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/').replace(/\/+/g, '/').replace(':/', ':///');
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) { this.uri = join(parts); }
    get exists() { return mockFs.dirs.has(this.uri); }
    create() { mockFs.dirs.add(this.uri); }
    delete() {
      if (!mockFs.dirs.has(this.uri)) throw new Error('no such directory');
      mockFs.dirs.delete(this.uri);
      for (const k of Array.from(mockFs.files.keys())) if (k.startsWith(`${this.uri}/`)) mockFs.files.delete(k);
    }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) { this.uri = join(parts); }
    get exists() { return mockFs.files.has(this.uri); }
    get size() { return mockFs.files.get(this.uri)?.length ?? 0; }
    async text() { const v = mockFs.files.get(this.uri); if (v === undefined) throw new Error('missing'); return v; }
    async move(dest: File) {
      const v = mockFs.files.get(this.uri);
      if (v === undefined) throw new Error('missing');
      const parent = dest.uri.slice(0, dest.uri.lastIndexOf('/'));
      if (!mockFs.dirs.has(parent)) throw new Error('no parent');
      mockFs.files.set(dest.uri, v);
      mockFs.files.delete(this.uri);
      this.uri = dest.uri;
    }
    delete() { mockFs.files.delete(this.uri); }
  }
  const Paths = {
    cache: { uri: CACHE },
    get appleSharedContainers() { return mockFs.group ? { [mockFs.group]: new Directory(GROUP) } : {}; },
  };
  return { Directory, File, Paths };
});

const groupDir = `${GROUP}/${SHARE_DIR}`;
const cacheDir = `${CACHE}/${SHARE_DIR}`;

function seed(manifest: unknown, files: Record<string, string> = {}) {
  mockFs.dirs.add(groupDir);
  if (manifest !== undefined) mockFs.files.set(`${groupDir}/pending.json`, typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  for (const [name, body] of Object.entries(files)) mockFs.files.set(`${groupDir}/${name}`, body);
}

beforeEach(() => { mockFs.files.clear(); mockFs.dirs.clear(); mockFs.group = APP_GROUP; });

test('no App Group container (no entitlement / Android / jest): null, nothing touched', async () => {
  mockFs.group = null;
  expect(groupShareDir()).toBeNull();
  await expect(readAppGroupShare()).resolves.toBeNull();
});

test('container present but nothing shared: null', async () => {
  await expect(readAppGroupShare()).resolves.toBeNull();
});

test('text + two files: text joined, files moved into <cache>/share-intent/, group dir wiped, second read is null', async () => {
  seed({ v: 1, items: [{ kind: 'text', text: 'hello' }, { kind: 'file', name: 'deadbeefdeadbeef01.jpg' }, { kind: 'file', name: 'deadbeefdeadbeef02.pdf' }] },
    { 'deadbeefdeadbeef01.jpg': 'JPG', 'deadbeefdeadbeef02.pdf': 'PDF' });
  const r = await readAppGroupShare();
  expect(r).toEqual({ text: 'hello', uris: [`${cacheDir}/deadbeefdeadbeef01.jpg`, `${cacheDir}/deadbeefdeadbeef02.pdf`] });
  expect(mockFs.files.get(`${cacheDir}/deadbeefdeadbeef01.jpg`)).toBe('JPG');
  // Nothing is left in the shared container (the extension process could read it too).
  expect(mockFs.dirs.has(groupDir)).toBe(false);
  expect(Array.from(mockFs.files.keys()).filter((k) => k.startsWith(GROUP))).toEqual([]);
  await expect(readAppGroupShare()).resolves.toBeNull();
});

test('a OnePeek link shared as text passes through unchanged as text', async () => {
  const link = 'https://onepeek.io/s/Ab3dEfGh2k#' + 'a'.repeat(43);
  seed({ v: 1, items: [{ kind: 'text', text: link }] });
  await expect(readAppGroupShare()).resolves.toEqual({ text: link });
});

test('unsafe or missing file names are skipped, the rest still delivered', async () => {
  seed({ v: 1, items: [
    { kind: 'file', name: '../../../etc/passwd' },
    { kind: 'file', name: 'Photo Name.jpg' },
    { kind: 'file', name: 'deadbeefdeadbeef03.png' },
    { kind: 'file', name: 'deadbeefdeadbeef04.png' }, // listed, not written
  ] }, { 'deadbeefdeadbeef03.png': 'PNG', '../../../etc/passwd': 'x' });
  await expect(readAppGroupShare()).resolves.toEqual({ uris: [`${cacheDir}/deadbeefdeadbeef03.png`] });
  expect(mockFs.dirs.has(groupDir)).toBe(false);
});

test.each([
  ['not json', '{nope'],
  ['wrong version', { v: 2, items: [{ kind: 'text', text: 'x' }] }],
  ['items not an array', { v: 1, items: 'x' }],
  ['too many items', { v: 1, items: Array.from({ length: 51 }, () => ({ kind: 'text', text: 'x' })) }],
  ['only unknown kinds', { v: 1, items: [{ kind: 'zip', name: 'a' }] }],
])('bad manifest (%s): null and the directory is wiped', async (_label, manifest) => {
  seed(manifest, { 'deadbeefdeadbeef05.bin': 'B' });
  await expect(readAppGroupShare()).resolves.toBeNull();
  expect(mockFs.dirs.has(groupDir)).toBe(false);
});

test('oversize manifest is dropped unread', async () => {
  seed('x'.repeat(64 * 1024 + 1));
  await expect(readAppGroupShare()).resolves.toBeNull();
  expect(mockFs.dirs.has(groupDir)).toBe(false);
});

test('files without a manifest are wiped, not delivered', async () => {
  seed(undefined, { 'deadbeefdeadbeef06.jpg': 'J' });
  await expect(readAppGroupShare()).resolves.toBeNull();
  expect(mockFs.dirs.has(groupDir)).toBe(false);
});
