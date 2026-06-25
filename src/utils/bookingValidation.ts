// Pure, testable booking-time logic (extracted from routes/bookings.ts and
// services/database.ts so it can be unit-tested without the DB or HTTP layer).

const toMins = (t: string): number => {
  const [h, m] = String(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export interface AdhocTimeInput {
  startTime?: string;     // "HH:mm"
  endTime?: string;       // "HH:mm"
  workStartDate?: string; // "YYYY-MM-DD"
}

/**
 * Validate an ADHOC booking's times. Returns an error message string if invalid,
 * or `null` if OK. `now` is injectable (ms epoch) so tests are deterministic.
 * Past-time check is anchored to IST (UTC+5:30), matching the society location.
 */
export function validateAdhocBookingTimes(input: AdhocTimeInput, now: number = Date.now()): string | null {
  const { startTime, endTime, workStartDate } = input;

  if (startTime && endTime) {
    const startMins = toMins(startTime);
    const endMins = toMins(endTime);
    if (startMins < toMins('07:00') || startMins > toMins('21:00')) {
      return 'Start time must be between 7:00 AM and 9:00 PM';
    }
    if (endMins > toMins('22:00')) {
      return 'End time cannot be later than 10:00 PM';
    }
    if (endMins - startMins < 60) {
      return 'Minimum booking duration is 1 hour';
    }
  }

  if (workStartDate && startTime) {
    const bookingDateTime = new Date(`${workStartDate}T${startTime}:00+05:30`);
    const oneHourFromNow = new Date(now + 60 * 60 * 1000);
    if (bookingDateTime < oneHourFromNow) {
      return 'Booking must be at least 1 hour in the future';
    }
  }

  return null;
}

/**
 * True only if [start,end] fits entirely inside a maid's auto-accept window.
 * All args are "HH:mm". If the window is not fully configured, returns false.
 */
export function isWithinAutoAcceptWindow(
  start: string | null | undefined,
  end: string | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  if (!start || !end || !from || !to) return false;
  return toMins(start) >= toMins(String(from).substring(0, 5)) &&
         toMins(end) <= toMins(String(to).substring(0, 5));
}
