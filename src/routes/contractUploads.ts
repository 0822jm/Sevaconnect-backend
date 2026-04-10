import { Router, Request, Response } from 'express';
import multer from 'multer';
import csv from 'csv-parser';
import { Readable } from 'stream';
import crypto from 'crypto';
import { db, UserRole, BookingStatus } from '../services/database';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// 5 MB in-memory storage only
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const generateId = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID().split('-')[0]}-${Date.now().toString(36)}`;

// Validate a single CSV row's format; returns error string or null
function validateRowFormat(row: Record<string, string>, rowNum: number): string | null {
  const required = ['household_phone', 'maid_phone', 'frequency', 'start_time', 'end_time', 'start_date', 'monthly_contract_fee'];
  for (const field of required) {
    if (!row[field] || row[field].trim() === '') {
      return `Row ${rowNum}: missing required field "${field}"`;
    }
  }

  // Validate frequency
  const freq = row.frequency.trim().toUpperCase();
  const validDays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const freqParts = freq.split(',').map(s => s.trim());
  const isDaily = freqParts.length === 1 && freqParts[0] === 'DAILY';
  const isDayList = freqParts.every(p => validDays.includes(p));
  if (!isDaily && !isDayList) {
    return `Row ${rowNum}: invalid frequency "${row.frequency}". Use DAILY or comma-separated days e.g. MON,WED,FRI`;
  }

  // Validate time format HH:MM
  const timeRe = /^\d{2}:\d{2}$/;
  if (!timeRe.test(row.start_time.trim())) {
    return `Row ${rowNum}: invalid start_time "${row.start_time}". Expected HH:MM`;
  }
  if (!timeRe.test(row.end_time.trim())) {
    return `Row ${rowNum}: invalid end_time "${row.end_time}". Expected HH:MM`;
  }

  // Validate start_date format YYYY-MM-DD
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(row.start_date.trim())) {
    return `Row ${rowNum}: invalid start_date "${row.start_date}". Expected YYYY-MM-DD`;
  }

  // Validate monthly_contract_fee is a positive number
  const fee = Number(row.monthly_contract_fee);
  if (isNaN(fee) || fee <= 0) {
    return `Row ${rowNum}: monthly_contract_fee must be a positive number, got "${row.monthly_contract_fee}"`;
  }

  // Validate phone numbers are 10 digits
  const phoneRe = /^\d{10}$/;
  if (!phoneRe.test(row.household_phone.trim())) {
    return `Row ${rowNum}: household_phone must be a 10-digit number, got "${row.household_phone}"`;
  }
  if (!phoneRe.test(row.maid_phone.trim())) {
    return `Row ${rowNum}: maid_phone must be a 10-digit number, got "${row.maid_phone}"`;
  }

  return null;
}

// Parse CSV buffer → array of row objects
function parseCsvBuffer(buffer: Buffer): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    const results: Record<string, string>[] = [];
    const stream = Readable.from(buffer.toString());
    stream
      .pipe(csv({ mapHeaders: ({ header }) => header.trim().toLowerCase().replace(/\s+/g, '_') }))
      .on('data', (data: Record<string, string>) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

// POST /api/contract-uploads — SYS_ADMIN only
router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  try {
    // Auth check — SYS_ADMIN only
    const authUser = (req as any).user;
    if (!authUser || authUser.role !== UserRole.SYS_ADMIN) {
      res.status(403).json({ error: 'SYS_ADMIN access required' });
      return;
    }
    const authUserId = authUser.userId;

    if (!req.file) {
      res.status(400).json({ error: 'No CSV file uploaded. Field name must be "file".' });
      return;
    }

    const fileName = req.file.originalname;
    const uploadId = generateId('upl');

    // Parse CSV
    let rows: Record<string, string>[];
    try {
      rows = await parseCsvBuffer(req.file.buffer);
    } catch (e: any) {
      res.status(400).json({ error: `Failed to parse CSV: ${e.message}` });
      return;
    }

    if (rows.length === 0) {
      res.status(400).json({ error: 'CSV file is empty or has no data rows.' });
      return;
    }

    // ── Phase 1: All-or-nothing format validation ────────────────────────────
    const formatErrors: string[] = [];
    rows.forEach((row, idx) => {
      const err = validateRowFormat(row, idx + 1);
      if (err) formatErrors.push(err);
    });

    if (formatErrors.length > 0) {
      res.status(400).json({
        error: 'CSV validation failed. No records were imported.',
        validationErrors: formatErrors,
      });
      return;
    }

    // ── Phase 2: Business validation — resolve users, check society ──────────
    // We collect all errors first; if ANY row fails, entire upload is rejected.
    const businessErrors: string[] = [];
    type ResolvedRow = {
      row: Record<string, string>;
      householdUser: any;
      maidUser: any;
      societyId: string;
    };
    const resolved: ResolvedRow[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;

      // Resolve household
      const householdRows = await (db as any).getUserByPhone(row.household_phone.trim()).catch(() => null);
      let householdUser = householdRows;
      if (!householdUser) {
        businessErrors.push(`Row ${rowNum}: household phone ${row.household_phone} not found`);
        continue;
      }
      if (householdUser.role !== UserRole.HOUSEHOLD) {
        businessErrors.push(`Row ${rowNum}: user with phone ${row.household_phone} is not a HOUSEHOLD (role: ${householdUser.role})`);
        continue;
      }
      if (!householdUser.societyId) {
        businessErrors.push(`Row ${rowNum}: household ${row.household_phone} is not assigned to a society`);
        continue;
      }

      // Resolve maid
      const maidUser = await (db as any).getUserByPhone(row.maid_phone.trim()).catch(() => null);
      if (!maidUser) {
        businessErrors.push(`Row ${rowNum}: maid phone ${row.maid_phone} not found`);
        continue;
      }
      if (maidUser.role !== UserRole.MAID) {
        businessErrors.push(`Row ${rowNum}: user with phone ${row.maid_phone} is not a MAID (role: ${maidUser.role})`);
        continue;
      }

      // Same society check
      if (maidUser.societyId && maidUser.societyId !== householdUser.societyId) {
        businessErrors.push(`Row ${rowNum}: maid and household belong to different societies`);
        continue;
      }

      resolved.push({ row, householdUser, maidUser, societyId: householdUser.societyId });
    }

    // If any business validation errors → reject entire batch
    if (businessErrors.length > 0) {
      res.status(400).json({
        error: 'Business validation failed. No records were imported.',
        validationErrors: businessErrors,
      });
      return;
    }

    // ── Phase 3: All rows valid — insert staging + bookings ──────────────────
    const createdBookingIds: string[] = [];
    let successCount = 0;

    for (const { row, householdUser, maidUser, societyId } of resolved) {
      const stagingId = generateId('sc');
      const freq = row.frequency.trim().toUpperCase();

      // Insert staging_contract row
      await db.createStagingContract({
        id: stagingId,
        uploadId,
        uploadUser: authUserId,
        fileName,
        householdPhone: row.household_phone.trim(),
        maidPhone: row.maid_phone.trim(),
        jobDescription: row.job_description?.trim() || undefined,
        frequency: freq,
        startTime: row.start_time.trim(),
        endTime: row.end_time.trim(),
        startDate: row.start_date.trim(),
        monthlyContractFee: Number(row.monthly_contract_fee),
        status: 'SUCCESS',
        householdId: householdUser.id,
        maidId: maidUser.id,
        societyId,
      });

      // Find or create the Contract society_service for this society
      const societyServiceId = await db.findOrCreateContractSocietyService(societyId);

      // Parse frequency → list of (date, startTime, endTime) bookings
      // For DAILY → single booking on start_date
      // For MON,WED,FRI → one booking per matching day in the first 7 days from start_date
      const bookingDates: string[] = [];
      if (freq === 'DAILY') {
        bookingDates.push(row.start_date.trim());
      } else {
        const dayMap: Record<string, number> = {
          SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
        };
        const targetDays = freq.split(',').map(d => dayMap[d.trim()]).filter(d => d !== undefined);
        const startDt = new Date(row.start_date.trim());
        // Collect next occurrence of each target day within the next 7 days
        for (let offset = 0; offset < 7; offset++) {
          const d = new Date(startDt);
          d.setDate(startDt.getDate() + offset);
          if (targetDays.includes(d.getDay())) {
            bookingDates.push(d.toISOString().split('T')[0]);
          }
        }
      }

      for (const bookingDate of bookingDates) {
        const bk = await db.createBooking({
          societyServiceId,
          householdId: householdUser.id,
          maidId: maidUser.id,
          date: bookingDate,
          startTime: row.start_time.trim(),
          endTime: row.end_time.trim(),
          isRecurring: true,
          frequency: freq,
          priceAtBooking: Number(row.monthly_contract_fee),
          customDescription: row.job_description?.trim() || null,
          isContract: true,
          active: true,
          effStartDate: row.start_date.trim(),
          stagingContractId: stagingId,
        });
        createdBookingIds.push(bk.id);
      }

      successCount++;
    }

    // Insert audit record
    await db.createContractUpload({
      id: uploadId,
      uploadedBy: authUserId,
      fileName,
      totalRows: rows.length,
      successCount,
      failureCount: 0,
      errors: [],
      createdBookings: createdBookingIds,
    });

    res.status(201).json({
      uploadId,
      totalRows: rows.length,
      successCount,
      failureCount: 0,
      createdBookings: createdBookingIds.length,
    });
  } catch (e: any) {
    console.error('[ContractUpload] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/contract-uploads — SYS_ADMIN only
router.get('/', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).user;
    if (!authUser || authUser.role !== UserRole.SYS_ADMIN) {
      res.status(403).json({ error: 'SYS_ADMIN access required' });
      return;
    }
    const uploads = await db.getContractUploads();
    res.json(uploads);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
