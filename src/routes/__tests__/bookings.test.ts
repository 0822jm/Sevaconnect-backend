import request from 'supertest';
import { app } from '../../app';
import { db, BookingStatus, UserRole } from '../../services/database';
import { generateToken } from '../../middleware/auth';

jest.mock('../../services/database');

const authHeader = `Bearer ${generateToken({ userId: 'household-1', role: 'HOUSEHOLD' })}`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/bookings', () => {
  // Fixed future date/time well within working hours so ADHOC time-validation passes
  // unless a test deliberately picks an invalid time.
  const validBody = {
    bookingType: 'ADHOC',
    householdId: 'household-1',
    maidId: 'maid-1',
    societyServiceIds: ['ss-1'],
    workStartDate: '2099-01-01',
    startTime: '10:00',
    endTime: '11:00',
  };

  it('rejects requests without an auth token', async () => {
    const res = await request(app).post('/api/bookings').send(validBody);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No token provided');
  });

  it('creates a booking on the happy path and returns 201 with the booking', async () => {
    (db.getUserById as jest.Mock).mockResolvedValue({ id: 'household-1', societyId: 'society-1' });
    (db.isMaidMemberOfSociety as jest.Mock).mockResolvedValue(true);
    (db.getMaidSkillsForSociety as jest.Mock).mockResolvedValue(['ss-1', 'ss-2']);
    const createdBooking = {
      id: 'booking-1',
      status: BookingStatus.CONFIRMED,
      workStartDate: '2099-01-01',
      startTime: '10:00',
    };
    (db.createBooking as jest.Mock).mockResolvedValue(createdBooking);

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(createdBooking);
    expect(db.createBooking).toHaveBeenCalledWith(validBody);
    expect(db.isMaidMemberOfSociety).toHaveBeenCalledWith('maid-1', 'society-1');
    expect(db.getMaidSkillsForSociety).toHaveBeenCalledWith('maid-1', 'society-1');
  });

  it('sends a push notification to the maid when the created booking requires manual acceptance', async () => {
    (db.getUserById as jest.Mock).mockResolvedValue({ id: 'household-1', societyId: 'society-1' });
    (db.isMaidMemberOfSociety as jest.Mock).mockResolvedValue(true);
    (db.getMaidSkillsForSociety as jest.Mock).mockResolvedValue([]);
    (db.createBooking as jest.Mock).mockResolvedValue({
      id: 'booking-2',
      status: BookingStatus.REQUESTED,
      workStartDate: '2099-01-01',
      startTime: '10:00',
    });
    (db.getUserPushToken as jest.Mock).mockResolvedValue('push-token-abc');

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(db.getUserPushToken).toHaveBeenCalledWith('maid-1');
  });

  it('returns 400 when start time is outside the 7am-9pm working window', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ ...validBody, startTime: '22:00', endTime: '23:00' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Start time must be between 7:00 AM and 9:00 PM');
    expect(db.createBooking).not.toHaveBeenCalled();
  });

  it('returns 400 when booking duration is under 1 hour', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ ...validBody, startTime: '10:00', endTime: '10:30' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Minimum booking duration is 1 hour');
    expect(db.createBooking).not.toHaveBeenCalled();
  });

  it('returns 400 when the booking is less than 1 hour in the future', async () => {
    const almostNow = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now
    const pad = (n: number) => String(n).padStart(2, '0');
    const workStartDate = `${almostNow.getFullYear()}-${pad(almostNow.getMonth() + 1)}-${pad(almostNow.getDate())}`;
    const startTime = `${pad(almostNow.getHours())}:${pad(almostNow.getMinutes())}`;

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ ...validBody, workStartDate, startTime, endTime: '23:59' });

    expect(res.status).toBe(400);
    expect(db.createBooking).not.toHaveBeenCalled();
  });

  it('returns 400 when the household is not assigned to a society', async () => {
    (db.getUserById as jest.Mock).mockResolvedValue({ id: 'household-1', societyId: null });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Household is not assigned to a society');
    expect(db.createBooking).not.toHaveBeenCalled();
  });

  it('returns 400 when the maid does not serve the household society', async () => {
    (db.getUserById as jest.Mock).mockResolvedValue({ id: 'household-1', societyId: 'society-1' });
    (db.isMaidMemberOfSociety as jest.Mock).mockResolvedValue(false);

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Maid does not serve this society');
    expect(db.createBooking).not.toHaveBeenCalled();
  });

  it('returns 400 when the maid is not skilled in the selected services', async () => {
    (db.getUserById as jest.Mock).mockResolvedValue({ id: 'household-1', societyId: 'society-1' });
    (db.isMaidMemberOfSociety as jest.Mock).mockResolvedValue(true);
    (db.getMaidSkillsForSociety as jest.Mock).mockResolvedValue(['ss-other']);

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Maid not skilled in selected services');
    expect(db.createBooking).not.toHaveBeenCalled();
  });

  it('skips skill/society validation for CONTRACT bookings', async () => {
    (db.createBooking as jest.Mock).mockResolvedValue({
      id: 'booking-3',
      status: BookingStatus.CONFIRMED,
      workStartDate: '2099-01-01',
      startTime: '10:00',
    });

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send({ bookingType: 'CONTRACT', householdId: 'household-1', maidId: 'maid-1' });

    expect(res.status).toBe(201);
    expect(db.getUserById).not.toHaveBeenCalled();
    expect(db.isMaidMemberOfSociety).not.toHaveBeenCalled();
  });

  it('returns 500 when db.createBooking throws', async () => {
    (db.getUserById as jest.Mock).mockResolvedValue({ id: 'household-1', societyId: 'society-1' });
    (db.isMaidMemberOfSociety as jest.Mock).mockResolvedValue(true);
    (db.getMaidSkillsForSociety as jest.Mock).mockResolvedValue([]);
    (db.createBooking as jest.Mock).mockRejectedValue(new Error('db unavailable'));

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', authHeader)
      .send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('db unavailable');
  });
});

describe('GET /api/bookings/user/:userId', () => {
  it('rejects requests without an auth token', async () => {
    const res = await request(app).get('/api/bookings/user/household-1?role=HOUSEHOLD');
    expect(res.status).toBe(401);
  });

  it('returns 400 when role query param is missing', async () => {
    const res = await request(app)
      .get('/api/bookings/user/household-1')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('role query param required (MAID or HOUSEHOLD)');
  });

  it('sweeps stale bookings then returns bookings for the user', async () => {
    (db.maybeSweepStaleBookings as jest.Mock).mockResolvedValue(undefined);
    const bookings = [{ id: 'b1' }, { id: 'b2' }];
    (db.getBookingsForUser as jest.Mock).mockResolvedValue(bookings);

    const res = await request(app)
      .get('/api/bookings/user/household-1?role=HOUSEHOLD')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(bookings);
    expect(db.maybeSweepStaleBookings).toHaveBeenCalled();
    expect(db.getBookingsForUser).toHaveBeenCalledWith('household-1', 'HOUSEHOLD');
  });

  it('returns 500 when db throws', async () => {
    (db.maybeSweepStaleBookings as jest.Mock).mockResolvedValue(undefined);
    (db.getBookingsForUser as jest.Mock).mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .get('/api/bookings/user/household-1?role=HOUSEHOLD')
      .set('Authorization', authHeader);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});
