import { app } from './app';
import cron from 'node-cron';
import { db } from './services/database';
// import { sweepTimedOutAnyMaid } from './services/anyMaidReassign'; // re-add with the 5-min cron below

const PORT = process.env.PORT || 3001;

// Nightly maintenance, gated by a cron lease so exactly ONE instance runs it across N Render
// instances: stale-booking sweep + full trust_score refresh. Lease TTL comfortably exceeds the work.
async function runNightlyMaintenance(trigger: string) {
  const won = await db.tryAcquireCronLease('nightly_maintenance', 20);
  if (!won) {
    console.log(`[nightly] ${trigger}: another instance holds the lease — skipping`);
    return;
  }
  try {
    const r = await db.sweepStaleBookings();
    console.log(`[sweepStaleBookings] ${trigger}: ${r.expired} expired, ${r.noShow} no-show, ${r.incomplete} incomplete`);
  } catch (e) {
    console.error(`[sweepStaleBookings] ${trigger} failed`, e);
  }
  try {
    await db.refreshAllTrustScores();
    console.log(`[refreshAllTrustScores] ${trigger}: done`);
  } catch (e) {
    console.error(`[refreshAllTrustScores] ${trigger} failed`, e);
  }
}

app.listen(PORT, () => {
  console.log(`[Kamon Backend] Running on http://localhost:${PORT}`);
  console.log(`[Kamon Backend] Health check: http://localhost:${PORT}/api/health`);

  // Stale-booking sweep + trust refresh: primary trigger = daily cron at 00:30 IST; on free-tier the
  // service may be asleep, so the lazy on-fetch fallbacks (maybeSweepStaleBookings / sweepTimedOutAnyMaid
  // in the booking-list routes) are the real safety net. All lease-gated so only one instance runs.
  void runNightlyMaintenance('startup');

  cron.schedule('30 0 * * *', () => { void runNightlyMaintenance('cron'); }, { timezone: 'Asia/Kolkata' });

  // Any-maid accept-timeout re-pick DISABLED 2026-09-03 to let Neon autosuspend (cost): this 5-min
  // heartbeat kept the compute awake ~24/7. The on-fetch fallback (sweepTimedOutAnyMaid runs when a
  // booking list is loaded) is the real safety net, so timed-out any-maid bookings still get re-picked
  // on real traffic. To re-enable, uncomment this block AND the import above.
  // cron.schedule('*/5 * * * *', async () => {
  //   const won = await db.tryAcquireCronLease('anymaid_timeout_sweep', 4);
  //   if (won) await sweepTimedOutAnyMaid(true);
  // });
});
