// "Any maid" reassignment orchestration — the notification-aware wrapper around
// db.reassignAnyMaid. Two callers:
//   1) A maid declining a still-REQUESTED any-maid booking (see routes/bookings.ts /:id/status).
//   2) The 30-minute accept-timeout sweep (sweepTimedOutAnyMaid, run by the gated cron).
// Both silently re-pick another eligible maid (keeping the household's "matching…" state) and only
// surface to the household if the pool is exhausted and the booking gets cancelled.

import { db } from './database';
import { sendLocalizedNotification } from './pushNotifications';

// Throttle so overlapping sweeps / lazy triggers don't stampede the DB.
let _lastAnyMaidTimeoutSweepAt = 0;
const ANY_MAID_TIMEOUT_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // ~5 min

/**
 * Re-pick a maid for one any-maid booking and send the appropriate push.
 * REASSIGNED → notify the newly assigned maid (a manual request). EXHAUSTED → the booking was
 * cancelled; notify the household. SKIP → nothing to do (already confirmed / cancelled / not any-maid).
 */
export async function reassignAndNotify(bookingId: string, reason: 'decline' | 'timeout'): Promise<void> {
  try {
    const result = await db.reassignAnyMaid(bookingId, { reason });
    if (result.status === 'REASSIGNED') {
      const [info, maidInfo, booking] = await Promise.all([
        db.getNotificationInfoForBooking(bookingId),
        db.getUserPushInfo(result.maidId),
        db.getBookingById(bookingId),
      ]);
      if (maidInfo?.pushToken && booking) {
        sendLocalizedNotification(
          maidInfo.pushToken,
          maidInfo.preferredLocale,
          'booking.newRequest',
          { householdName: info?.householdName || 'A household', date: booking.workStartDate, time: booking.startTime },
          { type: 'booking_request', id: bookingId },
        );
      }
      // The household already sees a nameless "matching…" state; no per-re-pick push (avoid spam).
    } else if (result.status === 'EXHAUSTED') {
      const [info, booking] = await Promise.all([
        db.getNotificationInfoForBooking(bookingId),
        db.getBookingById(bookingId),
      ]);
      if (info?.householdPushToken && booking) {
        sendLocalizedNotification(
          info.householdPushToken,
          info.householdPreferredLocale,
          'booking.anyMaidNoneAvailable',
          { date: booking.workStartDate, time: booking.startTime },
          { type: 'booking', id: bookingId },
        );
      }
    }
  } catch (e: any) {
    console.error(JSON.stringify({ evt: 'any_maid_reassign_error', bookingId, reason, error: e?.message }));
  }
}

/**
 * Sweep any-maid bookings still awaiting acceptance past the 30-min timeout and re-pick each.
 * Throttled; intended to run under the advisory-lock cron leader so only one instance fires it.
 * `force` bypasses the throttle (for the scheduled run).
 */
export async function sweepTimedOutAnyMaid(force = false): Promise<number> {
  const now = Date.now();
  if (!force && now - _lastAnyMaidTimeoutSweepAt < ANY_MAID_TIMEOUT_SWEEP_INTERVAL_MS) return 0;
  _lastAnyMaidTimeoutSweepAt = now;
  let count = 0;
  try {
    const ids = await db.getTimedOutAnyMaidBookings(30);
    for (const id of ids) {
      await reassignAndNotify(id, 'timeout');
      count++;
    }
    if (ids.length > 0) console.log(JSON.stringify({ evt: 'any_maid_timeout_sweep', swept: ids.length }));
  } catch (e: any) {
    console.error(JSON.stringify({ evt: 'any_maid_timeout_sweep_error', error: e?.message }));
  }
  return count;
}
