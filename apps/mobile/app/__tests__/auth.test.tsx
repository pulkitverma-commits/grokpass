/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
import { render, screen, waitFor } from '@testing-library/react-native';
import AuthCallbackScreen from '../auth';
import { auth, resetChatMock } from '../../test/chat-mock';
import { resetRouter, router } from '../../test/expo-router-mock';

jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('@/lib/chat', () => require('../../test/chat-mock').chatMock);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const URL = 'onepeek://auth#access_token=SECRET_TOKEN_abc&type=magiclink';
const mockLink: { url: string | null } = { url: URL };
jest.mock('expo-linking', () => ({ useLinkingURL: () => mockLink.url }));

beforeEach(() => { resetChatMock(); resetRouter(); mockLink.url = URL; });

test('hands the callback URL to the core once, routes home, and never renders it', async () => {
  await render(<AuthCallbackScreen />);
  await waitFor(() => expect(auth.completeFromUrl).toHaveBeenCalledWith(URL));
  expect(auth.completeFromUrl).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  expect(JSON.stringify(screen.toJSON())).not.toContain('SECRET_TOKEN');
});

test('a link the core rejects shows a retry, not the URL', async () => {
  auth.completeFromUrl.mockResolvedValueOnce(false);
  await render(<AuthCallbackScreen />);
  expect(await screen.findByTestId('auth.error')).toBeTruthy();
  expect(router.replace).not.toHaveBeenCalled();
  expect(JSON.stringify(screen.toJSON())).not.toContain('SECRET_TOKEN');
});
