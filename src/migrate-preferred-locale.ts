import dotenv from 'dotenv';
dotenv.config();

import { neon } from '@neondatabase/serverless';

const sql: any = neon(process.env.DATABASE_URL!);

async function migrate() {
  console.log('=== Kamon DB Migration: users.preferred_locale ===\n');

  // User's chosen app language, synced from the mobile client at login/registration/settings
  // change. Nullable — legacy/never-synced users resolve to English at the application layer
  // (not here), so a NULL stays distinguishable from an explicit 'en' choice.
  await sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_locale VARCHAR(5)`, []);

  console.log('✓ Added preferred_locale column to users');
  console.log('\n=== Migration complete! ===');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
