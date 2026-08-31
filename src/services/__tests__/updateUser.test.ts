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
