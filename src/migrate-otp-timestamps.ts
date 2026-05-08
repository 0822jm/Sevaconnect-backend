import dotenv from 'dotenv';
dotenv.config();

import { neon } from '@neondatabase/serverless';

const sql: any = neon(process.env.DATABASE_URL!);

async function migrate() {
  console.log('=== SevaConnect DB Migration: bookings OTP timestamps ===\n');

  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS start_otp_time TIMESTAMPTZ`, []);
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS end_otp_time TIMESTAMPTZ`, []);

  console.log('✓ Added start_otp_time and end_otp_time columns to bookings table');
  console.log('\n=== Migration complete! ===');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
