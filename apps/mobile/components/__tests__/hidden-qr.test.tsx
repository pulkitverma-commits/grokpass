/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
// HiddenQR (review F-4): the code is not drawn until asked for, and goes after 30 s or on inactive.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { HiddenQR, QR_VISIBLE_MS } from '../HiddenQR';

const mockQr = jest.fn((_value: string) => {});
jest.mock('react-native-qrcode-svg', () => { const { View } = require('react-native'); function QrMock(p: { value: string }) { mockQr(p.value); return <View testID="qr" />; } return QrMock; });

const LINK = 'https://onepeek.io/chat/join#' + 'T'.repeat(43);
let handlers: ((s: string) => void)[] = [];
let spy: jest.SpyInstance;

beforeEach(() => {
  mockQr.mockClear();
  handlers = [];
  spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, cb) => { handlers.push(cb as (s: string) => void); return { remove: () => { handlers = handlers.filter((h) => h !== cb); } } as never; });
});
afterEach(() => { spy.mockRestore(); jest.useRealTimers(); });

test('absent until "Show QR code"; the value is in no prop or label before that', async () => {
  await render(<HiddenQR value={LINK} label="Invite QR code." testID="t.qr" />);
  expect(screen.queryByTestId('qr')).toBeNull();
  expect(mockQr).not.toHaveBeenCalled();
  expect(JSON.stringify(screen.toJSON())).not.toContain('TTTTTTTT');
  await fireEvent.press(screen.getByTestId('t.qr.show'));
  expect(screen.getByTestId('qr')).toBeTruthy();
  expect(mockQr).toHaveBeenCalledWith(LINK);
  expect(screen.getByTestId('t.qr.code').props.accessibilityLabel).toBe('Invite QR code.');
});

test('hides after 30 seconds', async () => {
  jest.useFakeTimers();
  await render(<HiddenQR value={LINK} label="QR" testID="t.qr" />);
  await fireEvent.press(screen.getByTestId('t.qr.show'));
  await act(async () => { jest.advanceTimersByTime(QR_VISIBLE_MS - 1000); });
  expect(screen.getByTestId('qr')).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(screen.queryByTestId('qr')).toBeNull();
  expect(screen.getByTestId('t.qr.show')).toBeTruthy();
});

test('hides when the app goes inactive or to the background; the listener goes with it', async () => {
  await render(<HiddenQR value={LINK} label="QR" testID="t.qr" />);
  expect(handlers).toHaveLength(0);   // nothing to watch while hidden
  await fireEvent.press(screen.getByTestId('t.qr.show'));
  expect(handlers).toHaveLength(1);
  await act(async () => { handlers[0]!('inactive'); });
  expect(screen.queryByTestId('qr')).toBeNull();
  expect(handlers).toHaveLength(0);
  await fireEvent.press(screen.getByTestId('t.qr.show'));
  await act(async () => { handlers[0]!('background'); });
  expect(screen.queryByTestId('qr')).toBeNull();
});
