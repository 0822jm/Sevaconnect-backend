/**
 * Migration: Reset global services catalog, migrate existing bookings to the new
 * catalog, set up soc-1 society_services, and reset maid skills to the new
 * society_service_id format.
 *
 * Run with: npx tsx src/migrate-skills-catalog.ts
 *
 * IMPORTANT: Always run against a Neon branch first. See the plan at
 * C:\Users\JM\.claude\plans\tranquil-meandering-wadler.md (Verification > Step 0).
 *
 * Transaction-wrapped via `Pool.connect()` so the whole migration rolls back
 * on any failure. Idempotent: safe to re-run.
 */
import dotenv from 'dotenv';
dotenv.config();

import { Pool } from '@neondatabase/serverless';

const KEEP_GLOBAL_IDS = ['srv-contract-global', 'srv-replacement-global'] as const;
const NEW_GLOBAL_IDS = ['srv-cleaning-global', 'srv-cooking-global', 'srv-laundry-global'] as const;
const SOC_1 = 'soc-1';

async function migrate() {
  console.log('=== Kamon Migration: skills catalog reset ===\n');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ─── 1a. Insert new global services ───
    console.log('Step 1a: Insert new global services');
    const newGlobals = [
      { id: 'srv-cleaning-global', name: { en: 'Cleaning' },           icon: '🧹', price: 300, duration: 120 },
      { id: 'srv-cooking-global',  name: { en: 'Cooking' },            icon: '🍳', price: 250, duration: 60  },
      { id: 'srv-laundry-global',  name: { en: 'Laundry / Ironing' },  icon: '🧺', price: 200, duration: 90  },
    ];
    for (const g of newGlobals) {
      await client.query(
        `INSERT INTO services (id, name, description, base_price, duration_minutes, icon, is_generic, is_active, pricing_config)
         VALUES ($1, $2::jsonb, '{}'::jsonb, $3, $4, $5, FALSE, TRUE, NULL)
         ON CONFLICT (id) DO NOTHING`,
        [g.id, JSON.stringify(g.name), g.price, g.duration, g.icon]
      );
    }
    console.log(`  ✓ Inserted ${newGlobals.length} new globals (or no-op if existed)`);

    // ─── Collect IDs to delete ───
    const KEEP_ALL = [...KEEP_GLOBAL_IDS, ...NEW_GLOBAL_IDS];
    const oldServiceRows = await client.query<{ id: string }>(
      `SELECT id FROM services
       WHERE is_generic = FALSE
         AND id NOT IN (${KEEP_ALL.map((_, i) => `$${i + 1}`).join(',')})`,
      KEEP_ALL as unknown as string[]
    );
    const oldServiceIds = oldServiceRows.rows.map(r => r.id);
    console.log(`  Old service IDs to delete: ${oldServiceIds.length === 0 ? '(none)' : oldServiceIds.join(', ')}`);

    let oldSsIds: string[] = [];
    if (oldServiceIds.length > 0) {
      const oldSsRows = await client.query<{ id: string; society_id: string }>(
        `SELECT id, society_id FROM society_services WHERE service_id = ANY($1::text[])`,
        [oldServiceIds]
      );
      oldSsIds = oldSsRows.rows.map(r => r.id);
      console.log(`  Old society_service IDs to migrate: ${oldSsIds.length === 0 ? '(none)' : oldSsIds.join(', ')}`);
    }

    // ─── 1b. Migrate bookings off deleted services ───
    console.log('\nStep 1b: Migrate bookings to Cleaning society_service');
    if (oldSsIds.length > 0) {
      // Which societies have bookings (or booking_services) referring to the old ss ids?
      const affectedSocietiesResult = await client.query<{ society_id: string }>(
        `SELECT DISTINCT ss.society_id
         FROM society_services ss
         WHERE ss.id = ANY($1::text[])`,
        [oldSsIds]
      );
      const affectedSocieties = affectedSocietiesResult.rows.map(r => r.society_id);
      console.log(`  Affected societies: ${affectedSocieties.length === 0 ? '(none)' : affectedSocieties.join(', ')}`);

      for (const societyId of affectedSocieties) {
        // Find or create a Cleaning society_service for this society
        let cleaningSsId: string | null = null;
        const existingCleaning = await client.query<{ id: string }>(
          `SELECT id FROM society_services WHERE society_id = $1 AND service_id = 'srv-cleaning-global'`,
          [societyId]
        );
        if (existingCleaning.rows.length > 0) {
          cleaningSsId = existingCleaning.rows[0].id;
          console.log(`    Society ${societyId}: Cleaning ss already exists (${cleaningSsId})`);
        } else {
          cleaningSsId = `ss-cleaning-${societyId}`;
          await client.query(
            `INSERT INTO society_services (id, society_id, service_id, name, description, price, duration, icon, is_generic, is_active)
             VALUES ($1, $2, 'srv-cleaning-global', NULL, NULL, NULL, NULL, NULL, NULL, TRUE)
             ON CONFLICT (id) DO NOTHING`,
            [cleaningSsId, societyId]
          );
          console.log(`    Society ${societyId}: Created Cleaning ss (${cleaningSsId})`);
        }

        // Migrate booking_services rows for this society's old ss ids
        // (society_services rows in old_ss are all in this iteration's society set)
        const updateBs = await client.query(
          `UPDATE booking_services
           SET society_service_id = $1
           WHERE society_service_id IN (
             SELECT id FROM society_services WHERE society_id = $2 AND id = ANY($3::text[])
           )`,
          [cleaningSsId, societyId, oldSsIds]
        );
        console.log(`    Society ${societyId}: Updated ${updateBs.rowCount} booking_services rows`);

        // Migrate bookings.society_service_id (legacy single-service field)
        const updateB = await client.query(
          `UPDATE bookings
           SET society_service_id = $1
           WHERE society_service_id IN (
             SELECT id FROM society_services WHERE society_id = $2 AND id = ANY($3::text[])
           )`,
          [cleaningSsId, societyId, oldSsIds]
        );
        console.log(`    Society ${societyId}: Updated ${updateB.rowCount} bookings (legacy field)`);
      }
    } else {
      console.log('  ✓ No old society_services to migrate');
    }

    // ─── 1c. Delete old society_services ───
    console.log('\nStep 1c: Delete old society_services linking to deleted globals');
    if (oldServiceIds.length > 0) {
      const delSs = await client.query(
        `DELETE FROM society_services WHERE service_id = ANY($1::text[])`,
        [oldServiceIds]
      );
      console.log(`  ✓ Deleted ${delSs.rowCount} society_services rows`);
    } else {
      console.log('  ✓ No society_services to delete');
    }

    // ─── 1ca. Strip dangling skill IDs from users.skills ───
    console.log('\nStep 1ca: Strip dangling skill IDs');
    const strip = await client.query(
      `UPDATE users u
       SET skills = ARRAY(
         SELECT s FROM unnest(u.skills) s
         WHERE EXISTS (SELECT 1 FROM society_services ss WHERE ss.id = s)
       )
       WHERE u.role = 'MAID'
         AND u.skills IS NOT NULL
         AND cardinality(u.skills) > 0`
    );
    console.log(`  ✓ Scanned/stripped ${strip.rowCount} maid skill arrays`);

    // ─── 1d. Delete old global services ───
    console.log('\nStep 1d: Delete old global services');
    if (oldServiceIds.length > 0) {
      const delSvc = await client.query(
        `DELETE FROM services WHERE id = ANY($1::text[])`,
        [oldServiceIds]
      );
      console.log(`  ✓ Deleted ${delSvc.rowCount} services rows`);
    } else {
      console.log('  ✓ No services to delete');
    }

    // ─── 1e. Set up soc-1 society_services ───
    console.log('\nStep 1e: Set up soc-1 society_services');

    // Soc-1 existence guard
    const soc1Check = await client.query(`SELECT 1 FROM societies WHERE id = $1`, [SOC_1]);
    if (soc1Check.rows.length === 0) {
      throw new Error("Test society 'soc-1' not found — seed it first.");
    }

    // General Help global id (is_generic = true)
    const generalRow = await client.query<{ id: string }>(
      `SELECT id FROM services WHERE is_generic = TRUE ORDER BY id LIMIT 1`
    );
    const generalServiceId = generalRow.rows[0]?.id;
    if (!generalServiceId) {
      throw new Error("No generic service (General Help) found in services table.");
    }

    // Rows to create — linked
    const linkedRows = [
      { id: 'ss-cleaning-soc1', serviceId: 'srv-cleaning-global' },
      { id: 'ss-cooking-soc1',  serviceId: 'srv-cooking-global'  },
      { id: 'ss-laundry-soc1',  serviceId: 'srv-laundry-global'  },
      { id: 'ss-general-soc1',  serviceId: generalServiceId      },
    ];
    for (const r of linkedRows) {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM society_services WHERE society_id = $1 AND service_id = $2`,
        [SOC_1, r.serviceId]
      );
      if (existing.rows.length > 0) {
        console.log(`  ✓ ${r.serviceId} → soc-1 already exists (${existing.rows[0].id})`);
        continue;
      }
      await client.query(
        `INSERT INTO society_services (id, society_id, service_id, name, description, price, duration, icon, is_generic, is_active)
         VALUES ($1, $2, $3, NULL, NULL, NULL, NULL, NULL, NULL, TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [r.id, SOC_1, r.serviceId]
      );
      console.log(`  ✓ Created ${r.id} (${r.serviceId})`);
    }

    // Garden Maintenance — exclusive
    const gardenCheck = await client.query<{ id: string }>(
      `SELECT id FROM society_services
       WHERE society_id = $1 AND service_id IS NULL AND name->>'en' = 'Garden Maintenance'`,
      [SOC_1]
    );
    if (gardenCheck.rows.length > 0) {
      console.log(`  ✓ Garden Maintenance already exists (${gardenCheck.rows[0].id})`);
    } else {
      const gardenId = 'ss-garden-soc1';
      await client.query(
        `INSERT INTO society_services (id, society_id, service_id, name, description, price, duration, icon, is_generic, is_active)
         VALUES ($1, $2, NULL, $3::jsonb, '{}'::jsonb, 400, 120, '🌿', FALSE, TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [gardenId, SOC_1, JSON.stringify({ en: 'Garden Maintenance' })]
      );
      console.log(`  ✓ Created Garden Maintenance (${gardenId})`);
    }

    // ─── 1f. Reset maid skills to "all skills" (guarded) ───
    console.log('\nStep 1f: Reset maid skills');
    const reset = await client.query(
      `UPDATE users u
       SET skills = COALESCE((
         SELECT ARRAY_AGG(ss.id)
         FROM society_services ss
         LEFT JOIN services svc ON svc.id = ss.service_id
         WHERE ss.society_id = u.society_id
           AND COALESCE(ss.is_generic, svc.is_generic, FALSE) = FALSE
           AND (ss.service_id IS NULL OR ss.service_id NOT IN ('srv-contract-global', 'srv-replacement-global'))
           AND ss.is_active = TRUE
       ), '{}')
       WHERE u.role = 'MAID'
         AND (
           u.skills IS NULL
           OR cardinality(u.skills) = 0
           OR EXISTS (SELECT 1 FROM unnest(u.skills) s WHERE s NOT LIKE 'ss-%')
         )`
    );
    console.log(`  ✓ Reset skills for ${reset.rowCount} maids`);

    await client.query('COMMIT');
    console.log('\n=== Migration complete ===');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n!!! Migration failed — rolled back !!!');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
