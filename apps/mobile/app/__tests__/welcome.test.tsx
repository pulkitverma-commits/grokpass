/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
import { fireEvent, render, screen } from '@testing-library/react-native';
import WelcomeScreen from '../welcome';
import { resetRouter, router } from '../../test/expo-router-mock';

jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'cancel' })) }));

beforeEach(resetRouter);

test('Welcome renders the pitch with honest copy and routes to sign in and join', async () => {
  await render(<WelcomeScreen />);
  expect(screen.getByText('Private chats\nthat disappear.')).toBeTruthy();
  expect(screen.getByText('Hold to read. Screenshots blocked or flagged.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('welcome.getStarted'));
  expect(router.push).toHaveBeenLastCalledWith('/sign-in');
  await fireEvent.press(screen.getByTestId('welcome.invite'));
  expect(router.push).toHaveBeenLastCalledWith('/join');
  await fireEvent.press(screen.getByTestId('welcome.signIn'));
  expect(router.push).toHaveBeenLastCalledWith('/sign-in');
});
