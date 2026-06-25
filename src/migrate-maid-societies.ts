import dotenv from 'dotenv';
dotenv.config();

import { neon } from '@neondatabase/serverless';

const sql: any = neon(process.env.DATABASE_URL!);

async function migrate() {
  console.log('=== Kamon DB Migration: maid_societies (multi-society maids) ===\n');

  // Secondary society memberships for maids. The PRIMARY society stays on
  // users.society_id / users.skills / users.is_verified; this table holds the
  // ADDITIONAL societies a maid serves, with that society's own skills + approval.
  await sql(
    `CREATE TABLE IF NOT EXISTS maid_societies (
       id          TEXT PRIMARY KEY,
       maid_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       society_id  TEXT NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
       skills      TEXT[] NOT NULL DEFAULT '{}',     -- society_service IDs for THIS society
       is_verified BOOLEAN NOT NULL DEFAULT FALSE,   -- approved by this society's admin
       created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
       UNIQUE (maid_id, society_id)
     )`,
    []
  );
  await sql(`CREATE INDEX IF NOT EXISTS idx_maid_societies_society ON maid_societies (society_id)`, []);
  await sql(`CREATE INDEX IF NOT EXISTS idx_maid_societies_maid ON maid_societies (maid_id)`, []);

  console.log('✓ Created maid_societies table + indexes');
  console.log('\n=== Migration complete! ===');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
