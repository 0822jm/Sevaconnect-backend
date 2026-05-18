import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config();

const sql = neon(process.env.DATABASE_URL!);

async function migrate() {
  await sql`ALTER TABLE services ADD COLUMN IF NOT EXISTS pricing_config JSONB`;
  await sql`ALTER TABLE booking_services ADD COLUMN IF NOT EXISTS booking_inputs JSONB`;
  console.log('Pricing migration complete.');
}

migrate().catch(console.error);
