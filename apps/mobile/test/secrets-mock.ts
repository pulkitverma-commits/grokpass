// Builds a fresh mock of `@/lib/secrets` for one test file, the same way chat-mock does for the chat:
//   jest.mock('@/lib/secrets', () => require('../../test/secrets-mock').secretsMock);
// The shapes follow the real `lib/secrets` (C4): in particular `verifyUnlockCode` resolves to the
// unlock token STRING, as the core does (review P2-7); `secret-viewer-unlock.test.tsx` pins the
// screen against the real module so the mock cannot drift again.
export type MockHeader = { v: 1; type: 'text' | 'file'; name?: string; mime?: string; size?: number; timer?: number; guard?: boolean; tpl?: 'wifi'; noCopy?: boolean; noSave?: boolean };
export type MockPeek = { header: MockHeader; viewsLeft: number | null; maxViews: number | null; locked: boolean; lockHint: string | null; notYet: string | null };
export type MockOpened =
  | { kind: 'text'; text: string; header: MockHeader }
  | { kind: 'wifi'; wifi: { ssid: string; password: string; security: 'WPA' | 'WEP' | 'nopass'; hidden?: boolean }; header: MockHeader }
  | { kind: 'file'; bytes: Uint8Array; name: string; mime: string; header: MockHeader };

export const SECRET_ID = 'abcdefgh12345678';
export const SECRET_KEY = 'K'.repeat(43);
export const SECRET_URL = `https://onepeek.io/s/${SECRET_ID}#${SECRET_KEY}`;

export const peek = (over: Partial<MockPeek> = {}, header: Partial<MockHeader> = {}): MockPeek => ({
  header: { v: 1, type: 'text', ...header }, viewsLeft: 1, maxViews: 1, locked: false, lockHint: null, notYet: null, ...over,
});

export const secrets = {
  isSecretLink: jest.fn((url: string) => /^(https:\/\/(www\.)?onepeek\.io|onepeek:\/)\/s\/[A-Za-z0-9_-]+#[A-Za-z0-9_+/=-]+$/.test(url)),
  createSecretLink: jest.fn(async (): Promise<{ id: string; url: string }> => ({ id: SECRET_ID, url: SECRET_URL })),
  peekSecretLink: jest.fn(async (): Promise<MockPeek> => peek()),
  openSecretLink: jest.fn(async (): Promise<MockOpened> => ({ kind: 'text', text: 'The vault code is 9182.', header: { v: 1, type: 'text' } })),
  // Lock-email flow (C4).
  requestUnlockCode: jest.fn(async (_url: string, _email: string) => {}),
  verifyUnlockCode: jest.fn(async (_url: string, _code: string): Promise<string> => 'unlock-token-for-tests'),
};

export const secretsMock = secrets;

export function resetSecretsMock() {
  for (const fn of Object.values(secrets)) fn.mockClear();
  secrets.createSecretLink.mockResolvedValue({ id: SECRET_ID, url: SECRET_URL });
  secrets.peekSecretLink.mockResolvedValue(peek());
  secrets.openSecretLink.mockResolvedValue({ kind: 'text', text: 'The vault code is 9182.', header: { v: 1, type: 'text' } });
  secrets.requestUnlockCode.mockResolvedValue(undefined);
  secrets.verifyUnlockCode.mockResolvedValue('unlock-token-for-tests');
}
