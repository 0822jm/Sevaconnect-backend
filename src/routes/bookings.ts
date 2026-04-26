import { Router, Request, Response } from 'express';
import { db, BookingStatus, UserRole } from '../services/database';
import { authMiddleware } from '../middleware/auth';
import { sendPushNotification } from '../services/pushNotifications';

const router = Router();
router.use(authMiddleware);

// GET /api/bookings/user/:userId
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const role = req.query.role as string;
    if (!role) {
      res.status(400).json({ error: 'role query param required (MAID or HOUSEHOLD)' });
      return;
    }
    const bookings = await db.getBookingsForUser(req.params.userId, role as UserRole);
    res.json(bookings);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/bookings/contracts — grouped contract view for household or maid
router.get('/contracts', async (req: Request, res: Response) => {
  try {
    const { userId, role } = req.query as { userId: string; role: string };
    if (!userId || !role) {
      res.status(400).json({ error: 'userId and role query params required' });
      return;
    }
    const contracts = await db.getContractsForUser(userId, role);
    res.json(contracts);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/bookings/contract-leave-exception
// Called when a maid books leave that conflicts with a recurring contract.
// Sends a push notification to the household so they can arrange a replacement.
router.post('/contract-leave-exception', async (req: Request, res: Response) => {
  try {
    const { stagingContractId, date, leaveType } = req.body;
    if (!stagingContractId || !date || !leaveType) {
      res.status(400).json({ error: 'stagingContractId, date, and leaveType are required' });
      return;
    }

    const info = await db.getHouseholdInfoForContract(stagingContractId);
    if (!info) {
      res.status(404).json({ error: 'Contract not found' });
      return;
    }

    if (info.householdPushToken) {
      const leaveDesc =
        leaveType === 'FULL'      ? 'the full day' :
        leaveType === 'MORNING'   ? 'the morning (8 AM – 12 PM)' :
                                    'the afternoon (12 PM onwards)';
      sendPushNotification(
        info.householdPushToken,
        'Contract – Replacement Needed',
        `${info.maidName} is unavailable on ${date} for ${leaveDesc}. Please arrange a replacement helper.`,
      );
    }

    // Create a visible CANCELLED booking row for this date so the household calendar shows it
    await db.createLeaveExceptionBooking(stagingContractId, date);

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/bookings/contracts/check-conflict — checks if a maid has a conflicting active contract
// Query params: maidId, frequency (DAILY or MON,WED,FRI), startTime (HH:MM), endTime (HH:MM)
router.get('/contracts/check-conflict', async (req: Request, res: Response) => {
  try {
    const { maidId, frequency, startTime, endTime } = req.query as {
      maidId: string; frequency: string; startTime: string; endTime: string;
    };
    if (!maidId || !frequency || !startTime || !endTime) {
      res.status(400).json({ error: 'maidId, frequency, startTime, endTime are required' });
      return;
    }

    const activeContracts = await db.getActiveContractsForMaid(maidId);
    const newFreq = frequency.toUpperCase();
    const newDays = newFreq === 'DAILY' ? null : new Set(newFreq.split(','));

    const hasConflict = activeContracts.some(contract => {
      // Check day overlap
      const existingIsDailyOrNewIsDaily = newFreq === 'DAILY' || contract.frequency === 'DAILY';
      const daysConflict = existingIsDailyOrNewIsDaily ||
        (newDays !== null && contract.frequency.split(',').some(d => newDays.has(d)));
      if (!daysConflict) return false;

      // Check time overlap: two ranges [s1,e1) and [s2,e2) overlap if s1 < e2 && s2 < e1
      return startTime < contract.endTime && contract.startTime < endTime;
    });

    res.json({ hasConflict });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/bookings/contracts/create — household creates a contract from the app
router.post('/contracts/create', async (req: Request, res: Response) => {
  try {
    const {
      householdId, maidId, frequency, startTime, endTime,
      startDate, monthlyFee, jobDescription,
    } = req.body;

    if (!householdId || !maidId || !frequency || !startTime || !endTime || !startDate || !monthlyFee) {
      res.status(400).json({ error: 'householdId, maidId, frequency, startTime, endTime, startDate, monthlyFee are required' });
      return;
    }
    if (Number(monthlyFee) <= 0) {
      res.status(400).json({ error: 'monthlyFee must be greater than 0' });
      return;
    }

    // Validate users exist, same society, correct roles
    const household = await db.getUserById(householdId);
    const maid = await db.getUserById(maidId);
    if (!household || household.role !== UserRole.HOUSEHOLD) {
      res.status(400).json({ error: 'Invalid household user' }); return;
    }
    if (!maid || maid.role !== UserRole.MAID) {
      res.status(400).json({ error: 'Invalid maid user' }); return;
    }
    if (!household.societyId) {
      res.status(400).json({ error: 'Household is not assigned to a society' }); return;
    }
    if (maid.societyId && maid.societyId !== household.societyId) {
      res.status(400).json({ error: 'Maid and household belong to different societies' }); return;
    }

    const societyId = household.societyId;
    const freq = frequency.toUpperCase();

    // Backend safety-net: reject if maid already has a conflicting active contract
    const existingContracts = await db.getActiveContractsForMaid(maidId);
    const newDays = freq === 'DAILY' ? null : new Set(freq.split(','));
    const hasConflict = existingContracts.some(c => {
      const daysConflict = freq === 'DAILY' || c.frequency === 'DAILY' ||
        (newDays !== null && c.frequency.split(',').some((d: string) => newDays.has(d)));
      if (!daysConflict) return false;
      return startTime < c.endTime && c.startTime < endTime;
    });
    if (hasConflict) {
      res.status(409).json({ error: 'This maid already has an active contract that conflicts with the selected time and days.' });
      return;
    }

    // Generate staging contract ID
    const stagingId = `sc-${Date.now()}`;

    // Create staging_contract row
    await db.createStagingContract({
      id: stagingId,
      uploadUser: householdId,
      uploadId: undefined,
      fileName: undefined,
      householdPhone: household.phone || '',
      maidPhone: maid.phone || '',
      jobDescription: jobDescription || undefined,
      frequency: freq,
      startTime,
      endTime,
      startDate,
      monthlyContractFee: Number(monthlyFee),
      status: 'SUCCESS',
      householdId,
      maidId,
      societyId,
    });

    // Find or create the Contract society_service for this society
    const societyServiceId = await db.findOrCreateContractSocietyService(societyId);

    // Calculate end date: 6 months from startDate
    const endDt = new Date(startDate);
    endDt.setMonth(endDt.getMonth() + 6);
    const endDate = endDt.toISOString().split('T')[0];

    // Parse frequency → booking dates
    const bookingDates: string[] = [];
    if (freq === 'DAILY') {
      // One booking per day for 7 days from start
      const startDt = new Date(startDate);
      for (let offset = 0; offset < 7; offset++) {
        const d = new Date(startDt);
        d.setDate(startDt.getDate() + offset);
        bookingDates.push(d.toISOString().split('T')[0]);
      }
    } else {
      const dayMap: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
      const targetDays = freq.split(',').map((d: string) => dayMap[d.trim()]).filter((d: number) => d !== undefined);
      const startDt = new Date(startDate);
      for (let offset = 0; offset < 7; offset++) {
        const d = new Date(startDt);
        d.setDate(startDt.getDate() + offset);
        if (targetDays.includes(d.getDay())) {
          bookingDates.push(d.toISOString().split('T')[0]);
        }
      }
    }

    // Create bookings
    const createdBookingIds: string[] = [];
    for (const bookingDate of bookingDates) {
      const bk = await db.createBooking({
        societyServiceId,
        householdId,
        maidId,
        date: bookingDate,
        startTime,
        endTime,
        isRecurring: true,
        frequency: freq,
        priceAtBooking: Number(monthlyFee),
        customDescription: jobDescription || null,
        isContract: true,
        active: true,
        effStartDate: startDate,
        stagingContractId: stagingId,
      });
      createdBookingIds.push(bk.id);
    }

    // Notify maid
    if ((maid as any).expo_push_token) {
      const householdName = household.name || 'A household';
      sendPushNotification(
        (maid as any).expo_push_token,
        'New Contract',
        `${householdName} has created a contract with you starting ${startDate}`,
      );
    }

    res.status(201).json({ stagingContractId: stagingId, bookingIds: createdBookingIds, endDate });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/bookings/society/:societyId
router.get('/society/:societyId', async (req: Request, res: Response) => {
  try {
    const bookings = await db.getBookingsBySociety(req.params.societyId);
    res.json(bookings);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/bookings
router.post('/', async (req: Request, res: Response) => {
  try {
    const booking = await db.createBooking(req.body);
    res.status(201).json(booking);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/bookings/contracts/:stagingContractId — household updates contract
// MUST be defined before PUT /:id to avoid route shadowing
router.put('/contracts/:stagingContractId', async (req: Request, res: Response) => {
  try {
    const { startTime, endTime, startDate, monthlyFee } = req.body;
    if (!startTime || !endTime) {
      res.status(400).json({ error: 'startTime and endTime are required' });
      return;
    }
    const timeRe = /^\d{2}:\d{2}$/;
    if (!timeRe.test(startTime) || !timeRe.test(endTime)) {
      res.status(400).json({ error: 'startTime and endTime must be in HH:MM format' });
      return;
    }
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      res.status(400).json({ error: 'startDate must be in YYYY-MM-DD format' });
      return;
    }
    if (monthlyFee !== undefined && (isNaN(Number(monthlyFee)) || Number(monthlyFee) <= 0)) {
      res.status(400).json({ error: 'monthlyFee must be a positive number' });
      return;
    }
    await db.updateContract(req.params.stagingContractId, {
      startTime,
      endTime,
      startDate: startDate || undefined,
      monthlyFee: monthlyFee !== undefined ? Number(monthlyFee) : undefined,
    });

    // Notify maid about the contract update (fire-and-forget)
    db.getMaidInfoForContract(req.params.stagingContractId).then(info => {
      if (info?.maidPushToken) {
        const changes: string[] = [`Time: ${startTime}–${endTime}`];
        if (startDate) changes.push(`Start date: ${startDate}`);
        if (monthlyFee !== undefined) changes.push(`Fee: ₹${Math.round(Number(monthlyFee))}`);
        sendPushNotification(
          info.maidPushToken,
          'Contract Updated',
          `${info.householdName} has updated your contract. ${changes.join(', ')}.`,
        );
      }
    }).catch(() => {});

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/bookings/contracts/:stagingContractId — cancel contract
// Pass ?cancelledBy=MAID when the maid initiates cancellation (notifies household instead)
// MUST be defined before DELETE /:id if added in future
router.delete('/contracts/:stagingContractId', async (req: Request, res: Response) => {
  try {
    const cancelledByMaid = req.query.cancelledBy === 'MAID';

    if (cancelledByMaid) {
      // Fetch household info before cancelling to send push notification
      const info = await db.getHouseholdInfoForContract(req.params.stagingContractId).catch(() => null);
      await db.cancelContract(req.params.stagingContractId);
      if (info?.householdPushToken) {
        sendPushNotification(
          info.householdPushToken,
          'Contract Cancelled',
          `Your contract with ${info.maidName} has been cancelled by the maid.`,
        );
      }
    } else {
      // Household cancels — notify maid
      const info = await db.getMaidInfoForContract(req.params.stagingContractId).catch(() => null);
      await db.cancelContract(req.params.stagingContractId);
      if (info?.maidPushToken) {
        sendPushNotification(
          info.maidPushToken,
          'Contract Cancelled',
          `Your contract with ${info.householdName} has been cancelled.`,
        );
      }
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/bookings/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const booking = await db.getBookingById(req.params.id);
    if (booking?.isContract) {
      // SCD Type 2: close old version, insert new row with updates
      const newId = await db.scdUpdateBooking(req.params.id, req.body);
      res.json({ success: true, newId });
    } else {
      await db.updateBooking(req.params.id, req.body);
      res.json({ success: true });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/bookings/:id/status
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const booking = await db.getBookingById(req.params.id);
    if (booking?.isContract && status === BookingStatus.COMPLETED) {
      // SCD Type 2: contract ended — close current version with COMPLETED status
      const newId = await db.scdUpdateBooking(req.params.id, { status: BookingStatus.COMPLETED, active: false });
      res.json({ success: true, newId });
    } else {
      await db.updateBookingStatus(req.params.id, status as BookingStatus);

      // Notify household when their booking is cancelled or rejected by the maid
      if (status === BookingStatus.CANCELLED || status === BookingStatus.REJECTED) {
        const info = await db.getNotificationInfoForBooking(req.params.id);
        if (info?.householdPushToken) {
          const dateLabel = booking?.date
            ? new Date(booking.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
            : 'your booking';
          sendPushNotification(
            info.householdPushToken,
            'Booking Cancelled – Replacement Needed',
            `${info.maidName} cancelled ${info.serviceName} on ${dateLabel}. Please arrange a replacement helper.`,
          );
        }
      }

      res.json({ success: true });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/bookings/:id/request-otp
// Maid requests OTP → for contracts, auto-advance status without OTP exchange
router.post('/:id/request-otp', async (req: Request, res: Response) => {
  try {
    const { type } = req.body; // 'start' | 'end'
    const booking = await db.getBookingById(req.params.id);

    if (booking?.isContract) {
      // Auto-advance status — no OTP needed
      const nextStatus = type === 'start' ? BookingStatus.IN_PROGRESS : BookingStatus.COMPLETED;
      if (nextStatus === BookingStatus.COMPLETED) {
        // SCD Type 2 on contract end
        await db.scdUpdateBooking(req.params.id, { status: BookingStatus.COMPLETED, active: false });
      } else {
        await db.updateBookingStatus(req.params.id, nextStatus);
      }
      res.json({ success: true, status: nextStatus, autoAdvanced: true });
      return;
    }

    const otp = await db.setOtpRequested(req.params.id, type);
    console.log(`[OTP] Generated ${type} OTP for booking ${req.params.id}: ${otp}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/bookings/:id/cancel-otp
router.post('/:id/cancel-otp', async (req: Request, res: Response) => {
  try {
    const { type } = req.body;
    const booking = await db.getBookingById(req.params.id);
    if (booking?.isContract) {
      res.status(400).json({ error: 'OTP operations are not applicable for contract bookings.' });
      return;
    }
    await db.cancelOtpRequest(req.params.id, type);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/bookings/:id/verify-otp
// Maid submits code → verified against stored value in DB (no Twilio)
router.post('/:id/verify-otp', async (req: Request, res: Response) => {
  try {
    const { code, type } = req.body; // type: 'start' | 'end'
    const booking = await db.getBookingById(req.params.id);
    if (booking?.isContract) {
      res.status(400).json({ error: 'OTP verification is not applicable for contract bookings.' });
      return;
    }
    const masterOtp = process.env.TWILIO_MASTER_OTP || '1234';

    const isValid = code === masterOtp || await db.verifyStoredOtp(req.params.id, type, code);

    if (isValid) {
      const nextStatus = type === 'start' ? BookingStatus.IN_PROGRESS : BookingStatus.COMPLETED;
      await db.updateBookingStatus(req.params.id, nextStatus);
      res.json({ success: true, status: nextStatus });
    } else {
      res.status(400).json({ error: 'The code you entered is incorrect.' });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/bookings/:id/generate-otp
// Household can regenerate a new 4-digit code if needed
router.post('/:id/generate-otp', async (req: Request, res: Response) => {
  try {
    const { type } = req.body;
    const booking = await db.getBookingById(req.params.id);
    if (booking?.isContract) {
      res.status(400).json({ error: 'OTP generation is not applicable for contract bookings.' });
      return;
    }
    const otp = await db.regenerateOtp(req.params.id, type);
    console.log(`[OTP] Regenerated ${type} OTP for booking ${req.params.id}: ${otp}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
