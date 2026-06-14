import * as dotenv from 'dotenv';
dotenv.config();
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  console.log('Running hourly pricing + auto-accept time window migration...');

  // 1a — Auto-accept time window columns
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_accept_from TIME`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_accept_to   TIME`;
  console.log('✓ auto_accept_from / auto_accept_to columns added');

  // 1b — Update global service prices to hourly rates
  await sql`UPDATE services SET base_price = 75  WHERE id = 'srv-cleaning-global'`;
  await sql`UPDATE services SET base_price = 120 WHERE id = 'srv-cooking-global'`;
  await sql`UPDATE services SET base_price = 50  WHERE id = 'srv-laundry-global'`;
  console.log('✓ Global service hourly rates updated (Cleaning 75, Cooking 120, Laundry 50)');

  // 1c — Update soc-1 Garden Maintenance hourly rate
  const gardenRows = await sql`
    UPDATE society_services SET price = 150
    WHERE society_id = 'soc-1'
      AND service_id IS NULL
      AND name->>'en' = 'Garden Maintenance'
    RETURNING id`;
  console.log(`✓ Garden Maintenance rate updated (${gardenRows.length} row(s))`);

  // Verify
  const services = await sql`
    SELECT id, base_price FROM services
    WHERE id IN ('srv-cleaning-global','srv-cooking-global','srv-laundry-global')`;
  for (const s of services) {
    console.log(`  ${s.id}: ₹${s.base_price}/hr`);
  }

  console.log('Migration complete.');
}

run().catch(err => { console.error(err); process.exit(1); });
