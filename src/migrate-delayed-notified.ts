import dotenv from 'dotenv';
dotenv.config();

import { neon } from '@neondatabase/serverless';

const sql: any = neon(process.env.DATABASE_URL!);

async function migrate() {
  console.log('=== Kamon DB Migration: delayed-notification marker ===\n');

  // Dedupe marker for the same-day "Delayed" push (a job whose end time passed with no OTP).
  // This is NOT a status change — the Delayed state itself stays derived/display-only; this only
  // records that we've already sent the one-time notification so the hourly sweep doesn't repeat it.
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS delayed_notified_at TIMESTAMPTZ`, []);

  console.log('✓ Added delayed_notified_at column to bookings table');
  console.log('\n=== Migration complete! ===');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
