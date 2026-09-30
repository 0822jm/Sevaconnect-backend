/**
 * Regression guard for "clear preferred maid".
 *
 * Bug (reported by testers): a household could SET a preferred maid but could not
 * unset it back to none. The fix relies on db.updateUser KEEPING null values and
 * only skipping `undefined`, so that PUT /users/:id { preferredMaidId: null }
 * emits `preferred_maid_id = NULL`. If someone changes the filter to also drop
 * nulls (e.g. `v != null`), clearing silently breaks again — this test catches that.
 */

const calls: any[] = [];
const mockSql = jest.fn((..._args: any[]) => {
  calls.push(_args);
  // Any SELECT (getUserById after the UPDATE) needs a row so updateUser doesn't throw.
  return Promise.resolve([{ id: 'u1', name: 'Alice', role: 'HOUSEHOLD', preferred_maid_id: null }]);
});

jest.mock('@neondatabase/serverless', () => ({ neon: () => mockSql }));
jest.mock('../twilio', () => ({ formatPhoneE164: (p: string) => p }));

import { db } from '../database';
import { hashPassword, isScryptHash, verifyPin } from '../../utils/helpers';

// The write goes through the direct-call form: sql(`UPDATE users SET ...`, [id, ...values]).
// Tagged-template reads (getUserById) pass an array as the first arg, so filtering on a
// string first arg isolates the UPDATE statement.
const updateCall = () => calls.find(a => typeof a[0] === 'string' && /UPDATE users SET/.test(a[0]));

beforeEach(() => { calls.length = 0; mockSql.mockClear(); });

describe('db.updateUser — clearing the preferred maid', () => {
  it('writes preferred_maid_id = NULL when preferredMaidId is null', async () => {
    await db.updateUser('u1', { preferredMaidId: null } as any);
    const call = updateCall();
    expect(call).toBeDefined();
    expect(call![0]).toContain('preferred_maid_id =');   // column present in the SET clause
    expect(call![1]).toContain(null);                    // and the bound value is null
  });

  it('skips undefined fields so they are not overwritten', async () => {
    await db.updateUser('u1', { preferredMaidId: undefined, name: 'Alice' } as any);
    const call = updateCall();
    expect(call).toBeDefined();
    expect(call![0]).toContain('name =');
    expect(call![0]).not.toContain('preferred_maid_id'); // undefined → not written
  });
});

describe('db.updateUser — password_hash wrapping (scrypt)', () => {
  it('wraps a client-sent sha256 password_hash in salted scrypt before storing', async () => {
    const sha = await hashPassword('123456'); // what the mobile change-PIN flow sends
    await db.updateUser('u1', { password_hash: sha } as any);
    const call = updateCall();
    expect(call).toBeDefined();
    const stored = (call![1] as any[]).find((v) => typeof v === 'string' && v.startsWith('scrypt$'));
    expect(stored).toBeDefined();
    expect(isScryptHash(stored)).toBe(true);
    expect(stored).not.toBe(sha);                 // never store the bare sha256
    expect(await verifyPin(sha, stored)).toBe(true); // and it verifies
  });

  it('does not double-wrap an already-scrypt password_hash', async () => {
    const already = 'scrypt$16384$8$1$' + 'aa'.repeat(16) + '$' + 'bb'.repeat(64);
    await db.updateUser('u1', { password_hash: already } as any);
    const call = updateCall();
    expect(call![1]).toContain(already); // stored as-is, not re-wrapped
  });
});
