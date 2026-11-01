/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
// "Send as a one-time secret" (U8, design 07): options reach createSecretLink, the result is masked,
// the full link goes only to the clipboard / share / the chat send, and "Send in this chat" hands the
// text or file to the room.
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import SecretScreen from '../secret';
import { SecretComposer } from '../../components/SecretComposer';
import { resetRouter, router } from '../../test/expo-router-mock';
import { renderScreen } from '../../test/render';
import { resetSecretsMock, secrets, SECRET_KEY, SECRET_URL } from '../../test/secrets-mock';

const mockPicked = { uri: 'file:///cache/ImagePicker/x.png', name: 'passport.png', mime: 'image/png', size: 2_500_000, read: async () => new Uint8Array([1]) };
const mockClipboard = { setStringAsync: jest.fn(async () => true) };
const mockShare = { share: jest.fn(async () => ({ action: 'sharedAction' })) };

jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('@/lib/chat', () => require('../../test/chat-mock').chatMock);
jest.mock('@/lib/secrets', () => require('../../test/secrets-mock').secretsMock);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-qrcode-svg', () => { const { View } = require('react-native'); function QrMock(p: { value: string }) { return <View testID="qr" accessibilityValue={{ text: p.value }} />; } return QrMock; });
jest.mock('expo-clipboard', () => ({ setStringAsync: (s: string) => (mockClipboard.setStringAsync as unknown as (s: string) => Promise<boolean>)(s) }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock('@/security', () => ({ ...jest.requireActual('@/security/constants'), useSecureScreen: jest.fn() }));
jest.mock('@/lib/files', () => ({
  MAX_ATTACHMENT_BYTES: 50 * 1024 * 1024 - 1024,
  fileSize: (n: number) => `${(n / 1048576).toFixed(1)} MB`,
  pickPhoto: jest.fn(async () => mockPicked),
  pickDocument: jest.fn(async () => null),
  deletePicked: jest.fn(),
  fileSource: (p: typeof mockPicked) => ({ name: p.name, mime: p.mime, size: p.size, bytes: p.read }),
}));
jest.mock('react-native/Libraries/Share/Share', () => ({ __esModule: true, default: { share: (o: unknown) => (mockShare.share as unknown as (o: unknown) => Promise<unknown>)(o) } }));

const files = () => jest.requireMock('@/lib/files') as { deletePicked: jest.Mock; pickPhoto: jest.Mock };

beforeEach(() => {
  resetRouter(); resetSecretsMock();
  mockClipboard.setStringAsync.mockClear(); mockShare.share.mockClear();
  files().deletePicked.mockClear(); files().pickPhoto.mockResolvedValue(mockPicked);
});

/** Every string the tree shows or announces (children and string props), for "key never drawn" checks. */
function treeStrings(): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n === null || n === undefined || typeof n === 'boolean') return;
    if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const node = n as { props?: Record<string, unknown>; children?: unknown[] };
    for (const [k, v] of Object.entries(node.props ?? {})) {
      if (k === 'style' || k === 'testID' || typeof v === 'function') continue;
      if (typeof v === 'string') out.push(v);
      else if (v && typeof v === 'object' && 'text' in (v as object)) out.push(String((v as { text: unknown }).text));
    }
    node.children?.forEach(walk);
  };
  walk(screen.toJSON());
  return out.join('\n');
}

test('text secret: the chosen options reach createSecretLink; the key is never drawn; Copy and Share get the full link', async () => {
  await renderScreen(<SecretScreen />);
  expect(await screen.findByTestId('secret.screen')).toBeTruthy();
  expect(screen.getByTestId('secret.link').props.accessibilityState.disabled).toBe(true);
  await fireEvent.changeText(screen.getByTestId('secret.text'), 'The vault code is 9182.');
  await fireEvent.press(screen.getByTestId('secret.views.3'));
  await fireEvent.press(screen.getByTestId('secret.expires.3600'));
  await fireEvent.press(screen.getByTestId('secret.timer.30'));
  await fireEvent(screen.getByTestId('secret.guard'), 'valueChange', true);
  await fireEvent(screen.getByTestId('secret.allowCopy'), 'valueChange', false);
  await fireEvent.press(screen.getByTestId('secret.link'));
  await waitFor(() => expect(secrets.createSecretLink).toHaveBeenCalledWith({ kind: 'text', text: 'The vault code is 9182.' }, { ttlSeconds: 3600, views: 3, timer: 30, guard: true, noCopy: true }));
  expect(await screen.findByTestId('secret.result')).toBeTruthy();
  // Masked on screen: the id may show, the key never does; the QR carries the full link (it is the sharing surface).
  expect(screen.getByTestId('secret.resultLink').props.children).toBe(`https://onepeek.io/s/abcdefgh12345678#••••••`);
  const drawn = treeStrings().split('\n').filter((s) => s !== SECRET_URL);   // the QR value is the link by design
  expect(drawn.join('\n')).not.toContain(SECRET_KEY);
  expect(screen.getByText('Can be opened 3 times and expires in 1 hour if unopened. The key is in the link itself, so share it the way you’d share the secret.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('secret.copy'));
  await waitFor(() => expect(mockClipboard.setStringAsync).toHaveBeenCalledWith(SECRET_URL));
  await fireEvent.press(screen.getByTestId('secret.share'));
  await waitFor(() => expect(mockShare.share).toHaveBeenCalledWith({ message: SECRET_URL, url: SECRET_URL }));
  // No chat here: no "Send link in this chat".
  expect(screen.queryByTestId('secret.sendLink')).toBeNull();
  await fireEvent.press(screen.getByTestId('secret.done'));
  expect(router.back).toHaveBeenCalled();
});

test('defaults: once, 1 day, no timer, no guard, copying allowed → the minimal options object; the field is emptied after the link is made', async () => {
  await renderScreen(<SecretScreen />);
  await fireEvent.changeText(await screen.findByTestId('secret.text'), 'hunter2');
  await fireEvent.press(screen.getByTestId('secret.link'));
  await waitFor(() => expect(secrets.createSecretLink).toHaveBeenCalledWith({ kind: 'text', text: 'hunter2' }, { ttlSeconds: 86400, views: 1 }));
  await screen.findByTestId('secret.result');
  await fireEvent.press(screen.getByTestId('secret.done'));
  await waitFor(() => expect(screen.queryByTestId('secret.result')).toBeNull());
  expect(screen.getByTestId('secret.text').props.value).toBe('');
  expect(screen.queryByText('hunter2')).toBeNull();
});

test('file secret: the picked file goes as a FileSource with noSave when saving is off, and the picker copy is deleted after', async () => {
  await renderScreen(<SecretScreen />);
  await fireEvent.press(await screen.findByTestId('secret.photo'));
  expect(await screen.findByTestId('secret.picked')).toBeTruthy();
  expect(screen.queryByTestId('secret.text')).toBeNull();
  expect(screen.queryByTestId('secret.allowCopy')).toBeNull();
  await fireEvent(screen.getByTestId('secret.allowSave'), 'valueChange', false);
  await fireEvent.press(screen.getByTestId('secret.link'));
  await waitFor(() => expect(secrets.createSecretLink).toHaveBeenCalledWith({ kind: 'file', file: expect.objectContaining({ name: 'passport.png', size: 2_500_000 }) }, { ttlSeconds: 86400, views: 1, noSave: true }));
  await waitFor(() => expect(files().deletePicked).toHaveBeenCalledWith(mockPicked));
  expect(await screen.findByTestId('secret.result')).toBeTruthy();
});

test('an oversize pick is refused and its copy deleted; createSecretLink errors show secret.error', async () => {
  const big = { ...mockPicked, size: 60 * 1024 * 1024 };
  files().pickPhoto.mockResolvedValueOnce(big);
  await renderScreen(<SecretScreen />);
  await fireEvent.press(await screen.findByTestId('secret.photo'));
  expect(await screen.findByTestId('secret.error')).toBeTruthy();
  expect(files().deletePicked).toHaveBeenCalledWith(big);
  expect(screen.queryByTestId('secret.picked')).toBeNull();
  secrets.createSecretLink.mockRejectedValueOnce(Object.assign(new Error('failed: quota_exceeded'), { code: 'quota_exceeded' }));
  await fireEvent.changeText(screen.getByTestId('secret.text'), 'x');
  await fireEvent.press(screen.getByTestId('secret.link'));
  expect(await screen.findByText('You’ve used this month’s free secrets. See onepeek.io/pricing.')).toBeTruthy();
  expect(screen.queryByTestId('secret.result')).toBeNull();
});

test('in a chat: "Send in this chat" hands the text to the room and closes; "Send link in this chat" sends the full link', async () => {
  const onSendInChat = jest.fn(async () => {});
  const onSendLinkInChat = jest.fn(async () => {});
  const onDone = jest.fn();
  await renderScreen(<SecretComposer target={{ roomId: 'r1', ttl: 30, secret: true }} onSendInChat={onSendInChat} onSendLinkInChat={onSendLinkInChat} onDone={onDone} />);
  expect(screen.getByText('In this chat it’s a message they press and hold to read, gone 30s after reading.')).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId('secret.text'), 'The vault code is 9182.');
  await fireEvent.press(screen.getByTestId('secret.sendChat'));
  await waitFor(() => expect(onSendInChat).toHaveBeenCalledWith({ kind: 'text', text: 'The vault code is 9182.' }));
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(secrets.createSecretLink).not.toHaveBeenCalled();
  // Now the link path.
  await fireEvent.changeText(screen.getByTestId('secret.text'), 'second');
  await fireEvent.press(screen.getByTestId('secret.link'));
  await fireEvent.press(await screen.findByTestId('secret.sendLink'));
  await waitFor(() => expect(onSendLinkInChat).toHaveBeenCalledWith(SECRET_URL));
  expect(onDone).toHaveBeenCalledTimes(2);
});

test('in a Quick chat the copy is honest about text landing in the open; a file goes view once', async () => {
  const onSendInChat = jest.fn(async () => {});
  await renderScreen(<SecretComposer target={{ roomId: 'r1', ttl: 60, secret: false }} onSendInChat={onSendInChat} onDone={jest.fn()} />);
  expect(screen.getByText('In this chat it’s a normal message that disappears 1m after reading. Use a link for one-time opening.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('secret.photo'));
  await screen.findByTestId('secret.picked');
  expect(screen.getByText('In this chat it goes as a view-once file that disappears 1m after it’s opened.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('secret.sendChat'));
  await waitFor(() => expect(onSendInChat).toHaveBeenCalledWith({ kind: 'file', picked: mockPicked }));
});

test('Wi-Fi template: network, password and security go as a wifi input; "No password" drops the field; the password is cleared after', async () => {
  await renderScreen(<SecretScreen />);
  await fireEvent.press(await screen.findByTestId('secret.mode.wifi'));
  expect(screen.queryByTestId('secret.text')).toBeNull();
  expect(screen.getByTestId('secret.link').props.accessibilityState.disabled).toBe(true);
  await fireEvent.changeText(screen.getByTestId('secret.wifi.ssid'), 'Office-5G');
  expect(screen.getByTestId('secret.link').props.accessibilityState.disabled).toBe(true);   // WPA needs a password
  await fireEvent.changeText(screen.getByTestId('secret.wifi.password'), 'Spring2026!');
  await fireEvent(screen.getByTestId('secret.wifi.hidden'), 'valueChange', true);
  await fireEvent.press(screen.getByTestId('secret.link'));
  await waitFor(() => expect(secrets.createSecretLink).toHaveBeenCalledWith({ kind: 'wifi', wifi: { ssid: 'Office-5G', password: 'Spring2026!', security: 'WPA', hidden: true } }, { ttlSeconds: 86400, views: 1 }));
  await screen.findByTestId('secret.result');
  await fireEvent.press(screen.getByTestId('secret.done'));
  await waitFor(() => expect(screen.queryByTestId('secret.result')).toBeNull());
  expect(screen.getByTestId('secret.wifi.password').props.value).toBe('');
  await fireEvent.press(screen.getByTestId('secret.wifi.security.nopass'));
  expect(screen.queryByTestId('secret.wifi.password')).toBeNull();
  expect(screen.getByTestId('secret.link').props.accessibilityState.disabled).toBe(false);
});
