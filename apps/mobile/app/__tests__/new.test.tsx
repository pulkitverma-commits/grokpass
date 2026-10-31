/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import NewChatScreen from '../new';
import { chat, chatError, resetChatMock } from '../../test/chat-mock';
import { resetRouter, router } from '../../test/expo-router-mock';
import { renderScreen } from '../../test/render';

jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('@/lib/chat', () => require('../../test/chat-mock').chatMock);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// The QR mock records what it was asked to encode and draws nothing, so the tree assertion below
// proves the token is never rendered as text.
const mockQr = jest.fn((_value: string) => {});
jest.mock('react-native-qrcode-svg', () => { const { View } = require('react-native'); function QrMock(p: { value: string }) { mockQr(p.value); return <View testID="qr" />; } return QrMock; });
const mockSetString = jest.fn(async (_text: string) => true);
jest.mock('expo-clipboard', () => ({ setStringAsync: (s: string) => mockSetString(s) }));

const TOKEN = 'T'.repeat(43);
beforeEach(() => { resetChatMock(); resetRouter(); mockSetString.mockClear(); mockQr.mockClear(); });

test('Secret is the default kind and needs a 6+ character access code', async () => {
  await renderScreen(<NewChatScreen />);
  expect(screen.getByTestId('new.kind.secret').props.accessibilityState.checked).toBe(true);
  await fireEvent.changeText(screen.getByTestId('new.code'), 'abc');
  await fireEvent.press(screen.getByTestId('new.create'));
  expect(screen.getByText('Choose an access code of at least 6 characters.')).toBeTruthy();
  expect(chat.createRoom).not.toHaveBeenCalled();
});

test('creates the room with the chosen options, then an invite, and shows the link masked', async () => {
  await renderScreen(<NewChatScreen />);
  await fireEvent.press(screen.getByTestId('new.timer.300'));
  await fireEvent.press(screen.getByTestId('new.mode.sent'));
  await fireEvent.press(screen.getByTestId('new.lifetime.604800'));
  await fireEvent.changeText(screen.getByTestId('new.code'), 'river-blue-4471');
  await fireEvent.changeText(screen.getByTestId('new.name'), 'Vault handover');
  await fireEvent.changeText(screen.getByTestId('new.nick'), 'Sam Okonkwo');
  await fireEvent.press(screen.getByTestId('new.create'));
  await waitFor(() => expect(chat.createRoom).toHaveBeenCalledTimes(1));
  expect(chat.createRoom).toHaveBeenCalledWith({ kind: 'secret', ttl: 300, mode: 'on_send', lifetime: 604800, accessCode: 'river-blue-4471', name: 'Vault handover', nickname: 'Sam Okonkwo' });
  await waitFor(() => expect(chat.createInvite).toHaveBeenCalledWith('room-new', { expiresIn: 86400, maxUses: 1, approval: false }));
  const link = await screen.findByTestId('invite.link');
  expect(link.props.children).toBe('https://onepeek.io/chat/join#••••••');
  expect(JSON.stringify(screen.toJSON())).not.toContain(TOKEN.slice(0, 12));
  expect(mockQr).toHaveBeenCalledWith(`https://onepeek.io/chat/join#${TOKEN}`);
  await fireEvent.press(screen.getByTestId('invite.copy'));
  await waitFor(() => expect(mockSetString).toHaveBeenCalledWith(`https://onepeek.io/chat/join#${TOKEN}`));
  await fireEvent.press(screen.getByTestId('invite.done'));
  expect(router.replace).toHaveBeenCalledWith('/room/room-new');
});

test('Quick chat needs no code, uses its own defaults and omits an empty nickname', async () => {
  await renderScreen(<NewChatScreen />);
  await fireEvent.press(screen.getByTestId('new.kind.quick'));
  expect(screen.queryByTestId('new.code')).toBeNull();
  await fireEvent.press(screen.getByTestId('new.create'));
  await waitFor(() => expect(chat.createRoom).toHaveBeenCalledWith({ kind: 'quick', ttl: 60, mode: 'on_open', lifetime: 86400, accessCode: null, name: null }));
});

test('Business rooms ask for approval on the invite', async () => {
  await renderScreen(<NewChatScreen />);
  await fireEvent.press(screen.getByTestId('new.kind.business'));
  await fireEvent.press(screen.getByTestId('new.create'));
  await waitFor(() => expect(chat.createInvite).toHaveBeenCalledWith('room-new', { expiresIn: 86400, maxUses: 1, approval: true }));
});

test('core errors use the web wording', async () => {
  chat.createRoom.mockRejectedValueOnce(chatError('rate_limited'));
  await renderScreen(<NewChatScreen />);
  await fireEvent.press(screen.getByTestId('new.kind.quick'));
  await fireEvent.press(screen.getByTestId('new.create'));
  expect(await screen.findByText('Too many attempts. Wait a few minutes and try again.')).toBeTruthy();
});
