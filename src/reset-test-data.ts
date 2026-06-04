/**
 * Destructive test-data reset.
 *
 * Wipes all transactional data + societies + users, then seeds:
 *  - 2 societies (soc-1, soc-2) with parallel service catalogues
 *  - 1 system admin
 *  - 1 society admin per society (2 total)
 *  - 5 maids (3 in soc-1, 2 in soc-2) — skills auto-populated
 *  - 10 households (5 per society)
 *
 * All passwords are bcrypt('123456'). All users have is_verified = TRUE.
 *
 * Global services catalogue is preserved untouched.
 *
 * Run with: npx tsx src/reset-test-data.ts
 *
 * ⚠️  This is destructive and will sign every existing user out. Run only
 * after explicit confirmation.
 */
import dotenv from 'dotenv';
dotenv.config();

import { Pool } from '@neondatabase/serverless';
import { hashPassword } from './utils/helpers';

const PIN = '123456';

const SOCIETIES = [
  { id: 'soc-1', name: 'Gokuldham Society',   address: 'Powai, Mumbai' },
  { id: 'soc-2', name: 'Hiranandani Estate',  address: 'Thane, Mumbai' },
];

// society_services to create per society. Keys: id suffix (becomes ss-{key}-{socId}),
// either service_id (linked) OR exclusive (name/price/duration/icon).
const SOCIETY_SERVICE_SPECS = (socId: string) => {
  const isSoc1 = socId === 'soc-1';
  return [
    { id: `ss-cleaning-${socId}`,    serviceId: 'srv-cleaning-global' },
    { id: `ss-cooking-${socId}`,     serviceId: 'srv-cooking-global'  },
    { id: `ss-laundry-${socId}`,     serviceId: 'srv-laundry-global'  },
    { id: `ss-general-${socId}`,     serviceId: 'srv-5'               }, // generic
    { id: `ss-contract-${socId}`,    serviceId: 'srv-contract-global' },
    { id: `ss-replacement-${socId}`, serviceId: 'srv-replacement-global' },
    // Custom exclusive per society:
    isSoc1
      ? { id: `ss-garden-${socId}`,     exclusive: { name: 'Garden Maintenance', icon: '🌿', price: 400, duration: 120 } }
      : { id: `ss-petsitting-${socId}`, exclusive: { name: 'Pet sitting',        icon: '🐾', price: 400, duration: 180 } },
  ];
};

const USERS = [
  // System admin
  { id: 'u-sys',         username: 'sys',        name: 'System Admin',     role: 'SYS_ADMIN',    societyId: null,    phone: '+919876500001', address: null },
  // Society admins
  { id: 'u-soc1-admin',  username: 'soc1_admin', name: 'Gokuldham Admin',     role: 'SOCIETY_ADMIN', societyId: 'soc-1', phone: '+919876500002', address: null },
  { id: 'u-soc2-admin',  username: 'soc2_admin', name: 'Hiranandani Admin',   role: 'SOCIETY_ADMIN', societyId: 'soc-2', phone: '+919876500003', address: null },
  // Maids — 3 in soc-1, 2 in soc-2
  { id: 'u-maid-1',      username: 'maid1',      name: 'Maid One',         role: 'MAID',         societyId: 'soc-1', phone: '+919876500011', address: null },
  { id: 'u-maid-2',      username: 'maid2',      name: 'Maid Two',         role: 'MAID',         societyId: 'soc-1', phone: '+919876500012', address: null },
  { id: 'u-maid-3',      username: 'maid3',      name: 'Maid Three',       role: 'MAID',         societyId: 'soc-1', phone: '+919876500013', address: null },
  { id: 'u-maid-4',      username: 'maid4',      name: 'Maid Four',        role: 'MAID',         societyId: 'soc-2', phone: '+919876500014', address: null },
  { id: 'u-maid-5',      username: 'maid5',      name: 'Maid Five',        role: 'MAID',         societyId: 'soc-2', phone: '+919876500015', address: null },
  // Households — 5 per society
  { id: 'u-house-1',     username: 'house1',     name: 'Household One',    role: 'HOUSEHOLD',    societyId: 'soc-1', phone: '+919876500021', address: 'Flat A-101' },
  { id: 'u-house-2',     username: 'house2',     name: 'Household Two',    role: 'HOUSEHOLD',    societyId: 'soc-1', phone: '+919876500022', address: 'Flat A-102' },
  { id: 'u-house-3',     username: 'house3',     name: 'Household Three',  role: 'HOUSEHOLD',    societyId: 'soc-1', phone: '+919876500023', address: 'Flat A-103' },
  { id: 'u-house-4',     username: 'house4',     name: 'Household Four',   role: 'HOUSEHOLD',    societyId: 'soc-1', phone: '+919876500024', address: 'Flat A-104' },
  { id: 'u-house-5',     username: 'house5',     name: 'Household Five',   role: 'HOUSEHOLD',    societyId: 'soc-1', phone: '+919876500025', address: 'Flat A-105' },
  { id: 'u-house-6',     username: 'house6',     name: 'Household Six',    role: 'HOUSEHOLD',    societyId: 'soc-2', phone: '+919876500026', address: 'Flat B-201' },
  { id: 'u-house-7',     username: 'house7',     name: 'Household Seven',  role: 'HOUSEHOLD',    societyId: 'soc-2', phone: '+919876500027', address: 'Flat B-202' },
  { id: 'u-house-8',     username: 'house8',     name: 'Household Eight',  role: 'HOUSEHOLD',    societyId: 'soc-2', phone: '+919876500028', address: 'Flat B-203' },
  { id: 'u-house-9',     username: 'house9',     name: 'Household Nine',   role: 'HOUSEHOLD',    societyId: 'soc-2', phone: '+919876500029', address: 'Flat B-204' },
  { id: 'u-house-10',    username: 'house10',    name: 'Household Ten',    role: 'HOUSEHOLD',    societyId: 'soc-2', phone: '+919876500030', address: 'Flat B-205' },
];

// IDs of society_services that should NOT be a maid skill: generic (General Help)
// + contract + replacement. Computed per-society from the spec above.
function maidSkillsForSociety(socId: string): string[] {
  return SOCIETY_SERVICE_SPECS(socId)
    .filter(s => s.id !== `ss-general-${socId}` && s.id !== `ss-contract-${socId}` && s.id !== `ss-replacement-${socId}`)
    .map(s => s.id);
}

async function reset() {
  console.log('=== Kamon test data reset ===\n');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ─── Phase 1: wipe transactional data ──────────────────────────────
    console.log('Step 1: Wipe transactional data');
    const phase1 = [
      'messages',
      'reviews',
      'booking_services',
      'bookings',
      'staging_contracts',
      'contract_uploads',
      'maid_leaves',
    ];
    for (const table of phase1) {
      const r = await client.query(`DELETE FROM ${table}`);
      console.log(`  ✓ ${table}: ${r.rowCount} rows deleted`);
    }

    // ─── Phase 2: wipe users + society_services + societies ────────────
    console.log('\nStep 2: Wipe users');
    const u = await client.query(`DELETE FROM users`);
    console.log(`  ✓ users: ${u.rowCount} rows deleted`);

    console.log('\nStep 3: Wipe society_services (per-society catalogue)');
    const ss = await client.query(`DELETE FROM society_services`);
    console.log(`  ✓ society_services: ${ss.rowCount} rows deleted`);

    console.log('\nStep 4: Wipe societies');
    const so = await client.query(`DELETE FROM societies`);
    console.log(`  ✓ societies: ${so.rowCount} rows deleted`);

    // ─── Phase 3: seed societies ───────────────────────────────────────
    console.log('\nStep 5: Insert 2 fresh societies');
    for (const s of SOCIETIES) {
      await client.query(
        `INSERT INTO societies (id, name, address, code) VALUES ($1, $2, $3, $4)`,
        [s.id, s.name, s.address, s.id.toUpperCase()]
      );
      console.log(`  ✓ ${s.id}: ${s.name}`);
    }

    // ─── Phase 4: seed society_services per society ────────────────────
    console.log('\nStep 6: Seed society_services for both societies');
    for (const soc of SOCIETIES) {
      for (const spec of SOCIETY_SERVICE_SPECS(soc.id)) {
        if ('serviceId' in spec) {
          // Linked to a global service. price/duration/name inherit via COALESCE.
          await client.query(
            `INSERT INTO society_services (id, society_id, service_id, is_active)
             VALUES ($1, $2, $3, TRUE)`,
            [spec.id, soc.id, spec.serviceId]
          );
        } else {
          // Exclusive — must set price/duration/name/icon explicitly.
          await client.query(
            `INSERT INTO society_services (id, society_id, service_id, name, price, duration, icon, is_generic, is_active)
             VALUES ($1, $2, NULL, $3::jsonb, $4, $5, $6, FALSE, TRUE)`,
            [spec.id, soc.id, JSON.stringify({ en: spec.exclusive.name }), spec.exclusive.price, spec.exclusive.duration, spec.exclusive.icon]
          );
        }
        console.log(`  ✓ ${spec.id}`);
      }
    }

    // ─── Phase 5: seed users with hashed PIN ───────────────────────────
    console.log('\nStep 7: Insert 18 users (PIN=123456 for everyone)');
    const pinHash = await hashPassword(PIN);

    for (const u of USERS) {
      const skills = u.role === 'MAID' && u.societyId
        ? maidSkillsForSociety(u.societyId)
        : [];
      await client.query(
        `INSERT INTO users (
           id, name, username, password_hash, role, society_id, is_verified,
           phone, address, skills, must_change_password
         ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, $9, FALSE)`,
        [u.id, u.name, u.username, pinHash, u.role, u.societyId, u.phone, u.address, skills]
      );
      const skillNote = u.role === 'MAID' ? ` [${skills.length} skills]` : '';
      console.log(`  ✓ ${u.username} (${u.role}, ${u.societyId ?? '—'})${skillNote}`);
    }

    await client.query('COMMIT');
    console.log('\n=== Reset complete ===');
    console.log(`\nLogin with username + PIN=${PIN}, e.g.:`);
    console.log(`  sys / soc1_admin / soc2_admin / maid1..5 / house1..10`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n!!! Reset failed — rolled back !!!');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

reset().catch(err => {
  console.error(err);
  process.exit(1);
});
