/**
 * Security guard for the registration write path (salted-scrypt PIN migration).
 *
 * registerUser receives a RAW PIN and must persist it as salted scrypt
 * (hashPin(await hashPassword(pin))) — never a bare sha256 and never plaintext.
 * This complements login.test.ts (the read/verify side) by locking the write
 * side: the exact value handed to the INSERT is asserted to be scrypt AND to
 * verify the original raw PIN. If line 609 ever regresses to storing sha256 or
 * plaintext, this fails.
 */

const calls: any[] = [];
// registerUser makes two tagged-template calls: a conflict-check SELECT (must
// return [] so there is no conflict) and the INSERT (return ignored).
const mockSql = jest.fn((..._args: any[]) => {
  calls.push(_args);
  return Promise.resolve([]);
});

jest.mock('@neondatabase/serverless', () => ({ neon: () => mockSql }));
jest.mock('../twilio', () => ({ formatPhoneE164: (p: string) => p }));

import { db } from '../database';
import { hashPassword, isScryptHash, verifyPin } from '../../utils/helpers';

// The INSERT is a tagged template: first arg is the TemplateStringsArray whose
// [0] begins with "INSERT INTO users". Its interpolated values follow.
const insertCall = () =>
  calls.find(a => Array.isArray(a[0]) && typeof a[0][0] === 'string' && /INSERT INTO users/.test(a[0][0]));

beforeEach(() => { calls.length = 0; mockSql.mockClear(); });

describe('db.registerUser — PIN storage (scrypt)', () => {
  it('stores a raw PIN as salted scrypt that verifies, never as bare sha256', async () => {
    const rawPin = '481920';
    await db.registerUser({
      name: 'Alice',
      username: 'alice',
      phone: '9876543210',
      password: rawPin,
      role: 'HOUSEHOLD',
      societyId: 'soc1',
    });

    const call = insertCall();
    expect(call).toBeDefined();
    const values = (call as any[]).slice(1);
    const stored = values.find((v) => typeof v === 'string' && v.startsWith('scrypt$'));
    expect(stored).toBeDefined();
    expect(isScryptHash(stored)).toBe(true);

    const sha = await hashPassword(rawPin);
    expect(stored).not.toBe(sha);            // never the bare sha256 credential
    expect(stored).not.toContain(rawPin);    // never the plaintext PIN
    expect(await verifyPin(sha, stored)).toBe(true); // and it round-trips via login's verifyPin
  });
});
