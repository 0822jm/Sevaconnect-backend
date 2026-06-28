import request from 'supertest';
import { app } from '../../app';
import { db, UserRole } from '../../services/database';
import { generateToken } from '../../middleware/auth';

jest.mock('../../services/database');

const sysAdminToken = generateToken({ userId: 'sysadmin-1', role: UserRole.SYS_ADMIN });
const sysAdminAuthHeader = `Bearer ${sysAdminToken}`;

const householdToken = generateToken({ userId: 'household-1', role: UserRole.HOUSEHOLD });
const householdAuthHeader = `Bearer ${householdToken}`;

const CSV_HEADER = 'household_phone,maid_phone,frequency,start_time,end_time,start_date,monthly_contract_fee';

const validRow = '9876543210,9123456780,DAILY,09:00,11:00,2025-02-01,3000';

const householdUser = { id: 'house-1', role: UserRole.HOUSEHOLD, societyId: 'soc-1' };
const maidUser = { id: 'maid-1', role: UserRole.MAID, societyId: 'soc-1' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('auth requirement', () => {
  it('returns 401 with no token on POST', async () => {
    const res = await request(app)
      .post('/api/contract-uploads')
      .attach('file', Buffer.from(`${CSV_HEADER}\n${validRow}`), 'contracts.csv');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No token provided');
  });

  it('returns 401 with no token on GET', async () => {
    const res = await request(app).get('/api/contract-uploads');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No token provided');
  });

  it('returns 401 with an invalid token', async () => {
    const res = await request(app)
      .get('/api/contract-uploads')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired token');
  });
});

describe('POST /api/contract-uploads', () => {
  it('returns 403 when authenticated user is not SYS_ADMIN', async () => {
    const res = await request(app)
      .post('/api/contract-uploads')
      .set('Authorization', householdAuthHeader)
      .attach('file', Buffer.from(`${CSV_HEADER}\n${validRow}`), 'contracts.csv');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('SYS_ADMIN access required');
  });

  it('returns 400 when no file is uploaded', async () => {
    const res = await request(app)
      .post('/api/contract-uploads')
      .set('Authorization', sysAdminAuthHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No CSV file uploaded. Field name must be "file".');
  });

  it('returns 400 when CSV has no data rows', async () => {
    const res = await request(app)
      .post('/api/contract-uploads')
      .set('Authorization', sysAdminAuthHeader)
      .attach('file', Buffer.from(`${CSV_HEADER}\n`), 'empty.csv');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CSV file is empty or has no data rows.');
  });

  it('returns 400 with format validation errors when a required field is missing', async () => {
    const badRow = '9876543210,9123456780,DAILY,09:00,11:00,2025-02-01,'; // missing fee
    const res = await request(app)
      .post('/api/contract-uploads')
      .set('Authorization', sysAdminAuthHeader)
      .attach('file', Buffer.from(`${CSV_HEADER}\n${badRow}`), 'contracts.csv');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CSV validation failed. No records were imported.');
    expect(res.body.validationErrors).toEqual([
      'Row 1: missing required field "monthly_contract_fee"',
    ]);
  });

  it('returns 400 with format validation error for invalid frequency', async () => {
    const badRow = '9876543210,9123456780,SOMEDAY,09:00,11:00,2025-02-01,3000';
    const res = await request(app)
      .post('/api/contract-uploads')
      .set('Authorization', sysAdminAuthHeader)
      .attach('file', Buffer.from(`${CSV_HEADER}\n${badRow}`), 'contracts.csv');
    expect(res.status).toBe(400);
    expect(res.body.validationErrors).toEqual([
      'Row 1: invalid frequency "SOMEDAY". Use DAILY or comma-separated days e.g. MON,WED,FRI',
    ]);
  });

  it('returns 400 with format validation error for invalid phone number', async () => {
    const badRow = '987654,9123456780,DAILY,09:00,11:00,2025-02-01,3000';
    const res = await request(app)
      .post('/api/contract-uploads')
      .set('Authorization', sysAdminAuthHeader)
      .attach('file', Buffer.from(`${CSV_HEADER}\n${badRow}`), 'contracts.csv');
    expect(res.status).toBe(400);
    expect(res.body.validationErrors).toEqual([
      'Row 1: household_phone must be a 10-digit number, got "987654"',
    ]);
  });

  it('returns 400 with business validation error when household phone not found', async () => {
    (db as any).getUserByPhone = jest.fn().mockResolvedValue(null);
    const res = await request(app)
      .post('/api/contract-uploads')
      .set('Authorization', sysAdminAuthHeader)
      .attach('file', Buffer.from(`${CSV_HEADER}\n${validRow}`), 'contracts.csv');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Business validation failed. No records were imported.');
    expect(res.body.validationErrors).toEqual([
      'Row 1: household phone 9876543210 not found',
    ]);
  });

  it('returns 400 with business validation error when maid and household are in different societies', async () => {
    (db as any).getUserByPhone = jest
      .fn()
      .mockResolvedValueOnce(householdUser)
      .mockResolvedValueOnce({ ...maidUser, societyId: 'soc-2' });
    const res = await request(app)
      .post('/api/contract-uploads')
      .set('Authorization', sysAdminAuthHeader)
      .attach('file', Buffer.from(`${CSV_HEADER}\n${validRow}`), 'contracts.csv');
    expect(res.status).toBe(400);
    expect(res.body.validationErrors).toEqual([
      'Row 1: maid and household belong to different societies',
    ]);
  });

  it('creates staging contract and booking, returns 201 on success', async () => {
    (db as any).getUserByPhone = jest
      .fn()
      .mockResolvedValueOnce(householdUser)
      .mockResolvedValueOnce(maidUser);
    (db.createStagingContract as jest.Mock).mockResolvedValue(undefined);
    (db.findOrCreateContractSocietyService as jest.Mock).mockResolvedValue('ss-1');
    (db.createBooking as jest.Mock).mockResolvedValue({ id: 'bk-1' });
    (db.createContractUpload as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/contract-uploads')
      .set('Authorization', sysAdminAuthHeader)
      .attach('file', Buffer.from(`${CSV_HEADER}\n${validRow}`), 'contracts.csv');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      uploadId: expect.stringMatching(/^upl-/),
      totalRows: 1,
      successCount: 1,
      failureCount: 0,
      createdBookings: 1,
    });
    expect(db.createStagingContract).toHaveBeenCalledWith(
      expect.objectContaining({
        householdPhone: '9876543210',
        maidPhone: '9123456780',
        frequency: 'DAILY',
        startTime: '09:00',
        endTime: '11:00',
        startDate: '2025-02-01',
        monthlyContractFee: 3000,
        status: 'SUCCESS',
        householdId: 'house-1',
        maidId: 'maid-1',
        societyId: 'soc-1',
      })
    );
    expect(db.findOrCreateContractSocietyService).toHaveBeenCalledWith('soc-1');
    expect(db.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingType: 'CONTRACT',
        societyServiceId: 'ss-1',
        householdId: 'house-1',
        maidId: 'maid-1',
        workStartDate: '2025-02-01',
        workEndDate: '3499-12-31',
        startTime: '09:00',
        endTime: '11:00',
        isRecurring: true,
        frequency: 'DAILY',
        priceAtBooking: 3000,
        status: 'CONFIRMED',
      })
    );
    expect(db.createContractUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadedBy: 'sysadmin-1',
        fileName: 'contracts.csv',
        totalRows: 1,
        successCount: 1,
        failureCount: 0,
        createdBookings: ['bk-1'],
      })
    );
  });

  it('returns 500 when db throws unexpectedly', async () => {
    (db as any).getUserByPhone = jest.fn().mockRejectedValue(new Error('should be caught by .catch'));
    (db.createStagingContract as jest.Mock).mockRejectedValue(new Error('staging insert fail'));
    (db as any).getUserByPhone = jest
      .fn()
      .mockResolvedValueOnce(householdUser)
      .mockResolvedValueOnce(maidUser);

    const res = await request(app)
      .post('/api/contract-uploads')
      .set('Authorization', sysAdminAuthHeader)
      .attach('file', Buffer.from(`${CSV_HEADER}\n${validRow}`), 'contracts.csv');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('staging insert fail');
  });
});

describe('GET /api/contract-uploads', () => {
  it('returns 403 when authenticated user is not SYS_ADMIN', async () => {
    const res = await request(app)
      .get('/api/contract-uploads')
      .set('Authorization', householdAuthHeader);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('SYS_ADMIN access required');
  });

  it('returns the list of uploads for SYS_ADMIN', async () => {
    const uploads = [{ id: 'upl-1', fileName: 'contracts.csv' }];
    (db.getContractUploads as jest.Mock).mockResolvedValue(uploads);
    const res = await request(app)
      .get('/api/contract-uploads')
      .set('Authorization', sysAdminAuthHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(uploads);
  });

  it('returns 500 when db throws', async () => {
    (db.getContractUploads as jest.Mock).mockRejectedValue(new Error('list fail'));
    const res = await request(app)
      .get('/api/contract-uploads')
      .set('Authorization', sysAdminAuthHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('list fail');
  });
});
