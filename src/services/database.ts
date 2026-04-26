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
  REJECTED = 'REJECTED',
}

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
  societyServiceId: string;
  householdId: string;
  maidId: string;
  date: string;
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
  // Contract / SCD fields
  active?: boolean;
  stagingContractId?: string;
  isContract?: boolean;
  validFrom?: string;
  validTo?: string;
  isCurrent?: boolean;
  updateComments?: string | null;
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
  stagingContractId: string;
  frequency: string;
  startTime: string;
  endTime: string;
  monthlyContractFee: number;
  jobDescription?: string;
  effStartDate?: string;
  active: boolean;
  maidName?: string;
  householdName?: string;
  householdAddress?: string;
  bookingCount: number;
  bookingIds: string[];
  serviceIcon?: string;
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
  societyServiceId: row.society_service_id,
  householdId: row.household_id,
  maidId: row.maid_id,
  date: row.date,
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
  // Contract / SCD fields
  active: row.active !== undefined ? Boolean(row.active) : true,
  stagingContractId: row.staging_contract_id,
  isContract: row.is_contract ? Boolean(row.is_contract) : false,
  validFrom: row.valid_from,
  validTo: row.valid_to,
  isCurrent: row.is_current !== undefined ? Boolean(row.is_current) : true,
  updateComments: row.update_comments ?? null,
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
             AND (SELECT COUNT(*) FROM bookings WHERE maid_id = u.id AND status != 'REQUESTED') = 0
            THEN 50
            ELSE
              (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE maid_id = u.id) / 5.0 * 60
              + (1.0 - (SELECT COUNT(*) FROM bookings WHERE maid_id = u.id AND status = 'CANCELLED')::float
                      / GREATEST((SELECT COUNT(*) FROM bookings WHERE maid_id = u.id AND status != 'REQUESTED'), 1)) * 30
              + LEAST((SELECT COUNT(*) FROM bookings WHERE maid_id = u.id AND status = 'COMPLETED')::float / 50.0, 1.0) * 10
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
             AND (SELECT COUNT(*) FROM bookings WHERE maid_id = u.id AND status != 'REQUESTED') = 0
            THEN 50
            ELSE
              (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE maid_id = u.id) / 5.0 * 60
              + (1.0 - (SELECT COUNT(*) FROM bookings WHERE maid_id = u.id AND status = 'CANCELLED')::float
                      / GREATEST((SELECT COUNT(*) FROM bookings WHERE maid_id = u.id AND status != 'REQUESTED'), 1)) * 30
              + LEAST((SELECT COUNT(*) FROM bookings WHERE maid_id = u.id AND status = 'COMPLETED')::float / 50.0, 1.0) * 10
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
             AND (SELECT COUNT(*) FROM bookings WHERE maid_id = u.id AND status != 'REQUESTED') = 0
            THEN 50
            ELSE
              (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE maid_id = u.id) / 5.0 * 60
              + (1.0 - (SELECT COUNT(*) FROM bookings WHERE maid_id = u.id AND status = 'CANCELLED')::float
                      / GREATEST((SELECT COUNT(*) FROM bookings WHERE maid_id = u.id AND status != 'REQUESTED'), 1)) * 30
              + LEAST((SELECT COUNT(*) FROM bookings WHERE maid_id = u.id AND status = 'COMPLETED')::float / 50.0, 1.0) * 10
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
         AND b.date >= ${startDate}
         AND b.date <= ${endDate}
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
      `SELECT
        b.id, b.society_service_id, b.household_id, b.maid_id, b.date, b.start_time, b.end_time,
        b.status, b.start_otp, b.end_otp, b.maid_requested_start, b.maid_requested_end,
        b.is_recurring, b.frequency, b.custom_frequency_days, b.is_reviewed,
        b.custom_price, b.custom_description, b.price_at_booking,
        b.active, b.staging_contract_id, b.is_contract, b.auto_accepted,
        b.valid_from, b.valid_to, b.is_current,
        m.name as maid_name,
        h.name as household_name,
        h.address as household_address,
        h.phone as household_phone,
        COALESCE(ss.name, svc.name) as service_name,
        COALESCE(ss.icon, svc.icon) as service_icon
      FROM bookings b
      JOIN users m ON b.maid_id = m.id
      JOIN users h ON b.household_id = h.id
      LEFT JOIN society_services ss ON b.society_service_id = ss.id
      LEFT JOIN services svc ON ss.service_id = svc.id
      WHERE b.${fieldName} = $1
        AND b.is_current = true
      ORDER BY b.date DESC, b.start_time DESC`,
      [userId]
    );
    return rows.map(mapBooking);
  },

  getBookingsBySociety: async (societyId: string): Promise<Booking[]> => {
    const rows = await (sql as any)(
      `SELECT
        b.id, b.society_service_id, b.household_id, b.maid_id, b.date, b.start_time, b.end_time,
        b.status, b.start_otp, b.end_otp, b.maid_requested_start, b.maid_requested_end,
        b.is_recurring, b.frequency, b.custom_frequency_days, b.is_reviewed,
        b.custom_price, b.custom_description, b.price_at_booking,
        b.active, b.staging_contract_id, b.is_contract,
        b.valid_from, b.valid_to, b.is_current,
        m.name as maid_name,
        h.name as household_name,
        h.address as household_address,
        COALESCE(ss.name, svc.name) as service_name,
        COALESCE(ss.icon, svc.icon) as service_icon
      FROM bookings b
      JOIN users m ON b.maid_id = m.id
      JOIN users h ON b.household_id = h.id
      LEFT JOIN society_services ss ON b.society_service_id = ss.id
      LEFT JOIN services svc ON ss.service_id = svc.id
      WHERE h.society_id = $1
        AND b.is_current = true
      ORDER BY b.date DESC, b.start_time DESC`,
      [societyId]
    );
    return rows.map(mapBooking);
  },

  createBooking: async (booking: any): Promise<Booking> => {
    const id = generateId('bk');
    const initialStatus = booking.isContract ? BookingStatus.CONFIRMED : BookingStatus.REQUESTED;
    await (sql as any)(
      `INSERT INTO bookings (
        id, society_service_id, household_id, maid_id, date, start_time, end_time, status,
        start_otp, end_otp, is_recurring, frequency, custom_frequency_days, is_reviewed,
        custom_price, custom_description, maid_requested_start, maid_requested_end, price_at_booking,
        active, staging_contract_id, is_contract,
        valid_from, is_current
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        null, null, $9, $10, $11, false,
        $12, $13, false, false, $14,
        $15, $16, $17,
        NOW(), true
      )`,
      [
        id,
        booking.societyServiceId,
        booking.householdId,
        booking.maidId,
        booking.date,
        booking.startTime,
        booking.endTime,
        initialStatus,
        booking.isRecurring || false,
        booking.frequency || null,
        booking.customFrequencyDays || null,
        booking.customPrice || null,
        booking.customDescription || null,
        booking.priceAtBooking || null,
        booking.active !== false,
        booking.stagingContractId || null,
        booking.isContract || false,
      ]
    );

    // Auto-accept: if the maid has opted in, immediately confirm non-contract bookings
    if (!booking.isContract) {
      const maidRows = await sql`SELECT auto_accept FROM users WHERE id = ${booking.maidId}`;
      if (maidRows[0]?.auto_accept) {
        await sql`UPDATE bookings SET status = ${BookingStatus.CONFIRMED}, auto_accepted = true WHERE id = ${id}`;
        return { ...booking, id, status: BookingStatus.CONFIRMED, autoAccepted: true, isReviewed: false } as Booking;
      }
    }

    return { ...booking, id, status: initialStatus, autoAccepted: false, isReviewed: false } as Booking;
  },

  updateBooking: async (id: string, updates: Partial<Booking>): Promise<void> => {
    const allowedKeys = ['date', 'startTime', 'endTime', 'status', 'startOtp', 'endOtp', 'customPrice'];
    const entries = Object.entries(updates).filter(([key]) => allowedKeys.includes(key));
    if (entries.length === 0) return;

    const dbFields = entries.map(([key, _], i) => `${key.replace(/[A-Z]/g, (l: string) => `_${l.toLowerCase()}`)} = $${i + 2}`);
    const query = `UPDATE bookings SET ${dbFields.join(', ')} WHERE id = $1`;
    const params = [id, ...entries.map(([_, v]) => v)];
    await (sql as any)(query, params);
  },

  updateBookingStatus: async (id: string, status: BookingStatus): Promise<void> => {
    await sql`UPDATE bookings SET status = ${status} WHERE id = ${id}`;
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
      await sql`UPDATE bookings SET maid_requested_start = TRUE, start_otp = ${otp} WHERE id = ${id}`;
    } else {
      await sql`UPDATE bookings SET maid_requested_end = TRUE, end_otp = ${otp} WHERE id = ${id}`;
    }
    return otp;
  },

  verifyStoredOtp: async (id: string, type: 'start' | 'end', code: string): Promise<boolean> => {
    const rows = await sql`SELECT start_otp, end_otp FROM bookings WHERE id = ${id}`;
    if (rows.length === 0) return false;
    const storedOtp = type === 'start' ? rows[0].start_otp : rows[0].end_otp;
    return storedOtp === code;
  },

  regenerateOtp: async (id: string, type: 'start' | 'end'): Promise<string> => {
    const otp = generate4DigitOtp();
    if (type === 'start') {
      await sql`UPDATE bookings SET start_otp = ${otp} WHERE id = ${id}`;
    } else {
      await sql`UPDATE bookings SET end_otp = ${otp} WHERE id = ${id}`;
    }
    return otp;
  },

  cancelOtpRequest: async (id: string, type: 'start' | 'end'): Promise<void> => {
    if (type === 'start') {
      await sql`UPDATE bookings SET maid_requested_start = FALSE, start_otp = NULL WHERE id = ${id}`;
    } else {
      await sql`UPDATE bookings SET maid_requested_end = FALSE, end_otp = NULL WHERE id = ${id}`;
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
    await sql`UPDATE bookings SET is_reviewed = TRUE WHERE id = ${review.bookingId}`;
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
      `SELECT b.*, b.is_contract FROM bookings b WHERE b.id = $1`,
      [id]
    );
    return rows.length > 0 ? mapBooking(rows[0]) : null;
  },

  // SCD Type 2: close current version and insert new row with updated data
  scdUpdateBooking: async (id: string, updates: Partial<Booking>): Promise<string> => {
    // Fetch current row before closing (needed for diff and clone)
    const rows = await (sql as any)(`SELECT * FROM bookings WHERE id = $1 AND is_current = true`, [id]);
    if (rows.length === 0) throw new Error(`Booking ${id} not found`);
    const cur = rows[0];

    // Build human-readable close-reason comment by diffing old vs new values
    const fieldLabels: Record<string, string> = {
      status: 'status', date: 'date', start_time: 'start_time', end_time: 'end_time',
      custom_price: 'price', price_at_booking: 'price_at_booking',
      frequency: 'frequency', active: 'active',
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

    // Close current version with the audit comment
    await (sql as any)(
      `UPDATE bookings SET valid_to = NOW(), is_current = false, update_comments = $2 WHERE id = $1 AND is_current = true`,
      [id, updateComment]
    );

    const newId = generateId('bk');
    const merged = { ...cur, ...snakeUpdates };
    await (sql as any)(
      `INSERT INTO bookings (
        id, society_service_id, household_id, maid_id, date, start_time, end_time, status,
        start_otp, end_otp, is_recurring, frequency, custom_frequency_days, is_reviewed,
        custom_price, custom_description, maid_requested_start, maid_requested_end, price_at_booking,
        active, staging_contract_id, is_contract,
        valid_from, valid_to, is_current, update_comments
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW(),NULL,true,NULL)`,
      [
        newId, merged.society_service_id, merged.household_id, merged.maid_id,
        merged.date, merged.start_time, merged.end_time, merged.status,
        merged.start_otp, merged.end_otp, merged.is_recurring, merged.frequency,
        merged.custom_frequency_days, merged.is_reviewed,
        merged.custom_price, merged.custom_description,
        merged.maid_requested_start, merged.maid_requested_end, merged.price_at_booking,
        merged.active, merged.staging_contract_id, merged.is_contract,
      ]
    );
    return newId;
  },

  // Update contract fields with SCD Type 2 on bookings
  updateContract: async (
    stagingContractId: string,
    updates: { startTime: string; endTime: string; startDate?: string; monthlyFee?: number }
  ): Promise<void> => {
    const { startTime, endTime, startDate, monthlyFee } = updates;

    // Fetch all current active bookings for this contract
    const currentBookings = await (sql as any)(
      `SELECT * FROM bookings WHERE staging_contract_id = $1 AND is_current = true AND active = true`,
      [stagingContractId]
    );

    for (const cur of currentBookings) {
      // Build per-row close-reason comment by diffing old values against incoming updates
      const changeParts: string[] = [];
      if (startTime !== cur.start_time) changeParts.push(`start_time changed from "${cur.start_time}" to "${startTime}"`);
      if (endTime !== cur.end_time) changeParts.push(`end_time changed from "${cur.end_time}" to "${endTime}"`);
      if (startDate !== undefined && startDate !== cur.date) changeParts.push(`start_date changed from "${cur.date}" to "${startDate}"`);
      if (monthlyFee !== undefined && Number(monthlyFee) !== Number(cur.price_at_booking)) {
        changeParts.push(`monthly_fee changed from "${cur.price_at_booking}" to "${monthlyFee}"`);
      }
      const updateComment = changeParts.length > 0
        ? `Row closed: ${changeParts.join('; ')}`
        : 'Row closed: contract updated';

      // Close the current version with audit comment
      await (sql as any)(
        `UPDATE bookings SET valid_to = NOW(), is_current = false, update_comments = $2 WHERE id = $1`,
        [cur.id, updateComment]
      );
      // Insert new version with updated fields
      const newId = generateId('bk');
      await (sql as any)(
        `INSERT INTO bookings (
          id, society_service_id, household_id, maid_id, date, start_time, end_time, status,
          start_otp, end_otp, is_recurring, frequency, custom_frequency_days, is_reviewed,
          custom_price, custom_description, maid_requested_start, maid_requested_end, price_at_booking,
          active, staging_contract_id, is_contract,
          valid_from, valid_to, is_current, update_comments
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW(),NULL,true,NULL)`,
        [
          newId, cur.society_service_id, cur.household_id, cur.maid_id,
          startDate !== undefined ? startDate : cur.date, startTime, endTime, cur.status,
          cur.start_otp, cur.end_otp, cur.is_recurring, cur.frequency,
          cur.custom_frequency_days, cur.is_reviewed,
          cur.custom_price, cur.custom_description,
          cur.maid_requested_start, cur.maid_requested_end,
          monthlyFee !== undefined ? monthlyFee : cur.price_at_booking,
          cur.active, cur.staging_contract_id, cur.is_contract,
        ]
      );
    }

    // Update staging_contracts with all changed fields
    const stagingUpdates: string[] = ['start_time = $1', 'end_time = $2'];
    const stagingParams: any[] = [startTime, endTime];
    if (startDate !== undefined) {
      stagingParams.push(startDate);
      stagingUpdates.push(`start_date = $${stagingParams.length}`);
    }
    if (monthlyFee !== undefined) {
      stagingParams.push(monthlyFee);
      stagingUpdates.push(`monthly_contract_fee = $${stagingParams.length}`);
    }
    stagingParams.push(stagingContractId);
    await (sql as any)(
      `UPDATE staging_contracts SET ${stagingUpdates.join(', ')} WHERE id = $${stagingParams.length}`,
      stagingParams
    );
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
       JOIN users u_maid ON b.maid_id = u_maid.id
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
    // Query via bookings (not staging_contracts) because staging_contracts.household_id / maid_id
    // may be NULL if the upload pre-dates the resolved-ID columns, whereas bookings always carry them.
    const rows = await (sql as any)(
      `SELECT u_household.expo_push_token AS household_push_token, u_maid.name AS maid_name
       FROM bookings b
       JOIN users u_household ON b.household_id = u_household.id
       JOIN users u_maid ON b.maid_id = u_maid.id
       WHERE b.staging_contract_id = $1
         AND b.is_contract = true
       LIMIT 1`,
      [stagingContractId]
    );
    if (rows.length === 0) return null;
    return {
      householdPushToken: rows[0].household_push_token || null,
      maidName: rows[0].maid_name || 'Maid',
    };
  },

  // Returns all non-cancelled contracts for a maid (used for conflict detection).
  // Filters to contracts whose 6-month window hasn't expired yet (start_date + 6 months > today).
  // Uses status != 'CANCELLED' (not status = 'SUCCESS') to catch all active states.
  getActiveContractsForMaid: async (maidId: string): Promise<Array<{ frequency: string; startTime: string; endTime: string }>> => {
    const rows = await (sql as any)(
      `SELECT frequency, start_time, end_time, start_date
       FROM staging_contracts
       WHERE maid_id = $1
         AND status != 'CANCELLED'`,
      [maidId]
    );
    // Filter out expired contracts in application code (avoids any SQL date-cast edge cases)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const cutoff = sixMonthsAgo.toISOString().split('T')[0]; // YYYY-MM-DD
    return rows
      .filter((r: any) => r.start_date && r.start_date >= cutoff)
      .map((r: any) => ({ frequency: r.frequency, startTime: r.start_time, endTime: r.end_time }));
  },

  // When a maid books leave that conflicts with a specific contract date, create a visible
  // CANCELLED booking row for that date so the household can see the cancellation.
  // If a current booking already exists for that date, update it to CANCELLED.
  // If no row exists yet (future pattern date), insert one using an existing booking as template.
  createLeaveExceptionBooking: async (stagingContractId: string, date: string): Promise<void> => {
    // Check for an existing is_current=true booking on that date
    const existing = await (sql as any)(
      `SELECT id FROM bookings
       WHERE staging_contract_id = $1 AND date = $2 AND is_current = true
       LIMIT 1`,
      [stagingContractId, date]
    );
    if (existing.length > 0) {
      // Update the existing row to CANCELLED
      await (sql as any)(
        `UPDATE bookings
         SET status = 'CANCELLED', active = false,
             update_comments = 'Cancelled: maid leave'
         WHERE id = $1`,
        [existing[0].id]
      );
      return;
    }
    // No row exists for this date — use any existing booking as a template for IDs
    const ref = await (sql as any)(
      `SELECT society_service_id, household_id, maid_id, start_time, end_time, price_at_booking, custom_description
       FROM bookings
       WHERE staging_contract_id = $1 AND is_contract = true
       LIMIT 1`,
      [stagingContractId]
    );
    if (ref.length === 0) return; // No reference booking found, nothing to do
    const r = ref[0];
    const newId = generateId('bk');
    await (sql as any)(
      `INSERT INTO bookings (
        id, society_service_id, household_id, maid_id, date, start_time, end_time,
        status, is_recurring, is_contract, staging_contract_id, price_at_booking,
        custom_description, active, is_current, valid_from
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'CANCELLED',true,true,$8,$9,$10,false,true,NOW())
      ON CONFLICT (id) DO NOTHING`,
      [newId, r.society_service_id, r.household_id, r.maid_id, date, r.start_time, r.end_time,
       stagingContractId, r.price_at_booking, r.custom_description]
    );
  },

  // Assign a replacement maid to a CANCELLED booking.
  // Adhoc: update maid_id in-place and restore CONFIRMED status.
  // Contract: insert a new CONFIRMED booking row for the replacement maid; original CANCELLED row is kept as audit trail.
  assignReplacementForBooking: async (bookingId: string, replacementMaidId: string): Promise<{ newBookingId: string | null; isContract: boolean }> => {
    const rows = await (sql as any)(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
    if (rows.length === 0) throw new Error(`Booking ${bookingId} not found`);
    const orig = rows[0];

    if (!orig.is_contract) {
      // Adhoc: update in place
      await (sql as any)(
        `UPDATE bookings
         SET maid_id = $2, status = 'CONFIRMED',
             maid_requested_start = false, maid_requested_end = false,
             start_otp = NULL, end_otp = NULL,
             update_comments = 'Replacement maid assigned'
         WHERE id = $1`,
        [bookingId, replacementMaidId]
      );
      return { newBookingId: null, isContract: false };
    }

    // Contract: create new CONFIRMED booking for replacement maid
    const newId = generateId('bk');
    await (sql as any)(
      `INSERT INTO bookings (
        id, society_service_id, household_id, maid_id, date, start_time, end_time,
        status, is_recurring, frequency, is_contract, staging_contract_id,
        price_at_booking, custom_description, active, is_current, valid_from
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        'CONFIRMED', true, $8, true, $9,
        $10, $11, true, true, NOW()
      )`,
      [
        newId,
        orig.society_service_id,
        orig.household_id,
        replacementMaidId,
        orig.date,
        orig.start_time,
        orig.end_time,
        orig.frequency,
        orig.staging_contract_id,
        orig.price_at_booking,
        orig.custom_description,
      ]
    );
    return { newBookingId: newId, isContract: true };
  },

  // Cancel all active bookings for a staging contract and mark it inactive
  cancelContract: async (stagingContractId: string): Promise<void> => {
    await (sql as any)(
      `UPDATE bookings
       SET status = 'CANCELLED', active = false, is_current = false, valid_to = NOW(),
           update_comments = 'Row closed: contract cancelled'
       WHERE staging_contract_id = $1 AND is_current = true AND active = true`,
      [stagingContractId]
    );
    await (sql as any)(
      `UPDATE staging_contracts SET status = 'CANCELLED' WHERE id = $1`,
      [stagingContractId]
    );
  },

  getContractsForUser: async (userId: string, role: string): Promise<ContractGroup[]> => {
    // Anchor on staging_contracts (one row per contract) to avoid duplicate groups
    // when replacement maids are assigned (which creates extra bookings under the same staging_contract_id).
    const fieldName = role === 'MAID' ? 'sc.maid_id' : 'sc.household_id';
    const rows = await (sql as any)(
      `SELECT
        sc.id as staging_contract_id,
        sc.frequency,
        sc.start_time,
        sc.end_time,
        sc.monthly_contract_fee,
        sc.job_description,
        sc.start_date as eff_start_date,
        sc.status as contract_status,
        (sc.status != 'CANCELLED') as all_active,
        m.name  as maid_name,
        h.name  as household_name,
        h.address as household_address,
        (SELECT COUNT(*) FROM bookings b2
         WHERE b2.staging_contract_id = sc.id AND b2.is_current = true) as booking_count,
        (SELECT ARRAY_AGG(b2.id ORDER BY b2.valid_from DESC) FROM bookings b2
         WHERE b2.staging_contract_id = sc.id AND b2.is_current = true) as booking_ids,
        (SELECT COALESCE(ss2.icon, svc2.icon)
         FROM bookings b3
         LEFT JOIN society_services ss2 ON b3.society_service_id = ss2.id
         LEFT JOIN services svc2 ON ss2.service_id = svc2.id
         WHERE b3.staging_contract_id = sc.id AND b3.is_current = true
         LIMIT 1) as service_icon
      FROM staging_contracts sc
      JOIN users m ON sc.maid_id = m.id
      JOIN users h ON sc.household_id = h.id
      WHERE ${fieldName} = $1
      ORDER BY sc.start_date DESC`,
      [userId]
    );
    return rows.map((r: any): ContractGroup => ({
      stagingContractId: r.staging_contract_id,
      frequency: r.frequency,
      startTime: r.start_time,
      endTime: r.end_time,
      monthlyContractFee: Number(r.monthly_contract_fee),
      jobDescription: r.job_description,
      effStartDate: r.eff_start_date,
      active: r.all_active,
      maidName: r.maid_name,
      householdName: r.household_name,
      householdAddress: r.household_address,
      bookingCount: Number(r.booking_count),
      bookingIds: r.booking_ids || [],
      serviceIcon: r.service_icon,
    }));
  },

  // Materialise a real booking row for a contract date that only existed as a virtual frontend entry.
  // Called by request-otp when the booking ID starts with "virtual-".
  // Returns the newly inserted (or pre-existing) booking.
  materializeContractBooking: async (stagingContractId: string, date: string): Promise<Booking | null> => {
    // Check for a pre-existing row (race-condition guard)
    const existing = await (sql as any)(
      `SELECT id FROM bookings
       WHERE staging_contract_id = $1 AND date = $2 AND is_current = true AND is_contract = true
       LIMIT 1`,
      [stagingContractId, date]
    );
    if (existing.length > 0) return db.getBookingById(existing[0].id);

    // Clone metadata from any existing booking in this contract
    const ref = await (sql as any)(
      `SELECT society_service_id, household_id, maid_id, start_time, end_time,
              price_at_booking, custom_description, frequency
       FROM bookings
       WHERE staging_contract_id = $1 AND is_contract = true
       LIMIT 1`,
      [stagingContractId]
    );
    if (ref.length === 0) return null;
    const r = ref[0];
    const newId = generateId('bk');
    await (sql as any)(
      `INSERT INTO bookings (
        id, society_service_id, household_id, maid_id, date, start_time, end_time,
        status, is_recurring, frequency, is_contract, staging_contract_id,
        price_at_booking, custom_description, active, is_current, valid_from
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'CONFIRMED',true,$8,true,$9,$10,$11,true,true,NOW())`,
      [
        newId, r.society_service_id, r.household_id, r.maid_id, date,
        r.start_time, r.end_time, r.frequency, stagingContractId,
        r.price_at_booking, r.custom_description,
      ]
    );
    return db.getBookingById(newId);
  },
};
