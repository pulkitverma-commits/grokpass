// iOS importer for expo-share-intent's share intent, against an in-memory stand-in for expo-file-system
// (File / Directory / Paths) with the App Group container pre-filled the way the package's extension
// writes it: files at the container ROOT as <UUID>.<ext>, a <base64>.jpg thumbnail per video, and the
// UserDefaults suite under Library/Preferences (a directory the sweep must leave alone).
import { APP_GROUP, GROUP_SWEEP_GRACE_MS, groupContainer, importShareIntent, releaseImport, SHARE_DIR, sweepGroupContainer } from '@/security/iosShare';
import { MAX_SHARE_BYTES, MAX_SHARE_ITEM_BYTES } from '@/security/constants';

type Fs = { files: Map<string, string>; dirs: Set<string>; group: string | null; sizes: Map<string, number>; mtimes: Map<string, number> };
const mockFs: Fs = { files: new Map(), dirs: new Set(), group: null, sizes: new Map(), mtimes: new Map() };
const CACHE = 'file:///var/mobile/Containers/Data/Application/APP/Library/Caches';
const GROUP = 'file:///private/var/mobile/Containers/Shared/AppGroup/GRP';
const mockRandom = { counter: 0 };

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => { mockRandom.counter += 1; return Uint8Array.from({ length: n }, (_, i) => (i === n - 1 ? mockRandom.counter : 0xab)); },
}));
jest.mock('expo-file-system', () => {
  const join = (parts: unknown[]) => parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/').replace(/\/+/g, '/').replace(':/', ':///');
  const parentOf = (uri: string) => uri.slice(0, uri.lastIndexOf('/'));
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
    list() {
      const out: (Directory | File)[] = [];
      for (const d of mockFs.dirs) if (parentOf(d) === this.uri) out.push(new Directory(d));
      for (const f of mockFs.files.keys()) if (parentOf(f) === this.uri) out.push(new File(f));
      return out;
    }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) { this.uri = join(parts); }
    get exists() { return mockFs.files.has(this.uri); }
    get name() { return this.uri.slice(this.uri.lastIndexOf('/') + 1); }
    get size() { return mockFs.sizes.get(this.uri) ?? mockFs.files.get(this.uri)?.length ?? 0; }
    get modificationTime() { return mockFs.mtimes.get(this.uri) ?? null; }
    async move(dest: File) {
      const v = mockFs.files.get(this.uri);
      if (v === undefined) throw new Error('missing');
      if (!mockFs.dirs.has(parentOf(dest.uri))) throw new Error('no parent');
      mockFs.files.set(dest.uri, v);
      mockFs.files.delete(this.uri);
      this.uri = dest.uri;
    }
    delete() { if (!mockFs.files.delete(this.uri)) throw new Error('missing'); }
  }
  const Paths = {
    cache: { uri: CACHE },
    get appleSharedContainers() { return mockFs.group ? { [mockFs.group]: new Directory(GROUP) } : {}; },
  };
  return { Directory, File, Paths };
});

const cacheDir = `${CACHE}/${SHARE_DIR}`;
const HEX = /^[0-9a-f]{24}$/;
const MB = 1024 * 1024;

/** The container as the extension leaves it: the UserDefaults suite directory is always there. */
function seedContainer(files: Record<string, string> = {}) {
  mockFs.dirs.add(GROUP);
  mockFs.dirs.add(`${GROUP}/Library`);
  mockFs.dirs.add(`${GROUP}/Library/Preferences`);
  mockFs.files.set(`${GROUP}/Library/Preferences/group.io.onepeek.app.plist`, 'PLIST');
  for (const [name, body] of Object.entries(files)) mockFs.files.set(`${GROUP}/${name}`, body);
}
const rootFiles = () => Array.from(mockFs.files.keys()).filter((k) => k.startsWith(`${GROUP}/`) && !k.includes('/Library/')).map((k) => k.slice(GROUP.length + 1)).sort();
const cacheFiles = () => Array.from(mockFs.files.keys()).filter((k) => k.startsWith(`${cacheDir}/`));
const shareDirs = () => Array.from(mockFs.dirs).filter((d) => d.startsWith(`${cacheDir}/`)).map((d) => d.slice(cacheDir.length + 1)).sort();
const file = (name: string, mimeType = 'application/octet-stream') => ({ path: `${GROUP}/${name}`, mimeType, fileName: `Original ${name}`, size: 3, width: null, height: null, duration: null });
/** `<nonce>/<24 hex>.<ext>` → [nonce, stem, ext] */
const parts = (u: string) => { const rel = u.slice(cacheDir.length + 1); const [nonce, rest] = rel.split('/'); const [stem, ext] = rest!.split('.'); return { nonce: nonce!, stem: stem!, ext }; };

beforeEach(() => { mockFs.files.clear(); mockFs.dirs.clear(); mockFs.sizes.clear(); mockFs.mtimes.clear(); mockFs.group = APP_GROUP; mockRandom.counter = 0; });

test('no App Group container (no entitlement / Android / jest): null container, sweep is a no-op, text still imports', async () => {
  mockFs.group = null;
  expect(groupContainer()).toBeNull();
  expect(() => sweepGroupContainer()).not.toThrow();
  await expect(importShareIntent({ text: 'hello', webUrl: null, files: null })).resolves.toEqual({ text: 'hello' });
});

test('nothing usable: null', async () => {
  seedContainer();
  await expect(importShareIntent(null)).resolves.toBeNull();
  await expect(importShareIntent({ text: null, webUrl: null, files: null })).resolves.toBeNull();
  await expect(importShareIntent({ text: '   ', webUrl: '', files: [] })).resolves.toBeNull();
});

test('text wins over webUrl (the package extracts webUrl FROM the text); a bare URL share arrives as text', async () => {
  seedContainer();
  await expect(importShareIntent({ text: 'see https://example.com/x', webUrl: 'https://example.com/x', files: null })).resolves.toEqual({ text: 'see https://example.com/x' });
  await expect(importShareIntent({ text: null, webUrl: 'https://example.com/only', files: null })).resolves.toEqual({ text: 'https://example.com/only' });
});

test('a OnePeek link shared as text passes through unchanged', async () => {
  seedContainer();
  const link = 'https://onepeek.io/s/Ab3dEfGh2k#' + 'a'.repeat(43);
  await expect(importShareIntent({ text: link, webUrl: link, files: null })).resolves.toEqual({ text: link });
});

test('files are MOVED into <cache>/share-intent/<nonce>/ under random 24-hex names with a lowercased safe extension; the nonce is returned; the thumbnail goes by name; Library/Preferences is untouched (P3-3)', async () => {
  seedContainer({
    '0B1D2F3A-1111-2222-3333-444455556666.JPG': 'JPG',
    '0B1D2F3A-1111-2222-3333-444455557777.mov': 'MOV',
    'MEIxRDJGM0EtMTExMS0yMjIyLTMzMzMtNDQ0NDU1NTU3Nzc3Lm1vdg.jpg': 'THUMB', // the package's video thumbnail (base64 of the stored name, no padding), not in `files`
    'MEIxRDJGM0EtMTExMS0yMjIyLTMzMzMtNDQ0NDU1NTU3Nzc3Lm1vdg==.jpg': 'THUMB2', // the padded spelling, in case the package pads
  });
  const r = await importShareIntent({
    text: null,
    webUrl: null,
    files: [file('0B1D2F3A-1111-2222-3333-444455556666.JPG', 'image/jpeg'), file('0B1D2F3A-1111-2222-3333-444455557777.mov', 'video/quicktime')],
  });
  expect(r?.text).toBeUndefined();
  expect(r?.uris).toHaveLength(2);
  expect(r?.nonce).toMatch(HEX);
  for (const u of r!.uris!) {
    expect(u.startsWith(`${cacheDir}/${r!.nonce}/`)).toBe(true);
    const { stem, ext } = parts(u);
    expect(stem).toMatch(HEX);
    expect(['jpg', 'mov']).toContain(ext);
    expect(u).not.toContain('0B1D2F3A'); // nothing of the original name survives
  }
  expect(cacheFiles().map((k) => mockFs.files.get(k)).sort()).toEqual(['JPG', 'MOV']);
  expect(shareDirs()).toEqual([r!.nonce]);
  expect(rootFiles()).toEqual([]);
  expect(mockFs.files.get(`${GROUP}/Library/Preferences/group.io.onepeek.app.plist`)).toBe('PLIST');
  expect(mockFs.dirs.has(`${GROUP}/Library/Preferences`)).toBe(true);
  expect(Object.keys(r!)).toEqual(['uris', 'nonce']); // no `dropped` when nothing was skipped
});

test('P3-3: two overlapping shares: an import deletes only what ITS intent listed; another share\'s files already in the container survive, and each share gets its own directory', async () => {
  seedContainer({ 'A.png': 'A', 'B1.png': 'B1', 'B2.mov': 'B2', 'QjIubW92.jpg': 'B2-THUMB' }); // B's files landed while A is being read
  const a = await importShareIntent({ text: null, webUrl: null, files: [file('A.png', 'image/png')] });
  expect(a?.uris).toHaveLength(1);
  expect(rootFiles()).toEqual(['B1.png', 'B2.mov', 'QjIubW92.jpg']);   // untouched: not A's
  const b = await importShareIntent({ text: null, webUrl: null, files: [file('B1.png', 'image/png'), file('B2.mov', 'video/quicktime')] });
  expect(b?.uris).toHaveLength(2);
  expect(b!.nonce).not.toBe(a!.nonce);
  expect(rootFiles()).toEqual([]);
  expect(shareDirs()).toEqual([a!.nonce, b!.nonce].sort());
  expect(cacheFiles().map((k) => mockFs.files.get(k)).sort()).toEqual(['A', 'B1', 'B2']);
});

test('P3-3: releaseImport (consumeShare on iOS) deletes only the container names its own share listed, once; another share being written survives', async () => {
  seedContainer({ 'A.mov': 'A' });
  const a = await importShareIntent({ text: null, webUrl: null, files: [file('A.mov', 'video/quicktime')] });
  expect(rootFiles()).toEqual([]);
  // The extension writes A's thumbnail late, and share B lands, while A's screen is up.
  seedContainer({ 'QS5tb3Y.jpg': 'A-THUMB-LATE', 'B.png': 'B', 'Qi5wbmc.jpg': 'B-THUMB' });
  releaseImport(a!.nonce);
  expect(rootFiles()).toEqual(['B.png', 'Qi5wbmc.jpg']);
  // Forgotten after the first call; an unknown or missing nonce touches nothing.
  seedContainer({ 'QS5tb3Y.jpg': 'AGAIN' });
  releaseImport(a!.nonce);
  releaseImport('ffffffffffffffffffffffff');
  releaseImport(undefined);
  expect(rootFiles()).toEqual(['B.png', 'QS5tb3Y.jpg', 'Qi5wbmc.jpg']);
  expect(cacheFiles().map((k) => mockFs.files.get(k))).toEqual(['A']);   // the cache copy is consumeShare's job (deleteShareDir)
});

test('text + file together', async () => {
  seedContainer({ 'A.pdf': 'PDF' });
  const r = await importShareIntent({ text: 'read this', webUrl: null, files: [file('A.pdf', 'application/pdf')] });
  expect(r?.text).toBe('read this');
  expect(r?.uris).toHaveLength(1);
  expect(r!.uris![0]).toMatch(/\.pdf$/);
  expect(Object.keys(r!)).toEqual(['text', 'uris', 'nonce']);
});

test('odd extensions are dropped, not sanitised into something else; non-file:// paths and missing files are skipped', async () => {
  seedContainer({ 'x.tar.gz': 'TGZ', 'noext': 'RAW', 'weird.Ph$p': 'W' });
  const r = await importShareIntent({
    text: null,
    webUrl: null,
    files: [file('x.tar.gz'), file('noext'), file('weird.Ph$p'), file('missing.png'), { ...file('y.png'), path: 'content://not/ios' }, { ...file('z.png'), path: '/var/mobile/Media/DCIM/z.png' }],
  });
  expect(r?.uris).toHaveLength(3);
  const names = r!.uris!.map((u) => parts(u));
  expect(names.find((n) => n.ext === 'gz')).toBeDefined();
  expect(names.filter((n) => n.ext === undefined)).toHaveLength(2); // 'noext' and 'weird.Ph$p' land with no extension
  expect(rootFiles()).toEqual([]);
});

test('at most MAX_SHARE_ITEMS (10) files are taken, `dropped` counts the rest; the listed extras are still deleted from the container by name', async () => {
  const seeded: Record<string, string> = {};
  for (let i = 0; i < 12; i++) seeded[`f${i}.png`] = `P${i}`;
  seeded['unrelated.png'] = 'OTHER';   // not listed by this intent: another share's, left alone
  seedContainer(seeded);
  const r = await importShareIntent({ text: null, webUrl: null, files: Object.keys(seeded).filter((n) => n !== 'unrelated.png').map((n) => file(n, 'image/png')) });
  expect(r?.uris).toHaveLength(10);
  expect(r?.dropped).toBe(2);
  expect(rootFiles()).toEqual(['unrelated.png']);
  expect(cacheFiles()).toHaveLength(10);
});

test('an item over MAX_SHARE_ITEM_BYTES is skipped (never copied), counted in `dropped`, deleted by name; the others go through (P2-4)', async () => {
  seedContainer({ 'big.mov': 'BIG', 'small.png': 'PNG' });
  mockFs.sizes.set(`${GROUP}/big.mov`, 50 * MB);
  const r = await importShareIntent({ text: null, webUrl: null, files: [file('big.mov', 'video/quicktime'), file('small.png', 'image/png')] });
  expect(r?.uris).toHaveLength(1);
  expect(r!.uris![0]).toMatch(/\.png$/);
  expect(r?.dropped).toBe(1);
  expect(cacheFiles().map((k) => mockFs.files.get(k))).toEqual(['PNG']);
  expect(rootFiles()).toEqual([]);
  // Exactly at the cap is accepted.
  seedContainer({ 'edge.pdf': 'E' });
  mockFs.sizes.set(`${GROUP}/edge.pdf`, MAX_SHARE_ITEM_BYTES);
  const r2 = await importShareIntent({ text: null, webUrl: null, files: [file('edge.pdf', 'application/pdf')] });
  expect(r2?.uris).toHaveLength(1);
  expect(r2?.dropped).toBeUndefined();
});

test('P3-6: the share as a whole is capped at MAX_SHARE_BYTES (one attachment): 10 × 40 MB yields one copy, 9 dropped, all deleted from the container', async () => {
  expect(MAX_SHARE_BYTES).toBe(MAX_SHARE_ITEM_BYTES);
  const seeded: Record<string, string> = {};
  for (let i = 0; i < 10; i++) seeded[`v${i}.mov`] = `V${i}`;
  seedContainer(seeded);
  for (const n of Object.keys(seeded)) mockFs.sizes.set(`${GROUP}/${n}`, 40 * MB);
  const r = await importShareIntent({ text: null, webUrl: null, files: Object.keys(seeded).map((n) => file(n, 'video/quicktime')) });
  expect(r?.uris).toHaveLength(1);
  expect(r?.dropped).toBe(9);
  expect(cacheFiles().map((k) => mockFs.files.get(k))).toEqual(['V0']);
  expect(rootFiles()).toEqual([]);
  // A small item after a large one still fits in what is left of the budget.
  seedContainer({ 'big.mov': 'B', 'tiny.png': 'T', 'big2.mov': 'B2' });
  mockFs.sizes.set(`${GROUP}/big.mov`, 40 * MB);
  mockFs.sizes.set(`${GROUP}/tiny.png`, 5 * MB);
  mockFs.sizes.set(`${GROUP}/big2.mov`, 40 * MB);
  const r2 = await importShareIntent({ text: null, webUrl: null, files: [file('big.mov'), file('tiny.png'), file('big2.mov')] });
  expect(r2?.uris).toHaveLength(2);
  expect(r2?.dropped).toBe(1);
});

test('a second import of the same intent finds nothing (files already moved) and leaves the cache copies alone', async () => {
  seedContainer({ 'A.png': 'PNG' });
  const intent = { text: null, webUrl: null, files: [file('A.png', 'image/png')] };
  const first = await importShareIntent(intent);
  expect(first?.uris).toHaveLength(1);
  await expect(importShareIntent(intent)).resolves.toBeNull();
  expect(cacheFiles()).toHaveLength(1);
});

test('sweepGroupContainer alone: regular files at the root go, directories stay', () => {
  seedContainer({ 'leftover.jpg': 'L' });
  sweepGroupContainer();
  expect(rootFiles()).toEqual([]);
  expect(mockFs.dirs.has(`${GROUP}/Library/Preferences`)).toBe(true);
  expect(mockFs.files.has(`${GROUP}/Library/Preferences/group.io.onepeek.app.plist`)).toBe(true);
});

test('P3-3: the container sweep skips files modified in the last 10 s (a share the extension is writing now); older ones and ones with no known time go', () => {
  const now = 1_700_000_000_000;
  seedContainer({ 'fresh.mov': 'F', 'edge.png': 'E', 'old.png': 'O', 'unknown.png': 'U' });
  mockFs.mtimes.set(`${GROUP}/fresh.mov`, now - 1_000);
  mockFs.mtimes.set(`${GROUP}/edge.png`, now - GROUP_SWEEP_GRACE_MS);   // exactly at the edge: old enough
  mockFs.mtimes.set(`${GROUP}/old.png`, now - 60_000);
  expect(GROUP_SWEEP_GRACE_MS).toBe(10_000);
  sweepGroupContainer(APP_GROUP, now);
  expect(rootFiles()).toEqual(['fresh.mov']);
  // Ten seconds later the same file is a leftover and goes.
  sweepGroupContainer(APP_GROUP, now + GROUP_SWEEP_GRACE_MS);
  expect(rootFiles()).toEqual([]);
});
