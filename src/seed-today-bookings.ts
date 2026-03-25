/**
 * Seed today's bookings for the default test maid (Sunita Devi).
 *
 * Inserts 6 bookings:
 *   2 COMPLETED  (earlier times)
 *   1 IN_PROGRESS (near current hour)
 *   3 CONFIRMED   (upcoming times)
 *
 * Deletes any existing today-bookings for the maid first (including related
 * messages and reviews) so it's safe to re-run.
 *
 * Usage:  npx tsx src/seed-today-bookings.ts
 */

import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

const MAID_ID = 'u-3'; // Sunita Devi

interface SlotConfig {
  hourOffset: number;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'CONFIRMED';
}

const SLOTS: SlotConfig[] = [
  { hourOffset: -4, status: 'COMPLETED' },
  { hourOffset: -2, status: 'COMPLETED' },
  { hourOffset:  0, status: 'IN_PROGRESS' },
  { hourOffset:  2, status: 'CONFIRMED' },
  { hourOffset:  4, status: 'CONFIRMED' },
  { hourOffset:  6, status: 'CONFIRMED' },
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

async function seed() {
  const today = new Date().toISOString().split('T')[0];
  const currentHour = new Date().getHours();

  // Centre IN_PROGRESS around current even hour, clamped so all 6 fit in 06–22
  // Max offset is +6, so base ≤ 16 ensures last slot ≤ 22
  const baseHour = Math.max(10, Math.min(16, currentHour % 2 === 0 ? currentHour : currentHour - 1));

  // ── Fetch available services & households ────────────────────────────
  const services = await sql`
    SELECT ss.id,
           COALESCE(ss.name, s.name) AS name,
           COALESCE(ss.icon, s.icon) AS icon,
           COALESCE(ss.price, s.base_price) AS price
    FROM society_services ss
    LEFT JOIN services s ON ss.service_id = s.id
    WHERE ss.is_active = true AND ss.society_id = 'soc-1'
    ORDER BY ss.id
  `;
  const households = await sql`
    SELECT id, name, address
    FROM users
    WHERE role = 'HOUSEHOLD' AND society_id = 'soc-1'
    ORDER BY id
  `;

  if (services.length === 0) throw new Error('No society_services found in soc-1');
  if (households.length === 0) throw new Error('No HOUSEHOLD users found in soc-1');

  // ── Clean up existing today-bookings ─────────────────────────────────
  const existing = await sql`SELECT id FROM bookings WHERE maid_id = ${MAID_ID} AND date = ${today}`;
  if (existing.length > 0) {
    const ids = existing.map((r: any) => r.id);
    await sql`DELETE FROM messages  WHERE booking_id = ANY(${ids})`;
    await sql`DELETE FROM reviews   WHERE booking_id = ANY(${ids})`;
    await sql`DELETE FROM bookings  WHERE id = ANY(${ids})`;
    console.log(`Cleaned ${ids.length} old booking(s) + related messages/reviews`);
  }

  // ── Insert 6 bookings ───────────────────────────────────────────────
  console.log(`\nSeeding bookings for ${today}  (base hour ${pad(baseHour)}:00)\n`);

  for (let i = 0; i < SLOTS.length; i++) {
    const slot = SLOTS[i];
    const startH = Math.max(6, Math.min(22, baseHour + slot.hourOffset));
    const endH = Math.min(23, startH + 1);
    const startTime = `${pad(startH)}:00`;
    const endTime = `${pad(endH)}:00`;

    const svc = services[i % services.length];
    const hh = households[i % households.length];
    const id = `bk-seed-${today}-${i}`;
    const svcName = typeof svc.name === 'string' ? JSON.parse(svc.name).en : svc.name?.en ?? '?';

    await sql`
      INSERT INTO bookings
        (id, society_service_id, household_id, maid_id, date,
         start_time, end_time, status,
         maid_requested_start, maid_requested_end,
         is_recurring, is_reviewed, price_at_booking)
      VALUES
        (${id}, ${svc.id}, ${hh.id}, ${MAID_ID}, ${today},
         ${startTime}, ${endTime}, ${slot.status},
         false, false,
         false, ${slot.status === 'COMPLETED'}, ${svc.price})
    `;

    console.log(
      `  ${slot.status.padEnd(12)}  ${startTime}–${endTime}  ${svcName.padEnd(16)}  ${hh.name}  ₹${Math.round(Number(svc.price))}`,
    );
  }

  console.log('\nDone — 6 bookings inserted.');
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
