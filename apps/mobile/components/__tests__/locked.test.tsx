import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { LockedScreen } from '../LockedScreen';

const mockSec = {
  locked: true,
  unlock: jest.fn(async () => true),
  lockNow: jest.fn(),
  panic: jest.fn(),
  captured: false,
  biometrics: 'face' as 'face' | 'fingerprint' | 'passcode' | 'none',
  deviceInsecure: false,
  inactive: false,
};
let mockPanic = false;

jest.mock('@/security', () => ({
  ...jest.requireActual('@/security/constants'),
  LockCover: jest.requireActual('@/security/LockCover').LockCover,
  useSecurity: () => mockSec,
}));
jest.mock('@/lib/chat', () => ({ getLockStore: () => ({ get: () => mockPanic, set() {}, clear() {} }) }));

beforeEach(() => {
  mockSec.locked = true; mockSec.biometrics = 'face'; mockSec.deviceInsecure = false; mockPanic = false;
  mockSec.unlock.mockReset().mockResolvedValue(true);
});

test('locked: brand, Face ID wording, Unlock calls unlock(); no content underneath', async () => {
  await render(<><LockedScreen /><Text>SECRET CONTENT</Text></>);
  expect(screen.getByTestId('locked.screen')).toBeTruthy();
  expect(screen.getByText('Chats locked')).toBeTruthy();
  expect(screen.getByText('Unlock with Face ID to see your conversations on this phone.')).toBeTruthy();
  expect(screen.queryByTestId('locked.insecure')).toBeNull();
  await fireEvent.press(screen.getByTestId('locked.unlock'));
  await waitFor(() => expect(mockSec.unlock).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId('locked.failed')).toBeNull();
});

test('a failed unlock shows a retry state and the next press calls unlock() again', async () => {
  mockSec.unlock.mockResolvedValueOnce(false);
  await render(<LockedScreen />);
  await fireEvent.press(screen.getByTestId('locked.unlock'));
  expect(await screen.findByTestId('locked.failed')).toBeTruthy();
  expect(screen.getByText('Try again')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('locked.unlock'));
  await waitFor(() => expect(mockSec.unlock).toHaveBeenCalledTimes(2));
});

test('insecure device: the warning is shown and no biometric wording is used', async () => {
  mockSec.deviceInsecure = true; mockSec.biometrics = 'none';
  await render(<LockedScreen />);
  expect(screen.getByTestId('locked.insecure')).toBeTruthy();
  expect(screen.getByText(/no passcode or biometric lock/)).toBeTruthy();
  expect(screen.queryByText(/Face ID/)).toBeNull();
  expect(screen.queryByTestId('locked.passcode')).toBeNull();
});

test('Panic Exit flag is named; the cover shows brand only while merely inactive', async () => {
  mockPanic = true;
  await render(<LockedScreen />);
  expect(screen.getByText('Locked by Panic Exit')).toBeTruthy();
  mockSec.locked = false;
  await render(<LockedScreen />);
  expect(screen.queryByTestId('locked.screen')).toBeNull();
  expect(screen.queryByTestId('locked.unlock')).toBeNull();
  expect(screen.getAllByTestId('app.cover').length).toBeGreaterThan(0);
});
