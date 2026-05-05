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

  // Steps 5-7: Legacy service_id migration (skipped if service_id column already dropped)
  const hasServiceId = await sql(
    `SELECT COUNT(*) AS cnt FROM information_schema.columns
     WHERE table_name = 'bookings' AND column_name = 'service_id' AND table_schema = 'public'`,
    []
  );
  if (Number(hasServiceId[0].cnt) > 0) {
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
  } else {
    console.log('✓ Steps 5-7 skipped (service_id column already dropped)');
  }

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

  // Step 13: Add auto_accept to users (opt-in to auto-confirming new bookings)
  await sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_accept BOOLEAN NOT NULL DEFAULT FALSE`, []);
  console.log('✓ Added auto_accept to users');

  // Step 14: (one-time clean slate — intentionally skipped now that schema is stable)
  console.log('✓ Step 14 skipped (bookings preserved)');

  // Step 15: staging_contracts table
  await sql(`
    CREATE TABLE IF NOT EXISTS staging_contracts (
      id                    TEXT PRIMARY KEY,
      upload_id             TEXT NOT NULL,
      upload_user           TEXT NOT NULL REFERENCES users(id),
      file_name             TEXT NOT NULL,
      upload_timestamp      TIMESTAMPTZ DEFAULT NOW(),
      household_phone       TEXT NOT NULL,
      maid_phone            TEXT NOT NULL,
      job_description       TEXT,
      frequency             TEXT NOT NULL,
      start_time            TEXT NOT NULL,
      end_time              TEXT NOT NULL,
      start_date            TEXT NOT NULL,
      monthly_contract_fee  NUMERIC NOT NULL,
      status                TEXT NOT NULL DEFAULT 'PENDING',
      error_message         TEXT,
      household_id          TEXT,
      maid_id               TEXT,
      society_id            TEXT
    )
  `, []);
  console.log('✓ Created staging_contracts table');

  // Step 16: contract_uploads audit table
  await sql(`
    CREATE TABLE IF NOT EXISTS contract_uploads (
      id               TEXT PRIMARY KEY,
      uploaded_by      TEXT NOT NULL REFERENCES users(id),
      file_name        TEXT NOT NULL,
      total_rows       INTEGER NOT NULL DEFAULT 0,
      success_count    INTEGER NOT NULL DEFAULT 0,
      failure_count    INTEGER NOT NULL DEFAULT 0,
      errors           JSONB,
      created_bookings JSONB,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `, []);
  console.log('✓ Created contract_uploads table');

  // Step 17: New columns on bookings + SCD Type 2 versioning columns
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true`, []);
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS eff_start_date TEXT`, []);
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS eff_end_date TEXT`, []);
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS staging_contract_id TEXT REFERENCES staging_contracts(id)`, []);
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_contract BOOLEAN NOT NULL DEFAULT false`, []);
  // SCD Type 2 versioning: valid_from/valid_to/is_current track row history
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ DEFAULT NOW()`, []);
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS valid_to TIMESTAMPTZ`, []);
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT true`, []);
  // Backfill eff_start_date for any remaining existing rows (skip if date column already dropped by Step 25)
  const dateColCheck = await sql(`SELECT COUNT(*) as cnt FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'date'`, []);
  if (Number((dateColCheck as any)[0]?.cnt) > 0) {
    await sql(`UPDATE bookings SET eff_start_date = date WHERE eff_start_date IS NULL`, []);
  }
  console.log('✓ Added active, eff_start_date, eff_end_date, staging_contract_id, is_contract, valid_from, valid_to, is_current to bookings');

  // Step 18: Drop redundant eff_start_date and eff_end_date columns (superseded by valid_from/valid_to/is_current)
  await sql(`ALTER TABLE bookings DROP COLUMN IF EXISTS eff_start_date`, []);
  await sql(`ALTER TABLE bookings DROP COLUMN IF EXISTS eff_end_date`, []);
  console.log('✓ Dropped eff_start_date and eff_end_date from bookings');

  // Step 19: Global "Contract" service
  await sql(`
    INSERT INTO services (id, name, description, base_price, duration_minutes, icon, is_generic, is_active)
    VALUES ('srv-contract-global', '{"en":"Contract"}', '{"en":"Recurring contract service"}', 0, 60, 'FileText', false, true)
    ON CONFLICT (id) DO NOTHING
  `, []);
  console.log('✓ Inserted global Contract service (srv-contract-global)');

  // Step 20: Expo push token on users (for contract update/cancel notifications)
  await sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS expo_push_token TEXT`, []);
  console.log('✓ Added expo_push_token to users');

  // Step 21: Allow app-created contracts (upload_id and file_name nullable in staging_contracts)
  // Step 22: Track auto-accepted bookings
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS auto_accepted BOOLEAN NOT NULL DEFAULT FALSE`, []);
  console.log('✓ Added auto_accepted to bookings');

  // Step 21: Allow app-created contracts (upload_id and file_name nullable in staging_contracts)
  await sql(`ALTER TABLE staging_contracts ALTER COLUMN upload_id DROP NOT NULL`, []);
  await sql(`ALTER TABLE staging_contracts ALTER COLUMN file_name DROP NOT NULL`, []);
  console.log('✓ Made staging_contracts.upload_id and file_name nullable (supports app-created contracts)');

  // Step 23: Audit log — why a booking row was closed (SCD Type 2 close reason)
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS update_comments TEXT`, []);
  console.log('✓ Added update_comments to bookings (SCD close-reason audit log)');

  // Step 24: is_replacement flag — marks one-off replacement sessions so they don't
  // appear in the replacement maid's "My Contracts" view. getContractsForUser now
  // anchors on bookings (not staging_contracts) and filters is_replacement = false.
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_replacement BOOLEAN NOT NULL DEFAULT false`, []);
  console.log('✓ Added is_replacement to bookings (replacement session flag)');

  // ═══════════════════════════════════════════════════════════════
  // Step 25: Unified SCD Type 2 Bookings Redesign
  // ═══════════════════════════════════════════════════════════════
  console.log('\n--- Step 25: Unified SCD Type 2 Bookings Redesign ---');

  // 25a: Wipe all data (FK-safe order)
  for (const table of ['messages', 'reviews', 'bookings', 'staging_contracts', 'contract_uploads', 'society_services', 'services', 'users']) {
    await sql(`DELETE FROM ${table}`, []);
  }
  console.log('✓ Wiped all data');

  // 25b: Drop FK constraints (messages/reviews → bookings.id no longer valid with composite PK)
  await sql(`ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_booking_id_fkey`, []);
  await sql(`ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_booking_id_fkey`, []);
  console.log('✓ Dropped FK constraints on messages/reviews → bookings');

  // 25c: Drop old bookings columns
  for (const col of ['valid_from', 'valid_to', 'is_current', 'active', 'is_contract', 'is_replacement', 'service_id', 'date']) {
    await sql(`ALTER TABLE bookings DROP COLUMN IF EXISTS ${col}`, []);
  }
  console.log('✓ Dropped old columns: valid_from, valid_to, is_current, active, is_contract, is_replacement, service_id, date');

  // 25d: Drop existing PK + old eff columns (may have wrong type from earlier migration steps)
  await sql(`ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_pkey`, []);
  await sql(`ALTER TABLE bookings DROP COLUMN IF EXISTS eff_start_date`, []);
  await sql(`ALTER TABLE bookings DROP COLUMN IF EXISTS eff_end_date`, []);
  console.log('✓ Dropped PK + old eff columns');

  // 25e: Add new columns
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_type TEXT`, []);
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_replacement_of TEXT`, []);
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS work_start_date DATE`, []);
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS work_end_date DATE`, []);
  await sql(`ALTER TABLE bookings ADD COLUMN eff_start_date TIMESTAMPTZ NOT NULL DEFAULT NOW()`, []);
  await sql(`ALTER TABLE bookings ADD COLUMN eff_end_date TIMESTAMPTZ NOT NULL DEFAULT '3499-12-31'`, []);
  await sql(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`, []);
  // Enforce NOT NULL on required business columns (safe — table is empty after wipe)
  await sql(`ALTER TABLE bookings ALTER COLUMN booking_type SET NOT NULL`, []);
  await sql(`ALTER TABLE bookings ALTER COLUMN work_start_date SET NOT NULL`, []);
  await sql(`ALTER TABLE bookings ALTER COLUMN work_end_date SET NOT NULL`, []);
  console.log('✓ Added new columns: booking_type, is_replacement_of, work_start_date, work_end_date, eff_start_date, eff_end_date, created_at');

  // 25f: Composite primary key
  await sql(`ALTER TABLE bookings ADD PRIMARY KEY (id, eff_start_date)`, []);
  console.log('✓ Added composite PK (id, eff_start_date)');

  // 25g: Indexes
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_bookings_maid_eff ON bookings (maid_id, eff_end_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_bookings_household_eff ON bookings (household_id, eff_end_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_bookings_type_eff ON bookings (booking_type, eff_end_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_bookings_replacement_of ON bookings (is_replacement_of) WHERE is_replacement_of IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_bookings_work_dates ON bookings (work_start_date, work_end_date)`,
    `CREATE INDEX IF NOT EXISTS idx_bookings_society_service ON bookings (society_service_id) WHERE society_service_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_bookings_staging_contract ON bookings (staging_contract_id) WHERE staging_contract_id IS NOT NULL`,
  ];
  for (const idx of indexes) {
    await sql(idx, []);
  }
  console.log('✓ Added indexes');

  // 25h: Seed 7 global services
  const globalServices = [
    { id: 'srv-1', name: '{"en":"Floor Cleaning"}', desc: '{"en":"Complete floor cleaning and mopping"}', price: 200, duration: 60, icon: '🧹', isGeneric: false },
    { id: 'srv-2', name: '{"en":"Utensil Washing"}', desc: '{"en":"Washing dishes and utensils"}', price: 150, duration: 45, icon: '🍽️', isGeneric: false },
    { id: 'srv-3', name: '{"en":"Cooking"}', desc: '{"en":"Meal preparation"}', price: 300, duration: 90, icon: '🍳', isGeneric: false },
    { id: 'srv-4', name: '{"en":"Laundry"}', desc: '{"en":"Washing and ironing clothes"}', price: 250, duration: 120, icon: '👔', isGeneric: false },
    { id: 'srv-5', name: '{"en":"General Help"}', desc: '{"en":"Flexible service for custom tasks"}', price: 0, duration: 60, icon: '🛠️', isGeneric: true },
    { id: 'srv-contract-global', name: '{"en":"Contract"}', desc: '{"en":"Recurring contract service"}', price: 0, duration: 60, icon: 'FileText', isGeneric: false },
    { id: 'srv-replacement-global', name: '{"en":"Contract Replacement"}', desc: '{"en":"Hourly rate for replacement maid sessions"}', price: 150, duration: 60, icon: '🔄', isGeneric: false },
  ];
  for (const s of globalServices) {
    await (sql as any)(
      `INSERT INTO services (id, name, description, base_price, duration_minutes, icon, is_generic, is_active)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, true)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description,
         base_price = EXCLUDED.base_price, duration_minutes = EXCLUDED.duration_minutes,
         icon = EXCLUDED.icon, is_generic = EXCLUDED.is_generic, is_active = EXCLUDED.is_active`,
      [s.id, s.name, s.desc, s.price, s.duration, s.icon, s.isGeneric]
    );
  }
  console.log('✓ Seeded 7 global services');

  // 25i: Ensure test society soc-1 exists
  await (sql as any)(
    `INSERT INTO societies (id, name, address, code)
     SELECT 'soc-1', 'Gokuldham Society', 'Powai, Mumbai', 'GOK-400076'
     WHERE NOT EXISTS (SELECT 1 FROM societies WHERE id = 'soc-1')`,
    []
  );
  console.log('✓ Ensured test society soc-1 exists');

  // 25j: Seed 7 society_services for soc-1
  const societyServices = [
    { id: 'ss-floor-soc1', serviceId: 'srv-1' },
    { id: 'ss-utensil-soc1', serviceId: 'srv-2' },
    { id: 'ss-cooking-soc1', serviceId: 'srv-3' },
    { id: 'ss-laundry-soc1', serviceId: 'srv-4' },
    { id: 'ss-general-soc1', serviceId: 'srv-5' },
    { id: 'ss-contract-soc1', serviceId: 'srv-contract-global' },
    { id: 'ss-replacement-soc1', serviceId: 'srv-replacement-global' },
  ];
  for (const ss of societyServices) {
    await (sql as any)(
      `INSERT INTO society_services (id, society_id, service_id, is_active)
       VALUES ($1, 'soc-1', $2, true)
       ON CONFLICT (id) DO NOTHING`,
      [ss.id, ss.serviceId]
    );
  }
  console.log('✓ Seeded 7 society_services for soc-1');

  // 25k: Seed 17 test user accounts (password: 123456)
  const pwHash = '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92';
  const householdNames = ['One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten'];
  const testUsers = [
    { id: 'u-sys', name: 'System Admin', username: 'sys', role: 'SYS_ADMIN', societyId: null, autoAccept: false },
    { id: 'u-soc-admin', name: 'Society Admin', username: 'soc_admin', role: 'SOCIETY_ADMIN', societyId: 'soc-1', autoAccept: false },
    { id: 'u-maid-1', name: 'Maid One', username: 'maid1', role: 'MAID', societyId: 'soc-1', autoAccept: false },
    { id: 'u-maid-2', name: 'Maid Two', username: 'maid2', role: 'MAID', societyId: 'soc-1', autoAccept: false },
    { id: 'u-maid-3', name: 'Maid Three', username: 'maid3', role: 'MAID', societyId: 'soc-1', autoAccept: true },
    { id: 'u-maid-4', name: 'Maid Four', username: 'maid4', role: 'MAID', societyId: 'soc-1', autoAccept: true },
    { id: 'u-maid-5', name: 'Maid Five', username: 'maid5', role: 'MAID', societyId: 'soc-1', autoAccept: false },
    ...householdNames.map((n, i) => ({
      id: `u-house-${i + 1}`, name: `Household ${n}`, username: `house${i + 1}`,
      role: 'HOUSEHOLD', societyId: 'soc-1', autoAccept: false,
    })),
  ];
  for (const u of testUsers) {
    await (sql as any)(
      `INSERT INTO users (id, name, username, password_hash, role, society_id, is_verified, phone, address, skills, leaves, must_change_password, auto_accept)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[], FALSE, $7)
       ON CONFLICT (id) DO NOTHING`,
      [u.id, u.name, u.username, pwHash, u.role, u.societyId, u.autoAccept]
    );
  }
  console.log('✓ Seeded 17 test user accounts');

  // Step 26: Allow NULL maid_id on bookings — REPLACEMENT rows are created at maid-leave
  // time with maid_id=NULL ("needs replacement; no maid assigned") and only get a maid_id
  // once the household assigns one via assignReplacementForBooking.
  await sql(`ALTER TABLE bookings ALTER COLUMN maid_id DROP NOT NULL`, []);
  console.log('✓ Allowed NULL on bookings.maid_id (pending-replacement state)');

  // Backfill: clear maid_id on any existing REPLACEMENT-REQUESTED rows whose maid_id
  // still points at the parent's maid (i.e., createLeaveExceptionBooking-style rows
  // from before this change). Leave assigned/auto-accepted rows alone.
  await sql(
    `UPDATE bookings b
       SET maid_id = NULL
     WHERE b.booking_type = 'REPLACEMENT'
       AND b.status = 'REQUESTED'
       AND b.eff_end_date = '3499-12-31'
       AND b.is_replacement_of IS NOT NULL
       AND b.maid_id IS NOT NULL
       AND b.maid_id = (
         SELECT p.maid_id FROM bookings p
         WHERE p.id = b.is_replacement_of AND p.eff_end_date = '3499-12-31'
       )`,
    []
  );
  console.log('✓ Backfilled NULL maid_id on pending-replacement rows');

  console.log('\n=== Migration complete! ===');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
