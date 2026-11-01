/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
// Import-shape test (review P2-7): the viewer's recipient-lock flow against the REAL `lib/secrets`
// (and so the real core), with the Supabase fake and a faked `fetch`. Pins the contract the screen
// relies on: `verifyUnlockCode` resolves to the unlock token string, and that string reaches
// `/api/open` as `unlockToken`. `secret-viewer.test.tsx` covers the states with the mock; this file
// makes sure the mock and the module cannot drift apart again.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SecretViewerRoute from '../s/[id]';
import { createSecretLink } from '../../lib/secrets';
import { resetRouter, setLocalParams } from '../../test/expo-router-mock';

const mockLinking = { url: null as string | null };

jest.mock('expo-router', () => require('../../test/expo-router-mock'));
jest.mock('expo-linking', () => ({ useLinkingURL: () => mockLinking.url }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-qrcode-svg', () => { const { View } = require('react-native'); function QrMock() { return <View testID="qr" />; } return QrMock; });
jest.mock('expo-image', () => { const { View } = require('react-native'); return { Image: (p: { testID?: string }) => <View testID={p.testID ?? 'image'} /> }; });
jest.mock('@/security', () => ({
  ...jest.requireActual('@/security/constants'),
  useSecureScreen: jest.fn(),
  forgetLinkingURL: jest.fn(),
  Watermark: () => { const { View } = require('react-native'); return <View testID="security.watermark" />; },
}));
jest.mock('@/lib/files', () => ({
  DATA_URI_LIMIT: 3 * 1024 * 1024,
  dataUri: () => 'data:image/png;base64,AQID',
  writeTemp: jest.fn(async () => 'file:///cache/onepeek-view/t.png'),
  deleteTemp: jest.fn(),
  shareBytes: jest.fn(async () => {}),
  extensionOf: () => '.png',
  fileSize: (n: number) => `${n} B`,
  clearPickerCaches: async () => {},
}));
// The real lib/chat builds the real core client over these fakes (as lib/__tests__/secrets.test.ts does).
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { supabaseUrl: 'https://xyzcompany.supabase.co', supabaseAnonKey: 'anon-key-for-tests', siteUrl: 'https://onepeek.io' } } },
}));
jest.mock('expo-device', () => ({ modelName: 'iPhone 15', osName: 'iOS', osVersion: '18.1', deviceName: "Pulkit's iPhone" }));
jest.mock('expo-sqlite', () => {
  const { createFakeSqlite } = jest.requireActual('../../lib/__tests__/fake-sqlite');
  const fake = createFakeSqlite();
  return { __esModule: true, openDatabaseSync: (name: string) => fake.openDatabaseSync(name), __fake: fake };
});
jest.mock('@supabase/supabase-js', () => {
  const { createFakeSupabase } = jest.requireActual('../../lib/__tests__/fake-supabase');
  return createFakeSupabase(jest.fn);
});

type Mocked = { __calls: { method: string; args: unknown[] }[]; __rpcAnswers: Map<string, (args: Record<string, unknown>) => unknown> };
const sbMock = jest.requireMock('@supabase/supabase-js') as Mocked;

const TEXT = 'for-rahul-only: 4471';
const UNLOCK_TOKEN = 'unlock-token-from-the-real-module-7f3a9c1d';
const stored = new Map<string, { header: string; body: string | null }>();
type Req = { method: string; headers: Record<string, string>; body: string };
const fetchMock = jest.fn<Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>, [string, Req]>();

beforeEach(() => {
  resetRouter();
  sbMock.__calls.length = 0;
  sbMock.__rpcAnswers.clear();
  stored.clear();
  mockLinking.url = null;
  let n = 0;
  sbMock.__rpcAnswers.set('create_secret', (args) => {
    const id = `LockId${String(++n).padStart(4, '0')}`;
    stored.set(id, { header: args.p_header as string, body: (args.p_body as string | null) ?? null });
    return id;
  });
  sbMock.__rpcAnswers.set('peek_secret', (args) => {
    const s = stored.get(args.p_id as string);
    return s ? [{ header: s.header, kind: 'text', max_views: 1, views_left: 1, lock_hint: 'r***@example.test', open_after: null, allowed_countries: null }] : [];
  });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url, init) => {
    const body = JSON.parse(init.body) as { id: string; code?: string; unlockToken?: string };
    const s = stored.get(body.id);
    if (url.endsWith('/api/unlock/send')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (url.endsWith('/api/unlock/verify')) {
      return body.code === '123456'
        ? { ok: true, status: 200, json: async () => ({ token: UNLOCK_TOKEN }) }
        : { ok: false, status: 400, json: async () => ({ error: 'wrong_code', left: 4 }) };
    }
    if (!url.endsWith('/api/open')) return { ok: false, status: 404, json: async () => ({}) };
    if (!s) return { ok: false, status: 404, json: async () => ({ error: 'gone' }) };
    if (body.unlockToken !== UNLOCK_TOKEN) return { ok: false, status: 403, json: async () => ({ error: 'recipient_locked' }) };
    stored.delete(body.id);
    return { ok: true, status: 200, json: async () => ({ header: s.header, body: s.body, file_path: null, views_left: 0, final: true, viewer_place: null }) };
  });
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
});

test('P2-7: with the real lib/secrets, a wrong code is reported, the right code yields the token STRING and open sends it as unlockToken', async () => {
  const link = await createSecretLink({ kind: 'text', text: TEXT }, { ttlSeconds: 3600, views: 1 });
  setLocalParams({ id: link.id });
  mockLinking.url = link.url;
  await render(<SecretViewerRoute />);

  // Peek through the real core: locked, cannot open yet.
  expect(await screen.findByTestId('sview.locked')).toBeTruthy();
  expect(screen.getByText('This secret is for r***@example.test. Confirm it’s you with a one-time code.')).toBeTruthy();
  expect(screen.getByTestId('sview.open').props.accessibilityState.disabled).toBe(true);

  await fireEvent.changeText(screen.getByTestId('sview.lockEmail'), 'rahul@example.test');
  await fireEvent.press(screen.getByTestId('sview.sendCode'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('https://onepeek.io/api/unlock/send', expect.objectContaining({ body: JSON.stringify({ id: link.id, email: 'rahul@example.test' }) })));

  // Wrong code: the core's `wrong_code` reaches the screen's wording.
  await fireEvent.changeText(await screen.findByTestId('sview.lockCode'), '654321');
  await fireEvent.press(screen.getByTestId('sview.verifyCode'));
  expect(await screen.findByText('That code isn’t right. Try again.')).toBeTruthy();
  expect(screen.queryByTestId('sview.unlocked')).toBeNull();

  // Right code: the string token unlocks the Open button ("Email confirmed" is the proof the string was used).
  await fireEvent.changeText(screen.getByTestId('sview.lockCode'), '123456');
  await fireEvent.press(screen.getByTestId('sview.verifyCode'));
  expect(await screen.findByTestId('sview.unlocked')).toBeTruthy();
  expect(screen.getByTestId('sview.open').props.accessibilityState.disabled).toBe(false);

  await fireEvent.press(screen.getByTestId('sview.open'));
  expect(await screen.findByText(TEXT)).toBeTruthy();
  const openCall = fetchMock.mock.calls.find(([u]) => u.endsWith('/api/open'))!;
  expect(JSON.parse(openCall[1].body)).toEqual({ id: link.id, precise: null, unlockToken: UNLOCK_TOKEN });
  // The token and the code are never drawn; the email reached only /api/unlock/send (never /api/open).
  const tree = JSON.stringify(screen.toJSON());
  expect(tree).not.toContain(UNLOCK_TOKEN);
  expect(tree).not.toContain('123456');
  expect(openCall[1].body).not.toContain('rahul@example.test');
});
