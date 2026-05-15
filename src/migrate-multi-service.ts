/**
 * Migration: Create booking_services junction table for multi-service bookings.
 * Run with: npx tsx src/migrate-multi-service.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { neon } from '@neondatabase/serverless';

const sql: any = neon(process.env.DATABASE_URL!);

async function migrate() {
  console.log('=== SevaConnect Migration: multi-service booking_services ===\n');

  // Step 1: Create booking_services table
  await sql(`
    CREATE TABLE IF NOT EXISTS booking_services (
      id                  TEXT PRIMARY KEY,
      booking_id          TEXT NOT NULL,
      society_service_id  TEXT NOT NULL,
      price_at_booking    NUMERIC,
      duration_minutes    INTEGER,
      sort_order          INTEGER NOT NULL DEFAULT 0
    )
  `, []);
  await sql(`CREATE INDEX IF NOT EXISTS idx_booking_services_booking_id ON booking_services (booking_id)`, []);
  console.log('✓ Created booking_services table');

  // Step 2: Migrate existing bookings that have a society_service_id but no booking_services row
  const migrated = await sql(`
    INSERT INTO booking_services (id, booking_id, society_service_id, price_at_booking, duration_minutes, sort_order)
    SELECT
      'bks-' || md5(b.id) AS id,
      b.id AS booking_id,
      b.society_service_id,
      b.price_at_booking,
      COALESCE(
        (SELECT COALESCE(ss.duration, svc.duration_minutes)
         FROM society_services ss
         LEFT JOIN services svc ON ss.service_id = svc.id
         WHERE ss.id = b.society_service_id),
        0
      ) AS duration_minutes,
      0 AS sort_order
    FROM bookings b
    WHERE b.society_service_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM booking_services bs WHERE bs.booking_id = b.id
      )
  `, []);
  console.log(`✓ Migrated existing bookings to booking_services`);

  // Step 3: Make society_service_id nullable for new multi-service bookings
  const hasNotNull = await sql(`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_name = 'bookings'
      AND column_name = 'society_service_id'
      AND table_schema = 'public'
  `, []);

  if (hasNotNull.length > 0 && hasNotNull[0].is_nullable === 'NO') {
    await sql(`ALTER TABLE bookings ALTER COLUMN society_service_id DROP NOT NULL`, []);
    console.log('✓ Made bookings.society_service_id nullable');
  } else {
    console.log('✓ bookings.society_service_id already nullable — skipped');
  }

  console.log('\n=== Migration complete ===');
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
