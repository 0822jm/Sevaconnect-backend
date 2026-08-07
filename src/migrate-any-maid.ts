import dotenv from 'dotenv';
dotenv.config();

import { neon } from '@neondatabase/serverless';

const sql: any = neon(process.env.DATABASE_URL!);

// The all-time trust formula (mirrors login/getUserById): 0–100, default 50 for maids with no
// reviews and no settled bookings. Materialised into users.trust_score so the pool query and the
// weighted pick read a cheap column instead of correlated subqueries.
const TRUST_FORMULA = `
  ROUND(COALESCE(
    CASE
      WHEN (SELECT COUNT(*) FROM reviews WHERE maid_id = u.id) = 0
       AND (SELECT COUNT(*) FROM (SELECT DISTINCT ON (id) status FROM bookings WHERE maid_id = u.id ORDER BY id, eff_end_date DESC) sub WHERE sub.status != 'REQUESTED') = 0
      THEN 50
      ELSE
        (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE maid_id = u.id) / 5.0 * 60
        + (1.0 - (SELECT COUNT(*) FROM (SELECT DISTINCT ON (id) status FROM bookings WHERE maid_id = u.id ORDER BY id, eff_end_date DESC) sub WHERE sub.status = 'CANCELLED')::float
                / GREATEST((SELECT COUNT(*) FROM (SELECT DISTINCT ON (id) status FROM bookings WHERE maid_id = u.id ORDER BY id, eff_end_date DESC) sub WHERE sub.status NOT IN ('REQUESTED','TERMINATED')), 1)) * 30
        + LEAST((SELECT COUNT(*) FROM (SELECT DISTINCT ON (id) status FROM bookings WHERE maid_id = u.id ORDER BY id, eff_end_date DESC) sub WHERE sub.status = 'COMPLETED')::float / 50.0, 1.0) * 10
    END
  , 50))`;

async function migrate() {
  console.log('=== Kamon DB Migration: "any maid" random assignment ===\n');

  // 1) Extension for gist equality on maid_id in the exclusion constraint.
  await sql(`CREATE EXTENSION IF NOT EXISTS btree_gist`, []);
  console.log('✓ btree_gist ready');

  // 2) Feature columns.
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS any_maid_pool VARCHAR`, []);
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tried_maid_ids TEXT[]`, []);
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR`, []);
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ`, []);
  await sql(`CREATE UNIQUE INDEX IF NOT EXISTS bookings_idempotency_key_uidx ON bookings (idempotency_key) WHERE idempotency_key IS NOT NULL`, []);
  console.log('✓ Columns any_maid_pool / tried_maid_ids / idempotency_key(+unique) / matched_at');

  // 3) Materialise trust_score + backfill maids.
  await sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trust_score INTEGER DEFAULT 50`, []);
  await sql(`UPDATE users u SET trust_score = ${TRUST_FORMULA} WHERE u.role = 'MAID'`, []);
  console.log('✓ users.trust_score added + backfilled for maids');

  // 3b) Cron lease table — leader election for scheduled jobs across N Render instances (nightly
  //     trust refresh, stale sweep, any-maid timeout re-pick). One row per job; a leased job is
  //     skipped by other instances until the lease expires. HTTP-driver-safe (atomic upsert).
  await sql(
    `CREATE TABLE IF NOT EXISTS cron_leases (
       job_name     VARCHAR PRIMARY KEY,
       locked_until TIMESTAMPTZ,
       locked_by    VARCHAR
     )`,
    [],
  );
  console.log('✓ cron_leases table ready');

  // 4) Pre-existing-overlap detection — the exclusion constraint ADD fails if any exist, so surface
  //    them first (they must be resolved before enabling the constraint).
  const overlaps = await sql(
    `SELECT a.maid_id, a.id AS booking_a, b.id AS booking_b, a.work_start_date,
            a.start_time AS a_start, a.end_time AS a_end, b.start_time AS b_start, b.end_time AS b_end
     FROM bookings a
     JOIN bookings b ON a.maid_id = b.maid_id AND a.id < b.id
       AND a.work_start_date = b.work_start_date
       AND a.start_time < b.end_time AND b.start_time < a.end_time
     WHERE a.eff_end_date = '3499-12-31' AND b.eff_end_date = '3499-12-31'
       AND a.status IN ('REQUESTED','CONFIRMED','IN_PROGRESS') AND b.status IN ('REQUESTED','CONFIRMED','IN_PROGRESS')
       AND a.booking_type IN ('ADHOC','REPLACEMENT') AND b.booking_type IN ('ADHOC','REPLACEMENT')
       AND a.maid_id IS NOT NULL`,
    [],
  );
  if (overlaps.length > 0) {
    console.error(`\n✗ Found ${overlaps.length} pre-existing overlapping active booking pair(s) for the same maid:`);
    overlaps.slice(0, 20).forEach((r: any) =>
      console.error(`   maid ${r.maid_id} on ${r.work_start_date}: ${r.booking_a} (${r.a_start}-${r.a_end}) vs ${r.booking_b} (${r.b_start}-${r.b_end})`));
    console.error('\nResolve these (cancel/adjust one of each pair) before re-running — the exclusion constraint cannot be added while they exist.');
    process.exit(1);
  }
  console.log('✓ No pre-existing overlaps');

  // 5) IMMUTABLE helper to build a booking's slot instant from a `date` column + a `text` 'HH:MM'
  //    time. start_time/end_time are stored as text, and `text::time` is only STABLE (it can depend
  //    on session settings) so it can't live in an index expression. make_timestamp + split_part +
  //    extract are all IMMUTABLE, so this function is safely usable inside the exclusion constraint.
  await sql(
    `CREATE OR REPLACE FUNCTION booking_slot_ts(d date, t text) RETURNS timestamp
       LANGUAGE sql IMMUTABLE AS $func$
         SELECT make_timestamp(
           extract(year  FROM d)::int,
           extract(month FROM d)::int,
           extract(day   FROM d)::int,
           split_part(t, ':', 1)::int,
           split_part(t, ':', 2)::int,
           0
         )
       $func$`,
    [],
  );
  console.log('✓ booking_slot_ts(date, text) IMMUTABLE helper ready');

  // 6) Exclusion constraint — no two ACTIVE ad-hoc/replacement bookings for one maid may overlap.
  //    Guarded with IF NOT EXISTS so re-running after a partial failure is safe.
  await sql(
    `DO $do$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_maid_slot_overlap') THEN
         ALTER TABLE bookings ADD CONSTRAINT bookings_no_maid_slot_overlap
           EXCLUDE USING gist (
             maid_id WITH =,
             tsrange(booking_slot_ts(work_start_date, start_time), booking_slot_ts(work_start_date, end_time)) WITH &&
           )
           WHERE (eff_end_date = '3499-12-31'
             AND status IN ('REQUESTED','CONFIRMED','IN_PROGRESS')
             AND booking_type IN ('ADHOC','REPLACEMENT')
             AND maid_id IS NOT NULL);
       END IF;
     END $do$`,
    [],
  );
  console.log('✓ Exclusion constraint bookings_no_maid_slot_overlap added');

  console.log('\n=== Migration complete! ===');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
