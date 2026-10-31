// Files on the phone: picking (photo library, document picker), the core's FileSource adapter, and
// short-lived decrypted copies for the viewer. Decrypted bytes go to a data: URI when small enough
// and otherwise to a file in the CACHE directory (never Documents, which iCloud / Finder back up)
// that the viewer deletes on close. Nothing here logs a name, a URI or a size.
//
// Plaintext copies on disk (review W2-2 / W2-3): both pickers write a copy of the chosen file under
// the app's cache (ImagePicker re-encodes photos into <cache>/ImagePicker, DocumentPicker copies into
// <cache>/DocumentPicker). `deletePicked` removes that copy once a send has settled or the pick is
// dropped; `clearPickerCaches` sweeps both picker directories and the viewer's `onepeek-view` on app
// start and in "Reset chats on this phone", so a kill mid-send or mid-view leaves nothing behind
// for longer than one launch. The OS photo library still holds the original photo; that is the
// user's, not ours.
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { fileSource as coreFileSource, type RnPickedFile } from '@onepeek/core/src/rn';

/** Mirrors the core's MAX_ATTACHMENT_BYTES (the bucket's 50 MB minus encryption overhead). */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024 - 1024;

/** Inline images up to this size travel as a data: URI; larger ones go to a temp file in the cache. */
export const DATA_URI_LIMIT = 3 * 1024 * 1024;

export type Picked = RnPickedFile;

export function fileSize(n: number) {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

function picked(uri: string, name: string | null | undefined, mime: string | null | undefined, size: number | null | undefined): Picked {
  let bytes = size ?? 0;
  if (!bytes) {
    try { bytes = new File(uri).size ?? 0; } catch { bytes = 0; }
  }
  return { uri, name: name || 'file', mime: mime ?? '', size: bytes, read: () => new File(uri).bytes() };
}

/** Opens the photo library. Resolves null when the user cancels or permission is refused. */
export async function pickPhoto(): Promise<Picked | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9, exif: false, allowsMultipleSelection: false });
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  return picked(a.uri, a.fileName ?? 'photo.jpg', a.mimeType ?? 'image/jpeg', a.fileSize);
}

/** Opens the document picker. Resolves null when the user cancels. */
export async function pickDocument(): Promise<Picked | null> {
  const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  return picked(a.uri, a.name, a.mimeType, a.size);
}

/** The core's FileSource for a picked file (bytes are read lazily by sendFile). */
export function fileSource(p: Picked) {
  return coreFileSource(p);
}

/** Whether a URI points inside the app's cache directory (where both pickers put their copies). */
function inCache(uri: string): boolean {
  try {
    const root = Paths.cache.uri;
    return !!root && uri.startsWith(root.endsWith('/') ? root : `${root}/`);
  } catch { return false; }
}

/**
 * Deletes the picker's plaintext copy of a picked file. Only a file under the cache directory is
 * touched: a `content://` or other URI that a picker handed over without copying (not the case for
 * the two pickers above, but cheap to guard) belongs to another app and is left alone.
 */
export function deletePicked(p: Pick<Picked, 'uri'> | null | undefined): void {
  if (!p || !inCache(p.uri)) return;
  deleteTemp(p.uri);
}

/** Directories under the cache that may hold plaintext: the two pickers' copies and the viewer's temp files. */
const PLAINTEXT_DIRS = ['ImagePicker', 'DocumentPicker', 'onepeek-view'] as const;

let sweep: Promise<void> | null = null;

/**
 * Removes every picker copy and viewer temp file left on disk. Called on app start (root layout)
 * and from resetThisPhone(). Each directory is deleted on its own so one failure (a file held open
 * by the OS) does not stop the others; nothing is thrown and nothing is logged.
 */
export function clearPickerCaches(): Promise<void> {
  const run = (async () => {
    for (const name of PLAINTEXT_DIRS) {
      try {
        const d = new Directory(Paths.cache, name);
        if (d.exists) d.delete();
      } catch { /* best effort: the next launch tries again */ }
    }
  })();
  sweep = run;
  return run;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[n >> 18]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  if (i < bytes.length) {
    const n = (bytes[i]! << 16) | ((i + 1 < bytes.length ? bytes[i + 1]! : 0) << 8);
    out += B64[n >> 18]! + B64[(n >> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=') + '=';
  }
  return out;
}

export function dataUri(bytes: Uint8Array, mime: string) {
  return `data:${mime};base64,${base64(bytes)}`;
}

function randomName(ext: string) {
  const a = new Uint8Array(12);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('') + ext;
}

/** A decrypted copy in the cache directory under a random name (the real name never touches the file system). */
export async function writeTemp(bytes: Uint8Array, ext: string): Promise<string> {
  // Never race the launch sweep: a temp file written while onepeek-view is being removed would vanish
  // under the viewer (or survive the sweep).
  if (sweep) await sweep.catch(() => {});
  const f = new File(Paths.cache, 'onepeek-view', randomName(ext));
  if (!f.parentDirectory.exists) f.parentDirectory.create({ intermediates: true, idempotent: true });
  await f.write(bytes);
  return f.uri;
}

export function deleteTemp(uri: string) {
  try { const f = new File(uri); if (f.exists) f.delete(); } catch { /* already gone */ }
}

/** Hands a decrypted copy to the system share sheet. Only ever called after an explicit tap. */
export async function shareBytes(bytes: Uint8Array, mime: string, ext: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('sharing_unavailable');
  const uri = await writeTemp(bytes, ext);
  try { await Sharing.shareAsync(uri, { mimeType: mime, UTI: undefined }); } finally { deleteTemp(uri); }
}

export function extensionOf(name: string, mime: string) {
  const m = /\.[A-Za-z0-9]{1,8}$/.exec(name);
  if (m) return m[0].toLowerCase();
  if (mime.startsWith('image/')) return `.${mime.slice(6).replace('jpeg', 'jpg')}`;
  if (mime.startsWith('text/')) return '.txt';
  return '.bin';
}
