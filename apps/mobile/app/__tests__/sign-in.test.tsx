/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import SignInScreen from '../sign-in';
import { auth, resetChatMock } from '../../test/chat-mock';
import { resetRouter, router } from '../../test/expo-router-mock';

jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('@/lib/chat', () => require('../../test/chat-mock').chatMock);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const CALLBACK_URL = 'onepeek://auth#access_token=SECRET_TOKEN_abc&refresh_token=SECRET_REFRESH_xyz';
const mockOpenAuth = jest.fn(async () => ({ type: 'success', url: CALLBACK_URL }));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn(), openAuthSessionAsync: (...a: unknown[]) => mockOpenAuth(...(a as [])), openBrowserAsync: jest.fn() }));

const mockAppleSignIn = jest.fn(async () => ({ identityToken: 'APPLE_ID_TOKEN', user: 'u' }));
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(async () => true),
  signInAsync: (...a: unknown[]) => mockAppleSignIn(...(a as [])),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(n).map((_, i) => i + 1),
  digestStringAsync: jest.fn(async (_alg: string, s: string) => `sha256(${s})`),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

beforeEach(() => { resetChatMock(); resetRouter(); mockOpenAuth.mockClear(); mockAppleSignIn.mockClear(); });

test('Apple: hashed nonce goes to Apple, raw nonce and identity token go to auth', async () => {
  const os = Platform.OS;
  Platform.OS = 'ios';
  try {
    await render(<SignInScreen />);
    const apple = await screen.findByTestId('signin.apple');
    await fireEvent.press(apple);
    await waitFor(() => expect(auth.signInWithApple).toHaveBeenCalledTimes(1));
    const [token, nonce] = auth.signInWithApple.mock.calls[0] as unknown as [string, string];
    expect(token).toBe('APPLE_ID_TOKEN');
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(mockAppleSignIn).toHaveBeenCalledWith(expect.objectContaining({ nonce: `sha256(${nonce})` }));
    expect(router.replace).toHaveBeenCalledWith('/');
  } finally {
    Platform.OS = os;
  }
});

test('Google: opens the auth session at the redirect URL, completes from the result, never renders the URL', async () => {
  await render(<SignInScreen />);
  await fireEvent.press(screen.getByTestId('signin.google'));
  await waitFor(() => expect(auth.completeFromUrl).toHaveBeenCalledWith(CALLBACK_URL));
  expect(auth.startOAuth).toHaveBeenCalledWith('google');
  expect(mockOpenAuth).toHaveBeenCalledWith('https://auth.example/oauth?provider=google', 'onepeek://auth');
  expect(router.replace).toHaveBeenCalledWith('/');
  expect(JSON.stringify(screen.toJSON())).not.toContain('SECRET_TOKEN');
  expect(JSON.stringify(screen.toJSON())).not.toContain('SECRET_REFRESH');
});

test('Google: a cancelled browser session shows no error and signs nothing in', async () => {
  mockOpenAuth.mockResolvedValueOnce({ type: 'cancel', url: '' });
  await render(<SignInScreen />);
  await fireEvent.press(screen.getByTestId('signin.google'));
  await waitFor(() => expect(mockOpenAuth).toHaveBeenCalled());
  expect(auth.completeFromUrl).not.toHaveBeenCalled();
  expect(screen.queryByTestId('signin.error')).toBeNull();
});

test('Email link: validates, sends, and shows the check-your-inbox state', async () => {
  await render(<SignInScreen />);
  await fireEvent.press(screen.getByTestId('signin.sendLink'));
  expect(screen.getByText('Enter your email address.')).toBeTruthy();
  expect(auth.sendEmailLink).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByTestId('signin.email'), ' Sam@Example.com ');
  await fireEvent.press(screen.getByTestId('signin.sendLink'));
  await waitFor(() => expect(auth.sendEmailLink).toHaveBeenCalledWith('sam@example.com'));
  expect(await screen.findByTestId('signin.emailSent')).toBeTruthy();
  expect(screen.getByText(/Check your inbox/)).toBeTruthy();
  expect(screen.queryByTestId('signin.email')).toBeNull();
});

test('Guest: uses the web wording and calls signInAsGuest', async () => {
  await render(<SignInScreen />);
  expect(screen.getByText(/Join that chat as a guest/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('signin.guest'));
  await waitFor(() => expect(auth.signInAsGuest).toHaveBeenCalledTimes(1));
  expect(router.replace).toHaveBeenCalledWith('/');
});

test('Passkeys are not offered yet', async () => {
  await render(<SignInScreen />);
  expect(screen.queryByTestId('signin.passkey')).toBeNull();
});
