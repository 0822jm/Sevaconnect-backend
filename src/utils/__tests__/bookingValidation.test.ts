import { validateAdhocBookingTimes, isWithinAutoAcceptWindow } from '../bookingValidation';

describe('validateAdhocBookingTimes', () => {
  it('returns null for a valid time range with no date check', () => {
    expect(validateAdhocBookingTimes({ startTime: '09:00', endTime: '11:00' })).toBeNull();
  });

  it('rejects start time before 7:00 AM', () => {
    expect(validateAdhocBookingTimes({ startTime: '06:59', endTime: '08:00' })).toBe(
      'Start time must be between 7:00 AM and 9:00 PM'
    );
  });

  it('rejects start time after 9:00 PM', () => {
    expect(validateAdhocBookingTimes({ startTime: '21:01', endTime: '22:00' })).toBe(
      'Start time must be between 7:00 AM and 9:00 PM'
    );
  });

  it('allows start time exactly at 7:00 AM boundary', () => {
    expect(validateAdhocBookingTimes({ startTime: '07:00', endTime: '08:00' })).toBeNull();
  });

  it('allows start time exactly at 9:00 PM boundary', () => {
    // 21:00 start, 22:00 end -> duration 60 mins, end exactly at 22:00 boundary
    expect(validateAdhocBookingTimes({ startTime: '21:00', endTime: '22:00' })).toBeNull();
  });

  it('rejects end time after 10:00 PM', () => {
    expect(validateAdhocBookingTimes({ startTime: '20:00', endTime: '22:01' })).toBe(
      'End time cannot be later than 10:00 PM'
    );
  });

  it('allows end time exactly at 10:00 PM boundary', () => {
    expect(validateAdhocBookingTimes({ startTime: '20:30', endTime: '22:00' })).toBeNull();
  });

  it('rejects duration under 1 hour', () => {
    expect(validateAdhocBookingTimes({ startTime: '09:00', endTime: '09:30' })).toBe(
      'Minimum booking duration is 1 hour'
    );
  });

  it('allows duration exactly 1 hour', () => {
    expect(validateAdhocBookingTimes({ startTime: '09:00', endTime: '10:00' })).toBeNull();
  });

  it('checks start-time-before-end-time bounds before duration when both invalid (start range wins)', () => {
    // start before 7am AND duration <1hr -> start check should trigger first
    expect(validateAdhocBookingTimes({ startTime: '06:00', endTime: '06:15' })).toBe(
      'Start time must be between 7:00 AM and 9:00 PM'
    );
  });

  describe('1-hour-in-future check (using injectable now)', () => {
    it('rejects a booking that starts less than 1 hour from now', () => {
      // now = 2026-01-01T10:00:00Z; booking at 15:29 IST (=09:59 UTC) is < 1hr away
      const now = new Date('2026-01-01T10:00:00Z').getTime();
      const result = validateAdhocBookingTimes(
        { startTime: '15:29', endTime: '17:00', workStartDate: '2026-01-01' },
        now
      );
      expect(result).toBe('Booking must be at least 1 hour in the future');
    });

    it('accepts a booking that starts more than 1 hour from now', () => {
      const now = new Date('2026-01-01T10:00:00Z').getTime();
      const result = validateAdhocBookingTimes(
        { startTime: '16:31', endTime: '18:00', workStartDate: '2026-01-01' },
        now
      );
      expect(result).toBeNull();
    });

    it('accepts a booking exactly at the 1-hour boundary (strict less-than means boundary is OK)', () => {
      // now=10:00:00Z -> oneHourFromNow=11:00:00Z = 16:30 IST exactly
      // bookingDateTime (16:30 IST) < oneHourFromNow (16:30 IST) is false -> valid
      const now = new Date('2026-01-01T10:00:00Z').getTime();
      const result = validateAdhocBookingTimes(
        { startTime: '16:30', endTime: '18:00', workStartDate: '2026-01-01' },
        now
      );
      expect(result).toBeNull();
    });

    it('skips the future check when workStartDate is missing', () => {
      const now = new Date('2026-01-01T23:59:00Z').getTime();
      const result = validateAdhocBookingTimes({ startTime: '07:00', endTime: '08:00' }, now);
      expect(result).toBeNull();
    });

    it('skips the future check when startTime is missing', () => {
      const now = new Date('2026-01-01T23:59:00Z').getTime();
      const result = validateAdhocBookingTimes({ workStartDate: '2026-01-01' }, now);
      expect(result).toBeNull();
    });
  });

  describe('IST timezone anchoring', () => {
    it('interprets workStartDate+startTime as Asia/Kolkata, not UTC', () => {
      // 2026-03-10T08:00 IST = 2026-03-10T02:30 UTC.
      // now is set so the IST interpretation is comfortably >1hr in the future,
      // but a (wrong) UTC interpretation of "08:00" same day would be in the past.
      const now = new Date('2026-03-10T01:00:00Z').getTime(); // oneHourFromNow = 02:00Z
      const result = validateAdhocBookingTimes(
        { startTime: '08:00', endTime: '09:30', workStartDate: '2026-03-10' },
        now
      );
      // Correct IST anchoring: booking instant = 2026-03-10T02:30Z, which is after
      // oneHourFromNow (02:00Z) -> valid. A buggy UTC interpretation ("08:00Z") would
      // also pass here, so this case alone doesn't fully distinguish - see next test.
      expect(result).toBeNull();
    });

    it('treats the date+time as IST, not local/UTC: a time that would be in the past under UTC interpretation is still valid under IST', () => {
      // now = 2026-03-09T18:30:00Z, so oneHourFromNow = 2026-03-09T19:30:00Z.
      // startTime "20:00" interpreted as IST means 2026-03-09T20:00:00+05:30 = 2026-03-09T14:30:00Z,
      // which is in the PAST relative to oneHourFromNow -> must be rejected.
      // If the code incorrectly treated "20:00" as UTC, the booking instant would be
      // 2026-03-09T20:00:00Z, which is AFTER oneHourFromNow (19:30Z) -> would incorrectly pass.
      const now = new Date('2026-03-09T18:30:00Z').getTime();
      const result = validateAdhocBookingTimes(
        { startTime: '20:00', endTime: '21:30', workStartDate: '2026-03-09' },
        now
      );
      expect(result).toBe('Booking must be at least 1 hour in the future');
    });
  });
});

describe('isWithinAutoAcceptWindow', () => {
  it('returns false when start is missing', () => {
    expect(isWithinAutoAcceptWindow(undefined, '10:00', '08:00', '18:00')).toBe(false);
  });

  it('returns false when end is missing', () => {
    expect(isWithinAutoAcceptWindow('09:00', null, '08:00', '18:00')).toBe(false);
  });

  it('returns false when from is missing', () => {
    expect(isWithinAutoAcceptWindow('09:00', '10:00', undefined, '18:00')).toBe(false);
  });

  it('returns false when to is missing', () => {
    expect(isWithinAutoAcceptWindow('09:00', '10:00', '08:00', null)).toBe(false);
  });

  it('returns false when all args are missing', () => {
    expect(isWithinAutoAcceptWindow(undefined, undefined, undefined, undefined)).toBe(false);
  });

  it('returns true when the range fits entirely inside the window', () => {
    expect(isWithinAutoAcceptWindow('09:00', '17:00', '08:00', '18:00')).toBe(true);
  });

  it('returns true on exact boundary fit (start==from, end==to)', () => {
    expect(isWithinAutoAcceptWindow('08:00', '18:00', '08:00', '18:00')).toBe(true);
  });

  it('returns false when start is before the window opens', () => {
    expect(isWithinAutoAcceptWindow('07:59', '17:00', '08:00', '18:00')).toBe(false);
  });

  it('returns false when end is after the window closes', () => {
    expect(isWithinAutoAcceptWindow('09:00', '18:01', '08:00', '18:00')).toBe(false);
  });

  it('returns false when the range is entirely outside the window', () => {
    expect(isWithinAutoAcceptWindow('19:00', '20:00', '08:00', '18:00')).toBe(false);
  });

  it('handles from/to arriving as "HH:mm:ss" and still matches against "HH:mm" bounds', () => {
    expect(isWithinAutoAcceptWindow('09:00', '17:00', '08:00:00', '18:00:00')).toBe(true);
  });

  it('handles "HH:mm:ss" window bounds that exclude an out-of-range request', () => {
    expect(isWithinAutoAcceptWindow('07:00', '17:00', '08:00:00', '18:00:00')).toBe(false);
  });
});
