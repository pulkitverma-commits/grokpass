// N3 (iOS): mark the chat database as excluded from iCloud / Finder backups.
// expo-sqlite stores databases in `SQLite.defaultDatabaseDirectory`
// (= <documentDirectory>/SQLite, see node_modules/expo-sqlite/ios/SQLiteModule.swift) and the core
// opens `DB_NAME` there (packages/core/src/adapters/rn/keystore.ts). The SQLite directory itself is
// marked (the flag on a directory covers its contents, including the -wal / -shm / -journal files
// SQLite creates later) and the database file and its side files are marked individually too.
// Android is a no-op here: plugins/withBackupRules.js excludes every domain in the manifest.
// expo-file-system v58 has no resource-attribute API, hence the local module (modules/screen-state).
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

import { excludeFromBackup } from '@/modules/screen-state';

/**
 * Mirrors `DB_NAME` in packages/core/src/adapters/rn/keystore.ts. Copied, not imported: importing
 * the core's RN entry at runtime pulls `chat/client.ts` → `ts-mls` (ESM) into jest, which the app's
 * jest config does not transform. backup.test.ts asserts the two strings are equal.
 */
export const CHAT_DB_NAME = 'onepeek-chat.db';

export const DB_SIDE_FILES = ['', '-wal', '-shm', '-journal'] as const;

/** The directory and the paths this function marks; exported for the test. */
export function chatDbPaths(dir: string | null | undefined = SQLite.defaultDatabaseDirectory): { dir: string; files: string[] } {
  const base = (dir ?? '').replace(/^file:\/\//, '').replace(/\/+$/, '');
  return { dir: base, files: DB_SIDE_FILES.map((s) => `${base}/${CHAT_DB_NAME}${s}`) };
}

/**
 * Runs after the keystore has opened (the provider calls it on mount; it is idempotent and cheap).
 * Resolves true when the directory was marked. Never throws.
 */
export async function excludeChatDbFromBackup(os: string = Platform.OS): Promise<boolean> {
  if (os !== 'ios') return false;
  const { dir, files } = chatDbPaths();
  if (!dir) return false;
  const marked = await excludeFromBackup(dir, true);
  await Promise.all(files.map((f) => excludeFromBackup(f, false)));
  return marked;
}
