/**
 * Migration: Restructure services → global catalogue + society_services join table
 * Run with: npx tsx src/migrate.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

const sql: any = neon(process.env.DATABASE_URL!);

const generateId = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID().split('-')[0]}-${Date.now().toString(36)}`;

async function migrate() {
  console.log('=== SevaConnect DB Migration ===\n');

  // Step 1: Add is_active to services
  await sql(`ALTER TABLE services ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true`, []);
  console.log('✓ Added is_active to services');

  // Step 2: Create society_services table
  await sql(`
    CREATE TABLE IF NOT EXISTS society_services (
      id          TEXT PRIMARY KEY,
      society_id  TEXT NOT NULL REFERENCES societies(id),
      service_id  TEXT REFERENCES services(id),
      name        TEXT,
      description TEXT,
      price       NUMERIC,
      duration    INTEGER,
      icon        TEXT,
      is_generic  BOOLEAN,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `, []);
  console.log('✓ Created society_services table');

  // Step 3: Migrate existing society-override service rows → society_services
  // Guard: only run if society_id column still exists (skipped if DB is already clean)
  const hasSocietyId = await sql(
    `SELECT COUNT(*) AS cnt FROM information_schema.columns
     WHERE table_name = 'services' AND column_name = 'society_id' AND table_schema = 'public'`,
    []
  );
  const idMap: Record<string, string> = {}; // old service.id → new society_services.id

  if (Number(hasSocietyId[0].cnt) > 0) {
    const overrides = await sql(`SELECT * FROM services WHERE society_id IS NOT NULL`, []);
    for (const svc of overrides) {
      const newId = generateId('ss');
      idMap[svc.id] = newId;
      await sql(
        `INSERT INTO society_services (id, society_id, service_id, price, is_active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (id) DO NOTHING`,
        [newId, svc.society_id, svc.original_service_id, svc.society_price || null]
      );
    }
    console.log(`✓ Migrated ${overrides.length} society-override services to society_services`);
  } else {
    console.log('✓ No society_id column found — skipping legacy data migration (already clean)');
  }

  // Step 4: Add new columns to bookings
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS society_service_id TEXT`, []);
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS price_at_booking NUMERIC`, []);
  console.log('✓ Added society_service_id + price_at_booking to bookings');

  // Step 5: For bookings pointing at society-override services → set society_service_id
  for (const [oldId, newId] of Object.entries(idMap)) {
    await sql(
      `UPDATE bookings SET society_service_id = $1 WHERE service_id = $2 AND society_service_id IS NULL`,
      [newId, oldId]
    );
  }

  // Step 6: For bookings still pointing at global services → create society_services entries
  const globalBookings = await sql(
    `SELECT DISTINCT b.service_id, h.society_id
     FROM bookings b
     JOIN users h ON b.household_id = h.id
     WHERE b.society_service_id IS NULL AND b.service_id IS NOT NULL AND h.society_id IS NOT NULL`,
    []
  );

  for (const row of globalBookings) {
    const existing = await sql(
      `SELECT id FROM society_services WHERE society_id = $1 AND service_id = $2`,
      [row.society_id, row.service_id]
    );
    let ssId: string;
    if (existing.length > 0) {
      ssId = existing[0].id;
    } else {
      ssId = generateId('ss');
      await sql(
        `INSERT INTO society_services (id, society_id, service_id, is_active) VALUES ($1, $2, $3, true)`,
        [ssId, row.society_id, row.service_id]
      );
    }
    await sql(
      `UPDATE bookings b
       SET society_service_id = $1
       FROM users h
       WHERE b.household_id = h.id
         AND b.service_id = $2
         AND h.society_id = $3
         AND b.society_service_id IS NULL`,
      [ssId, row.service_id, row.society_id]
    );
  }
  console.log(`✓ Resolved ${globalBookings.length} global-service booking groups`);

  // Step 7: Populate price_at_booking from effective price
  await sql(
    `UPDATE bookings b
     SET price_at_booking = COALESCE(
       b.custom_price,
       ss.price,
       s.base_price
     )
     FROM society_services ss
     LEFT JOIN services s ON ss.service_id = s.id
     WHERE b.society_service_id = ss.id AND b.price_at_booking IS NULL`,
    []
  );
  console.log('✓ Populated price_at_booking on all bookings');

  // Step 8: Delete society-override rows from services (now in society_services)
  // Guard: only run if society_id column still exists
  if (Number(hasSocietyId[0].cnt) > 0) {
    await sql(`DELETE FROM services WHERE society_id IS NOT NULL`, []);
    console.log('✓ Removed society-override rows from services');
  } else {
    console.log('✓ No society_id column — skipping delete (already clean)');
  }

  // Step 9: Drop old columns from services
  await sql(`ALTER TABLE services DROP COLUMN IF EXISTS society_id`, []);
  await sql(`ALTER TABLE services DROP COLUMN IF EXISTS society_price`, []);
  await sql(`ALTER TABLE services DROP COLUMN IF EXISTS original_service_id`, []);
  console.log('✓ Dropped society_id, society_price, original_service_id from services');

  // Step 10: Convert services name/description to JSONB for multilingual support
  await sql(`
    DO $$
    BEGIN
      IF (SELECT data_type FROM information_schema.columns
          WHERE table_name = 'services' AND column_name = 'name' AND table_schema = 'public') = 'text' THEN
        ALTER TABLE services
          ALTER COLUMN name TYPE JSONB USING jsonb_build_object('en', name),
          ALTER COLUMN description TYPE JSONB USING jsonb_build_object('en', description);
      END IF;
    END $$
  `, []);
  console.log('✓ services name/description → JSONB');

  // Step 11: Convert society_services name/description to JSONB
  await sql(`
    DO $$
    BEGIN
      IF (SELECT data_type FROM information_schema.columns
          WHERE table_name = 'society_services' AND column_name = 'name' AND table_schema = 'public') = 'text' THEN
        ALTER TABLE society_services
          ALTER COLUMN name TYPE JSONB
            USING CASE WHEN name IS NOT NULL THEN jsonb_build_object('en', name) ELSE NULL END,
          ALTER COLUMN description TYPE JSONB
            USING CASE WHEN description IS NOT NULL THEN jsonb_build_object('en', description) ELSE NULL END;
      END IF;
    END $$
  `, []);
  console.log('✓ society_services name/description → JSONB');

  // Step 12: Fix double-wrapped JSONB values in services
  // Caused by inserting JSON strings into a TEXT column before migration ran.
  // Detects {"en": "{\"en\": \"Cooking\"}"} and unwraps to {"en": "Cooking"}.
  await sql(`
    UPDATE services
    SET
      name = (name->>'en')::jsonb,
      description = CASE
        WHEN (description->>'en') ~ '^[{\\[]' THEN (description->>'en')::jsonb
        ELSE description
      END
    WHERE (name->>'en') ~ '^[{\\[]'
  `, []);
  console.log('✓ Fixed double-wrapped name/description in services');

  await sql(`
    UPDATE society_services
    SET
      name = CASE WHEN name IS NOT NULL AND (name->>'en') ~ '^[{\\[]' THEN (name->>'en')::jsonb ELSE name END,
      description = CASE WHEN description IS NOT NULL AND (description->>'en') ~ '^[{\\[]' THEN (description->>'en')::jsonb ELSE description END
    WHERE
      (name IS NOT NULL AND (name->>'en') ~ '^[{\\[]')
      OR (description IS NOT NULL AND (description->>'en') ~ '^[{\\[]')
  `, []);
  console.log('✓ Fixed double-wrapped name/description in society_services');

  console.log('\n=== Migration complete! ===');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
