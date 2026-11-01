import { redirectSystemPath } from '../+native-intent';

describe('+native-intent (expo-share-intent wake URL)', () => {
  test('the package wake URL is redirected to the home route (the bridge opens /share itself)', () => {
    expect(redirectSystemPath({ path: 'onepeek://dataUrl=onepeekShareKey?nonce=abc#text', initial: true })).toBe('/');
    expect(redirectSystemPath({ path: 'onepeek://dataUrl=onepeekShareKey', initial: false })).toBe('/');
  });

  test('every other URL passes through unchanged, fragment included', () => {
    const secret = 'https://onepeek.io/s/Ab3dEfGh2k#' + 'k'.repeat(43);
    expect(redirectSystemPath({ path: secret, initial: true })).toBe(secret);
    expect(redirectSystemPath({ path: 'onepeek://auth?code=xyz', initial: false })).toBe('onepeek://auth?code=xyz');
    expect(redirectSystemPath({ path: '/chat/join', initial: false })).toBe('/chat/join');
  });
});
