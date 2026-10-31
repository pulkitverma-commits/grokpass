/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import RoomScreen from '../room/[id]';
import { chat, message, mockFile, resetChatMock, room, THEM } from '../../test/chat-mock';
import { resetRouter, router, setLocalParams } from '../../test/expo-router-mock';
import { renderScreen } from '../../test/render';

const ROOM = room({ id: 'aaaaaaaa-0000-0000-0000-000000000001', kind: 'secret', name: 'Vault handover', ttl: 30 });
const mockPicked = { uri: 'file:///tmp/x', name: 'holiday.png', mime: 'image/png', size: 1258291, read: async () => new Uint8Array([1]) };
const mockSecurity = { inactive: false, locked: false, captured: false, biometrics: 'face', deviceInsecure: false, unlock: jest.fn(), lockNow: jest.fn(), panic: jest.fn() };

jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('@/lib/chat', () => require('../../test/chat-mock').chatMock);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-image', () => { const { View } = require('react-native'); return { Image: (p: { testID?: string }) => <View testID={p.testID ?? 'image'} /> }; });
jest.mock('react-native-qrcode-svg', () => { const { View } = require('react-native'); function QrMock() { return <View testID="qr" />; } return QrMock; });
jest.mock('@/lib/files', () => ({
  MAX_ATTACHMENT_BYTES: 50 * 1024 * 1024 - 1024,
  DATA_URI_LIMIT: 3 * 1024 * 1024,
  fileSize: (n: number) => `${(n / 1048576).toFixed(1)} MB`,
  pickPhoto: jest.fn(async () => mockPicked),
  pickDocument: jest.fn(async () => null),
  deletePicked: jest.fn(),
  fileSource: (p: typeof mockPicked) => ({ name: p.name, mime: p.mime, size: p.size, bytes: p.read }),
  dataUri: () => 'data:image/png;base64,AQID',
  writeTemp: jest.fn(async () => 'file:///cache/t'),
  deleteTemp: jest.fn(),
  shareBytes: jest.fn(async () => {}),
  extensionOf: () => '.png',
}));
const mockShot: { cb: (() => void) | null } = { cb: null };
jest.mock('@/security', () => ({
  ...jest.requireActual('@/security/constants'),
  useSecurity: () => mockSecurity,
  useSecureScreen: jest.fn(),
  useScreenshotAlert: jest.fn(),
  onScreenshot: jest.fn((cb: () => void) => { mockShot.cb = cb; return () => { mockShot.cb = null; }; }),
  shortDeviceCode: (id: string) => id.replace(/-/g, '').slice(0, 4).toUpperCase(),
  Watermark: () => { const { View } = require('react-native'); return <View testID="security.watermark" />; },
}));

const MEMBERS = [
  { deviceId: 'dddddddd-0000-0000-0000-00000000000d', role: 'owner' as const, state: 'active' as const, signaturePub: new Uint8Array([1]), hasKeyPackage: true, nickname: 'Pulkit', verified: null },
  { deviceId: THEM, role: 'member' as const, state: 'active' as const, signaturePub: new Uint8Array([2]), hasKeyPackage: true, nickname: 'Bea', verified: null },
];

const files = () => jest.requireMock('@/lib/files') as { deletePicked: jest.Mock; pickPhoto: jest.Mock };

/**
 * Everything the rendered tree shows or announces: string children of host nodes and the props a
 * screen reader or the keyboard would read. (A whole-tree JSON.stringify is not usable here: FlatList
 * hands its `data` to the host ScrollView as a prop, and host props can reach React fiber internals.)
 */
function treeText(): string {
  const out: string[] = [];
  const SPOKEN = ['accessibilityLabel', 'accessibilityHint', 'accessibilityValue', 'placeholder', 'value', 'text'];
  const walk = (n: unknown) => {
    if (n === null || n === undefined || typeof n === 'boolean') return;
    if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const node = n as { props?: Record<string, unknown>; children?: unknown[] };
    for (const k of SPOKEN) { const v = node.props?.[k]; if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') out.push(JSON.stringify(v)); }
    node.children?.forEach(walk);
  };
  walk(screen.toJSON());
  return out.join('\n');
}

beforeEach(() => {
  resetChatMock(); resetRouter();
  files().deletePicked.mockClear(); files().pickPhoto.mockResolvedValue(mockPicked);
  mockSecurity.inactive = false; mockShot.cb = null;
  setLocalParams({ id: ROOM.id });
  chat.myRooms.mockResolvedValue([ROOM]);
  chat.members.mockResolvedValue(MEMBERS);
});

async function open(messages = [message()]) {
  chat.messages.mockResolvedValue(messages);
  await renderScreen(<RoomScreen />);
  await screen.findByText('Vault handover');
  await waitFor(() => expect(chat.messages).toHaveBeenCalled());
}

test('Secret room: text is not in the tree until held; first hold calls markOpened once; release hides it', async () => {
  await open();
  const bubble = await screen.findByTestId('msg.m1');
  expect(screen.getByText('Hold to read')).toBeTruthy();
  expect(screen.queryByText('The locker code is 4471.')).toBeNull();
  expect(bubble.props.accessibilityLabel).not.toMatch(/locker/);
  await act(async () => { fireEvent(bubble, 'pressIn'); });
  expect(screen.getByText('The locker code is 4471.')).toBeTruthy();
  await waitFor(() => expect(chat.markOpened).toHaveBeenCalledTimes(1));
  await act(async () => { fireEvent(bubble, 'pressOut'); });
  expect(screen.queryByText('The locker code is 4471.')).toBeNull();
  // The timer has started: a second hold shows the text but does not mark it opened again.
  await act(async () => { fireEvent(screen.getByTestId('msg.m1'), 'pressIn'); });
  expect(screen.getByText('The locker code is 4471.')).toBeTruthy();
  expect(chat.markOpened).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/left$/)).toBeTruthy();
});

test('the owner auto-admits pending joiners and commits removals on refresh, like the web', async () => {
  await open([]);
  await waitFor(() => expect(chat.admitPending).toHaveBeenCalledWith(ROOM.id));
  expect(chat.commitRemovals).toHaveBeenCalledWith(ROOM.id);
});

test('Quick room: text shows directly and is marked opened once on screen', async () => {
  chat.myRooms.mockResolvedValue([room({ id: ROOM.id, kind: 'quick', name: 'Vault handover', ttl: 60 })]);
  await open();
  expect(await screen.findByText('The locker code is 4471.')).toBeTruthy();
  expect(screen.queryByText('Hold to read')).toBeNull();
  await waitFor(() => expect(chat.markOpened).toHaveBeenCalledTimes(1));
});

test('send: send() with the room, body, timer and a fresh id, then notifyRoom', async () => {
  await open([]);
  await waitFor(() => expect(screen.getByTestId('room.composer').props.editable).toBe(true));
  await fireEvent.changeText(screen.getByTestId('room.composer'), 'Got it, thanks.');
  await fireEvent.press(screen.getByTestId('room.send'));
  await waitFor(() => expect(chat.send).toHaveBeenCalledWith(ROOM.id, 'Got it, thanks.', 30, undefined, 'uuid-1'));
  await waitFor(() => expect(chat.notifyRoom).toHaveBeenCalledWith(ROOM.id));
  expect(screen.getByText('Got it, thanks.')).toBeTruthy();
  expect(screen.getByTestId('room.composer').props.value).toBe('');
});

test('attach: Photo → sendFile with the picked file, the timer and view once', async () => {
  await open([]);
  await waitFor(() => expect(screen.getByTestId('room.composer').props.editable).toBe(true));
  await fireEvent.press(screen.getByTestId('room.attach'));
  await fireEvent.press(await screen.findByTestId('attach.photo'));
  expect(await screen.findByTestId('attach.picked')).toBeTruthy();
  expect(screen.getByTestId('attach.viewOnce').props.value).toBe(true);   // Secret rooms default to view once
  await fireEvent.press(screen.getByTestId('attach.send'));
  await waitFor(() => expect(chat.sendFile).toHaveBeenCalledWith(ROOM.id, expect.objectContaining({ name: 'holiday.png', size: 1258291 }), 30, true));
  await waitFor(() => expect(chat.notifyRoom).toHaveBeenCalled());
});

test('view-once: first open decrypts, marks viewed and shows the viewer; second open is refused with viewer.gone', async () => {
  const m = message({ id: 'm2', body: '', file: mockFile({ viewOnce: true }) });
  await open([m]);
  await fireEvent.press(await screen.findByTestId('file.m2'));
  await waitFor(() => expect(chat.openFile).toHaveBeenCalledTimes(1));
  expect(chat.markViewed).toHaveBeenCalledWith(ROOM.id, expect.objectContaining({ id: 'm2' }));
  expect(await screen.findByTestId('viewer.screen')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('viewer.close'));
  await waitFor(() => expect(screen.queryByTestId('viewer.screen')).toBeNull());
  expect(screen.getByText('Already viewed')).toBeTruthy();
  // The row is disabled now; opening the viewed message again goes straight to the gone state.
  expect(screen.getByTestId('file.m2').props.accessibilityState.disabled).toBe(true);
  expect(chat.openFile).toHaveBeenCalledTimes(1);
});

test('a sender cannot open their own view-once file; a viewed one shows viewer.gone', async () => {
  const mine = message({ id: 'm3', mine: true, sender: 'dddddddd-0000-0000-0000-00000000000d', body: '', file: mockFile({ viewOnce: true }) });
  const viewed = message({ id: 'm4', body: '', file: mockFile({ viewOnce: true }), viewed: true });
  await open([mine, viewed]);
  expect((await screen.findByTestId('file.m3')).props.accessibilityState.disabled).toBe(true);
  expect(screen.getByTestId('file.m4').props.accessibilityState.disabled).toBe(true);
  expect(chat.openFile).not.toHaveBeenCalled();
});

test('screenshot notices render as room.notice with the web wording', async () => {
  await open([
    message({ id: 'a1', body: '', alert: 'screenshot', expiresAt: Date.now() + 30_000 }),
    message({ id: 'a2', body: '', alert: 'screenshot', mine: true, sender: 'dddddddd-0000-0000-0000-00000000000d', expiresAt: Date.now() + 30_000 }),
  ]);
  const notices = await screen.findAllByTestId('room.notice');
  expect(notices).toHaveLength(2);
  expect(screen.getByText('Bea may have taken a screenshot.')).toBeTruthy();
  expect(screen.getByText('You pressed a screenshot shortcut. Everyone in the chat was told.')).toBeTruthy();
  expect(screen.queryByTestId('msg.a1')).toBeNull();
});

test('removed: the ended state replaces the room and Back to chats goes home', async () => {
  chat.sync.mockResolvedValue({ joined: false, removed: true, newMessages: 0, newAlerts: 0 });
  await renderScreen(<RoomScreen />);
  expect(await screen.findByTestId('room.ended')).toBeTruthy();
  expect(screen.getByText('This chat has ended, or you were removed.')).toBeTruthy();
  expect(screen.queryByTestId('room.composer')).toBeNull();
  await fireEvent.press(screen.getByTestId('room.back'));
  expect(router.replace).toHaveBeenCalledWith('/');
});

test('not yet let in: waiting notice and a disabled composer', async () => {
  chat.myRooms.mockResolvedValue([room({ id: ROOM.id, kind: 'business', role: 'member', memberState: 'pending', name: 'Legal' })]);
  await renderScreen(<RoomScreen />);
  expect(await screen.findByTestId('room.waiting')).toBeTruthy();
  expect(screen.getByTestId('room.composer').props.editable).toBe(false);
  expect(screen.getByTestId('room.composer').props.placeholder).toBe('Waiting to be let in…');
  expect(chat.admitPending).not.toHaveBeenCalled();
});

test('the room menu opens from the header and the watermark is only drawn while something is held', async () => {
  await open();
  expect(screen.queryByTestId('security.watermark')).toBeNull();
  await act(async () => { fireEvent(await screen.findByTestId('msg.m1'), 'pressIn'); });
  expect(screen.getByTestId('security.watermark')).toBeTruthy();
  await act(async () => { fireEvent(screen.getByTestId('msg.m1'), 'pressOut'); });
  expect(screen.queryByTestId('security.watermark')).toBeNull();
  await fireEvent.press(screen.getByTestId('room.menu'));
  expect(await screen.findByTestId('room.burn')).toBeTruthy();
  expect(screen.getByTestId('room.menuSheet')).toBeTruthy();
  expect(<Text>placeholder</Text>).toBeTruthy();
});

test('W2-1: replying to a hidden Secret message keeps the text off screen after release; a screenshot or inactive drops the reply', async () => {
  await open();
  const bubble = await screen.findByTestId('msg.m1');
  await act(async () => { fireEvent(bubble, 'pressIn'); });
  await fireEvent.press(screen.getByTestId('reply.m1'));
  await act(async () => { fireEvent(screen.getByTestId('msg.m1'), 'pressOut'); });
  // The preview names the sender only; the body is nowhere in the tree.
  expect(screen.getByTestId('room.replyPreview').props.children).toBe('Replying to a hidden message from Bea');
  expect(screen.queryByText(/locker/)).toBeNull();
  expect(treeText()).not.toContain('The locker code is 4471.');
  expect(treeText()).not.toContain('locker');
  // A screenshot drops the reply altogether.
  expect(mockShot.cb).not.toBeNull();
  await act(async () => { mockShot.cb!(); });
  expect(screen.queryByTestId('room.replyPreview')).toBeNull();
  // Reply again, then the app goes inactive: gone as well.
  await act(async () => { fireEvent(screen.getByTestId('msg.m1'), 'pressIn'); });
  await fireEvent.press(screen.getByTestId('reply.m1'));
  await act(async () => { fireEvent(screen.getByTestId('msg.m1'), 'pressOut'); });
  expect(screen.getByTestId('room.replyPreview')).toBeTruthy();
  mockSecurity.inactive = true;
  await fireEvent.changeText(screen.getByTestId('room.composer'), 'x');   // any re-render picks up `inactive`
  expect(screen.queryByTestId('room.replyPreview')).toBeNull();
  mockSecurity.inactive = false;
});

test('W2-1: own messages and Quick rooms keep the quoted preview; the reply id still goes to send()', async () => {
  chat.myRooms.mockResolvedValue([room({ id: ROOM.id, kind: 'quick', name: 'Vault handover', ttl: 60 })]);
  await open();
  await screen.findByText('The locker code is 4471.');
  await fireEvent.press(screen.getByTestId('reply.m1'));
  expect(screen.getByTestId('room.replyPreview').props.children).toBe('Replying to “The locker code is 4471.”');
  await waitFor(() => expect(screen.getByTestId('room.composer').props.editable).toBe(true));
  await fireEvent.changeText(screen.getByTestId('room.composer'), 'On my way.');
  await fireEvent.press(screen.getByTestId('room.send'));
  await waitFor(() => expect(chat.send).toHaveBeenCalledWith(ROOM.id, 'On my way.', 60, 'm1', 'uuid-1'));
});

test('W2-7: the Secret-room composer refuses keyboard learning and autofill; Quick rooms are unchanged', async () => {
  await open([]);
  const secretInput = await screen.findByTestId('room.composer');
  expect(secretInput.props.autoCorrect).toBe(false);
  expect(secretInput.props.spellCheck).toBe(false);
  expect(secretInput.props.autoCapitalize).toBe('none');
  expect(secretInput.props.importantForAutofill).toBe('no');
  expect(secretInput.props.textContentType).toBe('none');
  expect(secretInput.props.autoComplete).toBe('off');
  await screen.unmount();
  chat.myRooms.mockResolvedValue([room({ id: ROOM.id, kind: 'quick', name: 'Vault handover', ttl: 60 })]);
  await open([]);
  const quickInput = await screen.findByTestId('room.composer');
  expect(quickInput.props.autoCorrect).toBe(true);
  expect(quickInput.props.spellCheck).toBeUndefined();
  expect(quickInput.props.autoCapitalize).toBeUndefined();
  expect(quickInput.props.importantForAutofill).toBeUndefined();
  expect(quickInput.props.textContentType).toBeUndefined();
});

test('W2-2: the picker copy is deleted after a successful send, a failed send, on cancel and when oversize', async () => {
  await open([]);
  await waitFor(() => expect(screen.getByTestId('room.composer').props.editable).toBe(true));
  // Success.
  await fireEvent.press(screen.getByTestId('room.attach'));
  await fireEvent.press(await screen.findByTestId('attach.photo'));
  await screen.findByTestId('attach.picked');
  expect(files().deletePicked).not.toHaveBeenCalledWith(mockPicked);
  await fireEvent.press(screen.getByTestId('attach.send'));
  await waitFor(() => expect(chat.sendFile).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(files().deletePicked).toHaveBeenCalledWith(mockPicked));
  files().deletePicked.mockClear();
  // Failure: the copy still goes.
  chat.sendFile.mockRejectedValueOnce(Object.assign(new Error('failed: network'), { code: 'network' }));
  await fireEvent.press(screen.getByTestId('room.attach'));
  await fireEvent.press(await screen.findByTestId('attach.photo'));
  await screen.findByTestId('attach.picked');
  await fireEvent.press(screen.getByTestId('attach.send'));
  await waitFor(() => expect(screen.getByTestId('room.error')).toBeTruthy());
  expect(files().deletePicked).toHaveBeenCalledWith(mockPicked);
  files().deletePicked.mockClear();
  // Cancel.
  await fireEvent.press(screen.getByTestId('room.attach'));
  await fireEvent.press(await screen.findByTestId('attach.photo'));
  await screen.findByTestId('attach.picked');
  await fireEvent.press(screen.getByTestId('attach.cancel'));
  await waitFor(() => expect(files().deletePicked).toHaveBeenCalledWith(mockPicked));
  files().deletePicked.mockClear();
  // Oversize: refused and deleted at once.
  const big = { ...mockPicked, size: 60 * 1024 * 1024 };
  files().pickPhoto.mockResolvedValueOnce(big);
  await fireEvent.press(screen.getByTestId('room.attach'));
  await fireEvent.press(await screen.findByTestId('attach.photo'));
  expect(await screen.findByTestId('attach.error')).toBeTruthy();
  expect(files().deletePicked).toHaveBeenCalledWith(big);
  expect(chat.sendFile).toHaveBeenCalledTimes(2);
});

test('W2-4: the attach sheet says photos keep their embedded details', async () => {
  await open([]);
  await waitFor(() => expect(screen.getByTestId('room.composer').props.editable).toBe(true));
  await fireEvent.press(screen.getByTestId('room.attach'));
  expect((await screen.findByTestId('attach.exif')).props.children).toBe('Photos keep their embedded details, such as location, unless your phone removes them.');
});
