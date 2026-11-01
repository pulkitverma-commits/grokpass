// lib/links: classification of scanned / shared / tapped text, and the one-shot hand-off.
import { inviteTokenFrom } from '../format';
import { classify, clearHandoffs, HANDOFF_TTL_MS, inviteLinkFrom, secretLinkFrom, stashHandoff, takeHandoff, verifyDigitsFrom } from '../links';

jest.mock('../secrets', () => ({ isSecretLink: jest.fn((u: string) => !u.includes('reject-me')) }));

const KEY = 'A'.repeat(43);
const TOKEN = 'T'.repeat(43);
const PIN = '1' + 'p'.repeat(64);   // F2-7 owner pin after the token

beforeEach(() => clearHandoffs());

test('F2-7: invite links with the owner pin keep it (token.pin); old links without it still parse; a damaged pin is no link at all', () => {
  const pinned = `https://onepeek.io/chat/join#${TOKEN}.${PIN}`;
  expect(inviteLinkFrom(`open ${pinned} please`)).toEqual({ url: pinned, token: `${TOKEN}.${PIN}` });
  expect(classify(`onepeek://chat/join#${TOKEN}.${PIN}`)).toEqual({ kind: 'invite', url: `onepeek://chat/join#${TOKEN}.${PIN}`, token: `${TOKEN}.${PIN}` });
  expect(inviteLinkFrom(`https://onepeek.io/chat/join#${TOKEN}`)?.token).toBe(TOKEN);
  expect(inviteLinkFrom(`https://onepeek.io/chat/join#${TOKEN}.`)?.token).toBe(TOKEN);           // sentence full stop
  expect(inviteLinkFrom(`https://onepeek.io/chat/join#${TOKEN}.1short`)).toBeNull();               // damaged: invite_invalid, not an unpinned join
  expect(inviteLinkFrom(`https://onepeek.io/chat/join#${TOKEN}.${PIN.slice(0, 40)}`)).toBeNull();     // cut short by a messenger
  expect(classify(`https://onepeek.io/chat/join#${TOKEN}.2${'p'.repeat(64)}`).kind).toBe('none');    // unknown version
  expect(inviteTokenFrom(`https://onepeek.io/chat/join#${TOKEN}.1short`)).toBeNull();
  expect(inviteTokenFrom(`https://onepeek.io/chat/join#${TOKEN}.${PIN}`)).toBe(`${TOKEN}.${PIN}`);
  expect(inviteTokenFrom(`https://onepeek.io/chat/join#${TOKEN}`)).toBe(TOKEN);
});

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

test('P3-2: a stash older than HANDOFF_TTL_MS (30 s) is not taken, and is gone; a fresh one is', () => {
  const t0 = 1_700_000_000_000;
  const now = jest.spyOn(Date, 'now');
  try {
    now.mockReturnValue(t0);
    stashHandoff('secret', 'stale');
    stashHandoff('invite', 'stale-invite');
    now.mockReturnValue(t0 + HANDOFF_TTL_MS + 1);
    expect(HANDOFF_TTL_MS).toBe(30_000);
    expect(takeHandoff('secret')).toBeNull();
    expect(takeHandoff('invite')).toBeNull();
    // Dropped, not kept for a later reader that happens to be "in time" again.
    now.mockReturnValue(t0 + 1);
    expect(takeHandoff('secret')).toBeNull();
    // Just inside the lifetime is fine.
    now.mockReturnValue(t0);
    stashHandoff('secret', 'fresh');
    now.mockReturnValue(t0 + HANDOFF_TTL_MS);
    expect(takeHandoff('secret')).toBe('fresh');
  } finally {
    now.mockRestore();
  }
});

test('P3-2: clearHandoffs forgets both slots (relock and resetThisPhone call it)', () => {
  stashHandoff('secret', 's-link');
  stashHandoff('invite', 'i-link');
  clearHandoffs();
  expect(takeHandoff('secret')).toBeNull();
  expect(takeHandoff('invite')).toBeNull();
});
