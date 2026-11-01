/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
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
// InviteSheet reads `extra.e2e` from the build's config (W3-2); the tests flip it per case.
const mockExtra: { e2e?: unknown } = {};
jest.mock('expo-constants', () => ({ __esModule: true, default: { get expoConfig() { return { extra: mockExtra }; } } }));

const TOKEN = 'T'.repeat(43);
beforeEach(() => { resetChatMock(); resetRouter(); mockSetString.mockClear(); mockQr.mockClear(); delete mockExtra.e2e; });

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
  // F-4: the QR encodes the whole link, so it is not drawn until asked for.
  expect(mockQr).not.toHaveBeenCalled();
  expect(screen.queryByTestId('qr')).toBeNull();
  expect(screen.getByTestId('invite.qr.show')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('invite.qr.show'));
  expect(screen.getByTestId('qr')).toBeTruthy();
  expect(mockQr).toHaveBeenCalledWith(`https://onepeek.io/chat/join#${TOKEN}`);
  await fireEvent.press(screen.getByTestId('invite.qr.hide'));
  expect(screen.queryByTestId('qr')).toBeNull();
  await fireEvent.press(screen.getByTestId('invite.copy'));
  await waitFor(() => expect(mockSetString).toHaveBeenCalledWith(`https://onepeek.io/chat/join#${TOKEN}`));
  await fireEvent.press(screen.getByTestId('invite.done'));
  expect(router.replace).toHaveBeenCalledWith('/room/room-new');
});

async function createQuickAndOpenInvite() {
  await renderScreen(<NewChatScreen />);
  await fireEvent.press(screen.getByTestId('new.kind.quick'));
  await fireEvent.press(screen.getByTestId('new.create'));
  return screen.findByTestId('invite.link');
}

test('W3-2: only `extra.e2e === true` (the e2e EAS profile) renders the full link; anything else masks it', async () => {
  mockExtra.e2e = true;
  let link = await createQuickAndOpenInvite();
  expect(link.props.children).toBe(`https://onepeek.io/chat/join#${TOKEN}`);
  expect(link.props.numberOfLines).toBeUndefined();
  expect(link.props.ellipsizeMode).toBeUndefined();
  await screen.unmount();
  // A truthy-but-not-true value (a copied env string, a "1") fails closed.
  for (const v of ['1', 'true', 1, {}] as unknown[]) {
    mockExtra.e2e = v;
    link = await createQuickAndOpenInvite();
    expect(link.props.children).toBe('https://onepeek.io/chat/join#••••••');
    expect(link.props.numberOfLines).toBe(1);
    await screen.unmount();
  }
  // The shell variable alone does nothing in the sheet.
  delete mockExtra.e2e;
  process.env.EXPO_PUBLIC_E2E = '1';
  try {
    link = await createQuickAndOpenInvite();
    expect(link.props.children).toBe('https://onepeek.io/chat/join#••••••');
    expect(JSON.stringify(screen.toJSON())).not.toContain(TOKEN.slice(0, 12));
  } finally { delete process.env.EXPO_PUBLIC_E2E; }
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

test('F-4: a shown invite QR hides again when the app goes inactive', async () => {
  const handlers: ((s: string) => void)[] = [];
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, cb) => { handlers.push(cb as (s: string) => void); return { remove: jest.fn() } as never; });
  try {
    await createQuickAndOpenInvite();
    await fireEvent.press(screen.getByTestId('invite.qr.show'));
    expect(screen.getByTestId('qr')).toBeTruthy();
    await act(async () => { for (const h of [...handlers]) h('inactive'); });
    expect(screen.queryByTestId('qr')).toBeNull();
    expect(screen.getByTestId('invite.qr.show')).toBeTruthy();
  } finally { spy.mockRestore(); }
});
