import crypto from 'crypto';
import { generateId, hashPassword, hashPin, verifyPin, isScryptHash } from '../helpers';

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

describe('hashPin / verifyPin (salted scrypt)', () => {
  it('produces the self-describing scrypt$N$r$p$salt$hash format', async () => {
    const stored = await hashPin(await hashPassword('123456'));
    expect(stored).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(isScryptHash(stored)).toBe(true);
  });

  it('verifies the correct credential', async () => {
    const cred = await hashPassword('123456');
    expect(await verifyPin(cred, await hashPin(cred))).toBe(true);
  });

  it('rejects an incorrect credential', async () => {
    const stored = await hashPin(await hashPassword('123456'));
    expect(await verifyPin(await hashPassword('000000'), stored)).toBe(false);
  });

  it('uses a unique salt per call (same input → different stored value, both verify)', async () => {
    const cred = await hashPassword('123456');
    const a = await hashPin(cred);
    const b = await hashPin(cred);
    expect(a).not.toBe(b);
    expect(await verifyPin(cred, a)).toBe(true);
    expect(await verifyPin(cred, b)).toBe(true);
  });

  it('rejects a legacy bare-sha256 stored value (scrypt-only)', async () => {
    const cred = await hashPassword('123456');
    expect(isScryptHash(cred)).toBe(false);
    expect(await verifyPin(cred, cred)).toBe(false);
  });

  it('returns false for malformed or empty stored values', async () => {
    const cred = await hashPassword('123456');
    expect(await verifyPin(cred, '')).toBe(false);
    expect(await verifyPin(cred, 'scrypt$16384$8$1$deadbeef')).toBe(false); // too few parts
    expect(await verifyPin(cred, 'notscrypt$16384$8$1$aa$bb')).toBe(false);
  });

  it('round-trips a raw PIN through the register→login path', async () => {
    const rawPin = '481920';
    const stored = await hashPin(await hashPassword(rawPin));        // register/change-pin
    expect(await verifyPin(await hashPassword(rawPin), stored)).toBe(true);   // login (correct)
    expect(await verifyPin(await hashPassword('481921'), stored)).toBe(false); // login (wrong)
  });
});
