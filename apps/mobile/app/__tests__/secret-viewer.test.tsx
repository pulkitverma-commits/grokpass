/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
// Secret viewer (U8, `/s/<id>#<key>`): states from the mocked peek/open, the key read from the launch
// URL or the hand-off (never a param), content cleared when the app leaves the foreground, noCopy /
// noSave honoured, guard needs a hold, the timer vanishes the secret. The launch URL is forgotten
// once the peek resolved (P2-2); "Open in browser" uses a Custom Tab on Android and openURL on iOS,
// with the honest sentence under it (P2-8).
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState, Linking, Platform } from 'react-native';
import SecretViewerRoute from '../s/[id]';
import { clearHandoffs, stashHandoff } from '../../lib/links';
import { resetRouter, router, setLocalParams } from '../../test/expo-router-mock';
import { renderScreen } from '../../test/render';
import { peek, resetSecretsMock, secrets, SECRET_ID, SECRET_KEY, SECRET_URL } from '../../test/secrets-mock';

const mockLinking = { url: null as string | null };
const mockSecurity = { forgetLinkingURL: jest.fn() };
const mockBrowser = { openBrowserAsync: jest.fn(async () => ({ type: 'cancel' })) };
const mockClipboard = { setStringAsync: jest.fn(async () => true) };
const mockFiles = { shareBytes: jest.fn(async () => {}), writeTemp: jest.fn(async () => 'file:///cache/onepeek-view/t.png'), deleteTemp: jest.fn() };
let appStateHandlers: ((s: string) => void)[] = [];

jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('@/lib/chat', () => require('../../test/chat-mock').chatMock);
jest.mock('@/lib/secrets', () => require('../../test/secrets-mock').secretsMock);
jest.mock('expo-linking', () => ({ useLinkingURL: () => mockLinking.url }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: (u: string) => (mockBrowser.openBrowserAsync as unknown as (u: string) => Promise<unknown>)(u) }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-qrcode-svg', () => { const { View } = require('react-native'); function QrMock(p: { value: string }) { return <View testID="qr" accessibilityValue={{ text: p.value }} />; } return QrMock; });
jest.mock('expo-clipboard', () => ({ setStringAsync: (s: string) => (mockClipboard.setStringAsync as unknown as (s: string) => Promise<boolean>)(s) }));
jest.mock('expo-image', () => { const { View } = require('react-native'); return { Image: (p: { testID?: string }) => <View testID={p.testID ?? 'image'} /> }; });
jest.mock('@/security', () => ({
  ...jest.requireActual('@/security/constants'),
  useSecureScreen: jest.fn(),
  forgetLinkingURL: () => mockSecurity.forgetLinkingURL(),
  Watermark: () => { const { View } = require('react-native'); return <View testID="security.watermark" />; },
}));
jest.mock('@/lib/files', () => ({
  DATA_URI_LIMIT: 3 * 1024 * 1024,
  dataUri: () => 'data:image/png;base64,AQID',
  writeTemp: (b: Uint8Array, e: string) => (mockFiles.writeTemp as unknown as (b: Uint8Array, e: string) => Promise<string>)(b, e),
  deleteTemp: (u: string) => mockFiles.deleteTemp(u),
  shareBytes: (b: Uint8Array, m: string, e: string) => (mockFiles.shareBytes as unknown as (b: Uint8Array, m: string, e: string) => Promise<void>)(b, m, e),
  extensionOf: () => '.png',
  fileSize: (n: number) => `${n} B`,
}));

beforeEach(() => {
  resetRouter(); resetSecretsMock(); clearHandoffs();
  mockLinking.url = null;
  mockSecurity.forgetLinkingURL.mockClear();
  mockBrowser.openBrowserAsync.mockClear().mockResolvedValue({ type: 'cancel' });
  mockClipboard.setStringAsync.mockClear();
  mockFiles.shareBytes.mockClear(); mockFiles.writeTemp.mockClear(); mockFiles.deleteTemp.mockClear();
  appStateHandlers = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, cb) => { appStateHandlers.push(cb as (s: string) => void); return { remove: jest.fn() }; });
  setLocalParams({ id: SECRET_ID });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

function treeText(): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n === null || n === undefined || typeof n === 'boolean') return;
    if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const node = n as { props?: Record<string, unknown>; children?: unknown[] };
    for (const [k, v] of Object.entries(node.props ?? {})) if (k !== 'style' && typeof v === 'string') out.push(v);
    node.children?.forEach(walk);
  };
  walk(screen.toJSON());
  return out.join('\n');
}

test('Universal Link: the key comes from the launch URL; peek shows the ready state; Open decrypts and shows the text with Copy', async () => {
  mockLinking.url = SECRET_URL;
  // P2-2: the launch URL is forgotten once the peek has resolved (key imported), not before.
  let resolvePeek: ((p: ReturnType<typeof peek>) => void) | null = null;
  secrets.peekSecretLink.mockImplementationOnce(() => new Promise((r) => { resolvePeek = r; }));
  await renderScreen(<SecretViewerRoute />);
  await waitFor(() => expect(secrets.peekSecretLink).toHaveBeenCalledWith(SECRET_URL));
  expect(screen.getByText('Checking your link…')).toBeTruthy();
  expect(mockSecurity.forgetLinkingURL).not.toHaveBeenCalled();
  await act(async () => { resolvePeek!(peek()); });
  expect(await screen.findByTestId('sview.open')).toBeTruthy();
  expect(mockSecurity.forgetLinkingURL).toHaveBeenCalledTimes(1);
  expect(secrets.peekSecretLink).toHaveBeenCalledWith(SECRET_URL);
  expect(secrets.openSecretLink).not.toHaveBeenCalled();   // peeking never burns
  expect(screen.getByText('Someone sent you a secret')).toBeTruthy();
  expect(screen.getByText('As soon as you open it, it’s deleted from OnePeek — this link won’t work again.', { exact: false })).toBeTruthy();
  expect(treeText()).not.toContain(SECRET_KEY);
  await fireEvent.press(screen.getByTestId('sview.open'));
  await waitFor(() => expect(secrets.openSecretLink).toHaveBeenCalledWith(SECRET_URL));
  expect(await screen.findByText('The vault code is 9182.')).toBeTruthy();
  expect(screen.getByText('This secret has been deleted from OnePeek. The link won’t work again.')).toBeTruthy();
  expect(screen.queryByTestId('sview.hold')).toBeNull();
  await fireEvent.press(screen.getByTestId('sview.copy'));
  await waitFor(() => expect(mockClipboard.setStringAsync).toHaveBeenCalledWith('The vault code is 9182.'));
  expect(treeText()).not.toContain(SECRET_KEY);
  expect(mockSecurity.forgetLinkingURL).toHaveBeenCalledTimes(1);   // still once: the open does not repeat it
});

test('P2-2: a failed peek (gone, bad key) does not forget the launch URL; a hand-off viewer forgets it too once its peek resolves', async () => {
  mockLinking.url = SECRET_URL;
  secrets.peekSecretLink.mockRejectedValueOnce(Object.assign(new Error('failed: gone'), { code: 'gone' }));
  await renderScreen(<SecretViewerRoute />);
  expect(await screen.findByTestId('sview.error')).toBeTruthy();
  expect(mockSecurity.forgetLinkingURL).not.toHaveBeenCalled();
  await screen.unmount();
  mockLinking.url = null;
  stashHandoff('secret', SECRET_URL);
  await renderScreen(<SecretViewerRoute />);
  expect(await screen.findByTestId('sview.open')).toBeTruthy();
  expect(mockSecurity.forgetLinkingURL).toHaveBeenCalledTimes(1);
});

describe('P2-8: "Open in browser" fallback', () => {
  const geofenced = () => Object.assign(new Error('failed: geofence_location_required'), { code: 'geofence_location_required' });
  const platform = (os: 'ios' | 'android') => { Object.defineProperty(Platform, 'OS', { value: os, configurable: true }); };
  const originalOS = Platform.OS;
  afterEach(() => platform(originalOS as 'ios' | 'android'));

  test('Android: a Custom Tab (openBrowserAsync), never Linking.openURL (the verified App Link would loop back into the app); the note names the consequence', async () => {
    platform('android');
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    mockLinking.url = SECRET_URL;
    secrets.openSecretLink.mockRejectedValueOnce(geofenced());
    await renderScreen(<SecretViewerRoute />);
    await fireEvent.press(await screen.findByTestId('sview.open'));
    const btn = await screen.findByTestId('sview.browser');
    expect(screen.getByTestId('sview.browserNote').props.children).toBe('Opens in your browser. The full link, key included, is handed to the browser and will be in its history.');
    await fireEvent.press(btn);
    await waitFor(() => expect(mockBrowser.openBrowserAsync).toHaveBeenCalledWith(SECRET_URL));
    expect(openURL).not.toHaveBeenCalled();
  });

  test('iOS: Linking.openURL hands the Universal Link to Safari; the Custom Tab API is not used', async () => {
    platform('ios');
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    mockLinking.url = SECRET_URL;
    secrets.openSecretLink.mockRejectedValueOnce(geofenced());
    await renderScreen(<SecretViewerRoute />);
    await fireEvent.press(await screen.findByTestId('sview.open'));
    await fireEvent.press(await screen.findByTestId('sview.browser'));
    await waitFor(() => expect(openURL).toHaveBeenCalledWith(SECRET_URL));
    expect(mockBrowser.openBrowserAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId('sview.browserNote')).toBeTruthy();
  });

  test('a browser that cannot be opened is reported, nothing else changes', async () => {
    platform('ios');
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    mockLinking.url = SECRET_URL;
    secrets.openSecretLink.mockRejectedValueOnce(geofenced());
    await renderScreen(<SecretViewerRoute />);
    await fireEvent.press(await screen.findByTestId('sview.open'));
    await fireEvent.press(await screen.findByTestId('sview.browser'));
    expect(await screen.findByText('Couldn’t open the browser.')).toBeTruthy();
    expect(screen.getByTestId('sview.open').props.accessibilityState.disabled).toBe(false);
  });
});

test('from a bubble or the scanner: the link arrives through the hand-off, read once; a wrong id is refused as incomplete', async () => {
  stashHandoff('secret', SECRET_URL);
  await renderScreen(<SecretViewerRoute />);
  expect(await screen.findByTestId('sview.open')).toBeTruthy();
  expect(secrets.peekSecretLink).toHaveBeenCalledWith(SECRET_URL);
  await screen.unmount();
  // The hand-off was consumed: a second viewer without a link is an honest error, no peek.
  secrets.peekSecretLink.mockClear();
  await renderScreen(<SecretViewerRoute />);
  expect(await screen.findByTestId('sview.error')).toBeTruthy();
  expect(screen.getByText('This link is incomplete. Ask the sender to share the full link.')).toBeTruthy();
  expect(secrets.peekSecretLink).not.toHaveBeenCalled();
  await screen.unmount();
  // A hand-off for another id is not used for this route.
  stashHandoff('secret', 'https://onepeek.io/s/otherid00000#' + 'Q'.repeat(43));
  await renderScreen(<SecretViewerRoute />);
  expect(await screen.findByTestId('sview.error')).toBeTruthy();
  expect(secrets.peekSecretLink).not.toHaveBeenCalled();
});

test('gone / vanished / locked / not yet states use the web wording; locked and not-yet cannot open', async () => {
  mockLinking.url = SECRET_URL;
  secrets.peekSecretLink.mockRejectedValueOnce(Object.assign(new Error('failed: gone'), { code: 'gone' }));
  await renderScreen(<SecretViewerRoute />);
  expect(await screen.findByText('This secret has already been opened, or it has expired.')).toBeTruthy();
  expect(screen.getByText('Nothing to reveal')).toBeTruthy();
  await screen.unmount();

  // Geofenced: the app has no location; the website is the honest answer and nothing burned.
  secrets.openSecretLink.mockRejectedValueOnce(Object.assign(new Error('failed: geofence_location_required'), { code: 'geofence_location_required' }));
  await renderScreen(<SecretViewerRoute />);
  await fireEvent.press(await screen.findByTestId('sview.open'));
  expect(await screen.findByText(/needs a location check the app doesn’t do\. Open the link in a browser on onepeek\.io instead\. Nothing has been opened or deleted\./)).toBeTruthy();
  expect(screen.getByTestId('sview.browser')).toBeTruthy();
  expect(screen.getByTestId('sview.open').props.accessibilityState.disabled).toBe(false);
  await screen.unmount();
  secrets.openSecretLink.mockClear();

  secrets.peekSecretLink.mockResolvedValueOnce(peek({ notYet: '2030-01-01T10:00:00.000Z' }));
  await renderScreen(<SecretViewerRoute />);
  expect(await screen.findByTestId('sview.notYet')).toBeTruthy();
  expect(screen.getByText(/This secret can’t be opened yet\. It unlocks .*Nothing has been opened or deleted\./)).toBeTruthy();
  expect(screen.getByTestId('sview.open').props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(screen.getByTestId('sview.open'));
  expect(secrets.openSecretLink).not.toHaveBeenCalled();
  await screen.unmount();

  // Multi-view: the copy counts views, and a failed open that burned nothing goes back to ready.
  secrets.peekSecretLink.mockResolvedValueOnce(peek({ viewsLeft: 3, maxViews: 5 }));
  secrets.openSecretLink.mockRejectedValueOnce(Object.assign(new Error('failed: network'), { code: 'network' }));
  await renderScreen(<SecretViewerRoute />);
  expect(await screen.findByText('This link can be opened 3 more times, then it’s deleted from OnePeek.', { exact: false })).toBeTruthy();
  await fireEvent.press(screen.getByTestId('sview.open'));
  expect(await screen.findByText('We couldn’t reach OnePeek. Check your connection and try again. Nothing has been opened or deleted.')).toBeTruthy();
  expect(screen.getByTestId('sview.open').props.accessibilityState.disabled).toBe(false);
});

test('the content is cleared the moment the app leaves the foreground, and the image temp file with it', async () => {
  mockLinking.url = SECRET_URL;
  secrets.peekSecretLink.mockResolvedValueOnce(peek({}, { type: 'file', name: 'scan.png', mime: 'image/png', size: 4_000_000 }));
  secrets.openSecretLink.mockResolvedValueOnce({ kind: 'file', bytes: new Uint8Array(4_000_000), name: 'scan.png', mime: 'image/png', header: { v: 1, type: 'file', mime: 'image/png' } });
  await renderScreen(<SecretViewerRoute />);
  await fireEvent.press(await screen.findByTestId('sview.open'));
  expect(await screen.findByTestId('sview.image')).toBeTruthy();
  expect(mockFiles.writeTemp).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('sview.save')).toBeTruthy();
  expect(appStateHandlers.length).toBeGreaterThan(0);
  await act(async () => { appStateHandlers.forEach((h) => h('inactive')); });
  expect(screen.queryByTestId('sview.image')).toBeNull();
  expect(await screen.findByTestId('sview.cleared')).toBeTruthy();
  expect(mockFiles.deleteTemp).toHaveBeenCalledWith('file:///cache/onepeek-view/t.png');
  expect(screen.getByText(/It has already been deleted from OnePeek, so the link won’t work again\./)).toBeTruthy();
});

test('noCopy hides Copy and marks the text unselectable; noSave hides Save; the sentence says what the sender turned off', async () => {
  mockLinking.url = SECRET_URL;
  secrets.peekSecretLink.mockResolvedValueOnce(peek({}, { noCopy: true }));
  secrets.openSecretLink.mockResolvedValueOnce({ kind: 'text', text: 'no-copy-text', header: { v: 1, type: 'text', noCopy: true } });
  await renderScreen(<SecretViewerRoute />);
  await fireEvent.press(await screen.findByTestId('sview.open'));
  expect(await screen.findByText('no-copy-text')).toBeTruthy();
  expect(screen.queryByTestId('sview.copy')).toBeNull();
  expect(screen.getByText('no-copy-text').props.selectable).toBe(false);
  expect(screen.getByText('The sender turned off copying for this secret.')).toBeTruthy();
  await screen.unmount();

  secrets.peekSecretLink.mockResolvedValueOnce(peek({}, { type: 'file', name: 'k.pem', mime: 'application/x-pem-file', size: 300, noSave: true }));
  secrets.openSecretLink.mockResolvedValueOnce({ kind: 'file', bytes: new Uint8Array([1, 2, 3]), name: 'k.pem', mime: 'application/x-pem-file', header: { v: 1, type: 'file', noSave: true } });
  await renderScreen(<SecretViewerRoute />);
  await fireEvent.press(await screen.findByTestId('sview.open'));
  expect(await screen.findByTestId('sview.file')).toBeTruthy();
  expect(screen.queryByTestId('sview.save')).toBeNull();
  expect(screen.getByText('The sender turned off saving for this secret.')).toBeTruthy();
  expect(mockFiles.shareBytes).not.toHaveBeenCalled();
});

test('a file that may be saved goes to the share sheet only on a tap', async () => {
  mockLinking.url = SECRET_URL;
  secrets.peekSecretLink.mockResolvedValueOnce(peek({}, { type: 'file', name: 'k.pem', mime: 'application/x-pem-file', size: 3 }));
  secrets.openSecretLink.mockResolvedValueOnce({ kind: 'file', bytes: new Uint8Array([1, 2, 3]), name: 'k.pem', mime: 'application/x-pem-file', header: { v: 1, type: 'file' } });
  await renderScreen(<SecretViewerRoute />);
  await fireEvent.press(await screen.findByTestId('sview.open'));
  await fireEvent.press(await screen.findByTestId('sview.save'));
  await waitFor(() => expect(mockFiles.shareBytes).toHaveBeenCalledWith(expect.any(Uint8Array), 'application/x-pem-file', '.png'));
});

test('guard: the text is not in the tree until held, the watermark shows while held, release hides it again', async () => {
  mockLinking.url = SECRET_URL;
  secrets.peekSecretLink.mockResolvedValueOnce(peek({}, { guard: true }));
  secrets.openSecretLink.mockResolvedValueOnce({ kind: 'text', text: 'guarded-text', header: { v: 1, type: 'text', guard: true } });
  await renderScreen(<SecretViewerRoute />);
  expect(await screen.findByText('hold to view')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('sview.open'));
  const hold = await screen.findByTestId('sview.hold');
  expect(screen.queryByText('guarded-text')).toBeNull();
  expect(screen.queryByTestId('security.watermark')).toBeNull();
  expect(treeText()).not.toContain('guarded-text');
  await act(async () => { fireEvent(hold, 'pressIn'); });
  expect(screen.getByText('guarded-text')).toBeTruthy();
  expect(screen.getByTestId('security.watermark')).toBeTruthy();
  await act(async () => { fireEvent(hold, 'pressOut'); });
  expect(screen.queryByText('guarded-text')).toBeNull();
  expect(screen.queryByTestId('security.watermark')).toBeNull();
});

test('timer: counts down after opening, then the secret vanishes', async () => {
  jest.useFakeTimers();
  mockLinking.url = SECRET_URL;
  secrets.peekSecretLink.mockResolvedValueOnce(peek({}, { timer: 3 }));
  secrets.openSecretLink.mockResolvedValueOnce({ kind: 'text', text: 'timed-text', header: { v: 1, type: 'text', timer: 3 } });
  await renderScreen(<SecretViewerRoute />);
  expect(await screen.findByText('vanishes 3s after opening')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('sview.open'));
  expect(await screen.findByText('timed-text')).toBeTruthy();
  expect(screen.getByTestId('sview.timer')).toBeTruthy();
  expect(screen.getByText('3s')).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(screen.getByText('2s')).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(screen.getByText('1s')).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(screen.queryByText('timed-text')).toBeNull();
  expect(screen.getByTestId('sview.vanished')).toBeTruthy();
  expect(screen.getByText('The viewing time set by the sender ran out. It’s gone from this phone and from OnePeek.')).toBeTruthy();
});

test('Wi-Fi: network, password and a join QR; Copy copies the password; Close leaves', async () => {
  mockLinking.url = SECRET_URL;
  secrets.peekSecretLink.mockResolvedValueOnce(peek({}, { tpl: 'wifi' }));
  secrets.openSecretLink.mockResolvedValueOnce({ kind: 'wifi', wifi: { ssid: 'Office-5G', password: 'Spring2026!', security: 'WPA' }, header: { v: 1, type: 'text', tpl: 'wifi' } });
  await renderScreen(<SecretViewerRoute />);
  expect(await screen.findByText('Someone sent you Wi-Fi details')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('sview.open'));
  expect(await screen.findByTestId('sview.wifi')).toBeTruthy();
  expect(screen.getByText('Office-5G')).toBeTruthy();
  expect(screen.getByText('Spring2026!')).toBeTruthy();
  expect(screen.getByTestId('qr').props.accessibilityValue.text).toBe('WIFI:T:WPA;S:Office-5G;P:Spring2026!;;');
  await fireEvent.press(screen.getByTestId('sview.copy'));
  await waitFor(() => expect(mockClipboard.setStringAsync).toHaveBeenCalledWith('Spring2026!'));
  await fireEvent.press(screen.getByTestId('sview.done'));
  expect(router.back).toHaveBeenCalled();
});

test('recipient lock (C4): email → code → token (a string, P2-7); open carries the token and the email, the watermark names the email', async () => {
  mockLinking.url = SECRET_URL;
  secrets.peekSecretLink.mockResolvedValueOnce(peek({ locked: true, lockHint: 'r***@example.test' }, { guard: true }));
  secrets.openSecretLink.mockResolvedValueOnce({ kind: 'text', text: 'for-rahul-only', header: { v: 1, type: 'text', guard: true } });
  await renderScreen(<SecretViewerRoute />);
  expect(await screen.findByTestId('sview.locked')).toBeTruthy();
  expect(screen.getByText('This secret is for r***@example.test. Confirm it’s you with a one-time code.')).toBeTruthy();
  expect(screen.getByTestId('sview.open').props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(screen.getByTestId('sview.sendCode'));   // disabled while empty
  expect(secrets.requestUnlockCode).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByTestId('sview.lockEmail'), 'not-an-email');
  await fireEvent.press(screen.getByTestId('sview.sendCode'));
  expect(await screen.findByText('Enter your email address.')).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId('sview.lockEmail'), 'rahul@example.test');
  await fireEvent.press(screen.getByTestId('sview.sendCode'));
  await waitFor(() => expect(secrets.requestUnlockCode).toHaveBeenCalledWith(SECRET_URL, 'rahul@example.test'));
  expect(await screen.findByTestId('sview.lockCode')).toBeTruthy();
  secrets.verifyUnlockCode.mockRejectedValueOnce(Object.assign(new Error('failed: wrong_code'), { code: 'wrong_code' }));
  await fireEvent.changeText(screen.getByTestId('sview.lockCode'), '12345a6');
  expect(screen.getByTestId('sview.lockCode').props.value).toBe('123456');
  await fireEvent.press(screen.getByTestId('sview.verifyCode'));
  expect(await screen.findByText('That code isn’t right. Try again.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('sview.verifyCode'));
  await waitFor(() => expect(secrets.verifyUnlockCode).toHaveBeenCalledTimes(2));
  expect(await screen.findByTestId('sview.unlocked')).toBeTruthy();
  expect(screen.queryByTestId('sview.locked')).toBeNull();
  expect(screen.getByTestId('sview.open').props.accessibilityState.disabled).toBe(false);
  await fireEvent.press(screen.getByTestId('sview.open'));
  await waitFor(() => expect(secrets.openSecretLink).toHaveBeenCalledWith(SECRET_URL, { email: 'rahul@example.test', token: 'unlock-token-for-tests' }));
  expect(await screen.findByTestId('sview.hold')).toBeTruthy();
  // The unlock token and the code are never drawn.
  expect(treeText()).not.toContain('unlock-token-for-tests');
});

test('recipient lock: the server saying recipient_locked on open resets the code step without burning', async () => {
  mockLinking.url = SECRET_URL;
  secrets.peekSecretLink.mockResolvedValueOnce(peek({ locked: true, lockHint: 'r***@example.test' }));
  secrets.openSecretLink.mockRejectedValueOnce(Object.assign(new Error('failed: recipient_locked'), { code: 'recipient_locked' }));
  await renderScreen(<SecretViewerRoute />);
  await fireEvent.changeText(await screen.findByTestId('sview.lockEmail'), 'rahul@example.test');
  await fireEvent.press(screen.getByTestId('sview.sendCode'));
  await fireEvent.changeText(await screen.findByTestId('sview.lockCode'), '123456');
  await fireEvent.press(screen.getByTestId('sview.verifyCode'));
  await fireEvent.press(await screen.findByTestId('sview.open'));
  expect(await screen.findByText('Confirm your email with a new code first. Nothing has been opened or deleted.')).toBeTruthy();
  expect(screen.getByTestId('sview.lockEmail')).toBeTruthy();
  expect(screen.getByTestId('sview.open').props.accessibilityState.disabled).toBe(true);
});

describe('location notice (release finding: the sender asked to see where it is opened)', () => {
  const NOTICE = 'The sender asked to see where this is opened. OnePeek on this phone never reads your location, so opening shares only an approximate city from your network.';

  test('shown before Open when the peek carries shareLocation; Open still works and sends no location', async () => {
    mockLinking.url = SECRET_URL;
    secrets.peekSecretLink.mockResolvedValueOnce({ ...peek(), shareLocation: true, fence: null } as never);
    await renderScreen(<SecretViewerRoute />);
    expect(await screen.findByTestId('sview.open')).toBeTruthy();
    expect(screen.getByTestId('sview.location')).toBeTruthy();
    expect(screen.getByText(NOTICE)).toBeTruthy();
    expect(screen.getByText('shares location')).toBeTruthy();
    expect(secrets.openSecretLink).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('sview.open'));
    await waitFor(() => expect(secrets.openSecretLink).toHaveBeenCalledWith(SECRET_URL));
    // The app has no precise option: whatever the screen passes, it is never coordinates.
    expect(JSON.stringify(secrets.openSecretLink.mock.calls[0])).not.toMatch(/lat|lon|accuracy/);
  });

  test('absent when the sender did not ask', async () => {
    mockLinking.url = SECRET_URL;
    secrets.peekSecretLink.mockResolvedValueOnce({ ...peek(), shareLocation: false, fence: null } as never);
    await renderScreen(<SecretViewerRoute />);
    expect(await screen.findByTestId('sview.open')).toBeTruthy();
    expect(screen.queryByTestId('sview.location')).toBeNull();
    expect(screen.queryByText('shares location')).toBeNull();
  });
});
