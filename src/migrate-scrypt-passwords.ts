import dotenv from 'dotenv';
dotenv.config();

import { neon } from '@neondatabase/serverless';
import { hashPin, isScryptHash } from './utils/helpers';

const sql: any = neon(process.env.DATABASE_URL!);

/**
 * One-time migration: re-wrap every legacy bare-sha256 PIN hash in salted scrypt.
 *
 * Safe because the new at-rest format is scrypt(sha256(pin), salt) and the value
 * already stored in each row IS sha256(pin) — so we can migrate every account,
 * including dormant ones, WITHOUT anyone's raw PIN.
 *
 * Idempotent: rows already in scrypt format are skipped, so re-running is a no-op.
 * Empty-hash rows (scrubbed soft-deleted accounts) are left untouched.
 *
 * Ordering (Option B, no dual-format code): run this DURING the maintenance
 * window AFTER traffic is stopped and BEFORE the scrypt-only backend serves
 * requests. The old (sha256-compare) backend must NOT be live once rows are
 * scrypt, and the new (scrypt-only) backend must NOT be live until they are.
 */
async function migrate() {
  console.log('=== Kamon DB Migration: wrap PIN hashes in salted scrypt ===\n');

  const rows: any[] = await sql(
    `SELECT id, password_hash FROM users WHERE password_hash IS NOT NULL AND password_hash <> ''`,
    []
  );
  console.log(`Found ${rows.length} account(s) with a stored PIN hash.`);

  let migrated = 0;
  let skipped = 0;
  for (const row of rows) {
    if (isScryptHash(row.password_hash)) {
      skipped++;
      continue;
    }
    const wrapped = await hashPin(row.password_hash);
    await sql(`UPDATE users SET password_hash = $2 WHERE id = $1`, [row.id, wrapped]);
    migrated++;
  }

  const remaining: any[] = await sql(
    `SELECT count(*)::int AS n FROM users
       WHERE password_hash IS NOT NULL AND password_hash <> '' AND password_hash NOT LIKE 'scrypt$%'`,
    []
  );

  console.log(`\n✓ Migrated ${migrated} row(s) to salted scrypt`);
  console.log(`• Skipped ${skipped} already-scrypt row(s)`);
  console.log(`• Remaining legacy rows: ${remaining[0].n}`);
  if (remaining[0].n !== 0) {
    throw new Error(`Migration incomplete: ${remaining[0].n} legacy row(s) remain — aborting.`);
  }
  console.log('\n=== Migration complete! ===');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
