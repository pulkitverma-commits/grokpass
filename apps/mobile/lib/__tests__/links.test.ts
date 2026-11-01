// lib/links: classification of scanned / shared / tapped text, and the one-shot hand-off.
import { classify, clearHandoffs, inviteLinkFrom, secretLinkFrom, stashHandoff, takeHandoff, verifyDigitsFrom } from '../links';

jest.mock('../secrets', () => ({ isSecretLink: jest.fn((u: string) => !u.includes('reject-me')) }));

const KEY = 'A'.repeat(43);
const TOKEN = 'T'.repeat(43);

beforeEach(() => clearHandoffs());

test('secret links: https (with www) and the app scheme, inside surrounding text; the id is returned without the key', () => {
  expect(secretLinkFrom(`https://onepeek.io/s/abcdefgh#${KEY}`)).toEqual({ url: `https://onepeek.io/s/abcdefgh#${KEY}`, id: 'abcdefgh' });
  expect(secretLinkFrom(`see https://www.onepeek.io/s/abcdefgh#${KEY} now`)?.id).toBe('abcdefgh');
  expect(secretLinkFrom(`onepeek://s/abcdefgh#${KEY}`)?.url).toBe(`onepeek://s/abcdefgh#${KEY}`);
  expect(secretLinkFrom('https://onepeek.io/s/abcdefgh')).toBeNull();          // no key
  expect(secretLinkFrom(`https://evil.io/s/abcdefgh#${KEY}`)).toBeNull();
  expect(secretLinkFrom(`https://onepeek.io.evil.io/s/abcdefgh#${KEY}`)).toBeNull();
  expect(secretLinkFrom(`https://onepeek.io/chat/join#${TOKEN}`)).toBeNull();
  expect(secretLinkFrom(null)).toBeNull();
});

test('the core’s isSecretLink has the last word once it is wired', () => {
  expect(secretLinkFrom(`https://onepeek.io/s/reject-me#${KEY}`)).toBeNull();
});

test('invite links and verify codes', () => {
  expect(inviteLinkFrom(`https://onepeek.io/chat/join#${TOKEN}`)).toEqual({ url: `https://onepeek.io/chat/join#${TOKEN}`, token: TOKEN });
  expect(inviteLinkFrom(`onepeek://chat/join#${TOKEN}`)?.token).toBe(TOKEN);
  expect(inviteLinkFrom('https://onepeek.io/chat/join')).toBeNull();
  expect(verifyDigitsFrom(`onepeek-verify:${'1'.repeat(60)}`)).toBe('1'.repeat(60));
  expect(verifyDigitsFrom(`onepeek-verify:${'1'.repeat(59)}`)).toBeNull();
  expect(verifyDigitsFrom('1'.repeat(60))).toBeNull();
});

test('classify picks secret, then invite, then verify, else none', () => {
  expect(classify(`https://onepeek.io/s/abcdefgh#${KEY}`).kind).toBe('secret');
  expect(classify(`https://onepeek.io/chat/join#${TOKEN}`).kind).toBe('invite');
  expect(classify(`onepeek-verify:${'2'.repeat(60)}`).kind).toBe('verify');
  expect(classify('https://example.com')).toEqual({ kind: 'none' });
  expect(classify('')).toEqual({ kind: 'none' });
});

test('the hand-off is read exactly once and per slot', () => {
  stashHandoff('secret', 's-link');
  stashHandoff('invite', 'i-link');
  expect(takeHandoff('secret')).toBe('s-link');
  expect(takeHandoff('secret')).toBeNull();
  expect(takeHandoff('invite')).toBe('i-link');
  expect(takeHandoff('invite')).toBeNull();
});
