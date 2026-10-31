/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import ResetScreen from '../reset';
import SettingsScreen from '../settings';
import { auth, resetChatMock, resetThisPhone } from '../../test/chat-mock';
import { resetRouter, router } from '../../test/expo-router-mock';

jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('@/lib/chat', () => require('../../test/chat-mock').chatMock);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

beforeEach(() => { resetChatMock(); resetRouter(); });

test('Reset explains the missing keys, asks twice, calls resetThisPhone and goes to Welcome', async () => {
  await render(<ResetScreen />);
  expect(screen.getByText('This phone’s chat keys are missing')).toBeTruthy();
  expect(screen.queryByTestId('reset.confirm')).toBeNull();
  await fireEvent.press(screen.getByTestId('reset.reset'));
  expect(resetThisPhone).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('reset.confirm'));
  await waitFor(() => expect(resetThisPhone).toHaveBeenCalledTimes(1));
  expect(router.replace).toHaveBeenCalledWith('/welcome');
});

test('Settings shows who is signed in, signs out, and routes to reset', async () => {
  auth.getSession.mockResolvedValue({ userId: 'u', email: 'sam@example.com', isAnonymous: false });
  await render(<SettingsScreen />);
  expect(await screen.findByText('Signed in as sam@example.com')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('settings.reset'));
  expect(router.push).toHaveBeenCalledWith('/reset');
  await fireEvent.press(screen.getByTestId('settings.signOut'));
  await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
  expect(router.replace).toHaveBeenCalledWith('/welcome');
});

test('Settings uses the web guest wording', async () => {
  auth.getSession.mockResolvedValue({ userId: 'u', email: null, isAnonymous: true });
  await render(<SettingsScreen />);
  expect(await screen.findByText('You’re using chat as a guest on this device.')).toBeTruthy();
});
