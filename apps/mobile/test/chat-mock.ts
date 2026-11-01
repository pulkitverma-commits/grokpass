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
  sync: jest.fn(async () => ({ joined: true, removed: false, newMessages: 0, newAlerts: 0 })),
  subscribe: jest.fn(() => () => {}),
  // Wave 2: conversation, room menu, settings.
  ensureDevice: jest.fn(async () => ({ id: 'dddddddd-0000-0000-0000-00000000000d', userId: 'u', signing: {} })),
  // Phase 2: lib/report reads the session bearer through the client.
  ensureSession: jest.fn(async (_guest?: boolean): Promise<null | { access_token: string }> => ({ access_token: 'session-bearer-for-tests' })),
  messages: jest.fn(async (): Promise<MockMessage[]> => []),
  dropMessage: jest.fn(async () => {}),
  forgetRoom: jest.fn(async () => {}),
  commitRemovals: jest.fn(async () => {}),
  send: jest.fn(async (_room: string, body: string, ttl: number, replyTo?: string, id?: string): Promise<MockMessage> => ({ ...message({ id: id ?? 'sent-1', mine: true, body, ttl, replyTo }) })),
  notifyRoom: jest.fn(async () => {}),
  sendFile: jest.fn(async (): Promise<MockMessage> => message({ id: 'file-sent', mine: true, file: mockFile({ viewOnce: true }) })),
  openFile: jest.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' })),
  markViewed: jest.fn(async (_room: string, m: MockMessage) => ({ ...m, viewed: true })),
  markOpened: jest.fn(async (_room: string, m: MockMessage) => ({ ...m, expiresAt: Date.now() + m.ttl * 1000 })),
  setTimer: jest.fn(async () => {}),
  setRoomName: jest.fn(async () => {}),
  safetyNumberWith: jest.fn(async () => '123456789012345678901234567890123456789012345678901234567890'),
  markVerified: jest.fn(async () => {}),
  removeMember: jest.fn(async () => {}),
  leave: jest.fn(async () => {}),
  burn: jest.fn(async () => {}),
  listInvites: jest.fn(async (): Promise<{ id: string; expires_at: string; max_uses: number; uses: number; requires_approval: boolean; revoked_at: string | null }[]> => []),
  revokeInvite: jest.fn(async () => {}),
  listDevices: jest.fn(async (): Promise<{ id: string; label: string; created_at: string; last_seen: string; revoked_at: string | null }[]> => []),
  revokeDevice: jest.fn(async () => {}),
  registerPushDevice: jest.fn(async () => {}),
  unregisterPushDevice: jest.fn(async () => {}),
  lock: jest.fn(), isLocked: jest.fn(() => false), unlock: jest.fn(async () => {}),
  sendScreenshotAlert: jest.fn(async () => ({})),
  keystore: { get: jest.fn(async (_k: string): Promise<unknown> => ({})), put: jest.fn(async () => {}), wipe: jest.fn(async () => {}) },
};

export type MockFile = { t: 'file'; id: string; ttl: number; viewOnce: boolean; objectPath: string; key: string; name: string; mime: string; size: number };
export type MockMessage = {
  id: string; seq: number; mine: boolean; sender: string; body: string; ttl: number; sentAt: number; expiresAt: number | null;
  replyTo?: string; file?: MockFile; viewed?: boolean; pending?: boolean; alert?: 'screenshot';
};

export const THEM = 'eeeeeeee-0000-0000-0000-00000000000e';

export const mockFile = (over: Partial<MockFile> = {}): MockFile => ({
  t: 'file', id: 'f1', ttl: 30, viewOnce: false, objectPath: 'room/obj', key: 'k', name: 'holiday.png', mime: 'image/png', size: 1258291, ...over,
});

export const message = (over: Partial<MockMessage> = {}): MockMessage => ({
  id: 'm1', seq: 1, mine: false, sender: THEM, body: 'The locker code is 4471.', ttl: 30, sentAt: Date.now() - 5000, expiresAt: null, ...over,
});

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

/** Stub of the lib's `push` export (core-crypto wave 2) until the merged lib carries the real one. */
export const push = { register: jest.fn(async (_p: 'ios' | 'android', _t: string) => {}), unregister: jest.fn(async () => {}), current: jest.fn(async () => false) };

/** C4 adds `getSupabase()` to lib/chat; a test that needs it sets `supabaseHolder.getSupabase` (read through a getter, so a namespace import sees it). */
export const supabaseHolder: { getSupabase: undefined | (() => unknown) } = { getSupabase: undefined };

export const chatMock = {
  AUTH_REDIRECT_URL: 'onepeek://auth',
  get getSupabase() { return supabaseHolder.getSupabase; },
  getChat: () => chat,
  getLockStore: () => ({ set() {}, get: () => false, clear() {} }),
  auth,
  resetThisPhone,
  push,
};

/** A ChatError look-alike: the core's class derives `code` from the message's last `[a-z_]+` word. */
export const chatError = (code: string) => Object.assign(new Error(`failed: ${code}`), { code });

export function resetChatMock() {
  for (const fn of Object.values(chat)) if (typeof fn === 'function') (fn as jest.Mock).mockClear();
  chat.keystore.get.mockClear().mockResolvedValue({});
  for (const fn of Object.values(auth)) fn.mockClear();
  resetThisPhone.mockClear();
  push.register.mockClear(); push.unregister.mockClear(); push.current.mockClear().mockResolvedValue(false);
  chat.myRooms.mockResolvedValue([]);
  chat.members.mockResolvedValue([]);
  chat.messages.mockResolvedValue([]);
  chat.sync.mockResolvedValue({ joined: true, removed: false, newMessages: 0, newAlerts: 0 });
  chat.listInvites.mockResolvedValue([]);
  chat.listDevices.mockResolvedValue([]);
  auth.getSession.mockResolvedValue(null);
  chat.ensureSession.mockResolvedValue({ access_token: 'session-bearer-for-tests' });
}
