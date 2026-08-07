// Orchestration tests for services/anyMaidReassign.ts — the notification-aware wrapper around
// db.reassignAnyMaid and the accept-timeout sweep. The database + push modules are auto-mocked
// (no real DB/push is ever hit), so these tests exercise pure branching: which push fires for
// REASSIGNED vs EXHAUSTED vs SKIP, the swallowed-error path, and the sweep throttle.
import { reassignAndNotify, sweepTimedOutAnyMaid } from '../anyMaidReassign';
import { db } from '../database';
import { sendLocalizedNotification } from '../pushNotifications';

jest.mock('../database');
jest.mock('../pushNotifications');

const booking = { id: 'bk1', workStartDate: '2026-08-10', startTime: '10:00' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  (db.getBookingById as jest.Mock).mockResolvedValue(booking);
  (db.getNotificationInfoForBooking as jest.Mock).mockResolvedValue({
    householdName: 'Home', householdPushToken: 'tok-h', householdPreferredLocale: 'gu',
  });
  (db.getUserPushInfo as jest.Mock).mockResolvedValue({ pushToken: 'tok-m', preferredLocale: 'hi' });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('reassignAndNotify', () => {
  it('REASSIGNED → notifies the newly assigned maid (booking.newRequest) and NOT the household', async () => {
    (db.reassignAnyMaid as jest.Mock).mockResolvedValue({ status: 'REASSIGNED', maidId: 'm9', maidName: 'Zoya' });

    await reassignAndNotify('bk1', 'decline');

    expect(db.reassignAnyMaid).toHaveBeenCalledWith('bk1', { reason: 'decline' });
    expect(db.getUserPushInfo).toHaveBeenCalledWith('m9');
    // Only the maid is pushed — the household keeps its silent "matching…" state (no re-pick spam).
    expect(sendLocalizedNotification).toHaveBeenCalledTimes(1);
    expect(sendLocalizedNotification).toHaveBeenCalledWith(
      'tok-m', 'hi', 'booking.newRequest',
      expect.objectContaining({ householdName: 'Home', date: '2026-08-10', time: '10:00' }),
      { type: 'booking_request', id: 'bk1' },
    );
  });

  it('REASSIGNED but the new maid has no push token → sends nothing (no crash)', async () => {
    (db.reassignAnyMaid as jest.Mock).mockResolvedValue({ status: 'REASSIGNED', maidId: 'm9', maidName: 'Zoya' });
    (db.getUserPushInfo as jest.Mock).mockResolvedValue({ pushToken: null, preferredLocale: 'hi' });

    await reassignAndNotify('bk1', 'timeout');

    expect(sendLocalizedNotification).not.toHaveBeenCalled();
  });

  it('EXHAUSTED → notifies the HOUSEHOLD that no maid was available (booking.anyMaidNoneAvailable)', async () => {
    (db.reassignAnyMaid as jest.Mock).mockResolvedValue({ status: 'EXHAUSTED' });

    await reassignAndNotify('bk1', 'timeout');

    expect(db.getUserPushInfo).not.toHaveBeenCalled();
    expect(sendLocalizedNotification).toHaveBeenCalledTimes(1);
    expect(sendLocalizedNotification).toHaveBeenCalledWith(
      'tok-h', 'gu', 'booking.anyMaidNoneAvailable',
      expect.objectContaining({ date: '2026-08-10', time: '10:00' }),
      { type: 'booking', id: 'bk1' },
    );
  });

  it('EXHAUSTED but the household has no push token → sends nothing', async () => {
    (db.reassignAnyMaid as jest.Mock).mockResolvedValue({ status: 'EXHAUSTED' });
    (db.getNotificationInfoForBooking as jest.Mock).mockResolvedValue({ householdPushToken: null });

    await reassignAndNotify('bk1', 'decline');

    expect(sendLocalizedNotification).not.toHaveBeenCalled();
  });

  it('SKIP → does nothing (no lookups, no push)', async () => {
    (db.reassignAnyMaid as jest.Mock).mockResolvedValue({ status: 'SKIP' });

    await reassignAndNotify('bk1', 'decline');

    expect(db.getNotificationInfoForBooking).not.toHaveBeenCalled();
    expect(db.getUserPushInfo).not.toHaveBeenCalled();
    expect(sendLocalizedNotification).not.toHaveBeenCalled();
  });

  it('swallows a reassignAnyMaid error (logs, does not throw, sends no push)', async () => {
    (db.reassignAnyMaid as jest.Mock).mockRejectedValue(new Error('db down'));

    await expect(reassignAndNotify('bk1', 'timeout')).resolves.toBeUndefined();
    expect(sendLocalizedNotification).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('sweepTimedOutAnyMaid', () => {
  it('processes every timed-out booking, re-picking each (reason: timeout), and returns the count', async () => {
    (db.getTimedOutAnyMaidBookings as jest.Mock).mockResolvedValue(['a', 'b', 'c']);
    (db.reassignAnyMaid as jest.Mock).mockResolvedValue({ status: 'SKIP' });

    const swept = await sweepTimedOutAnyMaid(true); // force bypasses the throttle

    expect(swept).toBe(3);
    expect(db.getTimedOutAnyMaidBookings).toHaveBeenCalledWith(30);
    expect(db.reassignAnyMaid).toHaveBeenCalledTimes(3);
    expect(db.reassignAnyMaid).toHaveBeenCalledWith('a', { reason: 'timeout' });
    expect(db.reassignAnyMaid).toHaveBeenCalledWith('c', { reason: 'timeout' });
  });

  it('returns 0 and re-picks nothing when no bookings have timed out', async () => {
    (db.getTimedOutAnyMaidBookings as jest.Mock).mockResolvedValue([]);

    const swept = await sweepTimedOutAnyMaid(true);

    expect(swept).toBe(0);
    expect(db.reassignAnyMaid).not.toHaveBeenCalled();
  });

  it('swallows a query error and returns 0', async () => {
    (db.getTimedOutAnyMaidBookings as jest.Mock).mockRejectedValue(new Error('boom'));

    await expect(sweepTimedOutAnyMaid(true)).resolves.toBe(0);
    expect(console.error).toHaveBeenCalled();
  });

  it('throttles a subsequent non-forced sweep within the interval', async () => {
    (db.getTimedOutAnyMaidBookings as jest.Mock).mockResolvedValue([]);
    // A forced sweep also stamps the throttle clock; the immediate non-forced follow-up must be skipped.
    await sweepTimedOutAnyMaid(true);
    (db.getTimedOutAnyMaidBookings as jest.Mock).mockClear();

    const swept = await sweepTimedOutAnyMaid(false);

    expect(swept).toBe(0);
    expect(db.getTimedOutAnyMaidBookings).not.toHaveBeenCalled();
  });
});
