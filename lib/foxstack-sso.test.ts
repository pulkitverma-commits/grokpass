import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { foxStackSigningKey, verifyFoxStackAssertion } from './foxstack-sso';

const KEY = Buffer.from('11'.repeat(32), 'hex');
const PROOF = 's'.repeat(43);
const NOW = 1_800_000_000;
const claims = () => ({
  iss: 'https://crm.foxnetglobal.com', aud: 'onepeek:foxstack:shares',
  sub: '11111111-2222-4333-8444-555555555555', email: 'employee@foxnetglobal.com', email_verified: true,
  name: 'Example Employee', scope: 'share:create', iat: NOW, exp: NOW + 60, jti: 'n'.repeat(43),
  cnf: { install_secret_sha256: createHash('sha256').update(PROOF).digest('hex') },
});
function sign(payload: unknown, header: unknown = { alg: 'HS256', typ: 'foxstack-onepeek+jwt', kid: 'v1' }) {
  const body = [header, payload].map(p => Buffer.from(JSON.stringify(p)).toString('base64url')).join('.');
  return `${body}.${createHmac('sha256', KEY).update(body).digest('base64url')}`;
}

describe('FoxStack scoped federation', () => {
  it('accepts a valid assertion only with its bound install-secret proof', () => {
    const token = sign(claims());
    expect(verifyFoxStackAssertion(token, PROOF, KEY, NOW)).toEqual(claims());
    expect(verifyFoxStackAssertion(token, 'x'.repeat(43), KEY, NOW)).toBeNull();
    expect(verifyFoxStackAssertion(token, PROOF, Buffer.alloc(32), NOW)).toBeNull();
  });

  it.each([
    { iss: 'https://attacker.test' }, { aud: 'onepeek:accounts' }, { scope: '*' },
    { sub: 'not-an-employee-id' }, { email: 'employee@example.com' }, { email_verified: false },
    { name: 'Employee\nInjected' }, { jti: 'short' }, { iat: NOW + 6, exp: NOW + 66 },
    { iat: NOW - 60, exp: NOW }, { exp: NOW + 3600 }, { exp: NOW + 59 },
    { exp: String(NOW + 60) }, { cnf: { install_secret_sha256: 'no' } },
  ])('rejects invalid identity, expiry or scope %j', patch => {
    expect(verifyFoxStackAssertion(sign({ ...claims(), ...patch }), PROOF, KEY, NOW)).toBeNull();
  });

  it('rejects unsigned, malformed, algorithm-confused and altered tokens', () => {
    const token = sign(claims());
    for (const invalid of ['', 'a.b.c', token + '.extra', 'x'.repeat(5000), token.replace(/.$/, '!'), token.split('.').slice(0, 2).join('.') + '.']) {
      expect(verifyFoxStackAssertion(invalid, PROOF, KEY, NOW)).toBeNull();
    }
    expect(verifyFoxStackAssertion(sign(claims(), { alg: 'none', typ: 'foxstack-onepeek+jwt', kid: 'v1' }), PROOF, KEY, NOW)).toBeNull();
    expect(verifyFoxStackAssertion(sign(claims(), { alg: 'HS256', typ: 'JWT', kid: 'v1' }), PROOF, KEY, NOW)).toBeNull();
    const pieces = token.split('.');
    pieces[1] = Buffer.from(JSON.stringify({ ...claims(), scope: '*' })).toString('base64url');
    expect(verifyFoxStackAssertion(pieces.join('.'), PROOF, KEY, NOW)).toBeNull();
  });

  it('fails closed for absent, short or non-hex configuration', () => {
    for (const key of ['', 'onepeek', 'a'.repeat(63), 'z'.repeat(64)]) expect(foxStackSigningKey(key)).toBeNull();
    expect(foxStackSigningKey(KEY.toString('hex'))).toEqual(KEY);
  });
});
