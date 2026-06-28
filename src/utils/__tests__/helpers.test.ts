import crypto from 'crypto';
import { generateId, hashPassword } from '../helpers';

describe('generateId', () => {
  it('produces an id matching the "prefix-xxxxxxxx-xxxxxxxx" pattern', () => {
    const id = generateId('user');
    expect(id).toMatch(/^user-[0-9a-f]{8}-[0-9a-z]+$/);
  });

  it('starts with the provided prefix', () => {
    expect(generateId('booking').startsWith('booking-')).toBe(true);
  });

  it('produces unique ids across multiple calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateId('x')));
    expect(ids.size).toBe(50);
  });

  it('produces different ids for different prefixes called back-to-back', () => {
    const a = generateId('a');
    const b = generateId('b');
    expect(a).not.toBe(b);
  });
});

describe('hashPassword', () => {
  it('is deterministic - same input produces same hash', async () => {
    const hash1 = await hashPassword('mySecretPassword');
    const hash2 = await hashPassword('mySecretPassword');
    expect(hash1).toBe(hash2);
  });

  it('produces a 64-character hex sha256 digest', async () => {
    const hash = await hashPassword('anything');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the output of node crypto sha256 directly', async () => {
    const expected = crypto.createHash('sha256').update('checkme').digest('hex');
    const hash = await hashPassword('checkme');
    expect(hash).toBe(expected);
  });

  it('produces different hashes for different inputs', async () => {
    const hash1 = await hashPassword('passwordOne');
    const hash2 = await hashPassword('passwordTwo');
    expect(hash1).not.toBe(hash2);
  });

  it('handles an empty string input', async () => {
    const hash = await hashPassword('');
    expect(hash).toBe(crypto.createHash('sha256').update('').digest('hex'));
  });
});
