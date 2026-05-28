/**
 * Migration: add visibility + auto-provisioning flags to the global services table.
 *
 * Adds 4 boolean columns and seeds explicit values for the existing system services
 * (Contract, Contract Replacement, General Help). All other services keep the
 * default (FALSE) — fully visible to every audience, manual activation.
 *
 * Idempotent (uses ADD COLUMN IF NOT EXISTS + conditional UPDATEs).
 * Transaction-wrapped so partial failure rolls back.
 *
 * Run with: npx tsx src/migrate-service-visibility.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { Pool } from '@neondatabase/serverless';

async function migrate() {
  console.log('=== Kamon Migration: service visibility flags ===\n');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ─── 1. Add columns (all default FALSE so existing/future services stay visible) ───
    console.log('Step 1: Adding visibility columns');
    await client.query(`
      ALTER TABLE services
        ADD COLUMN IF NOT EXISTS hidden_from_society_admin BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS hidden_from_household     BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS hidden_from_maid_skills   BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS is_auto_provisioned       BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log('  ✓ Columns added (or already existed)');

    // ─── 2. Seed values for the three system services ───
    console.log('\nStep 2: Seed visibility for system services');

    // Contract Replacement — hidden everywhere, auto-provisioned at society onboarding.
    const repl = await client.query(`
      UPDATE services SET
        hidden_from_society_admin = TRUE,
        hidden_from_household     = TRUE,
        hidden_from_maid_skills   = TRUE,
        is_auto_provisioned       = TRUE
      WHERE id = 'srv-replacement-global'
      RETURNING id
    `);
    console.log(`  ✓ srv-replacement-global: ${repl.rowCount === 1 ? 'updated' : 'NOT FOUND'}`);

    // Contract — hidden from society admin + maid skills; visible to households
    // (contract upload flow). NOT auto-provisioned — society_service is created
    // when first contract is uploaded.
    const contract = await client.query(`
      UPDATE services SET
        hidden_from_society_admin = TRUE,
        hidden_from_household     = FALSE,
        hidden_from_maid_skills   = TRUE,
        is_auto_provisioned       = FALSE
      WHERE id = 'srv-contract-global'
      RETURNING id
    `);
    console.log(`  ✓ srv-contract-global:    ${contract.rowCount === 1 ? 'updated' : 'NOT FOUND'}`);

    // General Help — hidden from society admin + maid skills; visible to households
    // (generic booking flow). Auto-provisioned silently at onboarding.
    const generic = await client.query(`
      UPDATE services SET
        hidden_from_society_admin = TRUE,
        hidden_from_household     = FALSE,
        hidden_from_maid_skills   = TRUE,
        is_auto_provisioned       = TRUE
      WHERE is_generic = TRUE
      RETURNING id
    `);
    console.log(`  ✓ generic services: updated ${generic.rowCount} row(s)`);

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
