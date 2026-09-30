/**
 * Security regression guard for the salted-scrypt PIN migration.
 *
 * db.login now authenticates by verifying the supplied PIN against the stored
 * salted-scrypt hash via verifyPin(sha256(pin), stored) — it no longer compares
 * a bare sha256. These tests drive the REAL db.login through the REAL hashing
 * helpers (only the neon SQL layer is mocked) to prove the fail-closed contract:
 *   - a correct PIN against a scrypt hash authenticates
 *   - a wrong PIN is rejected
 *   - an empty-hash account can NEVER authenticate (scrubbed / soft-deleted rows)
 *   - a legacy bare-sha256 row is rejected, not silently accepted (scrypt-only)
 *   - login with no password provided skips verification (unchanged behavior)
 *   - an unknown identifier returns null
 *
 * The route-level auth.test.ts fully mocks db.login, so without this file the
 * actual verify-and-reject logic has no coverage.
 */

// login makes a single tagged-template SELECT; the mock returns the configured
// row (or [] for "no such user") for that call.
let userRow: any = null;
const mockSql = jest.fn((..._args: any[]) => Promise.resolve(userRow ? [userRow] : []));

jest.mock('@neondatabase/serverless', () => ({ neon: () => mockSql }));
jest.mock('../twilio', () => ({ formatPhoneE164: (p: string) => p }));

import { db } from '../database';
import { hashPassword, hashPin } from '../../utils/helpers';

const RAW_PIN = '481920';

beforeEach(() => {
  userRow = null;
  mockSql.mockClear();
});

describe('db.login — salted-scrypt verification', () => {
  it('authenticates when the PIN matches the stored scrypt hash', async () => {
    userRow = {
      id: 'u1',
      username: 'alice',
      role: 'HOUSEHOLD',
      password_hash: await hashPin(await hashPassword(RAW_PIN)),
    };
    const result = await db.login('alice', RAW_PIN);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('u1');
  });

  it('rejects an incorrect PIN', async () => {
    userRow = {
      id: 'u1',
      username: 'alice',
      role: 'HOUSEHOLD',
      password_hash: await hashPin(await hashPassword(RAW_PIN)),
    };
    expect(await db.login('alice', '000000')).toBeNull();
  });

  it('rejects an account with an empty password_hash (fail-closed)', async () => {
    userRow = { id: 'u1', username: 'alice', role: 'HOUSEHOLD', password_hash: '' };
    expect(await db.login('alice', RAW_PIN)).toBeNull();
  });

  it('rejects a legacy bare-sha256 row instead of silently accepting it', async () => {
    // Simulates an un-migrated row: the column still holds sha256(pin), not scrypt.
    userRow = {
      id: 'u1',
      username: 'alice',
      role: 'HOUSEHOLD',
      password_hash: await hashPassword(RAW_PIN),
    };
    // Even supplying the CORRECT raw PIN must fail — verifyPin only trusts scrypt.
    expect(await db.login('alice', RAW_PIN)).toBeNull();
  });

  it('returns the user without verification when no password is supplied', async () => {
    userRow = {
      id: 'u1',
      username: 'alice',
      role: 'HOUSEHOLD',
      password_hash: await hashPin(await hashPassword(RAW_PIN)),
    };
    const result = await db.login('alice');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('u1');
  });

  it('returns null when no user matches the identifier', async () => {
    userRow = null; // SELECT yields no rows
    expect(await db.login('nobody', RAW_PIN)).toBeNull();
  });
});
