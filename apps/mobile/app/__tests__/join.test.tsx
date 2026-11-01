/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import JoinRoute from '../join';
import JoinDeepLinkRoute from '../chat/join';
import { auth, chat, chatError, resetChatMock } from '../../test/chat-mock';
import { resetRouter, router } from '../../test/expo-router-mock';
import { renderScreen } from '../../test/render';

jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('@/lib/chat', () => require('../../test/chat-mock').chatMock);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
const mockSecurity = { forgetLinkingURL: jest.fn() };
jest.mock('@/security', () => ({ ...jest.requireActual('@/security/constants'), forgetLinkingURL: () => mockSecurity.forgetLinkingURL() }));

const TOKEN = 'k'.repeat(40) + 'XYZ';
const mockLink: { url: string | null } = { url: null };
jest.mock('expo-linking', () => ({ useLinkingURL: () => mockLink.url }));

beforeEach(() => { resetChatMock(); resetRouter(); mockLink.url = null; mockSecurity.forgetLinkingURL.mockClear(); });

test('deep link: reads the token from the URL fragment, peeks, asks for code and nickname, redeems', async () => {
  mockLink.url = `https://onepeek.io/chat/join#${TOKEN}`;
  await renderScreen(<JoinDeepLinkRoute />);
  await waitFor(() => expect(chat.peekInvite).toHaveBeenCalledWith(TOKEN));
  // P2-2: once the token is captured the launch URL is forgotten (initial-URL cache, Android Intent); exactly once.
  expect(mockSecurity.forgetLinkingURL).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('You’re invited to a Secret Chat')).toBeTruthy();
  expect(screen.getByText('Hold to read')).toBeTruthy();
  expect(JSON.stringify(screen.toJSON())).not.toContain(TOKEN);
  await fireEvent.changeText(screen.getByTestId('join.code'), 'river-blue-4471');
  await fireEvent.changeText(screen.getByTestId('join.nick'), 'Bea');
  await fireEvent.press(screen.getByTestId('join.submit'));
  await waitFor(() => expect(chat.redeemInvite).toHaveBeenCalledWith(TOKEN, 'Bea', 'river-blue-4471'));
  expect(router.replace).toHaveBeenCalledWith('/room/room-joined');
});

test('custom scheme link works the same way and a Quick Chat needs no code', async () => {
  mockLink.url = `onepeek://chat/join#${TOKEN}`;
  chat.peekInvite.mockResolvedValueOnce({ needs_code: false, kind: 'quick' });
  await renderScreen(<JoinDeepLinkRoute />);
  expect(await screen.findByText('You’re invited to a Quick Chat')).toBeTruthy();
  expect(screen.queryByTestId('join.code')).toBeNull();
  await fireEvent.press(screen.getByTestId('join.submit'));
  await waitFor(() => expect(chat.redeemInvite).toHaveBeenCalledWith(TOKEN, '', undefined));
});

test('P2-2: a deep-link route with no token forgets nothing (there is no fragment to forget)', async () => {
  await renderScreen(<JoinDeepLinkRoute />);
  await screen.findByTestId('join.link');
  expect(mockSecurity.forgetLinkingURL).not.toHaveBeenCalled();
});

test('pasted link: extracts the fragment, rejects junk', async () => {
  await renderScreen(<JoinRoute />);
  await fireEvent.changeText(screen.getByTestId('join.link'), 'hello');
  await fireEvent.press(screen.getByTestId('join.continue'));
  expect(screen.getByText('That doesn’t look like an OnePeek invite link.')).toBeTruthy();
  expect(chat.peekInvite).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByTestId('join.link'), ` https://onepeek.io/chat/join#${TOKEN} `);
  await fireEvent.press(screen.getByTestId('join.continue'));
  await waitFor(() => expect(chat.peekInvite).toHaveBeenCalledWith(TOKEN));
});

test('an invalid invite shows the web wording', async () => {
  mockLink.url = `https://onepeek.io/chat/join#${TOKEN}`;
  chat.peekInvite.mockResolvedValueOnce(null);
  await renderScreen(<JoinDeepLinkRoute />);
  expect(await screen.findByTestId('join.invalid')).toBeTruthy();
  expect(screen.getByText('This invite isn’t valid any more. It may have expired, been used, or been revoked.')).toBeTruthy();
});

test('a wrong access code is reported with the web wording and the user stays on the screen', async () => {
  mockLink.url = `https://onepeek.io/chat/join#${TOKEN}`;
  chat.redeemInvite.mockRejectedValueOnce(chatError('access_code_wrong'));
  await renderScreen(<JoinDeepLinkRoute />);
  await screen.findByTestId('join.code');
  await fireEvent.changeText(screen.getByTestId('join.code'), 'nope-nope');
  await fireEvent.press(screen.getByTestId('join.submit'));
  expect(await screen.findByText('That access code isn’t right.')).toBeTruthy();
  expect(router.replace).not.toHaveBeenCalled();
});

test('the guest footnote shows only without an account session', async () => {
  mockLink.url = `https://onepeek.io/chat/join#${TOKEN}`;
  auth.getSession.mockResolvedValueOnce({ userId: 'u', email: 'sam@example.com', isAnonymous: false });
  await renderScreen(<JoinDeepLinkRoute />);
  await screen.findByTestId('join.submit');
  expect(screen.queryByText('You join as a guest. No account, no phone number.')).toBeNull();
});
