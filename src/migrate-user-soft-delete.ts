import dotenv from 'dotenv';
dotenv.config();

import { neon } from '@neondatabase/serverless';

const sql: any = neon(process.env.DATABASE_URL!);

async function migrate() {
  console.log('=== Kamon DB Migration: users.deleted_at (account deletion) ===\n');

  // Soft-delete / anonymisation marker. When a user deletes their account we scrub
  // their personal details in place (keeping de-identified booking history) and set
  // this timestamp; login + password recovery exclude rows where it is set.
  await sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`, []);

  console.log('✓ Added deleted_at column to users');
  console.log('\n=== Migration complete! ===');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
