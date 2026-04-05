import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import csvParser from 'csv-parser';
import { Readable } from 'stream';
import crypto from 'crypto';
import { db } from '../services/database';
import { authMiddleware } from '../middleware/auth';

const router = Router();

const generateId = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID().split('-')[0]}-${Date.now().toString(36)}`;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Require authentication + SYS_ADMIN role for all routes
router.use(authMiddleware);
router.use((req: Request, res: Response, next: NextFunction): void => {
  if (req.user?.role !== 'SYS_ADMIN') {
    res.status(403).json({ error: 'Forbidden: SYS_ADMIN only' });
    return;
  }
  next();
});

// Parse CSV buffer into array of row objects
function parseCsvBuffer(buffer: Buffer): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const rows: any[] = [];
    const stream = Readable.from(buffer);
    stream
      .pipe(csvParser())
      .on('data', (row: any) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

// Given a frequency string and start_date, return booking slots
// DAILY  → [{ date: start_date, isRecurring: true, frequency: 'Daily' }]
// MON,WED → [{ date: next Mon on/after start_date, ... }, { date: next Wed, ... }]
function parseFrequency(
  frequency: string,
  startDate: string
): Array<{ date: string; isRecurring: boolean; frequency: string; customFrequencyDays?: string }> {
  const DAY_MAP: Record<string, number> = {
    SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
  };

  if (frequency.trim().toUpperCase() === 'DAILY') {
    return [{ date: startDate, isRecurring: true, frequency: 'Daily' }];
  }

  const days = frequency.split(',').map((d) => d.trim().toUpperCase());
  const base = new Date(startDate + 'T00:00:00Z');

  return days.map((day) => {
    const targetDow = DAY_MAP[day];
    if (targetDow === undefined) throw new Error(`Unknown day: ${day}`);
    const d = new Date(base);
    const diff = (targetDow - d.getUTCDay() + 7) % 7;
    d.setUTCDate(d.getUTCDate() + diff);
    const dateStr = d.toISOString().split('T')[0];
    return { date: dateStr, isRecurring: true, frequency: 'Weekly', customFrequencyDays: day };
  });
}

function calculateEndTime(startTime: string, durationMinutes: number): string {
  const [h, m] = startTime.split(':').map(Number);
  const totalMinutes = h * 60 + m + durationMinutes;
  const endH = Math.floor(totalMinutes / 60) % 24;
  const endM = totalMinutes % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

// POST /api/contract-uploads
router.post('/', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const uploadId = generateId('cu');
  const fileName = req.file.originalname;
  const uploadedBy = req.user!.userId;

  let rows: any[];
  try {
    rows = await parseCsvBuffer(req.file.buffer);
  } catch (e: any) {
    res.status(400).json({ error: 'Failed to parse CSV: ' + e.message });
    return;
  }

  const errors: Array<{ row: number; error: string }> = [];
  const createdBookings: string[] = [];
  const societyIdsSet = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;

    try {
      const { household_phone, maid_phone, service_name, frequency, start_time, start_date } = row;

      if (!household_phone || !maid_phone || !service_name || !frequency || !start_time || !start_date) {
        throw new Error('Missing required column(s)');
      }

      // 1. Look up household
      const household = await db.getUserByPhone(household_phone.trim());
      if (!household) throw new Error(`Household not found: ${household_phone}`);
      if (household.role !== 'HOUSEHOLD') throw new Error(`User ${household_phone} is not a HOUSEHOLD`);

      // 2. Look up maid
      const maid = await db.getUserByPhone(maid_phone.trim());
      if (!maid) throw new Error(`Maid not found: ${maid_phone}`);
      if (maid.role !== 'MAID') throw new Error(`User ${maid_phone} is not a MAID`);
      if (maid.societyId !== household.societyId) {
        throw new Error(`Maid and Household are in different societies`);
      }

      const societyId = household.societyId!;
      societyIdsSet.add(societyId);

      // 3. Look up society service by English name
      const service = await db.getSocietyServiceByName(societyId, service_name.trim());
      if (!service) throw new Error(`Service not found in society: ${service_name}`);

      // 4. Calculate end time
      const endTime = calculateEndTime(start_time.trim(), service.durationMinutes);

      // 5. Parse frequency into booking slots
      const slots = parseFrequency(frequency.trim(), start_date.trim());

      // 6. Create one booking per slot
      for (const slot of slots) {
        const booking = await db.createBooking({
          serviceId: service.serviceId,
          societyServiceId: service.id,
          householdId: household.id,
          maidId: maid.id,
          date: slot.date,
          startTime: start_time.trim(),
          endTime,
          isRecurring: slot.isRecurring,
          frequency: slot.frequency,
          customFrequencyDays: slot.customFrequencyDays,
          priceAtBooking: service.effectivePrice,
        });
        createdBookings.push(booking.id);
      }
    } catch (e: any) {
      errors.push({ row: rowNum, error: e.message });
    }
  }

  const totalRows = rows.length;
  const failureCount = errors.length;
  const successCount = totalRows - failureCount;

  await db.createContractUpload({
    id: uploadId,
    uploadedBy,
    fileName,
    societyIds: Array.from(societyIdsSet),
    status: 'DONE',
    totalRows,
    successCount,
    failureCount,
    errors,
    createdBookings,
  });

  res.status(201).json({
    id: uploadId,
    totalRows,
    successCount,
    failureCount,
    errors,
    createdBookings,
  });
});

// GET /api/contract-uploads
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const uploads = await db.getContractUploads();
    res.json(uploads);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
