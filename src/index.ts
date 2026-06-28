import { app } from './app';
import cron from 'node-cron';
import { db } from './services/database';

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`[Kamon Backend] Running on http://localhost:${PORT}`);
  console.log(`[Kamon Backend] Health check: http://localhost:${PORT}/api/health`);

  // Stale-booking sweep: NO_SHOW / INCOMPLETE for ADHOC bookings whose day has passed.
  // Primary trigger = daily cron at 00:30 IST; on free-tier the service may be asleep, so the
  // lazy on-fetch fallback (db.maybeSweepStaleBookings in booking-list routes) is the real safety net.
  db.sweepStaleBookings()
    .then((r) => console.log(`[sweepStaleBookings] startup: ${r.noShow} no-show, ${r.incomplete} incomplete`))
    .catch((e) => console.error('[sweepStaleBookings] startup failed', e));

  cron.schedule(
    '30 0 * * *',
    () => {
      db.sweepStaleBookings()
        .then((r) => console.log(`[sweepStaleBookings] cron: ${r.noShow} no-show, ${r.incomplete} incomplete`))
        .catch((e) => console.error('[sweepStaleBookings] cron failed', e));
    },
    { timezone: 'Asia/Kolkata' },
  );
});
