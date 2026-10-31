import { chatDbPaths, excludeChatDbFromBackup } from '@/security/backup';
import { excludeFromBackup } from '@/modules/screen-state';

jest.mock('expo-sqlite', () => ({ defaultDatabaseDirectory: '/var/mobile/Containers/Data/Application/X/Documents/SQLite' }));
jest.mock('@/modules/screen-state', () => ({ excludeFromBackup: jest.fn(async () => true) }));

describe('excludeChatDbFromBackup', () => {
  beforeEach(() => (excludeFromBackup as jest.Mock).mockClear());

  test('paths: expo-sqlite directory + onepeek-chat.db and its side files', () => {
    const p = chatDbPaths('file:///Documents/SQLite/');
    expect(p.dir).toBe('/Documents/SQLite');
    expect(p.files).toEqual(['/Documents/SQLite/onepeek-chat.db', '/Documents/SQLite/onepeek-chat.db-wal', '/Documents/SQLite/onepeek-chat.db-shm', '/Documents/SQLite/onepeek-chat.db-journal']);
  });

  test('ios: marks the directory and the four file paths', async () => {
    await expect(excludeChatDbFromBackup('ios')).resolves.toBe(true);
    expect(excludeFromBackup).toHaveBeenCalledWith('/var/mobile/Containers/Data/Application/X/Documents/SQLite', true);
    expect(excludeFromBackup).toHaveBeenCalledWith('/var/mobile/Containers/Data/Application/X/Documents/SQLite/onepeek-chat.db', false);
    expect(excludeFromBackup).toHaveBeenCalledTimes(5);
  });

  test('android: no-op (manifest rules do it)', async () => {
    await expect(excludeChatDbFromBackup('android')).resolves.toBe(false);
    expect(excludeFromBackup).not.toHaveBeenCalled();
  });
});
