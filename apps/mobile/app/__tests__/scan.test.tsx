/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
// QR scanner (U8, design 11): dispatch per payload type, permission copy, torch, safety-number match.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import ScanScreen from '../scan';
import { clearHandoffs, takeHandoff } from '../../lib/links';
import { chat, resetChatMock, THEM } from '../../test/chat-mock';
import { resetRouter, router, setLocalParams } from '../../test/expo-router-mock';
import { renderScreen } from '../../test/render';
import { resetSecretsMock, SECRET_ID, SECRET_URL } from '../../test/secrets-mock';

const INVITE = 'https://onepeek.io/chat/join#' + 'T'.repeat(43);
const DIGITS = '123456789012345678901234567890123456789012345678901234567890';
const mockCam = { granted: true, canAskAgain: true, request: jest.fn(async () => ({ granted: true })), onScan: null as null | ((r: { type: string; data: string }) => void), props: {} as Record<string, unknown> };
const mockHaptics = { notificationAsync: jest.fn(async () => {}) };

jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('@/lib/chat', () => require('../../test/chat-mock').chatMock);
jest.mock('@/lib/secrets', () => require('../../test/secrets-mock').secretsMock);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-haptics', () => ({ notificationAsync: (t: string) => (mockHaptics.notificationAsync as unknown as (t: string) => Promise<void>)(t), NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' } }));
jest.mock('expo-camera', () => {
  const { View } = require('react-native');
  return {
    useCameraPermissions: () => [{ granted: mockCam.granted, canAskAgain: mockCam.canAskAgain }, mockCam.request],
    CameraView: (p: { onBarcodeScanned?: (r: { type: string; data: string }) => void; enableTorch?: boolean; barcodeScannerSettings?: unknown; testID?: string }) => {
      mockCam.onScan = p.onBarcodeScanned ?? null;
      mockCam.props = { enableTorch: p.enableTorch, barcodeScannerSettings: p.barcodeScannerSettings };
      return <View testID={p.testID} />;
    },
  };
});

const scan = (data: string) => act(async () => { mockCam.onScan?.({ type: 'qr', data }); });

beforeEach(() => {
  resetChatMock(); resetRouter(); resetSecretsMock(); clearHandoffs();
  mockCam.granted = true; mockCam.canAskAgain = true; mockCam.request.mockClear(); mockCam.onScan = null;
  mockHaptics.notificationAsync.mockClear();
  setLocalParams({});
});

test('only QR codes are scanned; an invite shows "Invite to a chat" and Open invite goes to the join flow with the link parked', async () => {
  await renderScreen(<ScanScreen />);
  expect(await screen.findByTestId('scan.camera')).toBeTruthy();
  expect(mockCam.props.barcodeScannerSettings).toEqual({ barcodeTypes: ['qr'] });
  expect(screen.getByText('Scans invites, one-time secrets and safety numbers. The camera image never leaves this phone.')).toBeTruthy();
  await scan(INVITE);
  expect(await screen.findByText('Invite to a chat')).toBeTruthy();
  expect(mockHaptics.notificationAsync).toHaveBeenCalledWith('success');
  // Scanning stops while a result is shown.
  expect(mockCam.onScan).toBeNull();
  await fireEvent.press(screen.getByTestId('scan.open'));
  expect(router.replace).toHaveBeenCalledWith('/chat/join');
  expect(takeHandoff('invite')).toBe(INVITE);
});

test('a secret link shows "One-time secret"; Open secret parks the full link and routes by id only', async () => {
  await renderScreen(<ScanScreen />);
  await screen.findByTestId('scan.camera');
  await scan(SECRET_URL);
  expect(await screen.findByText('One-time secret')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('scan.open'));
  expect(router.replace).toHaveBeenCalledWith(`/s/${SECRET_ID}`);
  expect(takeHandoff('secret')).toBe(SECRET_URL);
});

test('anything else is "Not a OnePeek code"; Scan again resumes scanning', async () => {
  await renderScreen(<ScanScreen />);
  await screen.findByTestId('scan.camera');
  await scan('https://example.com/promo');
  expect(await screen.findByText('Not a OnePeek code')).toBeTruthy();
  expect(mockHaptics.notificationAsync).toHaveBeenCalledWith('warning');
  expect(screen.queryByTestId('scan.open')).toBeNull();
  await fireEvent.press(screen.getByTestId('scan.again'));
  await waitFor(() => expect(mockCam.onScan).not.toBeNull());
  expect(screen.queryByTestId('scan.result')).toBeNull();
});

test('a safety number from the room: compared with each other member; a match offers "mark verified"', async () => {
  setLocalParams({ room: 'aaaaaaaa-0000-0000-0000-000000000001' });
  chat.members.mockResolvedValue([
    { deviceId: 'dddddddd-0000-0000-0000-00000000000d', state: 'active', hasKeyPackage: true, role: 'owner', nickname: 'Pulkit', signaturePub: new Uint8Array([1]), verified: null } as never,
    { deviceId: THEM, state: 'active', hasKeyPackage: true, role: 'member', nickname: 'Bea', signaturePub: new Uint8Array([2]), verified: null } as never,
  ]);
  await renderScreen(<ScanScreen />);
  await screen.findByTestId('scan.camera');
  await scan(`onepeek-verify:${DIGITS}`);
  expect(await screen.findByText('Matches Bea')).toBeTruthy();
  // F-2 fixed in the core: the compared keys are the ones inside the encrypted group.
  expect(screen.getByText('The numbers match. These are the keys inside your encrypted chat.')).toBeTruthy();
  expect(screen.queryByText(/does not yet prove/)).toBeNull();
  expect(screen.queryByText(/intercept/i)).toBeNull();
  expect(screen.getByText('They match — mark verified')).toBeTruthy();
  expect(chat.safetyNumberWith).toHaveBeenCalledWith('aaaaaaaa-0000-0000-0000-000000000001', THEM);
  expect(chat.safetyNumberWith).toHaveBeenCalledTimes(1);   // never with my own device
  await fireEvent.press(screen.getByTestId('scan.verify'));
  await waitFor(() => expect(chat.markVerified).toHaveBeenCalledWith('aaaaaaaa-0000-0000-0000-000000000001', THEM));
  expect(router.back).toHaveBeenCalled();
});

test('a safety number that matches nobody says so; without a room it explains where to scan from', async () => {
  setLocalParams({ room: 'aaaaaaaa-0000-0000-0000-000000000001' });
  chat.members.mockResolvedValue([{ deviceId: THEM, state: 'active', hasKeyPackage: true, role: 'member', nickname: 'Bea', signaturePub: new Uint8Array([2]), verified: null } as never]);
  chat.safetyNumberWith.mockResolvedValue('9'.repeat(60));
  await renderScreen(<ScanScreen />);
  await screen.findByTestId('scan.camera');
  await scan(`onepeek-verify:${DIGITS}`);
  expect(await screen.findByText('Doesn’t match anyone in this chat')).toBeTruthy();
  expect(screen.queryByTestId('scan.verify')).toBeNull();
  await screen.unmount();
  setLocalParams({});
  await renderScreen(<ScanScreen />);
  await screen.findByTestId('scan.camera');
  await scan(`onepeek-verify:${DIGITS}`);
  expect(await screen.findByText('Open Verify people in a chat’s menu and scan from there to compare.')).toBeTruthy();
  expect(chat.safetyNumberWith).toHaveBeenCalledTimes(1);
});

test('F-2: a member whose key does not match the chat: the scan result shows the mismatch message and offers no "mark verified"', async () => {
  setLocalParams({ room: 'aaaaaaaa-0000-0000-0000-000000000001' });
  chat.members.mockResolvedValue([{ deviceId: THEM, state: 'active', hasKeyPackage: true, role: 'member', nickname: 'Bea', signaturePub: new Uint8Array([2]), verified: null, keyMismatch: true } as never]);
  chat.safetyNumberWith.mockRejectedValue(Object.assign(new Error('member_key_mismatch'), { code: 'member_key_mismatch' }));
  await renderScreen(<ScanScreen />);
  await screen.findByTestId('scan.camera');
  await scan(`onepeek-verify:${DIGITS}`);
  expect(await screen.findByText('This member’s key doesn’t match the chat. Don’t trust this chat until you’ve checked with them.')).toBeTruthy();
  expect(screen.queryByTestId('scan.verify')).toBeNull();
  expect(chat.markVerified).not.toHaveBeenCalled();
});

test('torch toggles the camera prop; Close leaves', async () => {
  await renderScreen(<ScanScreen />);
  await screen.findByTestId('scan.camera');
  expect(mockCam.props.enableTorch).toBe(false);
  await fireEvent.press(screen.getByTestId('scan.torch'));
  await waitFor(() => expect(mockCam.props.enableTorch).toBe(true));
  expect(screen.getByTestId('scan.torch').props.accessibilityState.checked).toBe(true);
  await fireEvent.press(screen.getByTestId('scan.close'));
  expect(router.back).toHaveBeenCalled();
});

test('no camera permission: honest copy and an Allow button; once it cannot be asked again, Open Settings instead', async () => {
  mockCam.granted = false;
  await renderScreen(<ScanScreen />);
  expect(await screen.findByTestId('scan.permission')).toBeTruthy();
  expect(screen.queryByTestId('scan.camera')).toBeNull();
  expect(screen.getByText('Scans invites, one-time secrets and safety numbers. The camera image never leaves this phone.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('scan.allow'));
  expect(mockCam.request).toHaveBeenCalledTimes(1);
  await screen.unmount();
  mockCam.canAskAgain = false;
  await renderScreen(<ScanScreen />);
  expect(await screen.findByTestId('scan.settings')).toBeTruthy();
  expect(screen.queryByTestId('scan.allow')).toBeNull();
});
