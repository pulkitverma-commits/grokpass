// Files on the phone: picking (photo library, document picker), the core's FileSource adapter, and
// short-lived decrypted copies for the viewer. Decrypted bytes go to a data: URI when small enough
// and otherwise to a file in the CACHE directory (never Documents, which iCloud / Finder back up)
// that the viewer deletes on close. Nothing here logs a name, a URI or a size.
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
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
