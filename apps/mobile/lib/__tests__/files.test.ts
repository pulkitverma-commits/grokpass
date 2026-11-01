// lib/files: the picker copies and viewer temp files on disk (reviews W2-2, W2-3), against an
// in-memory stand-in for expo-file-system's File / Directory / Paths.
import { clearPickerCaches, deletePicked, writeTemp } from '../files';

type Fs = { files: Map<string, Uint8Array>; dirs: Set<string> };
const mockFs: Fs = { files: new Map(), dirs: new Set() };
const CACHE = 'file:///data/user/0/io.onepeek/cache';

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
    list() { return Array.from(mockFs.files.keys()).filter((k) => k.startsWith(`${this.uri}/`)).map((k) => new File(k)); }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) { this.uri = join(parts); }
    get exists() { return mockFs.files.has(this.uri); }
    get size() { return mockFs.files.get(this.uri)?.length ?? 0; }
    get parentDirectory() { return new Directory(this.uri.slice(0, this.uri.lastIndexOf('/'))); }
    async write(b: Uint8Array) { mockFs.files.set(this.uri, b); }
    async bytes() { return mockFs.files.get(this.uri)!; }
    delete() { if (!mockFs.files.delete(this.uri)) throw new Error('no such file'); }
  }
  return { File, Directory, Paths: { cache: new Directory(CACHE) } };
});
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-document-picker', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('@onepeek/core/src/rn', () => ({ fileSource: (p: unknown) => p }));

function seed(dir: string, name: string) {
  const d = `${CACHE}/${dir}`;
  mockFs.dirs.add(d);
  mockFs.files.set(`${d}/${name}`, new Uint8Array([1, 2, 3]));
  return `${d}/${name}`;
}

beforeEach(() => { mockFs.files.clear(); mockFs.dirs.clear(); });

describe('deletePicked (W2-2)', () => {
  it('removes the picker copy when it lies under the cache directory', () => {
    const uri = seed('ImagePicker', 'a1b2c3.jpg');
    deletePicked({ uri });
    expect(mockFs.files.has(uri)).toBe(false);
  });

  it('leaves a URI outside the cache alone (another app owns it) and tolerates null and missing files', () => {
    const outside = 'content://com.android.providers.media.documents/document/image%3A12';
    mockFs.files.set(outside, new Uint8Array([9]));
    deletePicked({ uri: outside });
    deletePicked({ uri: 'file:///data/user/0/io.onepeek/files/keep.pdf' });
    deletePicked(null);
    deletePicked({ uri: `${CACHE}/DocumentPicker/already-gone.pdf` });
    expect(mockFs.files.has(outside)).toBe(true);
  });

  it('does not treat a sibling directory whose name starts with "cache" as the cache', () => {
    const uri = 'file:///data/user/0/io.onepeek/cache-not/x.jpg';
    mockFs.files.set(uri, new Uint8Array([1]));
    deletePicked({ uri });
    expect(mockFs.files.has(uri)).toBe(true);
  });
});

describe('clearPickerCaches (W2-2 / W2-3)', () => {
  it('removes the ImagePicker, DocumentPicker and onepeek-view directories with everything in them', async () => {
    const a = seed('ImagePicker', 'photo.jpg');
    const b = seed('DocumentPicker', 'contract.pdf');
    const c = seed('onepeek-view', 'deadbeef.png');   // a viewer temp left by a kill
    const other = seed('other-cache', 'keep.bin');
    await clearPickerCaches();
    expect(mockFs.files.has(a)).toBe(false);
    expect(mockFs.files.has(b)).toBe(false);
    expect(mockFs.files.has(c)).toBe(false);
    expect(mockFs.dirs.has(`${CACHE}/onepeek-view`)).toBe(false);
    expect(mockFs.files.has(other)).toBe(true);
  });

  it('is a no-op when nothing is there and never throws', async () => {
    await expect(clearPickerCaches()).resolves.toBeUndefined();
    expect(mockFs.dirs.size).toBe(0);
  });

  it('the viewer still writes temp files after the sweep, under onepeek-view', async () => {
    seed('onepeek-view', 'old.png');
    const sweep = clearPickerCaches();
    const uri = await writeTemp(new Uint8Array([7, 7]), '.png');
    await sweep;
    expect(uri.startsWith(`${CACHE}/onepeek-view/`)).toBe(true);
    expect(mockFs.files.get(uri)).toEqual(new Uint8Array([7, 7]));
    expect(mockFs.files.has(`${CACHE}/onepeek-view/old.png`)).toBe(false);
  });
});
