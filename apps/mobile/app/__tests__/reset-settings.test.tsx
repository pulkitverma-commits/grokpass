/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import ResetScreen from '../reset';
import SettingsScreen from '../settings';
import { auth, chat, push, resetChatMock, resetThisPhone } from '../../test/chat-mock';
import { resetRouter, router } from '../../test/expo-router-mock';
import { renderScreen } from '../../test/render';

const mockSecurity = { biometrics: 'face', deviceInsecure: false, lockNow: jest.fn(), panic: jest.fn() };
const mockNotifications = {
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getDevicePushTokenAsync: jest.fn(async () => ({ type: 'ios', data: 'OPAQUE-DEVICE-TOKEN-0123456789abcdef' })),
};

jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('@/lib/chat', () => require('../../test/chat-mock').chatMock);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-notifications', () => ({ requestPermissionsAsync: () => mockNotifications.requestPermissionsAsync(), getDevicePushTokenAsync: () => mockNotifications.getDevicePushTokenAsync() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.0' } } }));
jest.mock('@/security', () => ({ ...jest.requireActual('@/security/constants'), useSecurity: () => mockSecurity }));

beforeEach(() => { resetChatMock(); resetRouter(); mockSecurity.panic.mockClear(); mockSecurity.lockNow.mockClear(); mockNotifications.requestPermissionsAsync.mockClear().mockResolvedValue({ granted: true }); });

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
  await renderScreen(<SettingsScreen />);
  expect(await screen.findByText('Signed in as sam@example.com')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('settings.reset'));
  expect(router.push).toHaveBeenCalledWith('/reset');
  await fireEvent.press(screen.getByTestId('settings.signOut'));
  await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
  expect(router.replace).toHaveBeenCalledWith('/welcome');
});

test('Settings uses the web guest wording', async () => {
  auth.getSession.mockResolvedValue({ userId: 'u', email: null, isAnonymous: true });
  await renderScreen(<SettingsScreen />);
  expect(await screen.findByText('You’re using chat as a guest on this device.')).toBeTruthy();
});

test('Notifications on: permission, device token → push.register; the token is never rendered; off → push.unregister', async () => {
  await renderScreen(<SettingsScreen />);
  const sw = await screen.findByTestId('settings.notify');
  expect(sw.props.value).toBe(false);
  await fireEvent(sw, 'valueChange', true);
  await waitFor(() => expect(mockNotifications.requestPermissionsAsync).toHaveBeenCalled());
  await waitFor(() => expect(mockNotifications.getDevicePushTokenAsync).toHaveBeenCalled());
  await waitFor(() => expect(push.register).toHaveBeenCalledWith('ios', 'OPAQUE-DEVICE-TOKEN-0123456789abcdef'));
  expect(mockNotifications.requestPermissionsAsync).toHaveBeenCalled();
  expect(chat.registerPushDevice).not.toHaveBeenCalled();
  expect(screen.queryByText(/OPAQUE-DEVICE-TOKEN/)).toBeNull();
  expect(JSON.stringify(screen.toJSON())).not.toMatch(/OPAQUE-DEVICE-TOKEN/);
  await waitFor(() => expect(screen.getByTestId('settings.notify').props.value).toBe(true));
  await fireEvent(screen.getByTestId('settings.notify'), 'valueChange', false);
  await waitFor(() => expect(push.unregister).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId('settings.notify').props.value).toBe(false);
});

test('Notifications: a refused permission shows a notice and registers nothing', async () => {
  mockNotifications.requestPermissionsAsync.mockResolvedValue({ granted: false });
  await renderScreen(<SettingsScreen />);
  await fireEvent(await screen.findByTestId('settings.notify'), 'valueChange', true);
  expect(await screen.findByTestId('settings.notifyError')).toBeTruthy();
  expect(push.register).not.toHaveBeenCalled();
});

test('Panic Exit asks once, then calls panic(); Lock now calls lockNow()', async () => {
  await renderScreen(<SettingsScreen />);
  await fireEvent.press(await screen.findByTestId('panic'));
  expect(mockSecurity.panic).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('panic.confirm'));
  expect(mockSecurity.panic).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('settings.lockNow'));
  expect(mockSecurity.lockNow).toHaveBeenCalledTimes(1);
});

test('Devices: lists from listDevices, revoke after confirming; honest protection copy and the version are shown', async () => {
  chat.listDevices.mockResolvedValue([
    { id: 'dddddddd-0000-0000-0000-00000000000d', label: 'iPhone 15 · iOS 18.1', created_at: '2026-10-01T00:00:00Z', last_seen: '2026-10-30T00:00:00Z', revoked_at: null },
    { id: 'bbbbbbbb-0000-0000-0000-00000000000b', label: 'Browser', created_at: '2026-10-01T00:00:00Z', last_seen: '2026-10-30T00:00:00Z', revoked_at: null },
    { id: 'cccccccc-0000-0000-0000-00000000000c', label: 'Old', created_at: '2026-10-01T00:00:00Z', last_seen: '2026-10-30T00:00:00Z', revoked_at: '2026-10-29T00:00:00Z' },
  ]);
  await renderScreen(<SettingsScreen />);
  const rows = await screen.findAllByTestId('settings.device');
  expect(rows).toHaveLength(2);
  expect(screen.getByText('iPhone 15 · iOS 18.1 · this phone')).toBeTruthy();
  await fireEvent.press(screen.getAllByTestId('settings.device.revoke')[1]!);
  await fireEvent.press(await screen.findByTestId('settings.device.confirm'));
  await waitFor(() => expect(chat.revokeDevice).toHaveBeenCalledWith('bbbbbbbb-0000-0000-0000-00000000000b'));
  expect(screen.getByText(/a screenshot cannot be blocked|screenshots and screen recordings of OnePeek come out black/)).toBeTruthy();
  expect(screen.getByText(/OnePeek 1\.0\.0/)).toBeTruthy();
});
