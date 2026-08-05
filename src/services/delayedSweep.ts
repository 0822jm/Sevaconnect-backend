import { db } from './database';
import { sendLocalizedNotification } from './pushNotifications';

// Throttle so the delayed-detection query doesn't run on every request. The claim itself is
// idempotent (each booking is stamped delayed_notified_at once), so this only limits DB churn.
let _lastRun = 0;
const THROTTLE_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Detect ad-hoc/replacement bookings that have just gone "Delayed" (scheduled end time passed with
 * no OTP) and send a one-time push to both the household and the maid. Fire-and-forget from the
 * booking-list routes (like the stale-booking sweep) — on Render's free tier the request that
 * triggers this is what wakes the server, so notifications land whenever someone opens the app.
 */
export async function notifyDelayedBookings(): Promise<void> {
  const now = Date.now();
  if (now - _lastRun < THROTTLE_MS) return;
  _lastRun = now;

  try {
    const claimed = await db.claimDelayedBookingsToNotify();
    for (const b of claimed) {
      // Household — their maid hasn't started/finished as scheduled.
      const hInfo = await db.getNotificationInfoForBooking(b.id);
      if (hInfo?.householdPushToken) {
        sendLocalizedNotification(
          hInfo.householdPushToken,
          hInfo.householdPreferredLocale,
          'booking.delayedHousehold',
          { serviceName: hInfo.serviceName, date: b.workStartDate, time: b.startTime },
          { type: 'booking', id: b.id },
        );
      }
      // Maid — nudge to update the job.
      const mInfo = await db.getMaidNotificationInfoForBooking(b.id);
      if (mInfo?.maidPushToken) {
        sendLocalizedNotification(
          mInfo.maidPushToken,
          mInfo.maidPreferredLocale,
          'booking.delayedMaid',
          { date: b.workStartDate, time: b.startTime },
          { type: 'booking', id: b.id },
        );
      }
    }
  } catch (e) {
    console.error('[notifyDelayedBookings] failed', e);
  }
}
