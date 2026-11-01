// app.config.ts: the `extra.e2e` flag that unmasks the invite link (W1-9) is produced by the `e2e`
// EAS profile alone and fails closed everywhere else (security review W2-6 / W3-2). The config is a
// function of the environment, so each case sets the two variables and evaluates it afresh.
import type { ConfigContext } from 'expo/config';
import appConfig from '../app.config';

const ENV = ['EXPO_PUBLIC_E2E', 'EAS_BUILD_PROFILE'] as const;
const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};

function evaluate(env: Partial<Record<(typeof ENV)[number], string>>) {
  for (const k of ENV) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  return appConfig({ config: {} } as ConfigContext);
}

beforeAll(() => { for (const k of ENV) saved[k] = process.env[k]; });
afterAll(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

test('no environment: extra.e2e is false', () => {
  const c = evaluate({});
  expect(c.extra?.e2e).toBe(false);
  expect(c.slug).toBe('onepeek');
});

test('EAS_BUILD_PROFILE=e2e is the only producer of extra.e2e === true', () => {
  expect(evaluate({ EAS_BUILD_PROFILE: 'e2e' }).extra?.e2e).toBe(true);
  expect(evaluate({ EAS_BUILD_PROFILE: 'e2e', EXPO_PUBLIC_E2E: '1' }).extra?.e2e).toBe(true);
});

test('EXPO_PUBLIC_E2E=1 without a profile (expo export, expo run:ios --configuration Release, a local archive) does not unmask', () => {
  expect(evaluate({ EXPO_PUBLIC_E2E: '1' }).extra?.e2e).toBe(false);
  expect(evaluate({ EXPO_PUBLIC_E2E: '1', EAS_BUILD_PROFILE: 'development' }).extra?.e2e).toBe(false);
});

test('other profiles never unmask', () => {
  for (const p of ['development', 'development-simulator', 'preview', 'production', 'E2E', 'e2e ']) {
    expect(evaluate({ EAS_BUILD_PROFILE: p }).extra?.e2e).toBe(false);
  }
});

test('EXPO_PUBLIC_E2E=1 on the preview or production profile refuses to evaluate (belt and braces)', () => {
  expect(() => evaluate({ EXPO_PUBLIC_E2E: '1', EAS_BUILD_PROFILE: 'production' })).toThrow('not allowed for the "production" build profile');
  expect(() => evaluate({ EXPO_PUBLIC_E2E: '1', EAS_BUILD_PROFILE: 'preview' })).toThrow('not allowed for the "preview" build profile');
  // Without the flag those profiles evaluate, masked.
  expect(evaluate({ EAS_BUILD_PROFILE: 'production' }).extra?.e2e).toBe(false);
});
