// F-2: the app's copy of the core's keyChanged and the member_key_mismatch message.
import { friendlyError, keyChanged } from '../format';

test('member_key_mismatch has its own message', () => {
  expect(friendlyError('member_key_mismatch')).toBe('This member’s key doesn’t match the chat. Don’t trust this chat until you’ve checked with them.');
});

test('keyChanged: a key mismatch always warns; otherwise only a verified member whose key moved', () => {
  const key = new Uint8Array([0xab, 0x01]);
  expect(keyChanged({ verified: null, signaturePub: key })).toBe(false);
  expect(keyChanged({ verified: '\\xab01', signaturePub: key })).toBe(false);
  expect(keyChanged({ verified: '\\xab02', signaturePub: key })).toBe(true);
  expect(keyChanged({ verified: null, signaturePub: key, keyMismatch: true })).toBe(true);
  expect(keyChanged({ verified: '\\xab01', signaturePub: key, keyMismatch: true })).toBe(true);
});
