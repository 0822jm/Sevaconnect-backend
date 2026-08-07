// Pure-function tests for the "any maid" helpers exported from database.ts. The sql/neon connection
// is lazily initialised (only on the first query), so importing the module here never touches a DB.
import { redactMatchingMaid, isMaidSlotConflict, BookingStatus } from '../database';

const baseBooking: any = {
  id: 'b1',
  status: BookingStatus.REQUESTED,
  anyMaidPool: 'ANY',
  maidId: 'maid-9',
  maidName: 'Asha',
  maidPhone: '+911111111111',
};

describe('redactMatchingMaid', () => {
  it('hides the assigned maid from the HOUSEHOLD while an any-maid booking is REQUESTED', () => {
    const out = redactMatchingMaid({ ...baseBooking }, 'HOUSEHOLD');
    expect(out.matching).toBe(true);
    expect(out.maidId).toBe('');
    expect(out.maidName).toBeUndefined();
    expect(out.maidPhone).toBeUndefined();
  });

  it('does NOT redact for the MAID viewer (they must see their own assignment)', () => {
    const out = redactMatchingMaid({ ...baseBooking }, 'MAID');
    expect(out.matching).toBeUndefined();
    expect(out.maidName).toBe('Asha');
  });

  it('does NOT redact once the booking is CONFIRMED (maid is revealed)', () => {
    const out = redactMatchingMaid({ ...baseBooking, status: BookingStatus.CONFIRMED }, 'HOUSEHOLD');
    expect(out.matching).toBeUndefined();
    expect(out.maidName).toBe('Asha');
  });

  it('does NOT redact a normal (non-any-maid) booking', () => {
    const out = redactMatchingMaid({ ...baseBooking, anyMaidPool: null }, 'HOUSEHOLD');
    expect(out.matching).toBeUndefined();
    expect(out.maidName).toBe('Asha');
  });

  it('leaves the input object unmutated (returns a copy)', () => {
    const input = { ...baseBooking };
    redactMatchingMaid(input, 'HOUSEHOLD');
    expect(input.maidName).toBe('Asha');
    expect(input.matching).toBeUndefined();
  });
});

describe('isMaidSlotConflict', () => {
  it('detects the 23P01 exclusion violation by code', () => {
    expect(isMaidSlotConflict({ code: '23P01' })).toBe(true);
  });

  it('detects it via a wrapped sourceError code', () => {
    expect(isMaidSlotConflict({ sourceError: { code: '23P01' } })).toBe(true);
  });

  it('detects it by the constraint name in the message', () => {
    expect(isMaidSlotConflict({ message: 'conflicting key value violates exclusion constraint "bookings_no_maid_slot_overlap"' })).toBe(true);
  });

  it('is false for unrelated errors', () => {
    expect(isMaidSlotConflict({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isMaidSlotConflict(new Error('network down'))).toBe(false);
    expect(isMaidSlotConflict(null)).toBe(false);
  });
});
