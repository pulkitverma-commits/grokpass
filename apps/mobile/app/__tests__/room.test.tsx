/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { FlatList, Text, TextInput, View } from 'react-native';
import RoomScreen from '../room/[id]';
import { chat, message, mockFile, resetChatMock, room, THEM } from '../../test/chat-mock';
import { resetRouter, router, setLocalParams } from '../../test/expo-router-mock';
import { renderScreen } from '../../test/render';
import { clearHandoffs, takeHandoff } from '../../lib/links';
import { resetSecretsMock, secrets, SECRET_ID, SECRET_URL } from '../../test/secrets-mock';

const ROOM = room({ id: 'aaaaaaaa-0000-0000-0000-000000000001', kind: 'secret', name: 'Vault handover', ttl: 30 });
const mockPicked = { uri: 'file:///tmp/x', name: 'holiday.png', mime: 'image/png', size: 1258291, read: async () => new Uint8Array([1]) };
const mockSecurity = { inactive: false, locked: false, captured: false, biometrics: 'face', deviceInsecure: false, unlock: jest.fn(), lockNow: jest.fn(), panic: jest.fn() };

jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('@/lib/chat', () => require('../../test/chat-mock').chatMock);
jest.mock('@/lib/secrets', () => require('../../test/secrets-mock').secretsMock);
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
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
 * Everything the rendered tree shows, announces or hands to the keyboard: string children of host
 * nodes and every string inside every prop, except a deny-list (W3-4). A prop not on the list is
 * swept, so a future `title`, `accessibilityActions`, `defaultValue` or `aria-*` carrying a body
 * fails the test instead of passing silently. Excluded on purpose:
 * - `data`: FlatList hands its rows to the host ScrollView as a prop, so it holds every message body
 *   by construction (and host props can reach React fiber internals); `data` never reaches native.
 * - `style`: layout numbers and colours, never content.
 * - functions (handlers) and `children` (walked as the node's children instead).
 * - inside a prop that is a React element (e.g. `ListHeaderComponent`) only its `props` are read;
 *   `_owner`/`_store` and any `_`-prefixed key are fiber internals, never content of their own.
 * - `testID` and `key`: fixed ids (`msg.<id>`, `row.<id>`), asserted elsewhere to carry ids only.
 * - enum-like host props that cannot carry content: `accessibilityRole`, `pointerEvents`,
 *   `keyboardType`, `returnKeyType`, `textContentType`, `autoComplete`, `autoCapitalize`,
 *   `importantForAutofill`, `ellipsizeMode`, `collapsable`, `nativeID`.
 */
const TREE_TEXT_SKIP = new Set(['data', 'style', 'children', 'testID', 'key', 'accessibilityRole', 'pointerEvents', 'keyboardType', 'returnKeyType', 'textContentType', 'autoComplete', 'autoCapitalize', 'importantForAutofill', 'ellipsizeMode', 'collapsable', 'nativeID']);
function treeText(): string {
  const out: string[] = [];
  const seen = new WeakSet<object>();
  // Strings anywhere inside a prop value (objects such as accessibilityState/Value, arrays, nested).
  const collect = (v: unknown, depth: number) => {
    if (typeof v === 'string') { out.push(v); return; }
    if (v === null || v === undefined || typeof v !== 'object' || depth > 12) return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { v.forEach((x) => collect(x, depth + 1)); return; }
    const o = v as Record<string, unknown>;
    if ('$$typeof' in o) { collect(o.props, depth + 1); return; }   // a React element: its props only
    for (const [k, x] of Object.entries(o)) if (!k.startsWith('_') && typeof x !== 'function') collect(x, depth + 1);
  };
  const walk = (n: unknown) => {
    if (n === null || n === undefined || typeof n === 'boolean') return;
    if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const node = n as { props?: Record<string, unknown>; children?: unknown[] };
    for (const [k, v] of Object.entries(node.props ?? {})) { if (TREE_TEXT_SKIP.has(k) || typeof v === 'function') continue; collect(v, 0); }
    node.children?.forEach(walk);
  };
  walk(screen.toJSON());
  return out.join('\n');
}

beforeEach(() => {
  resetChatMock(); resetRouter(); resetSecretsMock(); clearHandoffs();
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

test('send: send() with the room, body, timer and a fresh id; the screen sends no second notifyRoom (F-9)', async () => {
  await open([]);
  await waitFor(() => expect(screen.getByTestId('room.composer').props.editable).toBe(true));
  await fireEvent.changeText(screen.getByTestId('room.composer'), 'Got it, thanks.');
  await fireEvent.press(screen.getByTestId('room.send'));
  await waitFor(() => expect(chat.send).toHaveBeenCalledWith(ROOM.id, 'Got it, thanks.', 30, undefined, 'uuid-1'));
  await waitFor(() => expect(screen.getByText('Got it, thanks.')).toBeTruthy());
  expect(chat.notifyRoom).not.toHaveBeenCalled();   // the core's send() notifies once
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
  await waitFor(() => expect(files().deletePicked).toHaveBeenCalled());
  expect(chat.notifyRoom).not.toHaveBeenCalled();   // sendFile() notifies once (F-9)
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

test('W3-1: a sent reply to a hidden Secret message names the sender in the bubble quote; the parent text is nowhere in the tree', async () => {
  await open();
  const bubble = await screen.findByTestId('msg.m1');
  await act(async () => { fireEvent(bubble, 'pressIn'); });
  await fireEvent.press(screen.getByTestId('reply.m1'));
  await act(async () => { fireEvent(screen.getByTestId('msg.m1'), 'pressOut'); });
  await waitFor(() => expect(screen.getByTestId('room.composer').props.editable).toBe(true));
  await fireEvent.changeText(screen.getByTestId('room.composer'), 'On my way.');
  await fireEvent.press(screen.getByTestId('room.send'));
  await waitFor(() => expect(chat.send).toHaveBeenCalledWith(ROOM.id, 'On my way.', 30, 'm1', 'uuid-1'));
  // The sent bubble is on screen with its reply quote, and the quote names Bea instead of quoting her.
  expect(screen.getByTestId('msg.uuid-1')).toBeTruthy();
  expect(screen.getByText('On my way.')).toBeTruthy();
  expect(screen.getByText('Hidden message from Bea')).toBeTruthy();
  expect(screen.queryByText(/locker/)).toBeNull();
  const text = treeText();
  expect(text).not.toContain('The locker code is 4471.');
  expect(text).not.toContain('locker');
  expect(text).toContain('Hidden message from Bea');
  // Holding the parent does not change the quote: her text is read on her bubble only.
  await act(async () => { fireEvent(screen.getByTestId('msg.m1'), 'pressIn'); });
  expect(screen.getByText('Hidden message from Bea')).toBeTruthy();
  expect(screen.getAllByText('The locker code is 4471.')).toHaveLength(1);
  await act(async () => { fireEvent(screen.getByTestId('msg.m1'), 'pressOut'); });
});

test('W3-1: Quick rooms and own parents keep the quoted text in the sent bubble', async () => {
  chat.myRooms.mockResolvedValue([room({ id: ROOM.id, kind: 'quick', name: 'Vault handover', ttl: 60 })]);
  await open();
  await screen.findByText('The locker code is 4471.');
  await fireEvent.press(screen.getByTestId('reply.m1'));
  await waitFor(() => expect(screen.getByTestId('room.composer').props.editable).toBe(true));
  await fireEvent.changeText(screen.getByTestId('room.composer'), 'On my way.');
  await fireEvent.press(screen.getByTestId('room.send'));
  await waitFor(() => expect(screen.getByTestId('msg.uuid-1')).toBeTruthy());
  // Parent bubble + the quote inside the sent bubble.
  expect(screen.getAllByText('The locker code is 4471.')).toHaveLength(2);
  expect(screen.queryByText(/Hidden message/)).toBeNull();
  expect(treeText()).toContain('The locker code is 4471.');
  await screen.unmount();
  // Secret room, replying to my own message: the quote stays.
  chat.myRooms.mockResolvedValue([ROOM]);
  await open([message({ id: 'm2', mine: true, sender: 'dddddddd-0000-0000-0000-00000000000d', body: 'Meet at the north gate.' })]);
  await screen.findByText('Meet at the north gate.');
  await fireEvent.press(screen.getByTestId('reply.m2'));
  await waitFor(() => expect(screen.getByTestId('room.composer').props.editable).toBe(true));
  await fireEvent.changeText(screen.getByTestId('room.composer'), 'Ten minutes.');
  await fireEvent.press(screen.getByTestId('room.send'));
  await waitFor(() => expect(screen.getByTestId('msg.uuid-1')).toBeTruthy());
  expect(screen.getAllByText('Meet at the north gate.')).toHaveLength(2);
  expect(screen.queryByText(/Hidden message/)).toBeNull();
});

test('W3-4: treeText() sweeps every prop but the deny-list, so a content-bearing prop is caught', async () => {
  // The sweep sees string children, nested object/array props and an unknown prop, and skips `data`,
  // `style` and `testID`. An unknown prop stands in for whatever a future component may add.
  const unknownProp = { title: 'prop-title-leak' } as Record<string, unknown>;
  await render(
    <View {...unknownProp} accessibilityActions={[{ name: 'x', label: 'action-label-leak' }]} accessibilityState={{ checked: false }} testID="id-not-content" style={{ width: 1 }}>
      <FlatList data={['data-row-not-swept']} renderItem={() => null} />
      <TextInput defaultValue="default-value-leak" placeholder="placeholder-leak" />
      <Text>child-text</Text>
    </View>,
  );
  const text = treeText();
  // Nothing from React's own bookkeeping is swept, so an element-valued prop cannot smuggle fiber state.
  expect(text).not.toContain('memoizedState');
  expect(text).toContain('prop-title-leak');
  expect(text).toContain('action-label-leak');
  expect(text).toContain('default-value-leak');
  expect(text).toContain('placeholder-leak');
  expect(text).toContain('child-text');
  expect(text).not.toContain('data-row-not-swept');
  expect(text).not.toContain('id-not-content');
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

test('U8 block: messages from a device on this phone’s block list are hidden; the list is read from the keystore', async () => {
  chat.keystore.get.mockImplementation(async (k: string) => (k === `room:${ROOM.id}:blocked` ? [THEM] : {}));
  await open([message({ id: 'm1' }), message({ id: 'm9', mine: true, sender: 'dddddddd-0000-0000-0000-00000000000d', body: 'Still here.' })]);
  await screen.findByText('Still here.');
  expect(screen.queryByTestId('msg.m1')).toBeNull();
  expect(screen.queryByText('Hold to read')).toBeNull();
  expect(treeText()).not.toContain('locker');
  expect(screen.getByTestId('msg.m9')).toBeTruthy();
});

test('P2-6 Secret room: a bubble with a secret link shows no "Open secret" until it is held; the button goes away on release', async () => {
  await open([message({ id: 'm5', body: `Here you go: ${SECRET_URL}` })]);
  const bubble = await screen.findByTestId('msg.m5');
  expect(screen.getByText('Hold to read')).toBeTruthy();
  expect(screen.queryByTestId('link.m5')).toBeNull();
  expect(treeText()).not.toContain('Open secret');
  expect(treeText()).not.toContain('onepeek.io');
  await act(async () => { fireEvent(bubble, 'pressIn'); });
  const btn = screen.getByTestId('link.m5');
  expect(btn.props.accessibilityLabel).not.toContain('onepeek.io');
  await fireEvent.press(btn);
  expect(router.push).toHaveBeenCalledWith(`/s/${SECRET_ID}`);
  expect(takeHandoff('secret')).toBe(SECRET_URL);
  await act(async () => { fireEvent(bubble, 'pressOut'); });
  expect(screen.queryByTestId('link.m5')).toBeNull();
  // The sender's own bubble is never hidden, so its button is there without a hold.
  await screen.unmount();
  resetRouter(); clearHandoffs();
  await open([message({ id: 'm6', mine: true, sender: 'dddddddd-0000-0000-0000-00000000000d', body: SECRET_URL })]);
  expect(await screen.findByTestId('link.m6')).toBeTruthy();
});

test('U8 secret link in a message: "Open secret" parks the full link and routes by id only; the link is not an accessibility label', async () => {
  chat.myRooms.mockResolvedValue([room({ id: ROOM.id, kind: 'quick', name: 'Vault handover', ttl: 60 })]);
  await open([message({ id: 'm5', body: `Here you go: ${SECRET_URL}` })]);
  const btn = await screen.findByTestId('link.m5');
  expect(btn.props.accessibilityLabel).not.toContain('onepeek.io');
  await fireEvent.press(btn);
  expect(router.push).toHaveBeenCalledWith(`/s/${SECRET_ID}`);
  expect(takeHandoff('secret')).toBe(SECRET_URL);
  // Plain text has no such button.
  expect(screen.queryByTestId('link.m1')).toBeNull();
});

test('U8 attach → Send as a one-time secret: the sheet opens; "Send in this chat" sends the text through send(); the link path sends the full link as a message', async () => {
  await open([]);
  await waitFor(() => expect(screen.getByTestId('room.composer').props.editable).toBe(true));
  await fireEvent.press(screen.getByTestId('room.attach'));
  await fireEvent.press(await screen.findByTestId('attach.secret'));
  expect(await screen.findByTestId('secret.sheet')).toBeTruthy();
  expect(screen.queryByTestId('attach.sheet')).toBeNull();
  await fireEvent.changeText(screen.getByTestId('secret.text'), 'The vault code is 9182.');
  await fireEvent.press(screen.getByTestId('secret.sendChat'));
  await waitFor(() => expect(chat.send).toHaveBeenCalledWith(ROOM.id, 'The vault code is 9182.', 30, undefined, 'uuid-1'));
  await waitFor(() => expect(screen.queryByTestId('secret.sheet')).toBeNull());
  expect(secrets.createSecretLink).not.toHaveBeenCalled();
  // The composer draft was not touched by the secret send.
  expect(screen.getByTestId('room.composer').props.value).toBe('');
  // Link path: the message body is the full link, the screen never draws the key.
  await fireEvent.press(screen.getByTestId('room.attach'));
  await fireEvent.press(await screen.findByTestId('attach.secret'));
  await fireEvent.changeText(await screen.findByTestId('secret.text'), 'second');
  await fireEvent.press(screen.getByTestId('secret.link'));
  await waitFor(() => expect(secrets.createSecretLink).toHaveBeenCalledTimes(1));
  await fireEvent.press(await screen.findByTestId('secret.sendLink'));
  await waitFor(() => expect(chat.send).toHaveBeenLastCalledWith(ROOM.id, SECRET_URL, 30, undefined, 'uuid-1'));
  await waitFor(() => expect(screen.queryByTestId('secret.sheet')).toBeNull());
});

describe('F-1: a room that myRooms() does not list for this session', () => {
  afterEach(() => { chat.subscribe.mockImplementation(() => () => {}); });

  test('never reads or renders the stored copies, even when sync reports new messages; shows the ended state', async () => {
    chat.myRooms.mockResolvedValue([room({ id: 'bbbbbbbb-0000-0000-0000-000000000002' })]);   // another room only
    chat.sync.mockResolvedValue({ joined: true, removed: false, newMessages: 3, newAlerts: 0 });
    chat.messages.mockResolvedValue([message(), message({ id: 'm9', mine: true, body: 'Previous account wrote this.' })]);
    let ping: ((event: string) => void) | null = null;
    chat.subscribe.mockImplementation(((_room: string, cb: (event: string) => void) => { ping = cb; return () => {}; }) as never);
    await renderScreen(<RoomScreen />);
    await act(async () => { ping?.('msg'); });   // a Realtime ping: the pull path, racing the first refresh
    expect(await screen.findByTestId('room.ended')).toBeTruthy();
    expect(screen.getByText('This chat has ended.')).toBeTruthy();
    expect(chat.messages).not.toHaveBeenCalled();
    expect(chat.forgetRoom).toHaveBeenCalledWith(ROOM.id);
    const all = treeText();
    expect(all).not.toContain('Previous account wrote this.');
    expect(all).not.toContain('4471');
  });

  test('stored copies appear only after myRooms() has listed the room', async () => {
    let listRooms: (rooms: unknown[]) => void = () => {};
    chat.myRooms.mockImplementation(() => new Promise((res) => { listRooms = res as never; }));
    chat.sync.mockResolvedValue({ joined: true, removed: false, newMessages: 1, newAlerts: 0 });
    chat.messages.mockResolvedValue([message({ mine: true, body: 'Listed room message.' })]);
    let ping: ((event: string) => void) | null = null;
    chat.subscribe.mockImplementation(((_room: string, cb: (event: string) => void) => { ping = cb; return () => {}; }) as never);
    await renderScreen(<RoomScreen />);
    await act(async () => { ping?.('msg'); });
    expect(chat.messages).not.toHaveBeenCalled();
    expect(screen.queryByText('Listed room message.')).toBeNull();
    await act(async () => { listRooms([ROOM]); });
    expect(await screen.findByText('Listed room message.')).toBeTruthy();
    expect(chat.messages).toHaveBeenCalledWith(ROOM.id);
  });
});

describe('accessibility (qa A1, A2, §12 key-changed row)', () => {
  test('A1: a hidden Secret bubble is labelled with the sender and the time, never the text', async () => {
    const sentAt = new Date(2026, 10, 1, 9, 41).getTime();
    await open([message({ sentAt })]);
    const bubble = await screen.findByTestId('msg.m1');
    expect(bubble.props.accessibilityLabel).toBe('Hidden message from Bea, 9:41. Hold to read.');
    expect(bubble.props.accessibilityLabel).not.toMatch(/locker|4471/);
  });

  test('A2: holding announces the body once; re-renders while held and the release announce nothing', async () => {
    const { AccessibilityInfo } = require('react-native');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    announce.mockClear();   // react-native's jest setup already mocks it: drop calls from earlier tests
    try {
      await open();
      const bubble = await screen.findByTestId('msg.m1');
      expect(announce).not.toHaveBeenCalled();   // nothing outside a hold
      await act(async () => { fireEvent(bubble, 'pressIn'); });
      await waitFor(() => expect(chat.markOpened).toHaveBeenCalledTimes(1));   // re-render while held
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith('The locker code is 4471.');
      await act(async () => { fireEvent(screen.getByTestId('msg.m1'), 'pressOut'); });
      expect(announce).toHaveBeenCalledTimes(1);
      // A second hold is a second reveal: announced once more.
      await act(async () => { fireEvent(screen.getByTestId('msg.m1'), 'pressIn'); });
      expect(announce).toHaveBeenCalledTimes(2);
    } finally { announce.mockRestore(); }
  });

  test('A2: own messages and Quick rooms are never announced (their text is on screen anyway)', async () => {
    const { AccessibilityInfo } = require('react-native');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    announce.mockClear();   // react-native's jest setup already mocks it: drop calls from earlier tests
    try {
      chat.myRooms.mockResolvedValue([room({ id: ROOM.id, kind: 'quick', name: 'Vault handover', ttl: 60 })]);
      await open([message(), message({ id: 'm2', mine: true, body: 'Mine.' })]);
      expect(await screen.findByText('The locker code is 4471.')).toBeTruthy();
      expect(announce).not.toHaveBeenCalled();
    } finally { announce.mockRestore(); }
  });

  test('F2-6: a sync refused for a key mismatch shows a persistent notice; a mismatched pending member gets the mismatch row with its own label', async () => {
    chat.sync.mockRejectedValue(Object.assign(new Error('member_key_mismatch'), { code: 'member_key_mismatch' }));
    chat.members.mockResolvedValue([MEMBERS[0]!, { ...MEMBERS[1]!, state: 'pending' as const, keyMismatch: true }] as never);
    await open([]);
    expect(await screen.findByText('This chat stopped updating because a member’s key doesn’t match. Don’t trust it until you’ve checked with them.')).toBeTruthy();
    const row = await screen.findByTestId('room.keyMismatch');
    expect(row.props.accessibilityLabel).toBe('A member’s key doesn’t match the chat. Open Verify people.');
    expect(screen.getByText('Bea wasn’t let in. This member’s key doesn’t match the chat. Don’t trust this chat until you’ve checked with them.')).toBeTruthy();
  });

  test('F2-7: a room joined from a link without the owner pin shows the persistent notice; a pinned one does not', async () => {
    chat.myRooms.mockResolvedValue([room({ id: ROOM.id, role: 'member', name: 'Vault handover', ownerPinned: false })]);
    await open([]);
    expect(await screen.findByTestId('room.unpinned')).toBeTruthy();
    expect(screen.getByText('This invite didn’t carry the owner’s key, so the app can’t confirm who runs this chat. Ask for a new invite.')).toBeTruthy();
  });

  test('third pass (c): a Welcome refused because it was not from the pinned owner says so; F2-11: an owner the stored pin no longer recognises is surfaced', async () => {
    chat.sync.mockRejectedValue(Object.assign(new Error('invite_owner_mismatch'), { code: 'invite_owner_mismatch' }));
    chat.members.mockResolvedValue([{ ...MEMBERS[0]!, changedGroup: true }, MEMBERS[1]!] as never);
    await open([]);
    expect(await screen.findByText('We couldn’t confirm this chat: the device letting you in isn’t the owner your invite named. Don’t trust this chat. Check with the person who invited you, and ask the owner for a new invite.')).toBeTruthy();
    expect(screen.getByTestId('room.ownerUnrecognised')).toBeTruthy();
    expect(screen.getByText('Your copy of this chat no longer recognises its owner. Don’t trust it until you’ve checked with them.')).toBeTruthy();
  });

  test('F2-1: a device the server does not list gets its own row', async () => {
    chat.members.mockResolvedValue([MEMBERS[0]!, { ...MEMBERS[1]!, unlisted: true, inGroup: true }] as never);
    await open([]);
    const row = await screen.findByTestId('room.unlisted');
    expect(row.props.accessibilityLabel).toBe('A device the server doesn’t list can read this chat. Open Verify people.');
    expect(screen.getByText('Bea: Not listed by the server: this device can still read the chat.')).toBeTruthy();
  });

  test('the key-changed row has a fixed label without the nickname', async () => {
    const changed = [MEMBERS[0]!, { ...MEMBERS[1]!, verified: '\\x99' }];   // verified a key that is no longer theirs
    chat.members.mockResolvedValue(changed);
    await open([]);
    const row = await screen.findByTestId('room.keyChanged');
    expect(row.props.accessibilityLabel).toBe('A member’s security key changed. Verify again.');
    expect(row.props.accessibilityRole).toBe('button');
    expect(screen.getByText('Bea’s security key changed. Verify again.')).toBeTruthy();
  });
});
