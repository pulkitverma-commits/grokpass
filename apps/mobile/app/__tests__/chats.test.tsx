/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import ChatsScreen from '../index';
import { chat, resetChatMock, room } from '../../test/chat-mock';
import { resetRouter, router } from '../../test/expo-router-mock';
import { renderScreen } from '../../test/render';

jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('@/lib/chat', () => require('../../test/chat-mock').chatMock);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const ROOMS = [
  room({ id: 'aaaaaaaa-0000-0000-0000-000000000001', kind: 'secret', name: 'Vault handover' }),
  room({ id: 'bbbbbbbb-0000-0000-0000-000000000002', kind: 'quick', name: null, role: 'member' }),
  room({ id: 'cccccccc-0000-0000-0000-000000000003', kind: 'business', name: 'Legal review', role: 'member', memberState: 'pending' }),
];

beforeEach(() => { resetChatMock(); resetRouter(); });

test('lists rooms from myRooms() with kind badges and pending state, and opens a room', async () => {
  chat.myRooms.mockResolvedValue(ROOMS);
  await renderScreen(<ChatsScreen />);
  const rows = await screen.findAllByTestId('chats.room');
  expect(rows).toHaveLength(3);
  expect(rows[0]!.props.accessibilityLabel).toBe('Vault handover');
  expect(rows[1]!.props.accessibilityLabel).toBe('Quick Chat · BBBB');
  expect(screen.getByText('Waiting to be let in')).toBeTruthy();
  expect(screen.getAllByText('Secret')).toBeTruthy();
  expect(screen.getByText(/Secret Chat · ends in 5:5\d|Secret Chat · ends in 6h/)).toBeTruthy();
  await fireEvent.press(rows[0]!);
  expect(router.push).toHaveBeenCalledWith('/room/aaaaaaaa-0000-0000-0000-000000000001');
});

test('search filters by name and kind', async () => {
  chat.myRooms.mockResolvedValue(ROOMS);
  await renderScreen(<ChatsScreen />);
  await screen.findAllByTestId('chats.room');
  await fireEvent.changeText(screen.getByTestId('chats.search'), 'vault');
  expect(screen.getAllByTestId('chats.room')).toHaveLength(1);
  await fireEvent.changeText(screen.getByTestId('chats.search'), 'quick');
  expect(screen.getAllByTestId('chats.room')).toHaveLength(1);
  await fireEvent.changeText(screen.getByTestId('chats.search'), 'zzz');
  expect(screen.queryAllByTestId('chats.room')).toHaveLength(0);
  expect(screen.getByTestId('chats.noMatch')).toBeTruthy();
});

test('empty state uses the web copy and routes to New chat', async () => {
  await renderScreen(<ChatsScreen />);
  expect(await screen.findByTestId('chats.empty')).toBeTruthy();
  expect(screen.getByText('No active chats on this device.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('chats.new'));
  expect(router.push).toHaveBeenCalledWith('/new');
  await fireEvent.press(screen.getByTestId('chats.settings'));
  expect(router.push).toHaveBeenCalledWith('/settings');
  await fireEvent.press(screen.getByTestId('chats.secret'));
  expect(router.push).toHaveBeenCalledWith('/secret');
});

test('a pending joiner on an owned room gets a Let in row that calls admitPending for that device', async () => {
  chat.myRooms.mockResolvedValue([ROOMS[0]!]);
  chat.members.mockResolvedValue([
    { deviceId: 'dddddddd-1111-0000-0000-000000000000', state: 'pending', hasKeyPackage: true, role: 'member' },
    { deviceId: 'eeeeeeee-2222-0000-0000-000000000000', state: 'active', hasKeyPackage: true, role: 'owner' },
  ]);
  await renderScreen(<ChatsScreen />);
  const letIn = await screen.findByTestId('chats.letIn');
  expect(screen.getByText('Guest DDDD wants to join')).toBeTruthy();
  expect(screen.getByText('Vault handover · used your invite')).toBeTruthy();
  await fireEvent.press(letIn);
  await waitFor(() => expect(chat.admitPending).toHaveBeenCalledWith('aaaaaaaa-0000-0000-0000-000000000001', ['dddddddd-1111-0000-0000-000000000000']));
  await waitFor(() => expect(screen.queryByTestId('chats.letIn')).toBeNull());
});

test('a keystore_unavailable error routes to the reset screen', async () => {
  chat.myRooms.mockRejectedValueOnce(Object.assign(new Error('wrapping key missing: keystore_unavailable'), { code: 'keystore_unavailable' }));
  await renderScreen(<ChatsScreen />);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/reset'));
});
