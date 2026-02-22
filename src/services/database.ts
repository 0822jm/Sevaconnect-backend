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
        (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE maid_id = u.id) as computed_rating
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
        (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE maid_id = u.id) as computed_rating
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
        (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE maid_id = u.id) as computed_rating
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
    const todayStr = new Date().toISOString().split('T')[0];
    const userRows = await sql`SELECT role, is_verified FROM users WHERE society_id = ${societyId} AND role != 'SOCIETY_ADMIN'`;
    const bookingRows = await sql`
      SELECT COUNT(*) as count
      FROM bookings b
      JOIN users u ON b.household_id = u.id
      WHERE u.society_id = ${societyId}
      AND b.date = ${todayStr}
      AND b.status IN ('CONFIRMED', 'IN_PROGRESS')
    `;

    return {
      totalUsers: userRows.length,
      pendingVerifications: userRows.filter((u: any) => !u.is_verified).length,
      activeBookingsToday: Number(bookingRows[0].count),
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
      ORDER BY b.date DESC, b.start_time DESC`,
      [societyId]
    );
    return rows.map(mapBooking);
  },

  createBooking: async (booking: any): Promise<Booking> => {
    const id = generateId('bk');
    await sql`INSERT INTO bookings (
      id, society_service_id, household_id, maid_id, date, start_time, end_time, status,
      start_otp, end_otp, is_recurring, frequency, custom_frequency_days, is_reviewed,
      custom_price, custom_description, maid_requested_start, maid_requested_end, price_at_booking
    ) VALUES (
      ${id}, ${booking.societyServiceId}, ${booking.householdId}, ${booking.maidId},
      ${booking.date}, ${booking.startTime}, ${booking.endTime}, ${BookingStatus.REQUESTED},
      null, null, ${booking.isRecurring || false}, ${booking.frequency || null},
      ${booking.customFrequencyDays || null}, false,
      ${booking.customPrice || null}, ${booking.customDescription || null}, false, false,
      ${booking.priceAtBooking || null}
    )`;
    return { ...booking, id, status: BookingStatus.REQUESTED, isReviewed: false } as Booking;
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
};
