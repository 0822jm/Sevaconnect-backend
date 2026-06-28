import request from 'supertest';
import { app } from '../../app';
import { db, BookingStatus, UserRole } from '../../services/database';
import { generateToken } from '../../middleware/auth';
import { sendPushNotification } from '../../services/pushNotifications';

jest.mock('../../services/database');
jest.mock('../../services/pushNotifications');

const authHeader = `Bearer ${generateToken({ userId: 'household-1', role: 'HOUSEHOLD' })}`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/bookings/contracts', () => {
  it('rejects requests without an auth token', async () => {
    const res = await request(app).get('/api/bookings/contracts?userId=u1&role=HOUSEHOLD');
    expect(res.status).toBe(401);
  });

  it('returns 400 when userId or role missing', async () => {
    const res = await request(app)
      .get('/api/bookings/contracts?userId=u1')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('userId and role query params required');
  });

  it('returns contracts for the user on the happy path', async () => {
    const contracts = [{ id: 'c1' }];
    (db.getContractsForUser as jest.Mock).mockResolvedValue(contracts);

    const res = await request(app)
      .get('/api/bookings/contracts?userId=household-1&role=HOUSEHOLD')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(contracts);
    expect(db.getContractsForUser).toHaveBeenCalledWith('household-1', 'HOUSEHOLD');
  });

  it('returns 500 when db throws', async () => {
    (db.getContractsForUser as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .get('/api/bookings/contracts?userId=household-1&role=HOUSEHOLD')
      .set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});

describe('POST /api/bookings/contract-leave-exception', () => {
  it('returns 400 when contractId or date missing', async () => {
    const res = await request(app)
      .post('/api/bookings/contract-leave-exception')
      .set('Authorization', authHeader)
      .send({ contractId: 'c1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('contractId and date are required');
  });

  it('returns 404 when contract not found', async () => {
    (db.createLeaveExceptionBooking as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .post('/api/bookings/contract-leave-exception')
      .set('Authorization', authHeader)
      .send({ contractId: 'c1', date: '2099-01-01' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Contract not found');
  });

  it('creates replacement and notifies household on the happy path', async () => {
    (db.createLeaveExceptionBooking as jest.Mock).mockResolvedValue({ id: 'rep-1' });
    (db.getNotificationInfoForBooking as jest.Mock).mockResolvedValue({
      householdPushToken: 'push-1',
      maidName: 'Maid A',
      serviceName: 'Cleaning',
    });

    const res = await request(app)
      .post('/api/bookings/contract-leave-exception')
      .set('Authorization', authHeader)
      .send({ contractId: 'c1', date: '2099-01-01', leaveType: 'FULL' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, replacementId: 'rep-1' });
    expect(db.createLeaveExceptionBooking).toHaveBeenCalledWith('c1', '2099-01-01');
    expect(sendPushNotification).toHaveBeenCalledWith(
      'push-1',
      'Contract – Replacement Needed',
      expect.stringContaining('Maid A'),
    );
  });

  it('skips notification when household has no push token', async () => {
    (db.createLeaveExceptionBooking as jest.Mock).mockResolvedValue({ id: 'rep-1' });
    (db.getNotificationInfoForBooking as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .post('/api/bookings/contract-leave-exception')
      .set('Authorization', authHeader)
      .send({ contractId: 'c1', date: '2099-01-01' });

    expect(res.status).toBe(200);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it('returns 500 when db throws', async () => {
    (db.createLeaveExceptionBooking as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .post('/api/bookings/contract-leave-exception')
      .set('Authorization', authHeader)
      .send({ contractId: 'c1', date: '2099-01-01' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});

describe('GET /api/bookings/contracts/check-conflict', () => {
  const baseQuery = 'maidId=maid-1&frequency=MON,WED&startTime=10:00&endTime=11:00';

  it('returns 400 when required params missing', async () => {
    const res = await request(app)
      .get('/api/bookings/contracts/check-conflict?maidId=maid-1')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('maidId, frequency, startTime, endTime are required');
  });

  it('returns hasConflict=false when no active contracts overlap', async () => {
    (db.getActiveContractsForMaid as jest.Mock).mockResolvedValue([
      { id: 'c1', frequency: 'TUE,THU', startTime: '09:00', endTime: '10:00' },
    ]);
    const res = await request(app)
      .get(`/api/bookings/contracts/check-conflict?${baseQuery}`)
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasConflict: false });
  });

  it('returns hasConflict=true when days and time overlap', async () => {
    (db.getActiveContractsForMaid as jest.Mock).mockResolvedValue([
      { id: 'c1', frequency: 'MON,FRI', startTime: '10:30', endTime: '12:00' },
    ]);
    const res = await request(app)
      .get(`/api/bookings/contracts/check-conflict?${baseQuery}`)
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasConflict: true });
  });

  it('treats DAILY frequency as always conflicting on day-overlap check', async () => {
    (db.getActiveContractsForMaid as jest.Mock).mockResolvedValue([
      { id: 'c1', frequency: 'DAILY', startTime: '10:30', endTime: '12:00' },
    ]);
    const res = await request(app)
      .get(`/api/bookings/contracts/check-conflict?${baseQuery}`)
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasConflict: true });
  });

  it('returns 500 when db throws', async () => {
    (db.getActiveContractsForMaid as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .get(`/api/bookings/contracts/check-conflict?${baseQuery}`)
      .set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});

describe('POST /api/bookings/contracts/create', () => {
  const validBody = {
    householdId: 'household-1',
    maidId: 'maid-1',
    frequency: 'MON,WED',
    startTime: '10:00',
    endTime: '11:00',
    startDate: '2099-01-01',
    monthlyFee: 5000,
    jobDescription: 'Cleaning',
  };

  const mockHousehold = { id: 'household-1', role: UserRole.HOUSEHOLD, societyId: 'society-1', phone: '111', name: 'House A' };
  const mockMaid = { id: 'maid-1', role: UserRole.MAID, phone: '222', expo_push_token: 'push-maid' };

  it('returns 400 when required fields missing', async () => {
    const res = await request(app)
      .post('/api/bookings/contracts/create')
      .set('Authorization', authHeader)
      .send({ householdId: 'household-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('are required');
  });

  it('returns 400 when monthlyFee is not greater than 0', async () => {
    const res = await request(app)
      .post('/api/bookings/contracts/create')
      .set('Authorization', authHeader)
      .send({ ...validBody, monthlyFee: -100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('monthlyFee must be greater than 0');
  });

  it('returns 400 when household user is invalid', async () => {
    (db.getUserById as jest.Mock).mockImplementation((id: string) =>
      id === 'household-1' ? Promise.resolve({ id, role: UserRole.MAID }) : Promise.resolve(mockMaid),
    );
    const res = await request(app)
      .post('/api/bookings/contracts/create')
      .set('Authorization', authHeader)
      .send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid household user');
  });

  it('returns 400 when maid user is invalid', async () => {
    (db.getUserById as jest.Mock).mockImplementation((id: string) =>
      id === 'household-1' ? Promise.resolve(mockHousehold) : Promise.resolve({ id, role: UserRole.HOUSEHOLD }),
    );
    const res = await request(app)
      .post('/api/bookings/contracts/create')
      .set('Authorization', authHeader)
      .send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid maid user');
  });

  it('returns 400 when household has no society', async () => {
    (db.getUserById as jest.Mock).mockImplementation((id: string) =>
      id === 'household-1' ? Promise.resolve({ ...mockHousehold, societyId: null }) : Promise.resolve(mockMaid),
    );
    const res = await request(app)
      .post('/api/bookings/contracts/create')
      .set('Authorization', authHeader)
      .send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Household is not assigned to a society');
  });

  it('returns 400 when maid does not serve the society', async () => {
    (db.getUserById as jest.Mock).mockImplementation((id: string) =>
      id === 'household-1' ? Promise.resolve(mockHousehold) : Promise.resolve(mockMaid),
    );
    (db.isMaidMemberOfSociety as jest.Mock).mockResolvedValue(false);
    const res = await request(app)
      .post('/api/bookings/contracts/create')
      .set('Authorization', authHeader)
      .send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Maid does not serve this society');
  });

  it('returns 409 when there is a conflicting active contract', async () => {
    (db.getUserById as jest.Mock).mockImplementation((id: string) =>
      id === 'household-1' ? Promise.resolve(mockHousehold) : Promise.resolve(mockMaid),
    );
    (db.isMaidMemberOfSociety as jest.Mock).mockResolvedValue(true);
    (db.getActiveContractsForMaid as jest.Mock).mockResolvedValue([
      { id: 'c1', frequency: 'MON,FRI', startTime: '10:30', endTime: '12:00' },
    ]);

    const res = await request(app)
      .post('/api/bookings/contracts/create')
      .set('Authorization', authHeader)
      .send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(
      'This maid already has an active contract that conflicts with the selected time and days.',
    );
    expect(db.createBooking).not.toHaveBeenCalled();
  });

  it('creates a contract on the happy path and notifies the maid', async () => {
    (db.getUserById as jest.Mock).mockImplementation((id: string) =>
      id === 'household-1' ? Promise.resolve(mockHousehold) : Promise.resolve(mockMaid),
    );
    (db.isMaidMemberOfSociety as jest.Mock).mockResolvedValue(true);
    (db.getActiveContractsForMaid as jest.Mock).mockResolvedValue([]);
    (db.createStagingContract as jest.Mock).mockResolvedValue(undefined);
    (db.findOrCreateContractSocietyService as jest.Mock).mockResolvedValue('ss-contract-1');
    (db.createBooking as jest.Mock).mockResolvedValue({ id: 'booking-contract-1' });

    const res = await request(app)
      .post('/api/bookings/contracts/create')
      .set('Authorization', authHeader)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.contractId).toBe('booking-contract-1');
    expect(typeof res.body.stagingContractId).toBe('string');
    expect(db.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingType: 'CONTRACT',
        societyServiceId: 'ss-contract-1',
        householdId: 'household-1',
        maidId: 'maid-1',
        status: BookingStatus.CONFIRMED,
        priceAtBooking: 5000,
      }),
    );
    expect(sendPushNotification).toHaveBeenCalledWith(
      'push-maid',
      'New Contract',
      expect.stringContaining('House A'),
    );
  });

  it('returns 500 when db throws', async () => {
    (db.getUserById as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .post('/api/bookings/contracts/create')
      .set('Authorization', authHeader)
      .send(validBody);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});

describe('GET /api/bookings/society/:societyId', () => {
  it('sweeps stale bookings then returns bookings for the society', async () => {
    (db.maybeSweepStaleBookings as jest.Mock).mockResolvedValue(undefined);
    const bookings = [{ id: 'b1' }];
    (db.getBookingsBySociety as jest.Mock).mockResolvedValue(bookings);

    const res = await request(app)
      .get('/api/bookings/society/society-1')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(bookings);
    expect(db.maybeSweepStaleBookings).toHaveBeenCalled();
    expect(db.getBookingsBySociety).toHaveBeenCalledWith('society-1');
  });

  it('returns 500 when db throws', async () => {
    (db.maybeSweepStaleBookings as jest.Mock).mockResolvedValue(undefined);
    (db.getBookingsBySociety as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .get('/api/bookings/society/society-1')
      .set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});

describe('GET /api/bookings/replacements', () => {
  it('returns empty array when required query params missing', async () => {
    const res = await request(app)
      .get('/api/bookings/replacements')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(db.getReplacementsForDateRange).not.toHaveBeenCalled();
  });

  it('returns replacements on the happy path', async () => {
    const replacements = [{ id: 'r1' }];
    (db.getReplacementsForDateRange as jest.Mock).mockResolvedValue(replacements);

    const res = await request(app)
      .get('/api/bookings/replacements?contractIds=c1,c2&startDate=2099-01-01&endDate=2099-01-31')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(replacements);
    expect(db.getReplacementsForDateRange).toHaveBeenCalledWith(['c1', 'c2'], '2099-01-01', '2099-01-31');
  });

  it('returns 500 when db throws', async () => {
    (db.getReplacementsForDateRange as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .get('/api/bookings/replacements?contractIds=c1&startDate=2099-01-01&endDate=2099-01-31')
      .set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});

describe('PUT /api/bookings/contracts/:contractId', () => {
  it('returns 400 when startTime or endTime missing', async () => {
    const res = await request(app)
      .put('/api/bookings/contracts/c1')
      .set('Authorization', authHeader)
      .send({ startTime: '10:00' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('startTime and endTime are required');
  });

  it('returns 400 when startTime/endTime are not HH:MM format', async () => {
    const res = await request(app)
      .put('/api/bookings/contracts/c1')
      .set('Authorization', authHeader)
      .send({ startTime: '10am', endTime: '11:00' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('startTime and endTime must be in HH:MM format');
  });

  it('updates the contract and notifies the maid on the happy path', async () => {
    (db.updateContract as jest.Mock).mockResolvedValue(undefined);
    (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'c1', stagingContractId: 'sc-1' });
    (db.getMaidInfoForContract as jest.Mock).mockResolvedValue({
      maidPushToken: 'push-maid',
      householdName: 'House A',
    });

    const res = await request(app)
      .put('/api/bookings/contracts/c1')
      .set('Authorization', authHeader)
      .send({ startTime: '10:00', endTime: '11:00', startDate: '2099-02-01', monthlyFee: 6000 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.updateContract).toHaveBeenCalledWith('c1', {
      startTime: '10:00',
      endTime: '11:00',
      startDate: '2099-02-01',
      monthlyFee: 6000,
    });
  });

  it('returns 500 when db throws', async () => {
    (db.updateContract as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .put('/api/bookings/contracts/c1')
      .set('Authorization', authHeader)
      .send({ startTime: '10:00', endTime: '11:00' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});

describe('DELETE /api/bookings/contracts/:contractId', () => {
  it('returns 404 when contract not found', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .delete('/api/bookings/contracts/c1')
      .set('Authorization', authHeader);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Contract not found');
  });

  it('terminates and notifies household when cancelled by maid', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'c1', stagingContractId: 'sc-1' });
    (db.getNotificationInfoForBooking as jest.Mock).mockResolvedValue({
      householdPushToken: 'push-house',
      maidName: 'Maid A',
    });
    (db.terminateContract as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app)
      .delete('/api/bookings/contracts/c1?cancelledBy=MAID')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.terminateContract).toHaveBeenCalledWith('c1');
    expect(sendPushNotification).toHaveBeenCalledWith(
      'push-house',
      'Contract Terminated',
      expect.stringContaining('Maid A'),
    );
  });

  it('terminates and notifies maid when cancelled by household', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'c1', stagingContractId: 'sc-1' });
    (db.getMaidInfoForContract as jest.Mock).mockResolvedValue({
      maidPushToken: 'push-maid',
      householdName: 'House A',
    });
    (db.terminateContract as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app)
      .delete('/api/bookings/contracts/c1')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(db.terminateContract).toHaveBeenCalledWith('c1');
    expect(sendPushNotification).toHaveBeenCalledWith(
      'push-maid',
      'Contract Terminated',
      expect.stringContaining('House A'),
    );
  });

  it('returns 500 when db throws', async () => {
    (db.getBookingById as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .delete('/api/bookings/contracts/c1')
      .set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});
