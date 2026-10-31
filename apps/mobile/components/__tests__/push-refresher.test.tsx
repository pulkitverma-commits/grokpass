/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
// PushRefresher (review W2-8): a registered phone re-registers its fresh token on start and on rotation.
import { render, screen, waitFor } from '@testing-library/react-native';
import { PushRefresher } from '../PushRefresher';
import { push, resetChatMock } from '../../test/chat-mock';

type Listener = (t: { data: string }) => void;
const mockN = {
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getDevicePushTokenAsync: jest.fn(async () => ({ type: 'ios', data: 'FRESH-TOKEN-0123456789abcdef' })),
  listener: null as Listener | null,
  remove: jest.fn(),
};
jest.mock('@/lib/chat', () => require('../../test/chat-mock').chatMock);
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: () => mockN.getPermissionsAsync(),
  getDevicePushTokenAsync: () => mockN.getDevicePushTokenAsync(),
  addPushTokenListener: (cb: Listener) => { mockN.listener = cb; return { remove: mockN.remove }; },
}));

beforeEach(() => {
  resetChatMock();
  mockN.getPermissionsAsync.mockClear().mockResolvedValue({ granted: true });
  mockN.getDevicePushTokenAsync.mockClear();
  mockN.listener = null;
  mockN.remove.mockClear();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

test('a phone with a registered token re-registers the fresh device token on start without prompting', async () => {
  push.current.mockResolvedValue(true);
  await render(<PushRefresher />);
  await waitFor(() => expect(push.register).toHaveBeenCalledWith('ios', 'FRESH-TOKEN-0123456789abcdef'));
  expect(push.register).toHaveBeenCalledTimes(1);
  expect(mockN.getPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(mockN.getDevicePushTokenAsync).toHaveBeenCalledTimes(1);
  // The start-up fetch also fires the OS listener with the same token: nothing more is registered.
  mockN.listener?.({ data: 'FRESH-TOKEN-0123456789abcdef' });
  await flush();
  expect(push.register).toHaveBeenCalledTimes(1);
});

test('a phone that never turned notifications on does nothing: no permission check, no token, no RPC', async () => {
  push.current.mockResolvedValue(false);
  await render(<PushRefresher />);
  await waitFor(() => expect(push.current).toHaveBeenCalled());
  await flush();
  expect(mockN.getPermissionsAsync).not.toHaveBeenCalled();
  expect(mockN.getDevicePushTokenAsync).not.toHaveBeenCalled();
  expect(push.register).not.toHaveBeenCalled();
});

test('permission revoked in the phone settings: the token is not fetched and nothing is registered', async () => {
  push.current.mockResolvedValue(true);
  mockN.getPermissionsAsync.mockResolvedValue({ granted: false });
  await render(<PushRefresher />);
  await waitFor(() => expect(mockN.getPermissionsAsync).toHaveBeenCalled());
  await flush();
  expect(mockN.getDevicePushTokenAsync).not.toHaveBeenCalled();
  expect(push.register).not.toHaveBeenCalled();
});

test('a rotation event registers the new token (push.register forgets the old one); unmount removes the listener', async () => {
  push.current.mockResolvedValue(true);
  await render(<PushRefresher />);
  await waitFor(() => expect(push.register).toHaveBeenCalledTimes(1));
  expect(mockN.listener).not.toBeNull();
  mockN.listener!({ data: 'ROTATED-TOKEN-fedcba9876543210' });
  await waitFor(() => expect(push.register).toHaveBeenCalledWith('ios', 'ROTATED-TOKEN-fedcba9876543210'));
  expect(push.register).toHaveBeenCalledTimes(2);
  await screen.unmount();
  expect(mockN.remove).toHaveBeenCalledTimes(1);
});

test('a rotation event on a phone without a registration registers nothing', async () => {
  push.current.mockResolvedValue(false);
  await render(<PushRefresher />);
  await waitFor(() => expect(mockN.listener).not.toBeNull());
  mockN.listener!({ data: 'ROTATED-TOKEN-fedcba9876543210' });
  await flush();
  expect(push.register).not.toHaveBeenCalled();
});

test('a failing register is swallowed (nothing thrown, nothing rendered)', async () => {
  push.current.mockResolvedValue(true);
  push.register.mockRejectedValueOnce(Object.assign(new Error('failed: not_signed_in'), { code: 'not_signed_in' }));
  await render(<PushRefresher />);
  await waitFor(() => expect(push.register).toHaveBeenCalledTimes(1));
  await flush();
  expect(screen.toJSON()).toBeNull();
});
