import request from 'supertest';
import { app } from '../../app';
import { db, BookingStatus, redactMatchingMaid, isMaidSlotConflict } from '../../services/database';
import { generateToken } from '../../middleware/auth';
import { sendLocalizedNotification } from '../../services/pushNotifications';
import { reassignAndNotify } from '../../services/anyMaidReassign';

jest.mock('../../services/database');
jest.mock('../../services/pushNotifications');
jest.mock('../../services/anyMaidReassign');

const authHeader = `Bearer ${generateToken({ userId: 'household-1', role: 'HOUSEHOLD' })}`;
const maidAuthHeader = `Bearer ${generateToken({ userId: 'm2', role: 'MAID' })}`;

const pad = (n: number) => String(n).padStart(2, '0');
const soonDate = (() => {
  const d = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
})();

const baseBody = {
  bookingType: 'ADHOC',
  householdId: 'household-1',
  societyServiceIds: ['ss-1'],
  workStartDate: soonDate,
  startTime: '10:00',
  endTime: '11:00',
  idempotencyKey: 'idem-1',
  preferredMaidId: 'pref-1',
};

const autoMaid = { id: 'm1', name: 'Asha', trustScore: 70, autoAccept: true, autoAcceptFrom: '08:00', autoAcceptTo: '20:00' };
const manualMaid = { id: 'm2', name: 'Bina', trustScore: 55, autoAccept: false, autoAcceptFrom: null, autoAcceptTo: null };

beforeEach(() => {
  jest.clearAllMocks();
  // The route imports two PURE helpers from the (auto-mocked) database module — restore real behaviour.
  (redactMatchingMaid as jest.Mock).mockImplementation((b: any) =>
    b?.anyMaidPool && b?.status === BookingStatus.REQUESTED ? { ...b, matching: true, maidName: undefined, maidId: '' } : b);
  (isMaidSlotConflict as jest.Mock).mockImplementation((e: any) => e?.code === '23P01');
  (db.getBookingByIdempotencyKey as jest.Mock).mockResolvedValue(null);
  (db.getUserById as jest.Mock).mockResolvedValue({ id: 'household-1', societyId: 'society-1' });
  (db.getNotificationInfoForBooking as jest.Mock).mockResolvedValue({
    householdPushToken: 'tok-h', householdPreferredLocale: 'en', householdName: 'Home', maidName: 'Asha', serviceName: 'Cleaning',
  });
  (db.getUserPushInfo as jest.Mock).mockResolvedValue({ pushToken: 'tok-m', preferredLocale: 'en' });
});

describe('POST /api/bookings/book-any-maid', () => {
  it('rejects requests without an auth token', async () => {
    const res = await request(app).post('/api/bookings/book-any-maid').send({ ...baseBody, poolType: 'AUTO_ACCEPT' });
    expect(res.status).toBe(401);
  });

  it('AUTO_ACCEPT pool → confirms instantly and pushes the household confirmation', async () => {
    (db.getAvailableMaidPool as jest.Mock).mockResolvedValue([autoMaid]);
    (db.assignAnyMaid as jest.Mock).mockResolvedValue({
      booking: { id: 'bk1', status: BookingStatus.CONFIRMED, anyMaidPool: 'AUTO_ACCEPT', workStartDate: soonDate, startTime: '10:00' },
      maidId: 'm1', maidName: 'Asha',
    });

    const res = await request(app)
      .post('/api/bookings/book-any-maid')
      .set('Authorization', authHeader)
      .send({ ...baseBody, poolType: 'AUTO_ACCEPT' });

    expect(res.status).toBe(201);
    // assignAnyMaid got the AUTO_ACCEPT sub-pool (the covering maid) and no client maidId leaked in.
    const call = (db.assignAnyMaid as jest.Mock).mock.calls[0][0];
    expect(call.poolType).toBe('AUTO_ACCEPT');
    expect(call.pool.map((m: any) => m.id)).toEqual(['m1']);
    expect(call.bookingParams.maidId).toBeUndefined();
    expect(call.idempotencyKey).toBe('idem-1');
    // Household gets the auto-accept confirmation.
    expect(sendLocalizedNotification).toHaveBeenCalledWith('tok-h', 'en', 'booking.requestSentAutoAccept', expect.anything(), expect.anything());
  });

  it('manual (ANY) pool → REQUESTED, pushes maid request + household "matching", and redacts the response', async () => {
    (db.getAvailableMaidPool as jest.Mock).mockResolvedValue([manualMaid]);
    (db.assignAnyMaid as jest.Mock).mockResolvedValue({
      booking: { id: 'bk2', status: BookingStatus.REQUESTED, anyMaidPool: 'ANY', workStartDate: soonDate, startTime: '10:00' },
      maidId: 'm2', maidName: 'Bina',
    });

    const res = await request(app)
      .post('/api/bookings/book-any-maid')
      .set('Authorization', authHeader)
      .send({ ...baseBody, poolType: 'ANY' });

    expect(res.status).toBe(201);
    expect((db.assignAnyMaid as jest.Mock).mock.calls[0][0].poolType).toBe('ANY');
    // Maid is told about the new request; household sees a nameless "matching…".
    expect(sendLocalizedNotification).toHaveBeenCalledWith('tok-m', 'en', 'booking.newRequest', expect.anything(), expect.anything());
    expect(sendLocalizedNotification).toHaveBeenCalledWith('tok-h', 'en', 'booking.anyMaidMatching', expect.anything(), expect.anything());
    // The response body is redacted (no maid identity leaks to the household).
    expect(redactMatchingMaid).toHaveBeenCalledWith(expect.objectContaining({ id: 'bk2' }), 'HOUSEHOLD');
    expect(res.body.maidName).toBeUndefined();
    expect(res.body.matching).toBe(true);
  });

  it('returns 409 when the requested sub-pool is empty (no covering maid for AUTO_ACCEPT)', async () => {
    (db.getAvailableMaidPool as jest.Mock).mockResolvedValue([manualMaid]); // only a non-auto maid

    const res = await request(app)
      .post('/api/bookings/book-any-maid')
      .set('Authorization', authHeader)
      .send({ ...baseBody, poolType: 'AUTO_ACCEPT' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NO_MAIDS_AVAILABLE');
    expect(db.assignAnyMaid).not.toHaveBeenCalled();
  });

  it('returns 409 when assignAnyMaid exhausts the pool (all candidates collided)', async () => {
    (db.getAvailableMaidPool as jest.Mock).mockResolvedValue([autoMaid]);
    (db.assignAnyMaid as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .post('/api/bookings/book-any-maid')
      .set('Authorization', authHeader)
      .send({ ...baseBody, poolType: 'AUTO_ACCEPT' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NO_MAIDS_AVAILABLE');
  });

  it('is idempotent: a repeated key returns the existing booking without re-assigning', async () => {
    (db.getBookingByIdempotencyKey as jest.Mock).mockResolvedValue({ id: 'existing', status: BookingStatus.REQUESTED, anyMaidPool: 'ANY' });

    const res = await request(app)
      .post('/api/bookings/book-any-maid')
      .set('Authorization', authHeader)
      .send({ ...baseBody, poolType: 'ANY' });

    expect(res.status).toBe(201);
    expect(db.getAvailableMaidPool).not.toHaveBeenCalled();
    expect(db.assignAnyMaid).not.toHaveBeenCalled();
  });

  it('rejects an invalid ADHOC time before touching the pool', async () => {
    const res = await request(app)
      .post('/api/bookings/book-any-maid')
      .set('Authorization', authHeader)
      .send({ ...baseBody, poolType: 'AUTO_ACCEPT', startTime: '10:00', endTime: '09:00' });

    expect(res.status).toBe(400);
    expect(db.getAvailableMaidPool).not.toHaveBeenCalled();
  });
});

describe('PUT /api/bookings/:id/status — any-maid decline', () => {
  it('reassigns (does NOT cancel) when the assigned maid declines a REQUESTED any-maid booking', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({
      id: 'bk3', bookingType: 'ADHOC', status: BookingStatus.REQUESTED, anyMaidPool: 'ANY',
      maidId: 'm2', workStartDate: soonDate, startTime: '10:00', effEndDate: '3499-12-31',
    });

    const res = await request(app)
      .put('/api/bookings/bk3/status')
      .set('Authorization', maidAuthHeader)
      .send({ status: 'CANCELLED', cancelledBy: 'MAID' });

    expect(res.status).toBe(200);
    expect(res.body.reassigned).toBe(true);
    expect(reassignAndNotify).toHaveBeenCalledWith('bk3', 'decline');
    expect(db.updateBookingStatus).not.toHaveBeenCalled();
  });

  it('still cancels a normal (non-any-maid) REQUESTED booking on decline', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({
      id: 'bk4', bookingType: 'ADHOC', status: BookingStatus.REQUESTED, anyMaidPool: null,
      maidId: 'm2', workStartDate: soonDate, startTime: '10:00', effEndDate: '3499-12-31',
    });

    const res = await request(app)
      .put('/api/bookings/bk4/status')
      .set('Authorization', maidAuthHeader)
      .send({ status: 'CANCELLED', cancelledBy: 'MAID' });

    expect(res.status).toBe(200);
    expect(reassignAndNotify).not.toHaveBeenCalled();
    expect(db.updateBookingStatus).toHaveBeenCalledWith('bk4', BookingStatus.CANCELLED, 'MAID');
  });
});
