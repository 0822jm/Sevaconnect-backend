import dotenv from 'dotenv';
dotenv.config();

import { neon } from '@neondatabase/serverless';

const sql: any = neon(process.env.DATABASE_URL!);

async function migrate() {
  console.log('=== SevaConnect DB Migration: messages.is_read ===\n');

  await sql(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE`, []);
  await sql(`CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages (booking_id, sender_id, is_read) WHERE NOT is_read`, []);

  console.log('✓ Added is_read column to messages table');
  console.log('\n=== Migration complete! ===');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
