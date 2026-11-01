/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { RoomMenu, type Member, type MenuView } from '../room/RoomMenu';
import { chat, resetChatMock, room, THEM } from '../../test/chat-mock';
import { resetRouter } from '../../test/expo-router-mock';
import { renderScreen } from '../../test/render';

const mockPanic = jest.fn();
jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('@/lib/chat', () => require('../../test/chat-mock').chatMock);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-qrcode-svg', () => { const { View } = require('react-native'); function QrMock() { return <View testID="qr" />; } return QrMock; });
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/security', () => ({ ...jest.requireActual('@/security/constants'), useSecurity: () => ({ panic: mockPanic }) }));
const mockFetch = jest.fn(async () => ({ ok: true, status: 200 }));

const ME = 'dddddddd-0000-0000-0000-00000000000d';
const ROOM = room({ id: 'aaaaaaaa-0000-0000-0000-000000000001', kind: 'secret', name: 'Vault handover', ttl: 30 });
const MEMBERS: Member[] = [
  { deviceId: ME, role: 'owner', state: 'active', signaturePub: new Uint8Array([1]), hasKeyPackage: true, nickname: 'Pulkit', verified: null },
  { deviceId: THEM, role: 'member', state: 'active', signaturePub: new Uint8Array([2]), hasKeyPackage: true, nickname: 'Bea', verified: null },
];

function Harness({ initial, onGone = jest.fn(), onChange = jest.fn(), role = 'owner' as 'owner' | 'member', blocked = [] as string[] }: { initial: MenuView; onGone?: () => void; onChange?: () => void; role?: 'owner' | 'member'; blocked?: string[] }) {
  const [view, setView] = useState<MenuView>(initial);
  return <RoomMenu view={view} setView={setView} room={{ ...ROOM, role }} title="Vault handover" members={MEMBERS} me={ME} ttl={30} setTtl={jest.fn()} blocked={blocked} onChange={onChange} onGone={onGone} />;
}

beforeEach(() => { resetChatMock(); resetRouter(); mockPanic.mockClear(); mockFetch.mockClear().mockResolvedValue({ ok: true, status: 200 }); (globalThis as { fetch: unknown }).fetch = mockFetch; });

test('burn needs two taps: room.burn opens the confirmation, room.burn.confirm calls burn() and leaves', async () => {
  const onGone = jest.fn();
  await renderScreen(<Harness initial="menu" onGone={onGone} />);
  await fireEvent.press(await screen.findByTestId('room.burn'));
  expect(chat.burn).not.toHaveBeenCalled();
  expect(await screen.findByText('Burn this chat?')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('room.burn.confirm'));
  await waitFor(() => expect(chat.burn).toHaveBeenCalledWith(ROOM.id));
  expect(onGone).toHaveBeenCalled();
});

test('a member sees Leave instead of Burn; the confirmation calls leave()', async () => {
  await renderScreen(<Harness initial="menu" role="member" />);
  expect(screen.queryByTestId('room.burn')).toBeNull();
  await fireEvent.press(await screen.findByTestId('room.leave'));
  await fireEvent.press(await screen.findByTestId('room.leave.confirm'));
  await waitFor(() => expect(chat.leave).toHaveBeenCalledWith(ROOM.id));
});

test('Panic Exit in the menu calls panic()', async () => {
  await renderScreen(<Harness initial="menu" />);
  await fireEvent.press(await screen.findByTestId('room.panic'));
  expect(mockPanic).toHaveBeenCalledTimes(1);
});

test('safety number comes from safetyNumberWith, in groups of five with a QR; mark verified calls markVerified', async () => {
  const onChange = jest.fn();
  await renderScreen(<Harness initial="verify" onChange={onChange} />);
  await waitFor(() => expect(chat.safetyNumberWith).toHaveBeenCalledWith(ROOM.id, THEM));
  expect(await screen.findByTestId('verify.number')).toBeTruthy();
  expect(screen.getAllByText('12345')).toHaveLength(6);
  expect(screen.getByTestId('qr')).toBeTruthy();
  // F-2 fixed in the core: the numbers come from the keys inside the encrypted group, and the copy says that much.
  expect(screen.getByText('Compare these numbers in person or on a call. If they match, these are the keys inside your encrypted chat.')).toBeTruthy();
  expect(screen.queryByText(/does not yet prove/)).toBeNull();
  expect(screen.queryByText(/intercept/i)).toBeNull();
  expect(screen.getByText('They match — mark verified')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('verify.mark'));
  await waitFor(() => expect(chat.markVerified).toHaveBeenCalledWith(ROOM.id, THEM));
  expect(onChange).toHaveBeenCalled();
});

test('F-2: a member whose key does not match the chat: the verify view shows the mismatch message and no number to mark verified', async () => {
  chat.safetyNumberWith.mockRejectedValueOnce(Object.assign(new Error('member_key_mismatch'), { code: 'member_key_mismatch' }));
  await renderScreen(<Harness initial="verify" />);
  expect(await screen.findByText('This member’s key doesn’t match the chat. Don’t trust this chat until you’ve checked with them.')).toBeTruthy();
  expect(screen.queryByTestId('verify.number')).toBeNull();
  await fireEvent.press(screen.getByTestId('verify.mark'));
  expect(chat.markVerified).not.toHaveBeenCalled();
});

test('members: the owner can remove someone after confirming; removeMember gets the device id', async () => {
  await renderScreen(<Harness initial="members" />);
  const rows = await screen.findAllByTestId('members.row');
  expect(rows).toHaveLength(2);
  expect(screen.getAllByTestId('members.remove')).toHaveLength(1);   // not for yourself
  await fireEvent.press(screen.getByTestId('members.remove'));
  expect(chat.removeMember).not.toHaveBeenCalled();
  await fireEvent.press(await screen.findByTestId('members.remove.yes'));
  await waitFor(() => expect(chat.removeMember).toHaveBeenCalledWith(ROOM.id, THEM));
});

test('timer: the owner saves a room default through setTimer', async () => {
  await renderScreen(<Harness initial="timer" />);
  await fireEvent.press(await screen.findByTestId('timer.mode.sent'));
  await fireEvent.press(screen.getByTestId('timer.save'));
  await waitFor(() => expect(chat.setTimer).toHaveBeenCalledWith(ROOM.id, 30, 'on_send'));
});

test('invite: creates with the chosen expiry and uses, lists and revokes existing invites', async () => {
  chat.listInvites.mockResolvedValue([{ id: 'inv-9', expires_at: new Date(Date.now() + 3600_000).toISOString(), max_uses: 5, uses: 1, requires_approval: false, revoked_at: null }]);
  await renderScreen(<Harness initial="invite" />);
  expect(await screen.findByTestId('invite.row')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('invite.expires.3600'));
  await fireEvent.press(screen.getByTestId('invite.uses.5'));
  await fireEvent.press(screen.getByTestId('invite.create'));
  await waitFor(() => expect(chat.createInvite).toHaveBeenCalledWith(ROOM.id, { expiresIn: 3600, maxUses: 5, approval: false }));
  expect(await screen.findByTestId('invite.link')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('invite.revoke'));
  await waitFor(() => expect(chat.revokeInvite).toHaveBeenCalledWith('inv-9'));
});

test('rename: setRoomName with the typed name', async () => {
  await renderScreen(<Harness initial="rename" />);
  await fireEvent.changeText(await screen.findByTestId('rename.name'), 'Handover');
  await fireEvent.press(screen.getByTestId('rename.save'));
  await waitFor(() => expect(chat.setRoomName).toHaveBeenCalledWith(ROOM.id, 'Handover'));
});

test('U8 block: any member can block another on this phone; confirm writes the keystore list; the copy says it is local; Unblock removes it', async () => {
  const onChange = jest.fn();
  await renderScreen(<Harness initial="members" role="member" onChange={onChange} />);
  const rows = await screen.findAllByTestId('members.row');
  expect(rows).toHaveLength(2);
  expect(screen.queryByTestId('members.remove')).toBeNull();   // not the owner
  expect(screen.getAllByTestId('members.block')).toHaveLength(1);   // never for me
  await fireEvent.press(screen.getByTestId('members.block'));
  expect(await screen.findByTestId('members.block.confirm')).toBeTruthy();
  expect(screen.getByText(/Block Bea on this phone\? Their messages are hidden here only\. They stay in the chat, keep seeing it, and aren’t told\./)).toBeTruthy();
  expect(chat.keystore.put).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('members.block.yes'));
  await waitFor(() => expect(chat.keystore.put).toHaveBeenCalledWith(`room:${ROOM.id}:blocked`, [THEM]));
  expect(onChange).toHaveBeenCalled();
  expect(chat.removeMember).not.toHaveBeenCalled();
  await screen.unmount();
  // Already blocked: the row says so and offers Unblock.
  await renderScreen(<Harness initial="members" role="owner" blocked={[THEM]} />);
  expect(await screen.findByText(/Blocked on this phone/)).toBeTruthy();
  expect(screen.getByTestId('members.remove')).toBeTruthy();   // the owner still has Remove
  await fireEvent.press(screen.getByTestId('members.unblock'));
  await waitFor(() => expect(chat.keystore.put).toHaveBeenCalledWith(`room:${ROOM.id}:blocked`, []));
});

test('U8 report: the menu item opens the reason view; Send posts only the room id and the reason', async () => {
  await renderScreen(<Harness initial="menu" />);
  await fireEvent.press(await screen.findByTestId('room.menu.report'));
  expect(await screen.findByTestId('report.reason')).toBeTruthy();
  expect(screen.getByText(/Only the chat’s id and your reason are sent: no messages, names or files/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('report.reason.abuse'));
  await fireEvent.press(screen.getByTestId('report.send'));
  expect(await screen.findByTestId('report.sent')).toBeTruthy();
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [url, init] = (mockFetch.mock.calls as unknown as [string, RequestInit][])[0]!;
  expect(url).toBe('https://onepeek.io/api/chat/report');
  expect(JSON.parse(String(init.body))).toEqual({ room: ROOM.id, reason: 'abuse' });
  expect(String(init.body)).not.toMatch(/Vault|Bea|Pulkit/);
  expect(chat.messages).not.toHaveBeenCalled();
});

test('U8 report: a failed post shows report.error and leaves the button', async () => {
  mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
  await renderScreen(<Harness initial="report" />);
  await fireEvent.press(await screen.findByTestId('report.send'));
  expect(await screen.findByTestId('report.error')).toBeTruthy();
  expect(screen.getByText('The report couldn’t be sent. Try again.')).toBeTruthy();
  expect(screen.getByTestId('report.send')).toBeTruthy();
});

test('U8 verify: "Scan their code" closes the menu and opens the scanner for this room', async () => {
  await renderScreen(<Harness initial="verify" />);
  await fireEvent.press(await screen.findByTestId('verify.scan'));
  const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
  expect(router.push).toHaveBeenCalledWith({ pathname: '/scan', params: { room: ROOM.id } });
  await waitFor(() => expect(screen.queryByTestId('verify.scan')).toBeNull());
});
