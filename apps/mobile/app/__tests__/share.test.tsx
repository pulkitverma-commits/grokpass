/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
// Share target (U8, design 10): dispatch of what another app handed over.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import ShareScreen from '../share';
import { clearHandoffs, takeHandoff } from '../../lib/links';
import { chat, resetChatMock, room } from '../../test/chat-mock';
import { resetRouter, router, setLocalParams } from '../../test/expo-router-mock';
import { renderScreen } from '../../test/render';
import { resetSecretsMock, secrets, SECRET_ID, SECRET_URL } from '../../test/secrets-mock';

const INVITE = 'https://onepeek.io/chat/join#' + 'T'.repeat(43);

jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('@/lib/chat', () => require('../../test/chat-mock').chatMock);
jest.mock('@/lib/secrets', () => require('../../test/secrets-mock').secretsMock);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-qrcode-svg', () => { const { View } = require('react-native'); function QrMock() { return <View testID="qr" />; } return QrMock; });
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock('@/security', () => ({ ...jest.requireActual('@/security/constants'), useSecureScreen: jest.fn() }));
jest.mock('@/lib/files', () => ({
  MAX_ATTACHMENT_BYTES: 50 * 1024 * 1024 - 1024,
  fileSize: (n: number) => `${(n / 1048576).toFixed(1)} MB`,
  pickPhoto: jest.fn(async () => null),
  pickDocument: jest.fn(async () => null),
  deletePicked: jest.fn(),
  fileSource: (p: { name: string; mime: string; size: number; read: () => Promise<Uint8Array> }) => ({ name: p.name, mime: p.mime, size: p.size, bytes: p.read }),
  pickedFromUri: (uri: string) => ({ uri, name: 'Passport scan.jpg', mime: 'image/jpeg', size: 2_516_582, read: async () => new Uint8Array([1]) }),
}));

const ROOMS = [
  room({ id: 'aaaaaaaa-0000-0000-0000-000000000001', kind: 'secret', name: 'Vault handover', ttl: 30 }),
  room({ id: 'bbbbbbbb-0000-0000-0000-000000000002', kind: 'business', name: 'Legal review', role: 'member', ttl: 3600 }),
  room({ id: 'cccccccc-0000-0000-0000-000000000003', kind: 'quick', name: 'Pending one', memberState: 'pending' }),
];

beforeEach(() => { resetChatMock(); resetRouter(); resetSecretsMock(); clearHandoffs(); chat.myRooms.mockResolvedValue(ROOMS); });

test('a shared file: the first active room is preselected, view once is on, Encrypt and send calls sendFile and opens the room', async () => {
  setLocalParams({ uris: 'file:///shared/Passport%20scan.jpg' });
  await renderScreen(<ShareScreen />);
  expect(await screen.findByTestId('share.file')).toBeTruthy();
  expect(screen.getByText('Passport scan.jpg')).toBeTruthy();
  expect(screen.getByText('2.4 MB · encrypted on this phone before upload')).toBeTruthy();
  const rows = await screen.findAllByTestId('share.room');
  expect(rows).toHaveLength(2);   // the pending room is not offered
  expect(rows[0]!.props.accessibilityState.checked).toBe(true);
  expect(screen.getByTestId('share.viewOnce').props.value).toBe(true);
  await fireEvent.press(rows[1]!);
  await fireEvent.press(screen.getByTestId('share.send'));
  await waitFor(() => expect(chat.sendFile).toHaveBeenCalledWith(ROOMS[1]!.id, expect.objectContaining({ name: 'Passport scan.jpg', size: 2_516_582 }), 3600, true));
  expect(chat.notifyRoom).toHaveBeenCalledWith(ROOMS[1]!.id);
  expect(router.replace).toHaveBeenCalledWith(`/room/${ROOMS[1]!.id}`);
});

test('shared text goes to the chosen room with send(); the field keeps keyboard learning off', async () => {
  setLocalParams({ text: 'meet at the north gate' });
  await renderScreen(<ShareScreen />);
  const field = await screen.findByTestId('share.text');
  expect(field.props.value).toBe('meet at the north gate');
  expect(field.props.autoCorrect).toBe(false);
  expect(screen.queryByTestId('share.viewOnce')).toBeNull();
  await screen.findAllByTestId('share.room');
  await fireEvent.press(screen.getByTestId('share.send'));
  await waitFor(() => expect(chat.send).toHaveBeenCalledWith(ROOMS[0]!.id, 'meet at the north gate', 30));
  expect(router.replace).toHaveBeenCalledWith(`/room/${ROOMS[0]!.id}`);
});

test('"Make a one-time link instead" opens the secret composer with the shared text, fixed, and the link is made', async () => {
  setLocalParams({ text: 'hunter2' });
  await renderScreen(<ShareScreen />);
  await fireEvent.press(await screen.findByTestId('share.link'));
  expect(await screen.findByTestId('secret.composer')).toBeTruthy();
  expect(screen.queryByTestId('secret.photo')).toBeNull();
  expect(screen.queryByTestId('secret.sendChat')).toBeNull();
  expect(screen.getByTestId('secret.text').props.value).toBe('hunter2');
  await fireEvent.press(screen.getByTestId('secret.link'));
  await waitFor(() => expect(secrets.createSecretLink).toHaveBeenCalledWith({ kind: 'text', text: 'hunter2' }, { ttlSeconds: 86400, views: 1 }));
  expect(await screen.findByTestId('secret.result')).toBeTruthy();
  expect(chat.send).not.toHaveBeenCalled();
});

test('shared text that is a secret link opens the viewer through the hand-off, never a param', async () => {
  setLocalParams({ text: `Look: ${SECRET_URL}` });
  await renderScreen(<ShareScreen />);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/s/${SECRET_ID}`));
  expect(takeHandoff('secret')).toBe(SECRET_URL);
  expect(screen.queryByTestId('share.send')).toBeNull();
  expect(chat.myRooms).not.toHaveBeenCalled();
});

test('shared text that is an invite link goes to the join flow', async () => {
  setLocalParams({ text: INVITE });
  await renderScreen(<ShareScreen />);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/chat/join'));
  expect(takeHandoff('invite')).toBe(INVITE);
});

test('no active chats: the list says so and only the link path is left; a failed send shows share.error', async () => {
  chat.myRooms.mockResolvedValue([]);
  setLocalParams({ text: 'x' });
  await renderScreen(<ShareScreen />);
  expect(await screen.findByTestId('share.noRooms')).toBeTruthy();
  expect(screen.getByTestId('share.send').props.accessibilityState.disabled).toBe(true);
  await screen.unmount();
  chat.myRooms.mockResolvedValue(ROOMS);
  chat.send.mockRejectedValueOnce(Object.assign(new Error('failed: room_closed'), { code: 'room_closed' }));
  await renderScreen(<ShareScreen />);
  await screen.findAllByTestId('share.room');
  await fireEvent.press(screen.getByTestId('share.send'));
  expect(await screen.findByTestId('share.error')).toBeTruthy();
  expect(screen.getByText('This chat has ended.')).toBeTruthy();
  expect(router.replace).not.toHaveBeenCalled();
});
