import { neon } from '@neondatabase/serverless';
import { generateId, hashPassword } from '../utils/helpers';

// Generate a random 4-digit OTP (1000-9999)
const generate4DigitOtp = (): string => {
  return String(Math.floor(1000 + Math.random() * 9000));
};

let _sqlInstance: ReturnType<typeof neon> | null = null;

function getSql(): ReturnType<typeof neon> {
  if (!_sqlInstance) {
    _sqlInstance = neon(process.env.DATABASE_URL!);
  }
  return _sqlInstance;
}

// Wrapper that lazily initializes the neon connection.
// Supports both tagged template syntax and direct call syntax.
const sql: any = (...args: any[]) => {
  const instance = getSql();
  return (instance as any)(...args);
};

// ── Localised string helper ──
export type LocalizedString = { [locale: string]: string };

const parseLocalized = (value: any): LocalizedString => {
  if (!value) return { en: '' };
  if (typeof value === 'string') {
    // Neon's parameterized SQL may return JSONB columns as JSON strings
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') return parsed as LocalizedString;
    } catch {}
    return { en: value };
  }
  if (typeof value === 'object') return value as LocalizedString;
  return { en: String(value) };
};

// ── Type Interfaces ──

export enum UserRole {
  SYS_ADMIN = 'SYS_ADMIN',
  SOCIETY_ADMIN = 'SOCIETY_ADMIN',
  MAID = 'MAID',
  HOUSEHOLD = 'HOUSEHOLD',
}

export enum BookingStatus {
  REQUESTED = 'REQUESTED',
  CONFIRMED = 'CONFIRMED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  TERMINATED = 'TERMINATED',
}

export type BookingType = 'ADHOC' | 'CONTRACT' | 'REPLACEMENT';

export interface User {
  id: string;
  name: string;
  username: string;
  password_hash?: string;
  role: UserRole;
  societyId?: string;
  isVerified: boolean;
  avatarUrl?: string;
  phone?: string;
  address?: string;
  mustChangePassword?: boolean;
  skills?: string[];
  rating?: number;
  reviewCount?: number;
  leaves?: string[];
  autoAccept?: boolean;
  trustScore?: number;
}

export interface Service {
  id: string;
  name: LocalizedString;
  description: LocalizedString;
  basePrice: number;
  durationMinutes: number;
  icon: string;
  isGeneric: boolean;
  isActive: boolean;
}

export interface SocietyService {
  id: string;              // society_services.id
  societyId: string;
  serviceId?: string;      // undefined for exclusive services
  name: LocalizedString;   // effective (coalesced with global)
  description: LocalizedString;
  effectivePrice: number;  // coalesced price
  basePrice?: number;      // global base price (undefined for exclusive)
  priceOverride?: number;  // set only if society explicitly overrode price
  durationMinutes: number;
  icon: string;
  isGeneric: boolean;
  isActive: boolean;
  isExclusive: boolean;    // true when serviceId is null
}

export interface Booking {
  id: string;
  bookingType: BookingType;
  isReplacementOf?: string;
  societyServiceId: string;
  householdId: string;
  maidId: string;
  workStartDate: string;
  workEndDate: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  startOtp?: string;
  endOtp?: string;
  maidRequestedStart?: boolean;
  maidRequestedEnd?: boolean;
  isRecurring: boolean;
  frequency?: string;
  customFrequencyDays?: number;
  isReviewed?: boolean;
  customPrice?: number;
  customDescription?: string;
  priceAtBooking?: number;
  serviceName?: LocalizedString;
  serviceIcon?: string;
  maidName?: string;
  householdName?: string;
  householdAddress?: string;
  householdPhone?: string;
  autoAccepted?: boolean;
  // SCD2 fields
  stagingContractId?: string;
  effStartDate?: string;
  effEndDate?: string;
  updateComments?: string | null;
  createdAt?: string;
}

export interface StagingContract {
  id: string;
  uploadId: string;
  uploadUser: string;
  fileName: string;
  uploadTimestamp: string;
  householdPhone: string;
  maidPhone: string;
  jobDescription?: string;
  frequency: string;
  startTime: string;
  endTime: string;
  startDate: string;
  monthlyContractFee: number;
  status: string;
  errorMessage?: string;
  householdId?: string;
  maidId?: string;
  societyId?: string;
}

export interface ContractUpload {
  id: string;
  uploadedBy: string;
  fileName: string;
  totalRows: number;
  successCount: number;
  failureCount: number;
  errors?: any[];
  createdBookings?: string[];
  createdAt: string;
}

export interface ContractGroup {
  id: string;
  frequency: string;
  startTime: string;
  endTime: string;
  monthlyContractFee: number;
  jobDescription?: string;
  workStartDate: string;
  workEndDate: string;
  effStartDate?: string;
  effEndDate?: string;
  status: string;
  maidName?: string;
  householdName?: string;
  householdAddress?: string;
  serviceIcon?: string;
  stagingContractId?: string;
}

export interface ChatMessage {
  id: string;
  bookingId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
}

export interface Review {
  id: string;
  bookingId: string;
  maidId: string;
  householdId: string;
  householdName?: string;
  rating: number;
  comment: string;
  date: string;
}

export interface Society {
  id: string;
  name: string;
  address: string;
  code: string;
}

// ── Row Mappers ──

const mapUser = (row: any): User => ({
  ...row,
  societyId: row.society_id,
  isVerified: row.is_verified,
  reviewCount: row.computed_review_count ? Number(row.computed_review_count) : 0,
  rating: row.computed_rating ? Number(Number(row.computed_rating).toFixed(1)) : 0,
  skills: row.skills || [],
  leaves: row.leaves || [],
  address: row.address,
  mustChangePassword: row.must_change_password || false,
  autoAccept: row.auto_accept ?? false,
  trustScore: row.trust_score != null ? Number(row.trust_score) : null,
  preferredMaidId: row.preferred_maid_id || null,
});

const mapService = (row: any): Service => ({
  id: row.id,
  name: parseLocalized(row.name),
  description: parseLocalized(row.description),
  basePrice: Number(row.base_price),
  durationMinutes: Number(row.duration_minutes),
  icon: row.icon,
  isGeneric: row.is_generic || false,
  isActive: row.is_active ?? true,
});

const mapSocietyService = (row: any): SocietyService => ({
  id: row.id,
  societyId: row.society_id,
  serviceId: row.service_id || undefined,
  name: parseLocalized(row.name),
  description: parseLocalized(row.description),
  effectivePrice: Number(row.effective_price ?? 0),
  basePrice: row.base_price != null ? Number(row.base_price) : undefined,
  priceOverride: row.price_override != null ? Number(row.price_override) : undefined,
  durationMinutes: Number(row.duration_minutes ?? 0),
  icon: row.icon,
  isGeneric: row.is_generic || false,
  isActive: row.is_active ?? true,
  isExclusive: !row.service_id,
});

const mapBooking = (row: any): Booking => ({
  id: row.id,
  bookingType: row.booking_type,
  isReplacementOf: row.is_replacement_of || undefined,
  societyServiceId: row.society_service_id,
  householdId: row.household_id,
  maidId: row.maid_id,
  workStartDate: row.work_start_date instanceof Date ? row.work_start_date.toISOString().substring(0, 10) : row.work_start_date ? String(row.work_start_date).substring(0, 10) : '',
  workEndDate: row.work_end_date instanceof Date ? row.work_end_date.toISOString().substring(0, 10) : row.work_end_date ? String(row.work_end_date).substring(0, 10) : '',
  startTime: row.start_time,
  endTime: row.end_time,
  status: row.status,
  startOtp: row.start_otp,
  endOtp: row.end_otp,
  maidRequestedStart: row.maid_requested_start,
  maidRequestedEnd: row.maid_requested_end,
  isRecurring: row.is_recurring,
  frequency: row.frequency,
  customFrequencyDays: row.custom_frequency_days,
  isReviewed: row.is_reviewed,
  customPrice: row.custom_price ? Number(row.custom_price) : undefined,
  customDescription: row.custom_description,
  priceAtBooking: row.price_at_booking ? Number(row.price_at_booking) : undefined,
  serviceName: row.service_name ? parseLocalized(row.service_name) : undefined,
  serviceIcon: row.service_icon || undefined,
  maidName: row.maid_name,
  householdName: row.household_name,
  householdAddress: row.household_address,
  householdPhone: row.household_phone,
  autoAccepted: row.auto_accepted ? Boolean(row.auto_accepted) : false,
  // SCD2 fields
  stagingContractId: row.staging_contract_id,
  effStartDate: row.eff_start_date instanceof Date ? row.eff_start_date.toISOString().substring(0, 10) : row.eff_start_date,
  effEndDate: row.eff_end_date instanceof Date ? row.eff_end_date.toISOString().substring(0, 10) : row.eff_end_date,
  updateComments: row.update_comments ?? null,
  createdAt: row.created_at,
});

const mapMessage = (row: any): ChatMessage => ({
  ...row,
  bookingId: row.booking_id,
  senderId: row.sender_id,
  senderName: row.sender_name,
  timestamp: row.timestamp,
});

// ── Database Operations ──

export const db = {
  // ─── Auth ───
  login: async (username: string, password?: string): Promise<User | null> => {
    const rows = await sql`
      SELECT
        u.*,
        (SELECT COUNT(*) FROM reviews WHERE maid_id = u.id) as computed_review_count,
        (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE maid_id = u.id) as computed_rating,
        ROUND(COALESCE(
          CASE
            WHEN (SELECT COUNT(*) FROM reviews WHERE maid_id = u.id) = 0
             AND (SELECT COUNT(*) FROM (SELECT DISTINCT ON (id) status FROM bookings WHERE maid_id = u.id ORDER BY id, eff_end_date DESC) sub WHERE sub.status != 'REQUESTED') = 0
            THEN 50
            ELSE
              (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE maid_id = u.id) / 5.0 * 60
              + (1.0 - (SELECT COUNT(*) FROM (SELECT DISTINCT ON (id) status FROM bookings WHERE maid_id = u.id ORDER BY id, eff_end_date DESC) sub WHERE sub.status = 'CANCELLED')::float
                      / GREATEST((SELECT COUNT(*) FROM (SELECT DISTINCT ON (id) status FROM bookings WHERE maid_id = u.id ORDER BY id, eff_end_date DESC) sub WHERE sub.status NOT IN ('REQUESTED', 'TERMINATED')), 1)) * 30
              + LEAST((SELECT COUNT(*) FROM (SELECT DISTINCT ON (id) status FROM bookings WHERE maid_id = u.id ORDER BY id, eff_end_date DESC) sub WHERE sub.status = 'COMPLETED')::float / 50.0, 1.0) * 10
          END
        , 50)) as trust_score
      FROM users u
      WHERE u.username = ${username} OR u.phone = ${username}
    `;
    if (rows.length > 0) {
      const user = rows[0];
      if (password) {
        const inputHash = await hashPassword(password);
        if (user.password_hash && user.password_hash !== inputHash) return null;
      }
      return mapUser(user);
    }
    return null;
  },

  getUserById: async (id: string): Promise<User | null> => {
    const rows = await sql`
      SELECT
        u.*,
        (SELECT COUNT(*) FROM reviews WHERE maid_id = u.id) as computed_review_count,
        (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE maid_id = u.id) as computed_rating,
        ROUND(COALESCE(
          CASE
            WHEN (SELECT COUNT(*) FROM reviews WHERE maid_id = u.id) = 0
             AND (SELECT COUNT(*) FROM (SELECT DISTINCT ON (id) status FROM bookings WHERE maid_id = u.id ORDER BY id, eff_end_date DESC) sub WHERE sub.status != 'REQUESTED') = 0
            THEN 50
            ELSE
              (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE maid_id = u.id) / 5.0 * 60
              + (1.0 - (SELECT COUNT(*) FROM (SELECT DISTINCT ON (id) status FROM bookings WHERE maid_id = u.id ORDER BY id, eff_end_date DESC) sub WHERE sub.status = 'CANCELLED')::float
                      / GREATEST((SELECT COUNT(*) FROM (SELECT DISTINCT ON (id) status FROM bookings WHERE maid_id = u.id ORDER BY id, eff_end_date DESC) sub WHERE sub.status NOT IN ('REQUESTED', 'TERMINATED')), 1)) * 30
              + LEAST((SELECT COUNT(*) FROM (SELECT DISTINCT ON (id) status FROM bookings WHERE maid_id = u.id ORDER BY id, eff_end_date DESC) sub WHERE sub.status = 'COMPLETED')::float / 50.0, 1.0) * 10
          END
        , 50)) as trust_score
      FROM users u
      WHERE u.id = ${id}
    `;
    return rows.length > 0 ? mapUser(rows[0]) : null;
  },

  verifyForgotPasswordOtp: async (username: string): Promise<User | null> => {
    const rows = await sql`SELECT * FROM users WHERE username = ${username} OR phone = ${username}`;
    if (rows.length > 0) {
      const user = rows[0];
      await sql`UPDATE users SET must_change_password = TRUE WHERE id = ${user.id}`;
      return db.getUserById(user.id);
    }
    return null;
  },

  getUserPhoneByUsername: async (username: string): Promise<string | null> => {
    const rows = await sql`SELECT phone FROM users WHERE username = ${username} OR phone = ${username}`;
    return rows.length > 0 ? (rows[0].phone || null) : null;
  },

  // ─── Users ───
  updateUser: async (id: string, updates: Partial<User>): Promise<User> => {
    const forbiddenKeys = ['rating', 'reviewCount', 'computed_rating', 'computed_review_count'];
    const entries = Object.entries(updates)
      .filter(([key, v]) => v !== undefined && !forbiddenKeys.includes(key));

    if (entries.length === 0) {
      const existing = await db.getUserById(id);
      if (!existing) throw new Error('User not found');
      return existing;
    }

    const dbUpdates = entries.map(([key, v]) => [key.replace(/[A-Z]/g, (l: string) => `_${l.toLowerCase()}`), v]);
    const setClause = dbUpdates.map(([k, _], i) => `${k} = $${i + 2}`).join(', ');

    await (sql as any)(
      `UPDATE users SET ${setClause} WHERE id = $1`,
      [id, ...dbUpdates.map(([_, v]) => v)]
    );

    const updated = await db.getUserById(id);
    if (!updated) throw new Error('Update failed');
    return updated;
  },

  getUserByPhone: async (phone: string): Promise<User | null> => {
    const rows = await sql`
      SELECT u.*,
        (SELECT COUNT(*) FROM reviews WHERE maid_id = u.id) as computed_review_count,
        (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE maid_id = u.id) as computed_rating
      FROM users u
      WHERE u.phone = ${phone} OR u.username = ${phone}
      LIMIT 1
    `;
    return rows.length > 0 ? mapUser(rows[0]) : null;
  },

  isPhoneRegistered: async (phone: string): Promise<boolean> => {
    const existing = await sql`SELECT id FROM users WHERE phone = ${phone} OR username = ${phone}`;
    return existing.length > 0;
  },

  registerUser: async (user: any): Promise<string> => {
    const existing = await sql`SELECT id FROM users WHERE phone = ${user.phone} OR username = ${user.phone}`;
    if (existing.length > 0) {
      throw new Error('This phone number is already registered to an account.');
    }

    const id = generateId('u');
    const passwordHash = user.password ? await hashPassword(user.password) : '';
    await sql`INSERT INTO users (id, name, username, password_hash, role, society_id, is_verified, phone, address, skills, leaves, must_change_password)
       VALUES (${id}, ${user.name}, ${user.phone}, ${passwordHash}, ${user.role}, ${user.societyId}, ${user.isVerified || false}, ${user.phone}, ${user.address || null}, ${user.skills || []}, ${[]}, FALSE)`;
    return id;
  },

  verifyUser: async (id: string): Promise<void> => {
    await sql`UPDATE users SET is_verified = TRUE WHERE id = ${id}`;
  },

  updateMaidSkills: async (id: string, skills: string[]): Promise<void> => {
    await sql`UPDATE users SET skills = ${skills} WHERE id = ${id}`;
  },

  updateAutoAccept: async (userId: string, enabled: boolean): Promise<void> => {
    await sql`UPDATE users SET auto_accept = ${enabled} WHERE id = ${userId}`;
  },

  toggleLeave: async (id: string, date: string): Promise<string[]> => {
    const rows = await sql`SELECT leaves FROM users WHERE id = ${id}`;
    let leaves: string[] = rows[0]?.leaves || [];
    leaves = leaves.includes(date)
      ? leaves.filter((d: string) => d !== date)
      : [...leaves, date];
    await sql`UPDATE users SET leaves = ${leaves} WHERE id = ${id}`;
    return leaves;
  },

  // New typed leave: stores "date:TYPE" format (e.g. "2025-01-15:MORNING")
  // leaveType = null means clear any leave for that date
  setLeave: async (id: string, date: string, leaveType: string | null | undefined): Promise<string[]> => {
    const rows = await sql`SELECT leaves FROM users WHERE id = ${id}`;
    let leaves: string[] = rows[0]?.leaves || [];
    // Remove any existing entry for this date (both "date" and "date:TYPE" formats)
    leaves = leaves.filter((l: string) => {
      const d = l.split(':')[0];
      return d !== date;
    });
    // Add new entry if leaveType is specified
    if (leaveType) {
      leaves.push(`${date}:${leaveType}`);
    }
    await sql`UPDATE users SET leaves = ${leaves} WHERE id = ${id}`;
    return leaves;
  },

  getUsersBySociety: async (societyId: string): Promise<User[]> => {
    const rows = await sql`
      SELECT
        u.*,
        (SELECT COUNT(*) FROM reviews WHERE maid_id = u.id) as computed_review_count,
        (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE maid_id = u.id) as computed_rating,
        ROUND(COALESCE(
          CASE
            WHEN (SELECT COUNT(*) FROM reviews WHERE maid_id = u.id) = 0
             AND (SELECT COUNT(*) FROM (SELECT DISTINCT ON (id) status FROM bookings WHERE maid_id = u.id ORDER BY id, eff_end_date DESC) sub WHERE sub.status != 'REQUESTED') = 0
            THEN 50
            ELSE
              (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE maid_id = u.id) / 5.0 * 60
              + (1.0 - (SELECT COUNT(*) FROM (SELECT DISTINCT ON (id) status FROM bookings WHERE maid_id = u.id ORDER BY id, eff_end_date DESC) sub WHERE sub.status = 'CANCELLED')::float
                      / GREATEST((SELECT COUNT(*) FROM (SELECT DISTINCT ON (id) status FROM bookings WHERE maid_id = u.id ORDER BY id, eff_end_date DESC) sub WHERE sub.status NOT IN ('REQUESTED', 'TERMINATED')), 1)) * 30
              + LEAST((SELECT COUNT(*) FROM (SELECT DISTINCT ON (id) status FROM bookings WHERE maid_id = u.id ORDER BY id, eff_end_date DESC) sub WHERE sub.status = 'COMPLETED')::float / 50.0, 1.0) * 10
          END
        , 50)) as trust_score
      FROM users u
      WHERE u.society_id = ${societyId} AND u.role != 'SOCIETY_ADMIN'
    `;
    return rows.map(mapUser);
  },

  deleteUser: async (id: string): Promise<void> => {
    // Guard: don't allow deleting admin roles
    const rows = await sql`SELECT role FROM users WHERE id = ${id}`;
    if (rows.length === 0) throw new Error('User not found');
    const role = rows[0].role;
    if (role === 'SYS_ADMIN' || role === 'SOCIETY_ADMIN') {
      throw new Error('Cannot delete admin accounts');
    }
    // Clean up related data
    await sql`DELETE FROM messages WHERE sender_id = ${id}`;
    await sql`DELETE FROM reviews WHERE maid_id = ${id}`;
    await sql`DELETE FROM bookings WHERE household_id = ${id} OR maid_id = ${id}`;
    await sql`DELETE FROM users WHERE id = ${id}`;
  },

  // ─── Societies ───
  getSocieties: async (): Promise<Society[]> => {
    const rows = await sql`SELECT * FROM societies`;
    return rows as any as Society[];
  },

  getSocietyById: async (id: string): Promise<Society | null> => {
    const rows = await sql`SELECT * FROM societies WHERE id = ${id}`;
    return rows.length > 0 ? (rows[0] as any as Society) : null;
  },

  getSocietyStats: async (societyId: string) => {
    const userRows = await sql`SELECT role, is_verified FROM users WHERE society_id = ${societyId} AND role != 'SOCIETY_ADMIN'`;
    const bookingRows = await sql`
      SELECT COUNT(*) as count
      FROM bookings b
      JOIN users u ON b.household_id = u.id
      WHERE u.society_id = ${societyId}
    `;

    const households = userRows.filter((u: any) => u.role === 'HOUSEHOLD');
    const maids = userRows.filter((u: any) => u.role === 'MAID');
    const verified = userRows.filter((u: any) => u.is_verified);
    const pending = userRows.filter((u: any) => !u.is_verified);

    return {
      total_members: userRows.length,
      verified_members: verified.length,
      pending_members: pending.length,
      household_count: households.length,
      maid_count: maids.length,
      booking_count: Number(bookingRows[0].count),
    };
  },

  getRecentSocietyActivity: async (societyId: string) => {
    const rows = await sql`
      SELECT name, role, is_verified, 'registration' as activity_type
      FROM users
      WHERE society_id = ${societyId}
      AND role != 'SOCIETY_ADMIN'
      ORDER BY id DESC
      LIMIT 5
    `;
    return rows;
  },

  getSocietiesWithStats: async (startDate: string, endDate: string) => {
    const rows = await sql`
      SELECT
        s.*,
        (SELECT COUNT(*) FROM users u WHERE u.society_id = s.id AND u.role = 'HOUSEHOLD') as household_count,
        (SELECT COUNT(*) FROM users u WHERE u.society_id = s.id AND u.role = 'MAID') as maid_count,
        (SELECT COUNT(*) FROM bookings b
         JOIN users u2 ON b.household_id = u2.id
         WHERE u2.society_id = s.id
         AND b.work_start_date >= ${startDate}::date
         AND b.work_start_date <= ${endDate}::date
         AND b.eff_end_date = '3499-12-31'
         AND b.status IN ('CONFIRMED', 'REQUESTED', 'IN_PROGRESS')) as expected_bookings
      FROM societies s
    `;
    return rows;
  },

  createSociety: async (society: { name: string; address: string; code: string; phone: string; initialPassword?: string }) => {
    const socId = generateId('soc');
    const adminId = generateId('u');
    const initialPassword = society.initialPassword || Math.random().toString(36).slice(-8);
    const passwordHash = await hashPassword(initialPassword);

    const existingUser = await sql`SELECT id FROM users WHERE phone = ${society.phone} OR username = ${society.phone}`;
    if (existingUser.length > 0) {
      throw new Error('Admin phone number is already registered to another account.');
    }

    const existingSociety = await sql`SELECT id FROM societies WHERE code = ${society.code}`;
    if (existingSociety.length > 0) {
      throw new Error('A society with this code already exists.');
    }

    await sql`INSERT INTO users (id, name, username, password_hash, role, is_verified, phone, must_change_password)
       VALUES (${adminId}, ${society.name + ' Admin'}, ${society.phone}, ${passwordHash}, ${UserRole.SOCIETY_ADMIN}, TRUE, ${society.phone}, TRUE)`;

    try {
      await sql`INSERT INTO societies (id, name, address, code) VALUES (${socId}, ${society.name}, ${society.address}, ${society.code})`;
      await sql`UPDATE users SET society_id = ${socId} WHERE id = ${adminId}`;
    } catch (error) {
      await sql`DELETE FROM users WHERE id = ${adminId}`;
      throw error;
    }

    return { socId, adminId, initialPassword };
  },

  resetSocietyAdminPin: async (societyId: string): Promise<{ pin: string; phone: string }> => {
    const rows = await sql`
      SELECT id, phone, username FROM users
      WHERE society_id = ${societyId} AND role = ${UserRole.SOCIETY_ADMIN}
      LIMIT 1
    `;
    if (rows.length === 0) throw new Error('No society admin found for this society.');
    const adminUser = rows[0];
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const passwordHash = await hashPassword(pin);
    await sql`
      UPDATE users SET password_hash = ${passwordHash}, must_change_password = TRUE
      WHERE id = ${adminUser.id}
    `;
    return { pin, phone: adminUser.phone || adminUser.username };
  },

  // ─── Services (Global Catalogue) ───
  getServices: async (): Promise<Service[]> => {
    const rows = await sql`SELECT * FROM services WHERE is_active = true ORDER BY name::text ASC`;
    return rows.map(mapService);
  },

  getAllServices: async (): Promise<Service[]> => {
    const rows = await sql`SELECT * FROM services ORDER BY name::text ASC`;
    return rows.map(mapService);
  },

  getServiceById: async (id: string): Promise<Service | null> => {
    const rows = await sql`SELECT * FROM services WHERE id = ${id}`;
    return rows.length > 0 ? mapService(rows[0]) : null;
  },

  addService: async (service: any): Promise<Service> => {
    const id = generateId('srv');
    const name = typeof service.name === 'string' ? { en: service.name } : (service.name || { en: '' });
    const description = typeof service.description === 'string' ? { en: service.description } : (service.description || { en: '' });
    await (sql as any)(
      `INSERT INTO services (id, name, description, base_price, duration_minutes, icon, is_generic, is_active)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, true)`,
      [id, JSON.stringify(name), JSON.stringify(description), service.basePrice, service.durationMinutes, service.icon, service.isGeneric || false]
    );
    return (await db.getServiceById(id))!;
  },

  updateService: async (id: string, updates: any): Promise<Service> => {
    const colMap: Record<string, string> = {
      name: 'name', description: 'description', basePrice: 'base_price',
      durationMinutes: 'duration_minutes', icon: 'icon', isGeneric: 'is_generic', isActive: 'is_active',
    };
    const entries = Object.entries(updates).filter(([key, v]) => v !== undefined && colMap[key]);
    if (entries.length > 0) {
      const jsonbCols = new Set(['name', 'description']);
      const fields = entries.map(([key, _], i) => {
        const col = colMap[key];
        return jsonbCols.has(key) ? `${col} = $${i + 2}::jsonb` : `${col} = $${i + 2}`;
      }).join(', ');
      const values = entries.map(([key, v]) =>
        (key === 'name' || key === 'description')
          ? JSON.stringify(typeof v === 'string' ? { en: v } : v)
          : v
      );
      await (sql as any)(`UPDATE services SET ${fields} WHERE id = $1`, [id, ...values]);
    }
    return (await db.getServiceById(id))!;
  },

  deleteService: async (id: string): Promise<void> => {
    await sql`DELETE FROM services WHERE id = ${id}`;
  },

  // ─── Society Services (Per-Society Offerings) ───
  getSocietyServices: async (societyId: string): Promise<SocietyService[]> => {
    const rows = await (sql as any)(
      `SELECT
        ss.id, ss.society_id, ss.service_id,
        COALESCE(ss.name, s.name)               AS name,
        COALESCE(ss.description, s.description) AS description,
        COALESCE(ss.price, s.base_price)        AS effective_price,
        s.base_price                            AS base_price,
        ss.price                                AS price_override,
        COALESCE(ss.duration, s.duration_minutes) AS duration_minutes,
        COALESCE(ss.icon, s.icon)              AS icon,
        COALESCE(ss.is_generic, s.is_generic)  AS is_generic,
        ss.is_active
       FROM society_services ss
       LEFT JOIN services s ON ss.service_id = s.id
       WHERE ss.society_id = $1
       ORDER BY ss.created_at ASC`,
      [societyId]
    );
    return rows.map(mapSocietyService);
  },

  getSocietyServiceById: async (id: string): Promise<SocietyService | null> => {
    const rows = await (sql as any)(
      `SELECT
        ss.id, ss.society_id, ss.service_id,
        COALESCE(ss.name, s.name)               AS name,
        COALESCE(ss.description, s.description) AS description,
        COALESCE(ss.price, s.base_price)        AS effective_price,
        s.base_price                            AS base_price,
        ss.price                                AS price_override,
        COALESCE(ss.duration, s.duration_minutes) AS duration_minutes,
        COALESCE(ss.icon, s.icon)              AS icon,
        COALESCE(ss.is_generic, s.is_generic)  AS is_generic,
        ss.is_active
       FROM society_services ss
       LEFT JOIN services s ON ss.service_id = s.id
       WHERE ss.id = $1`,
      [id]
    );
    return rows.length > 0 ? mapSocietyService(rows[0]) : null;
  },

  addSocietyService: async (data: {
    societyId: string; serviceId?: string;
    name?: LocalizedString | string | null; description?: LocalizedString | string | null;
    price?: number; duration?: number; icon?: string; isGeneric?: boolean;
  }): Promise<SocietyService> => {
    const id = generateId('ss');
    const nameJson = data.name
      ? JSON.stringify(typeof data.name === 'string' ? { en: data.name } : data.name)
      : null;
    const descJson = data.description
      ? JSON.stringify(typeof data.description === 'string' ? { en: data.description } : data.description)
      : null;
    await (sql as any)(
      `INSERT INTO society_services (id, society_id, service_id, name, description, price, duration, icon, is_generic, is_active)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, true)`,
      [id, data.societyId, data.serviceId || null, nameJson, descJson,
       data.price ?? null, data.duration ?? null, data.icon || null, data.isGeneric ?? null]
    );
    return (await db.getSocietyServiceById(id))!;
  },

  updateSocietyService: async (id: string, updates: {
    name?: LocalizedString | string | null; description?: LocalizedString | string | null;
    price?: number | null; duration?: number | null;
    icon?: string | null; isGeneric?: boolean | null; isActive?: boolean;
  }): Promise<SocietyService> => {
    const colMap: Record<string, string> = {
      name: 'name', description: 'description', price: 'price',
      duration: 'duration', icon: 'icon', isGeneric: 'is_generic', isActive: 'is_active',
    };
    const jsonbCols = new Set(['name', 'description']);
    const entries = Object.entries(updates).filter(([key, _]) => key in colMap);
    if (entries.length > 0) {
      const fields = entries.map(([key, _], i) =>
        jsonbCols.has(key) ? `${colMap[key]} = $${i + 2}::jsonb` : `${colMap[key]} = $${i + 2}`
      ).join(', ');
      const values = entries.map(([key, v]) => {
        if (!jsonbCols.has(key)) return v;
        if (v == null) return null;
        return JSON.stringify(typeof v === 'string' ? { en: v } : v);
      });
      await (sql as any)(
        `UPDATE society_services SET ${fields} WHERE id = $1`,
        [id, ...values]
      );
    }
    return (await db.getSocietyServiceById(id))!;
  },

  deleteSocietyService: async (id: string): Promise<void> => {
    await sql`UPDATE society_services SET is_active = false WHERE id = ${id}`;
  },

  // ─── Bookings ───
  getBookingsForUser: async (userId: string, role: UserRole): Promise<Booking[]> => {
    const fieldName = role === UserRole.MAID ? 'maid_id' : 'household_id';
    const rows = await (sql as any)(
      `SELECT sub.*,
        m.name as maid_name,
        h.name as household_name,
        h.address as household_address,
        h.phone as household_phone,
        COALESCE(ss.name, svc.name) as service_name,
        COALESCE(ss.icon, svc.icon) as service_icon
      FROM (
        SELECT DISTINCT ON (b.id) b.*
        FROM bookings b
        WHERE b.${fieldName} = $1
          AND b.eff_end_date = '3499-12-31'
        ORDER BY b.id, b.eff_end_date DESC
      ) sub
      LEFT JOIN users m ON sub.maid_id = m.id
      JOIN users h ON sub.household_id = h.id
      LEFT JOIN society_services ss ON sub.society_service_id = ss.id
      LEFT JOIN services svc ON ss.service_id = svc.id
      ORDER BY sub.work_start_date DESC, sub.start_time DESC`,
      [userId]
    );
    return rows.map(mapBooking);
  },

  getBookingsBySociety: async (societyId: string): Promise<Booking[]> => {
    const rows = await (sql as any)(
      `SELECT sub.*,
        m.name as maid_name,
        h.name as household_name,
        h.address as household_address,
        COALESCE(ss.name, svc.name) as service_name,
        COALESCE(ss.icon, svc.icon) as service_icon
      FROM (
        SELECT DISTINCT ON (b.id) b.*
        FROM bookings b
        JOIN users h2 ON b.household_id = h2.id
        WHERE h2.society_id = $1
          AND b.eff_end_date = '3499-12-31'
        ORDER BY b.id, b.eff_end_date DESC
      ) sub
      LEFT JOIN users m ON sub.maid_id = m.id
      JOIN users h ON sub.household_id = h.id
      LEFT JOIN society_services ss ON sub.society_service_id = ss.id
      LEFT JOIN services svc ON ss.service_id = svc.id
      ORDER BY sub.work_start_date DESC, sub.start_time DESC`,
      [societyId]
    );
    return rows.map(mapBooking);
  },

  createBooking: async (booking: any): Promise<Booking> => {
    const id = booking.id || generateId('bk');
    const bookingType: BookingType = booking.bookingType || 'ADHOC';
    const initialStatus = bookingType === 'CONTRACT' ? BookingStatus.CONFIRMED : BookingStatus.REQUESTED;
    await (sql as any)(
      `INSERT INTO bookings (
        id, booking_type, is_replacement_of, society_service_id, household_id, maid_id,
        work_start_date, work_end_date, start_time, end_time, status,
        is_recurring, frequency, custom_frequency_days,
        custom_price, custom_description, price_at_booking,
        staging_contract_id, auto_accepted, update_comments
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14,
        $15, $16, $17,
        $18, $19, $20
      )`,
      [
        id, bookingType, booking.isReplacementOf || null,
        booking.societyServiceId, booking.householdId, booking.maidId,
        booking.workStartDate, booking.workEndDate, booking.startTime, booking.endTime,
        booking.status || initialStatus,
        booking.isRecurring || false, booking.frequency || null, booking.customFrequencyDays || null,
        booking.customPrice || null, booking.customDescription || null, booking.priceAtBooking || null,
        booking.stagingContractId || null, booking.autoAccepted || false, booking.updateComments || null,
      ]
    );

    // Auto-accept: if the maid has opted in, immediately confirm non-contract ADHOC bookings
    if (bookingType === 'ADHOC' && (!booking.status || booking.status === BookingStatus.REQUESTED)) {
      const maidRows = await sql`SELECT auto_accept FROM users WHERE id = ${booking.maidId}`;
      if (maidRows[0]?.auto_accept) {
        await (sql as any)(
          `UPDATE bookings SET status = $1, auto_accepted = true WHERE id = $2 AND eff_end_date = '3499-12-31'`,
          [BookingStatus.CONFIRMED, id]
        );
        return { ...booking, id, bookingType, status: BookingStatus.CONFIRMED, autoAccepted: true, isReviewed: false } as Booking;
      }
    }

    return { ...booking, id, bookingType, status: booking.status || initialStatus, autoAccepted: false, isReviewed: false } as Booking;
  },

  updateBooking: async (id: string, updates: Partial<Booking>): Promise<void> => {
    const allowedKeys = ['startTime', 'endTime', 'status', 'startOtp', 'endOtp', 'customPrice', 'maidId'];
    const entries = Object.entries(updates).filter(([key]) => allowedKeys.includes(key));
    if (entries.length === 0) return;

    const dbFields = entries.map(([key, _], i) => `${key.replace(/[A-Z]/g, (l: string) => `_${l.toLowerCase()}`)} = $${i + 2}`);
    const query = `UPDATE bookings SET ${dbFields.join(', ')} WHERE id = $1 AND eff_end_date = '3499-12-31'`;
    const params = [id, ...entries.map(([_, v]) => v)];
    await (sql as any)(query, params);
  },

  updateBookingStatus: async (id: string, status: BookingStatus): Promise<void> => {
    await (sql as any)(
      `UPDATE bookings SET status = $1 WHERE id = $2 AND eff_end_date = '3499-12-31'`,
      [status, id]
    );
  },

  getHouseholdPhoneForBooking: async (bookingId: string): Promise<string> => {
    const rows = await sql`
      SELECT h.phone
      FROM bookings b
      JOIN users h ON b.household_id = h.id
      WHERE b.id = ${bookingId}
    `;
    return rows[0]?.phone || '';
  },

  setOtpRequested: async (id: string, type: 'start' | 'end'): Promise<string> => {
    const otp = generate4DigitOtp();
    if (type === 'start') {
      await (sql as any)(`UPDATE bookings SET maid_requested_start = TRUE, start_otp = $1 WHERE id = $2 AND eff_end_date = '3499-12-31'`, [otp, id]);
    } else {
      await (sql as any)(`UPDATE bookings SET maid_requested_end = TRUE, end_otp = $1 WHERE id = $2 AND eff_end_date = '3499-12-31'`, [otp, id]);
    }
    return otp;
  },

  verifyStoredOtp: async (id: string, type: 'start' | 'end', code: string): Promise<boolean> => {
    const rows = await (sql as any)(`SELECT start_otp, end_otp FROM bookings WHERE id = $1 AND eff_end_date = '3499-12-31'`, [id]);
    if (rows.length === 0) return false;
    const storedOtp = type === 'start' ? rows[0].start_otp : rows[0].end_otp;
    return storedOtp === code;
  },

  regenerateOtp: async (id: string, type: 'start' | 'end'): Promise<string> => {
    const otp = generate4DigitOtp();
    if (type === 'start') {
      await (sql as any)(`UPDATE bookings SET start_otp = $1 WHERE id = $2 AND eff_end_date = '3499-12-31'`, [otp, id]);
    } else {
      await (sql as any)(`UPDATE bookings SET end_otp = $1 WHERE id = $2 AND eff_end_date = '3499-12-31'`, [otp, id]);
    }
    return otp;
  },

  cancelOtpRequest: async (id: string, type: 'start' | 'end'): Promise<void> => {
    if (type === 'start') {
      await (sql as any)(`UPDATE bookings SET maid_requested_start = FALSE, start_otp = NULL WHERE id = $1 AND eff_end_date = '3499-12-31'`, [id]);
    } else {
      await (sql as any)(`UPDATE bookings SET maid_requested_end = FALSE, end_otp = NULL WHERE id = $1 AND eff_end_date = '3499-12-31'`, [id]);
    }
  },

  // ─── Messages ───
  getMessages: async (bookingId: string): Promise<ChatMessage[]> => {
    const rows = await sql`SELECT * FROM messages WHERE booking_id = ${bookingId} ORDER BY timestamp ASC`;
    return rows.map(mapMessage);
  },

  getMessageCounts: async (bookingIds: string[]): Promise<Record<string, number>> => {
    if (bookingIds.length === 0) return {};
    const placeholders = bookingIds.map((_: string, i: number) => `$${i + 1}`).join(',');
    const rows = await (sql as any)(
      `SELECT booking_id, COUNT(*)::int as count FROM messages WHERE booking_id IN (${placeholders}) GROUP BY booking_id`,
      bookingIds
    );
    const result: Record<string, number> = {};
    for (const id of bookingIds) result[id] = 0;
    for (const row of rows) result[row.booking_id] = Number(row.count);
    return result;
  },

  sendMessage: async (message: { bookingId: string; senderId: string; senderName: string; text: string }): Promise<ChatMessage> => {
    const id = generateId('msg');
    await sql`INSERT INTO messages (id, booking_id, sender_id, sender_name, text) VALUES (${id}, ${message.bookingId}, ${message.senderId}, ${message.senderName}, ${message.text})`;
    return { ...message, id, timestamp: new Date().toISOString() };
  },

  // ─── Reviews ───
  getReviewsForMaid: async (maidId: string): Promise<Review[]> => {
    const rows = await sql`SELECT * FROM reviews WHERE maid_id = ${maidId} ORDER BY date DESC`;
    return rows.map((r: any) => ({
      id: r.id,
      bookingId: r.booking_id,
      maidId: r.maid_id,
      householdId: r.household_id,
      householdName: r.household_name,
      rating: Number(r.rating),
      comment: r.comment,
      date: r.date,
    }));
  },

  addReview: async (review: any): Promise<void> => {
    const id = generateId('rv');
    const date = new Date().toISOString().split('T')[0];
    await sql`INSERT INTO reviews (id, booking_id, maid_id, household_id, household_name, rating, comment, date) VALUES (${id}, ${review.bookingId}, ${review.maidId}, ${review.householdId}, ${review.householdName}, ${review.rating}, ${review.comment}, ${date})`;
    await (sql as any)(`UPDATE bookings SET is_reviewed = TRUE WHERE id = $1 AND eff_end_date = '3499-12-31'`, [review.bookingId]);
  },

  // ─── Contracts ───

  createStagingContract: async (data: Partial<StagingContract> & { id: string; uploadUser: string; uploadId?: string; fileName?: string }): Promise<void> => {
    await (sql as any)(
      `INSERT INTO staging_contracts (
        id, upload_id, upload_user, file_name,
        household_phone, maid_phone, job_description, frequency,
        start_time, end_time, start_date, monthly_contract_fee,
        status, error_message, household_id, maid_id, society_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        data.id, data.uploadId, data.uploadUser, data.fileName,
        data.householdPhone, data.maidPhone, data.jobDescription || null, data.frequency,
        data.startTime, data.endTime, data.startDate, data.monthlyContractFee,
        data.status || 'PENDING', data.errorMessage || null,
        data.householdId || null, data.maidId || null, data.societyId || null,
      ]
    );
  },

  createContractUpload: async (data: {
    id: string; uploadedBy: string; fileName: string;
    totalRows: number; successCount: number; failureCount: number;
    errors?: any[]; createdBookings?: string[];
  }): Promise<void> => {
    await (sql as any)(
      `INSERT INTO contract_uploads (id, uploaded_by, file_name, total_rows, success_count, failure_count, errors, created_bookings)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        data.id, data.uploadedBy, data.fileName,
        data.totalRows, data.successCount, data.failureCount,
        JSON.stringify(data.errors || []),
        JSON.stringify(data.createdBookings || []),
      ]
    );
  },

  getContractUploads: async (): Promise<ContractUpload[]> => {
    const rows = await sql`SELECT * FROM contract_uploads ORDER BY created_at DESC`;
    return rows.map((r: any) => ({
      id: r.id,
      uploadedBy: r.uploaded_by,
      fileName: r.file_name,
      totalRows: Number(r.total_rows),
      successCount: Number(r.success_count),
      failureCount: Number(r.failure_count),
      errors: r.errors || [],
      createdBookings: r.created_bookings || [],
      createdAt: r.created_at,
    }));
  },

  findOrCreateContractSocietyService: async (societyId: string): Promise<string> => {
    const existing = await (sql as any)(
      `SELECT id FROM society_services WHERE society_id = $1 AND service_id = 'srv-contract-global'`,
      [societyId]
    );
    if (existing.length > 0) return existing[0].id;
    const id = generateId('ss');
    await (sql as any)(
      `INSERT INTO society_services (id, society_id, service_id, is_active)
       VALUES ($1, $2, 'srv-contract-global', true)`,
      [id, societyId]
    );
    return id;
  },

  getBookingById: async (id: string): Promise<Booking | null> => {
    const rows = await (sql as any)(
      `SELECT b.* FROM bookings b WHERE b.id = $1 ORDER BY b.eff_end_date DESC LIMIT 1`,
      [id]
    );
    return rows.length > 0 ? mapBooking(rows[0]) : null;
  },

  // SCD Type 2: close current version and insert new row with updated data
  // Returns the same id (stable business key). The new row gets a new eff_start_date.
  scdUpdateBooking: async (id: string, updates: Partial<Booking>): Promise<string> => {
    // Fetch current active row
    const rows = await (sql as any)(`SELECT * FROM bookings WHERE id = $1 AND eff_end_date = '3499-12-31'`, [id]);
    if (rows.length === 0) throw new Error(`Booking ${id} not found or not active`);
    const cur = rows[0];

    // Reject maid_id changes on CONTRACT records
    if (cur.booking_type === 'CONTRACT' && updates.maidId && updates.maidId !== cur.maid_id) {
      throw new Error('Cannot change maid_id on a CONTRACT. Terminate and create a new contract instead.');
    }

    // Build human-readable close-reason comment by diffing old vs new values
    const fieldLabels: Record<string, string> = {
      status: 'status', start_time: 'start_time', end_time: 'end_time',
      custom_price: 'price', price_at_booking: 'price_at_booking',
      frequency: 'frequency', work_start_date: 'work_start_date', work_end_date: 'work_end_date',
    };
    const snakeUpdates = Object.fromEntries(
      Object.entries(updates).map(([k, v]) => [k.replace(/[A-Z]/g, (l: string) => `_${l.toLowerCase()}`), v])
    );
    const changeParts: string[] = [];
    for (const [col, label] of Object.entries(fieldLabels)) {
      if (col in snakeUpdates && String(snakeUpdates[col]) !== String(cur[col])) {
        changeParts.push(`${label} changed from "${cur[col]}" to "${snakeUpdates[col]}"`);
      }
    }
    const updateComment = changeParts.length > 0
      ? `Row closed: ${changeParts.join('; ')}`
      : 'Row closed: booking updated';

    // Close current version
    await (sql as any)(
      `UPDATE bookings SET eff_end_date = NOW(), update_comments = $2 WHERE id = $1 AND eff_end_date = '3499-12-31'`,
      [id, updateComment]
    );

    // Insert new version with same id, new eff_start_date
    const merged = { ...cur, ...snakeUpdates };
    await (sql as any)(
      `INSERT INTO bookings (
        id, booking_type, is_replacement_of, society_service_id, household_id, maid_id,
        work_start_date, work_end_date, start_time, end_time, status,
        start_otp, end_otp, is_recurring, frequency, custom_frequency_days, is_reviewed,
        custom_price, custom_description, maid_requested_start, maid_requested_end, price_at_booking,
        staging_contract_id, auto_accepted, update_comments
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NULL)`,
      [
        id, merged.booking_type, merged.is_replacement_of,
        merged.society_service_id, merged.household_id, merged.maid_id,
        merged.work_start_date, merged.work_end_date, merged.start_time, merged.end_time, merged.status,
        merged.start_otp, merged.end_otp, merged.is_recurring, merged.frequency,
        merged.custom_frequency_days, merged.is_reviewed,
        merged.custom_price, merged.custom_description,
        merged.maid_requested_start, merged.maid_requested_end, merged.price_at_booking,
        merged.staging_contract_id, merged.auto_accepted,
      ]
    );
    return id;
  },

  // Update contract via SCD Type 2 — close current row and insert new version
  updateContract: async (
    contractBookingId: string,
    updates: { startTime: string; endTime: string; startDate?: string; monthlyFee?: number }
  ): Promise<void> => {
    const scdUpdates: Partial<Booking> = {};
    if (updates.startTime) scdUpdates.startTime = updates.startTime;
    if (updates.endTime) scdUpdates.endTime = updates.endTime;
    if (updates.startDate) scdUpdates.workStartDate = updates.startDate;
    if (updates.monthlyFee !== undefined) scdUpdates.priceAtBooking = updates.monthlyFee;
    await db.scdUpdateBooking(contractBookingId, scdUpdates);

    // Also update staging_contracts if linked
    const booking = await db.getBookingById(contractBookingId);
    if (booking?.stagingContractId) {
      const stagingUpdates: string[] = ['start_time = $1', 'end_time = $2'];
      const stagingParams: any[] = [updates.startTime, updates.endTime];
      if (updates.startDate !== undefined) {
        stagingParams.push(updates.startDate);
        stagingUpdates.push(`start_date = $${stagingParams.length}`);
      }
      if (updates.monthlyFee !== undefined) {
        stagingParams.push(updates.monthlyFee);
        stagingUpdates.push(`monthly_contract_fee = $${stagingParams.length}`);
      }
      stagingParams.push(booking.stagingContractId);
      await (sql as any)(
        `UPDATE staging_contracts SET ${stagingUpdates.join(', ')} WHERE id = $${stagingParams.length}`,
        stagingParams
      );
    }
  },

  // Save or update Expo push token for a user
  savePushToken: async (userId: string, token: string): Promise<void> => {
    await (sql as any)(
      `UPDATE users SET expo_push_token = $1 WHERE id = $2`,
      [token, userId]
    );
  },

  // Get maid push token + household name for a staging contract (used for push notifications)
  getMaidInfoForContract: async (stagingContractId: string): Promise<{ maidPushToken: string | null; householdName: string } | null> => {
    const rows = await (sql as any)(
      `SELECT u_maid.expo_push_token AS maid_push_token, u_household.name AS household_name
       FROM staging_contracts sc
       JOIN users u_maid ON sc.maid_id = u_maid.id
       JOIN users u_household ON sc.household_id = u_household.id
       WHERE sc.id = $1`,
      [stagingContractId]
    );
    if (rows.length === 0) return null;
    return {
      maidPushToken: rows[0].maid_push_token || null,
      householdName: rows[0].household_name || 'Household',
    };
  },

  // Returns household push token + maid name for any booking (used to notify household on cancellation)
  getNotificationInfoForBooking: async (bookingId: string): Promise<{ householdPushToken: string | null; maidName: string; serviceName: string } | null> => {
    const rows = await (sql as any)(
      `SELECT u_household.expo_push_token AS household_push_token,
              u_maid.name AS maid_name,
              COALESCE(ss.name->>'en', svc.name->>'en', 'Service') AS service_name
       FROM bookings b
       JOIN users u_household ON b.household_id = u_household.id
       LEFT JOIN users u_maid ON b.maid_id = u_maid.id
       LEFT JOIN society_services ss ON b.society_service_id = ss.id
       LEFT JOIN services svc ON ss.service_id = svc.id
       WHERE b.id = $1`,
      [bookingId]
    );
    if (rows.length === 0) return null;
    return {
      householdPushToken: rows[0].household_push_token || null,
      maidName: rows[0].maid_name || 'Your maid',
      serviceName: rows[0].service_name || 'Service',
    };
  },

  getHouseholdInfoForContract: async (stagingContractId: string): Promise<{ householdPushToken: string | null; maidName: string } | null> => {
    const rows = await (sql as any)(
      `SELECT u_household.expo_push_token AS household_push_token, u_maid.name AS maid_name
       FROM bookings b
       JOIN users u_household ON b.household_id = u_household.id
       JOIN users u_maid ON b.maid_id = u_maid.id
       WHERE b.staging_contract_id = $1
         AND b.booking_type = 'CONTRACT'
         AND b.eff_end_date = '3499-12-31'
       LIMIT 1`,
      [stagingContractId]
    );
    if (rows.length === 0) return null;
    return {
      householdPushToken: rows[0].household_push_token || null,
      maidName: rows[0].maid_name || 'Maid',
    };
  },

  // Returns all active contracts for a maid (used for conflict detection).
  getActiveContractsForMaid: async (maidId: string): Promise<Array<{ id: string; frequency: string; startTime: string; endTime: string; workStartDate: string }>> => {
    const rows = await (sql as any)(
      `SELECT id, frequency, start_time, end_time, work_start_date
       FROM bookings
       WHERE maid_id = $1
         AND booking_type = 'CONTRACT'
         AND eff_end_date = '3499-12-31'
         AND status NOT IN ('CANCELLED', 'TERMINATED')`,
      [maidId]
    );
    return rows.map((r: any) => ({
      id: r.id,
      frequency: r.frequency,
      startTime: r.start_time,
      endTime: r.end_time,
      workStartDate: r.work_start_date,
    }));
  },

  // When a maid books leave or cancels a contract session, create a REPLACEMENT record.
  // Contract row is UNTOUCHED. The REPLACEMENT starts as status='REQUESTED' with
  // maid_id=NULL — meaning "this session needs a replacement; no maid assigned yet".
  // The household assigns a maid via assignReplacementForBooking, which sets maid_id.
  // Accepts contractId (the booking id of the CONTRACT) and date (from calendar selection).
  createLeaveExceptionBooking: async (contractId: string, date: string): Promise<Booking | null> => {
    // Duplicate guard: check if a REPLACEMENT already exists for this contract+date
    const existing = await (sql as any)(
      `SELECT id FROM bookings
       WHERE is_replacement_of = $1 AND work_start_date = $2
         AND booking_type = 'REPLACEMENT' AND eff_end_date = '3499-12-31'
       LIMIT 1`,
      [contractId, date]
    );
    if (existing.length > 0) {
      return db.getBookingById(existing[0].id);
    }

    // Get the contract record for template data
    const ref = await (sql as any)(
      `SELECT * FROM bookings WHERE id = $1 AND booking_type = 'CONTRACT' AND eff_end_date = '3499-12-31' LIMIT 1`,
      [contractId]
    );
    if (ref.length === 0) return null;
    const contract = ref[0];

    // Find the replacement society_service for this society
    const householdRows = await (sql as any)(`SELECT society_id FROM users WHERE id = $1`, [contract.household_id]);
    const societyId = householdRows[0]?.society_id;
    const replacementSsId = societyId ? await db.findOrCreateReplacementSocietyService(societyId) : contract.society_service_id;

    // Calculate replacement cost: hourly rate × duration hours
    const ssRows = await (sql as any)(
      `SELECT COALESCE(ss.price, s.base_price) as effective_price
       FROM society_services ss LEFT JOIN services s ON ss.service_id = s.id
       WHERE ss.id = $1`,
      [replacementSsId]
    );
    const hourlyRate = ssRows.length > 0 ? Number(ssRows[0].effective_price) : 150;
    const startH = parseInt(contract.start_time.split(':')[0]);
    const endH = parseInt(contract.end_time.split(':')[0]);
    const durationHours = Math.max(endH - startH, 1);
    const replacementCost = hourlyRate * durationHours;

    const newId = generateId('bk');
    await (sql as any)(
      `INSERT INTO bookings (
        id, booking_type, is_replacement_of, society_service_id, household_id, maid_id,
        work_start_date, work_end_date, start_time, end_time, status,
        is_recurring, frequency, price_at_booking, update_comments
      ) VALUES ($1, 'REPLACEMENT', $2, $3, $4, NULL, $5, $5, $6, $7, 'REQUESTED', false, null, $8, $9)`,
      [
        newId, contractId, replacementSsId, contract.household_id,
        date, contract.start_time, contract.end_time, replacementCost,
        'Maid leave/cancellation — awaiting replacement assignment',
      ]
    );
    return db.getBookingById(newId);
  },

  // Assign a replacement maid to a booking.
  // Contract path: bookingId is a REPLACEMENT record — update maid_id in place.
  // Adhoc path: bookingId is original ADHOC — close original, create REPLACEMENT record.
  assignReplacementForBooking: async (bookingId: string, replacementMaidId: string): Promise<{ newBookingId: string | null; bookingType: BookingType }> => {
    const rows = await (sql as any)(`SELECT * FROM bookings WHERE id = $1 AND eff_end_date = '3499-12-31'`, [bookingId]);
    if (rows.length === 0) throw new Error(`Booking ${bookingId} not found or not active`);
    const orig = rows[0];

    // Check auto-accept for replacement maid
    const maidRows = await (sql as any)(`SELECT auto_accept FROM users WHERE id = $1`, [replacementMaidId]);
    const autoAccept = maidRows[0]?.auto_accept || false;
    const newStatus = autoAccept ? 'CONFIRMED' : 'REQUESTED';

    if (orig.booking_type === 'REPLACEMENT') {
      // Contract session replacement: update the existing REPLACEMENT record
      // Guard: must be REQUESTED or CANCELLED with original maid (no replacement currently assigned)
      await (sql as any)(
        `UPDATE bookings SET maid_id = $2, status = $3, auto_accepted = $4,
                update_comments = $5
         WHERE id = $1 AND eff_end_date = '3499-12-31'`,
        [bookingId, replacementMaidId, newStatus, autoAccept,
         `Replacement maid assigned${autoAccept ? ' (auto-accepted)' : ' (awaiting acceptance)'}`]
      );
      return { newBookingId: null, bookingType: 'REPLACEMENT' };
    }

    // Adhoc path: close original, create new REPLACEMENT record in a transaction-like sequence
    // Close original adhoc
    await (sql as any)(
      `UPDATE bookings SET eff_end_date = NOW(), update_comments = 'Closed: replacement assigned'
       WHERE id = $1 AND eff_end_date = '3499-12-31'`,
      [bookingId]
    );

    // Create REPLACEMENT record
    const newId = generateId('bk');
    await (sql as any)(
      `INSERT INTO bookings (
        id, booking_type, is_replacement_of, society_service_id, household_id, maid_id,
        work_start_date, work_end_date, start_time, end_time, status,
        is_recurring, price_at_booking, custom_description, auto_accepted, update_comments
      ) VALUES ($1, 'REPLACEMENT', $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $11, $12, $13, $14)`,
      [
        newId, bookingId, orig.society_service_id, orig.household_id, replacementMaidId,
        orig.work_start_date, orig.work_end_date, orig.start_time, orig.end_time, newStatus,
        orig.price_at_booking, orig.custom_description, autoAccept,
        `Replacement maid assigned for adhoc booking`,
      ]
    );
    return { newBookingId: newId, bookingType: 'ADHOC' };
  },

  // Terminate a contract — close the contract record and all orphaned REPLACEMENT records
  terminateContract: async (contractId: string): Promise<void> => {
    // Close the contract booking
    await (sql as any)(
      `UPDATE bookings
       SET status = 'TERMINATED', eff_end_date = NOW(),
           update_comments = 'Contract terminated'
       WHERE id = $1 AND eff_end_date = '3499-12-31'`,
      [contractId]
    );
    // Close all open REPLACEMENT records for this contract
    await (sql as any)(
      `UPDATE bookings
       SET status = 'TERMINATED', eff_end_date = NOW(),
           update_comments = 'Terminated: parent contract terminated'
       WHERE is_replacement_of = $1 AND booking_type = 'REPLACEMENT' AND eff_end_date = '3499-12-31'`,
      [contractId]
    );
    // Update staging_contracts if linked
    const booking = await db.getBookingById(contractId);
    if (booking?.stagingContractId) {
      await (sql as any)(
        `UPDATE staging_contracts SET status = 'CANCELLED' WHERE id = $1`,
        [booking.stagingContractId]
      );
    }
  },

  getContractsForUser: async (userId: string, role: string): Promise<ContractGroup[]> => {
    // One row per CONTRACT booking. No grouping needed — each contract is a single row.
    const fieldName = role === 'MAID' ? 'b.maid_id' : 'b.household_id';
    const rows = await (sql as any)(
      `SELECT
        b.id,
        b.frequency,
        b.start_time,
        b.end_time,
        b.price_at_booking AS monthly_contract_fee,
        b.custom_description AS job_description,
        b.work_start_date,
        b.work_end_date,
        b.eff_start_date,
        b.eff_end_date,
        b.status,
        b.staging_contract_id,
        u_m.name AS maid_name,
        u_h.name AS household_name,
        u_h.address AS household_address,
        COALESCE(ss.icon, svc.icon) AS service_icon
      FROM bookings b
      JOIN users u_m ON b.maid_id = u_m.id
      JOIN users u_h ON b.household_id = u_h.id
      LEFT JOIN society_services ss ON b.society_service_id = ss.id
      LEFT JOIN services svc ON ss.service_id = svc.id
      WHERE ${fieldName} = $1
        AND b.booking_type = 'CONTRACT'
        AND b.eff_end_date = '3499-12-31'
      ORDER BY b.work_start_date DESC`,
      [userId]
    );
    return rows.map((r: any): ContractGroup => ({
      id: r.id,
      frequency: r.frequency,
      startTime: r.start_time,
      endTime: r.end_time,
      monthlyContractFee: Number(r.monthly_contract_fee),
      jobDescription: r.job_description,
      workStartDate: r.work_start_date instanceof Date ? r.work_start_date.toISOString().substring(0, 10) : r.work_start_date ? String(r.work_start_date).substring(0, 10) : '',
      workEndDate: r.work_end_date instanceof Date ? r.work_end_date.toISOString().substring(0, 10) : r.work_end_date ? String(r.work_end_date).substring(0, 10) : '',
      effStartDate: r.eff_start_date instanceof Date ? r.eff_start_date.toISOString().substring(0, 10) : r.eff_start_date,
      effEndDate: r.eff_end_date instanceof Date ? r.eff_end_date.toISOString().substring(0, 10) : r.eff_end_date,
      status: r.status,
      maidName: r.maid_name,
      householdName: r.household_name,
      householdAddress: r.household_address,
      serviceIcon: r.service_icon,
      stagingContractId: r.staging_contract_id,
    }));
  },

  // Terminate a single booking (adhoc or replacement) — set TERMINATED + close record
  terminateBooking: async (id: string): Promise<void> => {
    await (sql as any)(
      `UPDATE bookings SET status = 'TERMINATED', eff_end_date = NOW(),
              update_comments = 'Terminated by household'
       WHERE id = $1 AND eff_end_date = '3499-12-31'`,
      [id]
    );
  },

  // Find or create the "Contract Replacement" society_service for a society
  findOrCreateReplacementSocietyService: async (societyId: string): Promise<string> => {
    const existing = await (sql as any)(
      `SELECT id FROM society_services WHERE society_id = $1 AND service_id = 'srv-replacement-global'`,
      [societyId]
    );
    if (existing.length > 0) return existing[0].id;
    const id = generateId('ss');
    await (sql as any)(
      `INSERT INTO society_services (id, society_id, service_id, is_active)
       VALUES ($1, $2, 'srv-replacement-global', true)`,
      [id, societyId]
    );
    return id;
  },

  // Get available replacement maids for a booking's date/time slot
  getAvailableReplacementMaids: async (bookingId: string): Promise<{
    maids: Array<{ id: string; name: string; rating: number; trustScore: number; autoAccept: boolean; replacementCost: number }>;
    hourlyRate: number; durationHours: number; isContractReplacement: boolean;
  }> => {
    // Get the booking (could be REPLACEMENT for contract, or ADHOC)
    const booking = await db.getBookingById(bookingId);
    if (!booking) throw new Error(`Booking ${bookingId} not found`);

    const isContractReplacement = booking.bookingType === 'REPLACEMENT';
    const date = booking.workStartDate;
    const startTime = booking.startTime;
    const endTime = booking.endTime;

    // Get the society for this household
    const householdRows = await (sql as any)(`SELECT society_id FROM users WHERE id = $1`, [booking.householdId]);
    const societyId = householdRows[0]?.society_id;

    // Build exclusion list: the maid on this booking (canceller if REPLACEMENT/ADHOC)
    // plus the original contract maid (via is_replacement_of). Both must be excluded so
    // a second-round replacement picker doesn't surface either of them.
    const excludeSet = new Set<string>();
    if (booking.maidId) excludeSet.add(booking.maidId);
    if (booking.isReplacementOf) {
      const parent = await db.getBookingById(booking.isReplacementOf);
      if (parent?.maidId) excludeSet.add(parent.maidId);
    }
    const excludeArray = [...excludeSet];

    // Get day of week for frequency matching (MON, TUE, etc.)
    const dateObj = new Date(date + 'T00:00:00');
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dayOfWeek = dayNames[dateObj.getDay()];

    // Find available maids
    const maids = await (sql as any)(
      `SELECT u.id, u.name, u.auto_accept,
              COALESCE((SELECT AVG(rating) FROM reviews WHERE maid_id = u.id), 0) as avg_rating,
              ROUND(COALESCE(
                CASE
                  WHEN (SELECT COUNT(*) FROM reviews WHERE maid_id = u.id) = 0
                   AND (SELECT COUNT(*) FROM (SELECT DISTINCT ON (b2.id) b2.status FROM bookings b2 WHERE b2.maid_id = u.id ORDER BY b2.id, b2.eff_end_date DESC) sub WHERE sub.status != 'REQUESTED') = 0
                  THEN 50
                  ELSE
                    COALESCE((SELECT AVG(rating) FROM reviews WHERE maid_id = u.id), 0) / 5.0 * 60
                    + 30
                    + 10
                END
              , 50)) as trust_score
       FROM users u
       WHERE u.society_id = $1
         AND u.role = 'MAID'
         AND u.is_verified = true
         AND ($2::text[] IS NULL OR NOT (u.id = ANY($2::text[])))
         AND NOT EXISTS (
           SELECT 1 FROM bookings b
           WHERE b.maid_id = u.id
             AND b.eff_end_date = '3499-12-31'
             AND b.status NOT IN ('CANCELLED', 'TERMINATED')
             AND (
               (b.booking_type IN ('ADHOC', 'REPLACEMENT')
                AND b.work_start_date = $3
                AND b.start_time < $5 AND b.end_time > $4)
               OR
               (b.booking_type = 'CONTRACT'
                AND b.work_start_date <= $3 AND b.work_end_date >= $3
                AND b.start_time < $5 AND b.end_time > $4
                AND (b.frequency = 'DAILY' OR $6 = ANY(string_to_array(b.frequency, ',')))
                AND NOT EXISTS (
                  SELECT 1 FROM bookings r
                  WHERE r.is_replacement_of = b.id
                    AND r.booking_type = 'REPLACEMENT'
                    AND r.work_start_date = $3
                    AND r.eff_end_date = '3499-12-31'
                ))
             )
         )
         AND NOT ($3::text = ANY(u.leaves))
       ORDER BY u.auto_accept DESC,
                (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE maid_id = u.id) DESC,
                u.id
       LIMIT 10`,
      [societyId, excludeArray, date, startTime, endTime, dayOfWeek]
    );

    // Calculate pricing
    let hourlyRate = 150;
    let durationHours = 1;
    const startH = parseInt(startTime.split(':')[0]);
    const endH = parseInt(endTime.split(':')[0]);
    durationHours = Math.max(endH - startH, 1);

    if (isContractReplacement) {
      const replacementSsId = societyId ? await db.findOrCreateReplacementSocietyService(societyId) : null;
      if (replacementSsId) {
        const ssRows = await (sql as any)(
          `SELECT COALESCE(ss.price, s.base_price) as effective_price
           FROM society_services ss LEFT JOIN services s ON ss.service_id = s.id WHERE ss.id = $1`,
          [replacementSsId]
        );
        if (ssRows.length > 0) hourlyRate = Number(ssRows[0].effective_price);
      }
    }

    return {
      maids: maids.map((m: any) => ({
        id: m.id,
        name: m.name,
        rating: Number(Number(m.avg_rating).toFixed(1)),
        trustScore: Number(m.trust_score),
        autoAccept: Boolean(m.auto_accept),
        replacementCost: isContractReplacement ? hourlyRate * durationHours : Number(booking.priceAtBooking || 0),
      })),
      hourlyRate,
      durationHours,
      isContractReplacement,
    };
  },

  // Batch-fetch REPLACEMENT records for a date range (used for calendar dots)
  getReplacementsForDateRange: async (contractIds: string[], startDate: string, endDate: string): Promise<Booking[]> => {
    if (contractIds.length === 0) return [];
    const placeholders = contractIds.map((_: string, i: number) => `$${i + 3}`).join(',');
    const rows = await (sql as any)(
      `SELECT DISTINCT ON (b.id) b.*
       FROM bookings b
       WHERE b.booking_type = 'REPLACEMENT'
         AND b.is_replacement_of IN (${placeholders})
         AND b.work_start_date >= $1
         AND b.work_start_date <= $2
       ORDER BY b.id, b.eff_end_date DESC`,
      [startDate, endDate, ...contractIds]
    );
    return rows.map(mapBooking);
  },
};
