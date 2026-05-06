/**
 * Migration: Create maid_leaves table and migrate leave data from users.leaves
 * Run with: npx tsx src/migrate.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { neon } from '@neondatabase/serverless';

const sql: any = neon(process.env.DATABASE_URL!);

async function migrate() {
  console.log('=== SevaConnect DB Migration: maid_leaves ===\n');

  // Step 1: Create maid_leaves table (idempotent)
  await sql(`
    CREATE TABLE IF NOT EXISTS maid_leaves (
      id         TEXT PRIMARY KEY,
      maid_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      leave_date DATE NOT NULL,
      leave_type TEXT NOT NULL DEFAULT 'FULL'
                   CHECK (leave_type IN ('FULL', 'MORNING', 'AFTERNOON')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (maid_id, leave_date)
    )
  `, []);
  await sql(`CREATE INDEX IF NOT EXISTS idx_maid_leaves_maid_date ON maid_leaves (maid_id, leave_date)`, []);
  console.log('✓ Created maid_leaves table');

  // Step 2: Check if users.leaves column still exists
  const hasLeavesCol = await sql(
    `SELECT COUNT(*) AS cnt FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'leaves' AND table_schema = 'public'`,
    []
  );

  if (Number(hasLeavesCol[0].cnt) > 0) {
    // Step 3: Migrate leave data from users.leaves (handles both "date" and "date:TYPE" formats)
    await sql(`
      INSERT INTO maid_leaves (id, maid_id, leave_date, leave_type)
      SELECT
        'ml-' || md5(u.id || lv) AS id,
        u.id AS maid_id,
        split_part(lv, ':', 1)::date AS leave_date,
        CASE
          WHEN split_part(lv, ':', 2) IN ('MORNING', 'AFTERNOON') THEN split_part(lv, ':', 2)
          ELSE 'FULL'
        END AS leave_type
      FROM users u, unnest(u.leaves) AS lv
      WHERE u.role = 'MAID'
        AND u.leaves IS NOT NULL
        AND array_length(u.leaves, 1) > 0
      ON CONFLICT (maid_id, leave_date) DO NOTHING
    `, []);
    console.log('✓ Migrated leave data from users.leaves into maid_leaves');

    // Step 4: Drop users.leaves column
    await sql(`ALTER TABLE users DROP COLUMN IF EXISTS leaves`, []);
    console.log('✓ Dropped users.leaves column');
  } else {
    console.log('✓ users.leaves already dropped — skipping migration');
  }

  console.log('\n=== Migration complete! ===');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
