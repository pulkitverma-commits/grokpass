// Builds a fresh mock of `@/lib/chat` for one test file:
//   jest.mock('@/lib/chat', () => require('../../test/chat-mock').chatMock);
// Every function is a jest.fn() so each test sets the behaviour it needs. Nothing here talks to a
// network, a keystore or Supabase.
export type MockRoom = { id: string; kind: 'quick' | 'secret' | 'business'; role: 'owner' | 'member'; memberState: 'pending' | 'active'; ttl: number; mode: 'on_open' | 'on_send'; expiresAt: string; name: string | null };

export const room = (over: Partial<MockRoom> = {}): MockRoom => ({
  id: '11111111-2222-3333-4444-555555555555', kind: 'secret', role: 'owner', memberState: 'active', ttl: 30, mode: 'on_open',
  expiresAt: new Date(Date.now() + 6 * 3600_000).toISOString(), name: null, ...over,
});

export const chat = {
  myRooms: jest.fn(async (): Promise<MockRoom[]> => []),
  members: jest.fn(async (): Promise<{ deviceId: string; state: 'pending' | 'active'; hasKeyPackage: boolean; role: 'owner' | 'member' }[]> => []),
  admitPending: jest.fn(async () => 1),
  createRoom: jest.fn(async () => 'room-new'),
  createInvite: jest.fn(async () => ({ id: 'inv-1', link: 'https://onepeek.io/chat/join#' + 'T'.repeat(43) })),
  peekInvite: jest.fn(async (): Promise<{ needs_code: boolean; kind: 'quick' | 'secret' | 'business' } | null> => ({ needs_code: true, kind: 'secret' })),
  redeemInvite: jest.fn(async () => 'room-joined'),
  sync: jest.fn(async () => ({ joined: true, removed: false, newMessages: 0 })),
  subscribe: jest.fn(() => () => {}),
};

export const auth = {
  getSession: jest.fn(async () => null as null | { userId: string; email: string | null; isAnonymous: boolean }),
  onChange: jest.fn((_cb: unknown) => () => {}),
  signInWithApple: jest.fn(async () => {}),
  startOAuth: jest.fn(async () => 'https://auth.example/oauth?provider=google'),
  completeFromUrl: jest.fn(async () => true),
  sendEmailLink: jest.fn(async () => {}),
  signInAsGuest: jest.fn(async () => {}),
  signOut: jest.fn(async () => {}),
};

export const resetThisPhone = jest.fn(async () => {});

export const chatMock = {
  AUTH_REDIRECT_URL: 'onepeek://auth',
  getChat: () => chat,
  getLockStore: () => ({ set() {}, get: () => false, clear() {} }),
  auth,
  resetThisPhone,
};

/** A ChatError look-alike: the core's class derives `code` from the message's last `[a-z_]+` word. */
export const chatError = (code: string) => Object.assign(new Error(`failed: ${code}`), { code });

export function resetChatMock() {
  for (const fn of Object.values(chat)) fn.mockClear();
  for (const fn of Object.values(auth)) fn.mockClear();
  resetThisPhone.mockClear();
  chat.myRooms.mockResolvedValue([]);
  chat.members.mockResolvedValue([]);
  auth.getSession.mockResolvedValue(null);
}
