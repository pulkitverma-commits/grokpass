import { forgetLinkingURL, isInviteLink, isSecretLink, isShareWakeUrl, parseOnePeekLink } from '@/security/links';
import * as Linking from 'expo-linking';
import { clearIntentData } from '@/modules/share-intent';

jest.mock('expo-linking', () => ({ clearInitialURL: jest.fn() }));
jest.mock('@/modules/share-intent', () => ({ clearIntentData: jest.fn() }));

const ID = 'Ab3dEfGh2k'; // 10 chars of the create_secret alphabet (no I O l 0 1)
const KEY = 'a'.repeat(43); // 32 bytes base64url without padding
const TOKEN = 'T'.repeat(32); // randomToken(24)
const DIGITS = '12345'.repeat(12); // 60 digits

describe('parseOnePeekLink: accept', () => {
  test.each([
    [`https://onepeek.io/s/${ID}#${KEY}`, { kind: 'secret', id: ID, key: KEY }],
    [`https://www.onepeek.io/s/${ID}#${KEY}`, { kind: 'secret', id: ID, key: KEY }],
    [`HTTPS://ONEPEEK.IO/s/${ID}#${KEY}`, { kind: 'secret', id: ID, key: KEY }],
    [`onepeek://s/${ID}#${KEY}`, { kind: 'secret', id: ID, key: KEY }],
    [`https://onepeek.io/s/${ID}/#${KEY}`, { kind: 'secret', id: ID, key: KEY }],
    [`  https://onepeek.io/s/${ID}#${KEY}\n`, { kind: 'secret', id: ID, key: KEY }],
    [`https://onepeek.io/chat/join#${TOKEN}`, { kind: 'invite', token: TOKEN }],
    [`https://www.onepeek.io/chat/join#${'x-_'.repeat(40)}${'y'.repeat(8)}`, { kind: 'invite', token: `${'x-_'.repeat(40)}${'y'.repeat(8)}` }],
    [`onepeek://chat/join#${TOKEN}`, { kind: 'invite', token: TOKEN }],
    [`https://onepeek.io/chat/join#${TOKEN}.1${'p'.repeat(64)}`, { kind: 'invite', token: TOKEN, pin: `1${'p'.repeat(64)}` }],
    [`onepeek://chat/join#${TOKEN}.1${'q_-'.repeat(21)}q`, { kind: 'invite', token: TOKEN, pin: `1${'q_-'.repeat(21)}q` }],
    [`onepeek-verify:${DIGITS}`, { kind: 'verify', digits: DIGITS }],
    ['onepeek://auth', { kind: 'auth' }],
    ['onepeek://auth/', { kind: 'auth' }],
    ['onepeek://auth?code=abc', { kind: 'auth' }],
    ['onepeek://auth#access_token=abc&x=y', { kind: 'auth' }],
    ['ONEPEEK://AUTH', { kind: 'auth' }],
  ])('%s', (url, expected) => {
    expect(parseOnePeekLink(url)).toEqual(expected);
  });
});

describe('parseOnePeekLink: reject', () => {
  test.each([
    ['look-alike host (suffix)', `https://onepeek.io.evil.com/s/${ID}#${KEY}`],
    ['look-alike host (prefix)', `https://evilonepeek.io/s/${ID}#${KEY}`],
    ['look-alike host (subdomain)', `https://app.onepeek.io/s/${ID}#${KEY}`],
    ['user info', `https://onepeek.io@evil.com/s/${ID}#${KEY}`],
    ['user info 2', `https://evil.com@onepeek.io/s/${ID}#${KEY}`],
    ['port', `https://onepeek.io:443/s/${ID}#${KEY}`],
    ['plain http', `http://onepeek.io/s/${ID}#${KEY}`],
    ['other scheme', `onepeek2://s/${ID}#${KEY}`],
    ['missing fragment', `https://onepeek.io/s/${ID}`],
    ['empty fragment', `https://onepeek.io/s/${ID}#`],
    ['# in the id', `https://onepeek.io/s/Ab3d#EfGh2k#${KEY}`],
    ['id too short', `https://onepeek.io/s/Ab3dEfGh2#${KEY}`],
    ['id too long', `https://onepeek.io/s/${ID}x#${KEY}`],
    ['id with excluded letters', `https://onepeek.io/s/Ab3dEfGhIl#${KEY}`],
    ['id with 0 and 1', `https://onepeek.io/s/Ab3dEfGh01#${KEY}`],
    ['extra path segment', `https://onepeek.io/s/${ID}/x#${KEY}`],
    ['oversize key (44)', `https://onepeek.io/s/${ID}#${'a'.repeat(44)}`],
    ['oversize key (2 KB)', `https://onepeek.io/s/${ID}#${'a'.repeat(2048)}`],
    ['short key (42)', `https://onepeek.io/s/${ID}#${'a'.repeat(42)}`],
    ['padded key', `https://onepeek.io/s/${ID}#${'a'.repeat(42)}=`],
    ['key with +/', `https://onepeek.io/s/${ID}#${'a'.repeat(41)}+/`],
    ['key with query sneaked in', `https://onepeek.io/s/${ID}?x=1#${KEY}x`],
    ['invite token too short', `https://onepeek.io/chat/join#${'T'.repeat(31)}`],
    ['invite token too long', `https://onepeek.io/chat/join#${'T'.repeat(129)}`],
    ['invite token bad chars', `https://onepeek.io/chat/join#${'T'.repeat(31)}+`],
    ['invite without fragment', 'https://onepeek.io/chat/join'],
    ['invite other path', `https://onepeek.io/chat/joined#${TOKEN}`],
    ['invite in query not fragment', `https://onepeek.io/chat/join?token=${TOKEN}`],
    ['invite pin too short', `https://onepeek.io/chat/join#${TOKEN}.1${'p'.repeat(63)}`],
    ['invite pin unknown version', `https://onepeek.io/chat/join#${TOKEN}.2${'p'.repeat(64)}`],
    ['invite empty pin', `https://onepeek.io/chat/join#${TOKEN}.`],
    ['verify 59 digits', `onepeek-verify:${DIGITS.slice(1)}`],
    ['verify 61 digits', `onepeek-verify:${DIGITS}1`],
    ['verify letters', `onepeek-verify:${'a'.repeat(60)}`],
    ['verify other prefix', `onepeek-verified:${DIGITS}`],
    ['auth look-alike host', 'onepeek://auth.evil'],
    ['auth with user info', 'onepeek://auth@evil'],
    ['auth with path', 'onepeek://auth/x'],
    ['the expo-share-intent wake url is not a link kind', 'onepeek://dataUrl=onepeekShareKey?nonce=1#media'],
    ['root', 'https://onepeek.io/'],
    ['other page', 'https://onepeek.io/about'],
    ['whitespace inside', `https://onepeek.io/s/${ID} #${KEY}`],
    ['control char', `https://onepeek.io/s/${ID}#${KEY}\u0001`],
    ['javascript', 'javascript:alert(1)'],
    ['empty', ''],
    ['garbage', 'not a url at all'],
    ['too long', `https://onepeek.io/s/${ID}#${KEY}?${'q'.repeat(3000)}`],
  ])('%s', (_label, url) => {
    expect(parseOnePeekLink(url)).toBeNull();
  });

  test('non-strings', () => {
    expect(parseOnePeekLink(null)).toBeNull();
    expect(parseOnePeekLink(undefined)).toBeNull();
    expect(parseOnePeekLink(42 as unknown as string)).toBeNull();
    expect(parseOnePeekLink({} as unknown as string)).toBeNull();
  });
});

test('isShareWakeUrl: expo-share-intent\'s dataUrl deep link only; parseOnePeekLink sees no link in it', () => {
  expect(isShareWakeUrl('onepeek://dataUrl=onepeekShareKey?nonce=123#media')).toBe(true);
  expect(isShareWakeUrl('onepeek://dataUrl=onepeekShareKey#text')).toBe(true);
  expect(isShareWakeUrl('onepeek://dataUrl=onepeekShareKey')).toBe(true);
  expect(isShareWakeUrl('onepeek://share')).toBe(false);
  expect(isShareWakeUrl('onepeek://dataUrl=')).toBe(false);
  expect(isShareWakeUrl(`https://onepeek.io/s/${ID}#${KEY}`)).toBe(false);
  expect(isShareWakeUrl(null)).toBe(false);
  expect(parseOnePeekLink('onepeek://dataUrl=onepeekShareKey?nonce=123#media')).toBeNull();
});

test('isSecretLink / isInviteLink', () => {
  expect(isSecretLink(`https://onepeek.io/s/${ID}#${KEY}`)).toBe(true);
  expect(isSecretLink(`https://onepeek.io/chat/join#${TOKEN}`)).toBe(false);
  expect(isInviteLink(`onepeek://chat/join#${TOKEN}`)).toBe(true);
  expect(isInviteLink(`https://onepeek.io/s/${ID}#${KEY}`)).toBe(false);
});

test('forgetLinkingURL clears expo-linking\'s cached URL and the Android Intent data', () => {
  forgetLinkingURL();
  expect(Linking.clearInitialURL).toHaveBeenCalledTimes(1);
  expect(clearIntentData).toHaveBeenCalledTimes(1);
});

test('forgetLinkingURL never throws when expo-linking does', () => {
  (Linking.clearInitialURL as jest.Mock).mockImplementationOnce(() => { throw new Error('web'); });
  expect(() => forgetLinkingURL()).not.toThrow();
});
