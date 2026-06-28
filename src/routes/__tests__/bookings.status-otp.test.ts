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

describe('GET /api/bookings/:id/available-replacements', () => {
  it('returns 404 when booking not found', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .get('/api/bookings/b1/available-replacements')
      .set('Authorization', authHeader);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Booking not found');
  });

  it('returns 400 when booking is not eligible (ADHOC not cancelled)', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({
      id: 'b1', bookingType: 'ADHOC', status: BookingStatus.CONFIRMED, effEndDate: '3499-12-31',
    });
    const res = await request(app)
      .get('/api/bookings/b1/available-replacements')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Booking is not eligible for replacement assignment');
  });

  it('returns available maids for an eligible ADHOC cancelled booking', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({
      id: 'b1', bookingType: 'ADHOC', status: BookingStatus.CANCELLED, effEndDate: '3499-12-31',
    });
    const maids = [{ id: 'maid-2', rating: 4.5 }];
    (db.getAvailableReplacementMaids as jest.Mock).mockResolvedValue(maids);

    const res = await request(app)
      .get('/api/bookings/b1/available-replacements')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(maids);
    expect(db.getAvailableReplacementMaids).toHaveBeenCalledWith('b1');
  });

  it('returns available maids for an eligible REPLACEMENT requested booking', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({
      id: 'b1', bookingType: 'REPLACEMENT', status: 'REQUESTED', effEndDate: '3499-12-31',
    });
    (db.getAvailableReplacementMaids as jest.Mock).mockResolvedValue([]);

    const res = await request(app)
      .get('/api/bookings/b1/available-replacements')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
  });

  it('returns 500 when db throws', async () => {
    (db.getBookingById as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .get('/api/bookings/b1/available-replacements')
      .set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});

describe('PUT /api/bookings/:id/assign-replacement', () => {
  const eligibleBooking = {
    id: 'b1', bookingType: 'ADHOC', status: BookingStatus.CANCELLED, effEndDate: '3499-12-31',
    householdId: 'household-1', workStartDate: '2099-01-01', startTime: '10:00',
  };

  it('returns 400 when replacementMaidId missing', async () => {
    const res = await request(app)
      .put('/api/bookings/b1/assign-replacement')
      .set('Authorization', authHeader)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('replacementMaidId is required');
  });

  it('returns 404 when booking not found', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .put('/api/bookings/b1/assign-replacement')
      .set('Authorization', authHeader)
      .send({ replacementMaidId: 'maid-2' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Booking not found');
  });

  it('returns 409 when booking is not eligible', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({
      ...eligibleBooking, status: BookingStatus.CONFIRMED,
    });
    const res = await request(app)
      .put('/api/bookings/b1/assign-replacement')
      .set('Authorization', authHeader)
      .send({ replacementMaidId: 'maid-2' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Booking is not eligible for replacement assignment');
  });

  it('returns 400 when replacement maid is invalid (not a MAID)', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue(eligibleBooking);
    (db.getUserById as jest.Mock).mockResolvedValue({ id: 'maid-2', role: UserRole.HOUSEHOLD });
    const res = await request(app)
      .put('/api/bookings/b1/assign-replacement')
      .set('Authorization', authHeader)
      .send({ replacementMaidId: 'maid-2' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid replacement maid');
  });

  it('returns 400 when replacement maid does not serve the society', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue(eligibleBooking);
    (db.getUserById as jest.Mock).mockImplementation((id: string) =>
      id === 'maid-2'
        ? Promise.resolve({ id: 'maid-2', role: UserRole.MAID, expo_push_token: 'push-2' })
        : Promise.resolve({ id: 'household-1', societyId: 'society-1' }),
    );
    (db.isMaidMemberOfSociety as jest.Mock).mockResolvedValue(false);

    const res = await request(app)
      .put('/api/bookings/b1/assign-replacement')
      .set('Authorization', authHeader)
      .send({ replacementMaidId: 'maid-2' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Replacement maid does not serve this society');
  });

  it('assigns the replacement and notifies the maid on the happy path', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue(eligibleBooking);
    (db.getUserById as jest.Mock).mockImplementation((id: string) =>
      id === 'maid-2'
        ? Promise.resolve({ id: 'maid-2', role: UserRole.MAID, expo_push_token: 'push-2' })
        : Promise.resolve({ id: 'household-1', societyId: 'society-1' }),
    );
    (db.isMaidMemberOfSociety as jest.Mock).mockResolvedValue(true);
    (db.assignReplacementForBooking as jest.Mock).mockResolvedValue({
      newBookingId: 'b2', bookingType: 'ADHOC',
    });

    const res = await request(app)
      .put('/api/bookings/b1/assign-replacement')
      .set('Authorization', authHeader)
      .send({ replacementMaidId: 'maid-2' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, newBookingId: 'b2' });
    expect(db.assignReplacementForBooking).toHaveBeenCalledWith('b1', 'maid-2');
    expect(sendPushNotification).toHaveBeenCalledWith(
      'push-2',
      'New Booking Assigned',
      expect.stringContaining('assigned'),
    );
  });

  it('returns 500 when db throws', async () => {
    (db.getBookingById as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .put('/api/bookings/b1/assign-replacement')
      .set('Authorization', authHeader)
      .send({ replacementMaidId: 'maid-2' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});

describe('PUT /api/bookings/:id', () => {
  it('returns 404 when booking not found', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .put('/api/bookings/b1')
      .set('Authorization', authHeader)
      .send({ status: BookingStatus.CONFIRMED });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Booking not found');
  });

  it('returns 400 when changing maidId on a CONTRACT booking', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({
      id: 'b1', bookingType: 'CONTRACT', maidId: 'maid-1',
    });
    const res = await request(app)
      .put('/api/bookings/b1')
      .set('Authorization', authHeader)
      .send({ maidId: 'maid-2' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Cannot change maid on a contract. Terminate and create a new one.');
  });

  it('updates status in-place when only status is provided', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'b1', bookingType: 'ADHOC' });
    (db.updateBookingStatus as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/bookings/b1')
      .set('Authorization', authHeader)
      .send({ status: BookingStatus.CONFIRMED });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.updateBookingStatus).toHaveBeenCalledWith('b1', BookingStatus.CONFIRMED);
    expect(db.scdUpdateBooking).not.toHaveBeenCalled();
  });

  it('performs an SCD2 update when material fields change', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'b1', bookingType: 'ADHOC' });
    (db.scdUpdateBooking as jest.Mock).mockResolvedValue('b1-new');

    const res = await request(app)
      .put('/api/bookings/b1')
      .set('Authorization', authHeader)
      .send({ startTime: '11:00' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 'b1-new' });
    expect(db.scdUpdateBooking).toHaveBeenCalledWith('b1', { startTime: '11:00' });
  });

  it('returns 500 when db throws', async () => {
    (db.getBookingById as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .put('/api/bookings/b1')
      .set('Authorization', authHeader)
      .send({ status: BookingStatus.CONFIRMED });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});

describe('PUT /api/bookings/:id/status', () => {
  it('returns 404 when booking not found', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .put('/api/bookings/b1/status')
      .set('Authorization', authHeader)
      .send({ status: BookingStatus.CANCELLED });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Booking not found');
  });

  describe('CANCELLED', () => {
    it('returns 400 for CONTRACT cancellation without a date', async () => {
      (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'b1', bookingType: 'CONTRACT' });
      const res = await request(app)
        .put('/api/bookings/b1/status')
        .set('Authorization', authHeader)
        .send({ status: BookingStatus.CANCELLED });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('date is required for contract session cancellation');
    });

    it('creates a leave-exception replacement for CONTRACT cancellation with a date', async () => {
      (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'b1', bookingType: 'CONTRACT' });
      (db.createLeaveExceptionBooking as jest.Mock).mockResolvedValue({ id: 'rep-1' });
      (db.getNotificationInfoForBooking as jest.Mock).mockResolvedValue({
        householdPushToken: 'push-house', maidName: 'Maid A', serviceName: 'Cleaning',
      });

      const res = await request(app)
        .put('/api/bookings/b1/status')
        .set('Authorization', authHeader)
        .send({ status: BookingStatus.CANCELLED, date: '2099-01-05' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, replacementId: 'rep-1' });
      expect(db.createLeaveExceptionBooking).toHaveBeenCalledWith('b1', '2099-01-05');
      expect(sendPushNotification).toHaveBeenCalledWith(
        'push-house', 'Contract – Replacement Needed', expect.stringContaining('Maid A'),
      );
    });

    it('cancels ADHOC booking in-place and notifies household when maid cancels', async () => {
      (db.getBookingById as jest.Mock).mockResolvedValue({
        id: 'b1', bookingType: 'ADHOC', workStartDate: '2099-01-01',
      });
      (db.updateBookingStatus as jest.Mock).mockResolvedValue(undefined);
      (db.getNotificationInfoForBooking as jest.Mock).mockResolvedValue({
        householdPushToken: 'push-house', maidName: 'Maid A', serviceName: 'Cleaning',
      });

      const res = await request(app)
        .put('/api/bookings/b1/status')
        .set('Authorization', authHeader)
        .send({ status: BookingStatus.CANCELLED, cancelledBy: 'MAID' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(db.updateBookingStatus).toHaveBeenCalledWith('b1', BookingStatus.CANCELLED, 'MAID');
      expect(sendPushNotification).toHaveBeenCalledWith(
        'push-house', 'Booking Cancelled – Replacement Needed', expect.stringContaining('Maid A'),
      );
    });

    it('does not notify household when household self-cancels', async () => {
      (db.getBookingById as jest.Mock).mockResolvedValue({
        id: 'b1', bookingType: 'ADHOC', workStartDate: '2099-01-01',
      });
      (db.updateBookingStatus as jest.Mock).mockResolvedValue(undefined);

      const res = await request(app)
        .put('/api/bookings/b1/status')
        .set('Authorization', authHeader)
        .send({ status: BookingStatus.CANCELLED, cancelledBy: 'HOUSEHOLD' });

      expect(res.status).toBe(200);
      expect(db.updateBookingStatus).toHaveBeenCalledWith('b1', BookingStatus.CANCELLED, 'HOUSEHOLD');
      expect(db.getNotificationInfoForBooking).not.toHaveBeenCalled();
      expect(sendPushNotification).not.toHaveBeenCalled();
    });

    it('defaults cancelledBy to MAID when not provided', async () => {
      (db.getBookingById as jest.Mock).mockResolvedValue({
        id: 'b1', bookingType: 'ADHOC', workStartDate: '2099-01-01',
      });
      (db.updateBookingStatus as jest.Mock).mockResolvedValue(undefined);
      (db.getNotificationInfoForBooking as jest.Mock).mockResolvedValue(null);

      const res = await request(app)
        .put('/api/bookings/b1/status')
        .set('Authorization', authHeader)
        .send({ status: BookingStatus.CANCELLED });

      expect(res.status).toBe(200);
      expect(db.updateBookingStatus).toHaveBeenCalledWith('b1', BookingStatus.CANCELLED, 'MAID');
    });
  });

  describe('TERMINATED', () => {
    it('terminates a CONTRACT booking via terminateContract', async () => {
      (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'b1', bookingType: 'CONTRACT' });
      (db.terminateContract as jest.Mock).mockResolvedValue(undefined);

      const res = await request(app)
        .put('/api/bookings/b1/status')
        .set('Authorization', authHeader)
        .send({ status: BookingStatus.TERMINATED });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(db.terminateContract).toHaveBeenCalledWith('b1');
      expect(db.terminateBooking).not.toHaveBeenCalled();
    });

    it('terminates an ADHOC booking via terminateBooking', async () => {
      (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'b1', bookingType: 'ADHOC' });
      (db.terminateBooking as jest.Mock).mockResolvedValue(undefined);

      const res = await request(app)
        .put('/api/bookings/b1/status')
        .set('Authorization', authHeader)
        .send({ status: BookingStatus.TERMINATED });

      expect(res.status).toBe(200);
      expect(db.terminateBooking).toHaveBeenCalledWith('b1');
      expect(db.terminateContract).not.toHaveBeenCalled();
    });
  });

  describe('other status transitions', () => {
    it('updates status in-place and notifies household when maid confirms an ADHOC booking', async () => {
      (db.getBookingById as jest.Mock).mockResolvedValue({
        id: 'b1', bookingType: 'ADHOC', workStartDate: '2099-01-01',
      });
      (db.updateBookingStatus as jest.Mock).mockResolvedValue(undefined);
      (db.getNotificationInfoForBooking as jest.Mock).mockResolvedValue({
        householdPushToken: 'push-house', maidName: 'Maid A', serviceName: 'Cleaning',
      });

      const res = await request(app)
        .put('/api/bookings/b1/status')
        .set('Authorization', authHeader)
        .send({ status: BookingStatus.CONFIRMED });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(db.updateBookingStatus).toHaveBeenCalledWith('b1', BookingStatus.CONFIRMED);
      expect(sendPushNotification).toHaveBeenCalledWith(
        'push-house', 'Booking Confirmed', expect.stringContaining('Maid A'),
      );
    });

    it('does not notify household when a non-ADHOC booking is confirmed', async () => {
      (db.getBookingById as jest.Mock).mockResolvedValue({
        id: 'b1', bookingType: 'REPLACEMENT', workStartDate: '2099-01-01',
      });
      (db.updateBookingStatus as jest.Mock).mockResolvedValue(undefined);

      const res = await request(app)
        .put('/api/bookings/b1/status')
        .set('Authorization', authHeader)
        .send({ status: BookingStatus.CONFIRMED });

      expect(res.status).toBe(200);
      expect(db.getNotificationInfoForBooking).not.toHaveBeenCalled();
      expect(sendPushNotification).not.toHaveBeenCalled();
    });
  });

  it('returns 500 when db throws', async () => {
    (db.getBookingById as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .put('/api/bookings/b1/status')
      .set('Authorization', authHeader)
      .send({ status: BookingStatus.CONFIRMED });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});

describe('POST /api/bookings/:id/request-otp', () => {
  it('returns 404 when booking not found', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .post('/api/bookings/b1/request-otp')
      .set('Authorization', authHeader)
      .send({ type: 'start' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Booking not found');
  });

  it('auto-advances a CONTRACT booking to IN_PROGRESS on start without OTP', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'b1', bookingType: 'CONTRACT' });
    (db.updateBookingStatus as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/bookings/b1/request-otp')
      .set('Authorization', authHeader)
      .send({ type: 'start' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true, status: BookingStatus.IN_PROGRESS, autoAdvanced: true, bookingId: 'b1',
    });
    expect(db.updateBookingStatus).toHaveBeenCalledWith('b1', BookingStatus.IN_PROGRESS);
    expect(db.setOtpRequested).not.toHaveBeenCalled();
  });

  it('auto-advances a CONTRACT booking to COMPLETED on end without OTP', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'b1', bookingType: 'CONTRACT' });
    (db.updateBookingStatus as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/bookings/b1/request-otp')
      .set('Authorization', authHeader)
      .send({ type: 'end' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(BookingStatus.COMPLETED);
    expect(db.updateBookingStatus).toHaveBeenCalledWith('b1', BookingStatus.COMPLETED);
  });

  it('generates an OTP for ADHOC/REPLACEMENT bookings', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'b1', bookingType: 'ADHOC' });
    (db.setOtpRequested as jest.Mock).mockResolvedValue('1234');

    const res = await request(app)
      .post('/api/bookings/b1/request-otp')
      .set('Authorization', authHeader)
      .send({ type: 'start' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.setOtpRequested).toHaveBeenCalledWith('b1', 'start');
  });

  it('returns 500 when db throws', async () => {
    (db.getBookingById as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .post('/api/bookings/b1/request-otp')
      .set('Authorization', authHeader)
      .send({ type: 'start' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});

describe('POST /api/bookings/:id/cancel-otp', () => {
  it('returns 400 for CONTRACT bookings', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'b1', bookingType: 'CONTRACT' });
    const res = await request(app)
      .post('/api/bookings/b1/cancel-otp')
      .set('Authorization', authHeader)
      .send({ type: 'start' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('OTP operations are not applicable for contract bookings.');
    expect(db.cancelOtpRequest).not.toHaveBeenCalled();
  });

  it('cancels the OTP request on the happy path', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'b1', bookingType: 'ADHOC' });
    (db.cancelOtpRequest as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/bookings/b1/cancel-otp')
      .set('Authorization', authHeader)
      .send({ type: 'start' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.cancelOtpRequest).toHaveBeenCalledWith('b1', 'start');
  });

  it('returns 500 when db throws', async () => {
    (db.getBookingById as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .post('/api/bookings/b1/cancel-otp')
      .set('Authorization', authHeader)
      .send({ type: 'start' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});

describe('POST /api/bookings/:id/verify-otp', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns 400 for CONTRACT bookings', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'b1', bookingType: 'CONTRACT' });
    const res = await request(app)
      .post('/api/bookings/b1/verify-otp')
      .set('Authorization', authHeader)
      .send({ code: '1234', type: 'start' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('OTP verification is not applicable for contract bookings.');
  });

  it('accepts the master OTP and advances status to IN_PROGRESS for start', async () => {
    delete process.env.TWILIO_MASTER_OTP;
    (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'b1', bookingType: 'ADHOC' });
    (db.stampOtpTime as jest.Mock).mockResolvedValue(undefined);
    (db.updateBookingStatus as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/bookings/b1/verify-otp')
      .set('Authorization', authHeader)
      .send({ code: '1234', type: 'start' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, status: BookingStatus.IN_PROGRESS });
    expect(db.stampOtpTime).toHaveBeenCalledWith('b1', 'start');
    expect(db.updateBookingStatus).toHaveBeenCalledWith('b1', BookingStatus.IN_PROGRESS);
    expect(db.verifyStoredOtp).not.toHaveBeenCalled();
  });

  it('advances status to COMPLETED for a valid end OTP via verifyStoredOtp', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'b1', bookingType: 'ADHOC' });
    (db.verifyStoredOtp as jest.Mock).mockResolvedValue(true);
    (db.stampOtpTime as jest.Mock).mockResolvedValue(undefined);
    (db.updateBookingStatus as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/bookings/b1/verify-otp')
      .set('Authorization', authHeader)
      .send({ code: '5678', type: 'end' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, status: BookingStatus.COMPLETED });
    expect(db.verifyStoredOtp).toHaveBeenCalledWith('b1', 'end', '5678');
    expect(db.updateBookingStatus).toHaveBeenCalledWith('b1', BookingStatus.COMPLETED);
  });

  it('returns 400 with incorrect-code error when OTP is invalid', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'b1', bookingType: 'ADHOC' });
    (db.verifyStoredOtp as jest.Mock).mockResolvedValue(false);

    const res = await request(app)
      .post('/api/bookings/b1/verify-otp')
      .set('Authorization', authHeader)
      .send({ code: '0000', type: 'start' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('The code you entered is incorrect.');
    expect(db.updateBookingStatus).not.toHaveBeenCalled();
  });

  it('returns 500 when db throws', async () => {
    (db.getBookingById as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .post('/api/bookings/b1/verify-otp')
      .set('Authorization', authHeader)
      .send({ code: '1234', type: 'start' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});

describe('POST /api/bookings/:id/generate-otp', () => {
  it('returns 400 for CONTRACT bookings', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'b1', bookingType: 'CONTRACT' });
    const res = await request(app)
      .post('/api/bookings/b1/generate-otp')
      .set('Authorization', authHeader)
      .send({ type: 'start' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('OTP generation is not applicable for contract bookings.');
    expect(db.regenerateOtp).not.toHaveBeenCalled();
  });

  it('regenerates the OTP on the happy path', async () => {
    (db.getBookingById as jest.Mock).mockResolvedValue({ id: 'b1', bookingType: 'ADHOC' });
    (db.regenerateOtp as jest.Mock).mockResolvedValue('9999');

    const res = await request(app)
      .post('/api/bookings/b1/generate-otp')
      .set('Authorization', authHeader)
      .send({ type: 'end' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.regenerateOtp).toHaveBeenCalledWith('b1', 'end');
  });

  it('returns 500 when db throws', async () => {
    (db.getBookingById as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .post('/api/bookings/b1/generate-otp')
      .set('Authorization', authHeader)
      .send({ type: 'start' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});
