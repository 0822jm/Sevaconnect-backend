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
    // Lazy on-fetch fallback: ensure stale bookings are swept before returning (throttled ~1/hr)
    await db.maybeSweepStaleBookings();
    const bookings = await db.getBookingsForUser(req.params.userId, role as UserRole);
    res.json(bookings);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/bookings/contracts — contract list for household or maid
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
// Called when a maid books leave that conflicts with a contract session.
// Creates a REPLACEMENT record with status='REQUESTED'.
router.post('/contract-leave-exception', async (req: Request, res: Response) => {
  try {
    const { contractId, date, leaveType } = req.body;
    if (!contractId || !date) {
      res.status(400).json({ error: 'contractId and date are required' });
      return;
    }

    // Create REPLACEMENT record
    const replacement = await db.createLeaveExceptionBooking(contractId, date);
    if (!replacement) {
      res.status(404).json({ error: 'Contract not found' });
      return;
    }

    // Notify household
    const info = await db.getNotificationInfoForBooking(replacement.id);
    if (info?.householdPushToken) {
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

    res.json({ success: true, replacementId: replacement.id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/bookings/contracts/check-conflict
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
      const existingIsDailyOrNewIsDaily = newFreq === 'DAILY' || contract.frequency === 'DAILY';
      const daysConflict = existingIsDailyOrNewIsDaily ||
        (newDays !== null && contract.frequency.split(',').some(d => newDays.has(d)));
      if (!daysConflict) return false;
      return startTime < contract.endTime && contract.startTime < endTime;
    });

    res.json({ hasConflict });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/bookings/contracts/create — create a contract (one booking row)
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

    // Conflict check
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

    // Create staging contract
    const stagingId = `sc-${Date.now()}`;
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

    const societyServiceId = await db.findOrCreateContractSocietyService(societyId);

    // Create ONE booking row for the contract
    const bk = await db.createBooking({
      bookingType: 'CONTRACT',
      societyServiceId,
      householdId,
      maidId,
      workStartDate: startDate,
      workEndDate: '3499-12-31',
      startTime,
      endTime,
      isRecurring: true,
      frequency: freq,
      priceAtBooking: Number(monthlyFee),
      customDescription: jobDescription || null,
      stagingContractId: stagingId,
      status: BookingStatus.CONFIRMED,
    });

    // Notify maid
    if ((maid as any).expo_push_token) {
      sendPushNotification(
        (maid as any).expo_push_token,
        'New Contract',
        `${household.name || 'A household'} has created a contract with you starting ${startDate}`,
      );
    }

    res.status(201).json({ contractId: bk.id, stagingContractId: stagingId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/bookings/society/:societyId
router.get('/society/:societyId', async (req: Request, res: Response) => {
  try {
    await db.maybeSweepStaleBookings();
    const bookings = await db.getBookingsBySociety(req.params.societyId);
    res.json(bookings);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/bookings/replacements — batch-fetch REPLACEMENT records for calendar dots
router.get('/replacements', async (req: Request, res: Response) => {
  try {
    const contractIds = (req.query.contractIds as string || '').split(',').filter(Boolean);
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    if (!startDate || !endDate || contractIds.length === 0) {
      res.json([]);
      return;
    }
    const replacements = await db.getReplacementsForDateRange(contractIds, startDate, endDate);
    res.json(replacements);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/bookings
router.post('/', async (req: Request, res: Response) => {
  try {
    // Skill validation: ensure the chosen maid has the required services as skills.
    // Skipped for contract bookings (no skill match required) and when the maid has
    // no skills configured yet (graceful — mirrors the mobile filter).
    const bookingType = req.body.bookingType || 'ADHOC';

    // Working-hours validation for ADHOC bookings
    if (bookingType === 'ADHOC') {
      const { startTime, endTime, workStartDate } = req.body;
      if (startTime && endTime) {
        const toMins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        const startMins = toMins(startTime);
        const endMins   = toMins(endTime);
        if (startMins < toMins('07:00') || startMins > toMins('21:00')) {
          res.status(400).json({ error: 'Start time must be between 7:00 AM and 9:00 PM' });
          return;
        }
        if (endMins > toMins('22:00')) {
          res.status(400).json({ error: 'End time cannot be later than 10:00 PM' });
          return;
        }
        if (endMins - startMins < 60) {
          res.status(400).json({ error: 'Minimum booking duration is 1 hour' });
          return;
        }
      }
      // Booking must be at least 1 hour in the future (validated in IST, UTC+5:30)
      if (workStartDate && startTime) {
        const bookingDateTime = new Date(`${workStartDate}T${startTime}:00+05:30`);
        const oneHourFromNow  = new Date(Date.now() + 60 * 60 * 1000);
        if (bookingDateTime < oneHourFromNow) {
          res.status(400).json({ error: 'Booking must be at least 1 hour in the future' });
          return;
        }
      }
    }

    if (bookingType !== 'CONTRACT' && req.body.maidId) {
      const requiredIds: string[] = Array.isArray(req.body.societyServiceIds) && req.body.societyServiceIds.length
        ? req.body.societyServiceIds
        : (req.body.societyServiceId ? [req.body.societyServiceId] : []);
      if (requiredIds.length > 0) {
        const maid = await db.getUserById(req.body.maidId);
        const maidSkills: string[] = (maid as any)?.skills || [];
        if (maidSkills.length > 0) {
          const hasAll = requiredIds.every(id => maidSkills.includes(id));
          if (!hasAll) {
            res.status(400).json({ error: 'Maid not skilled in selected services' });
            return;
          }
        }
      }
    }

    const booking = await db.createBooking(req.body);
    // Notify maid when booking requires their manual acceptance
    if (booking.status === BookingStatus.REQUESTED && req.body.maidId) {
      const maidToken = await db.getUserPushToken(req.body.maidId);
      if (maidToken) {
        sendPushNotification(
          maidToken,
          'New Booking Request',
          `You have a new booking request for ${booking.workStartDate} at ${booking.startTime}. Tap to review.`
        );
      }
    }
    res.status(201).json(booking);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/bookings/contracts/:contractId — update contract (SCD2)
router.put('/contracts/:contractId', async (req: Request, res: Response) => {
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
    await db.updateContract(req.params.contractId, {
      startTime,
      endTime,
      startDate: startDate || undefined,
      monthlyFee: monthlyFee !== undefined ? Number(monthlyFee) : undefined,
    });

    // Notify maid
    const booking = await db.getBookingById(req.params.contractId);
    if (booking?.stagingContractId) {
      db.getMaidInfoForContract(booking.stagingContractId).then(info => {
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
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/bookings/contracts/:contractId — terminate contract
router.delete('/contracts/:contractId', async (req: Request, res: Response) => {
  try {
    const cancelledByMaid = req.query.cancelledBy === 'MAID';
    const booking = await db.getBookingById(req.params.contractId);
    if (!booking) {
      res.status(404).json({ error: 'Contract not found' });
      return;
    }

    if (cancelledByMaid) {
      const info = await db.getNotificationInfoForBooking(req.params.contractId);
      await db.terminateContract(req.params.contractId);
      if (info?.householdPushToken) {
        sendPushNotification(
          info.householdPushToken,
          'Contract Terminated',
          `Your contract with ${info.maidName} has been terminated by the maid.`,
        );
      }
    } else {
      const info = booking.stagingContractId
        ? await db.getMaidInfoForContract(booking.stagingContractId).catch(() => null)
        : null;
      await db.terminateContract(req.params.contractId);
      if (info?.maidPushToken) {
        sendPushNotification(
          info.maidPushToken,
          'Contract Terminated',
          `Your contract with ${info.householdName} has been terminated.`,
        );
      }
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/bookings/:id/available-replacements
router.get('/:id/available-replacements', async (req: Request, res: Response) => {
  try {
    const booking = await db.getBookingById(req.params.id);
    if (!booking) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }
    // Eligibility check
    const isEligible =
      (booking.bookingType === 'ADHOC' && booking.status === BookingStatus.CANCELLED && booking.effEndDate?.includes('3499')) ||
      (booking.bookingType === 'REPLACEMENT' && ['REQUESTED', 'CANCELLED'].includes(booking.status) && booking.effEndDate?.includes('3499'));
    if (!isEligible) {
      res.status(400).json({ error: 'Booking is not eligible for replacement assignment' });
      return;
    }

    const result = await db.getAvailableReplacementMaids(req.params.id);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/bookings/:id/assign-replacement
router.put('/:id/assign-replacement', async (req: Request, res: Response) => {
  try {
    const { replacementMaidId } = req.body;
    if (!replacementMaidId) {
      res.status(400).json({ error: 'replacementMaidId is required' });
      return;
    }
    const booking = await db.getBookingById(req.params.id);
    if (!booking) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    // Eligibility: ADHOC with CANCELLED status (open), or REPLACEMENT with REQUESTED/CANCELLED
    const isEligible =
      (booking.bookingType === 'ADHOC' && booking.status === BookingStatus.CANCELLED && booking.effEndDate?.includes('3499')) ||
      (booking.bookingType === 'REPLACEMENT' && ['REQUESTED', 'CANCELLED'].includes(booking.status) && booking.effEndDate?.includes('3499'));
    if (!isEligible) {
      res.status(409).json({ error: 'Booking is not eligible for replacement assignment' });
      return;
    }

    const replacementMaid = await db.getUserById(replacementMaidId);
    if (!replacementMaid || replacementMaid.role !== UserRole.MAID) {
      res.status(400).json({ error: 'Invalid replacement maid' });
      return;
    }

    const result = await db.assignReplacementForBooking(req.params.id, replacementMaidId);

    // Notify replacement maid
    const pushToken = (replacementMaid as any).expo_push_token;
    if (pushToken) {
      const dateLabel = new Date(booking.workStartDate + 'T00:00').toLocaleDateString('en-IN', {
        weekday: 'short', day: 'numeric', month: 'short',
      });
      sendPushNotification(
        pushToken,
        result.bookingType === 'REPLACEMENT' ? 'Contract Session Assigned' : 'New Booking Assigned',
        `You have been assigned as a replacement helper on ${dateLabel} at ${booking.startTime}.`,
      );
    }

    res.json({ success: true, newBookingId: result.newBookingId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/bookings/:id — material update (SCD2 for non-status changes)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const booking = await db.getBookingById(req.params.id);
    if (!booking) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    // Reject maid_id changes on CONTRACT
    if (booking.bookingType === 'CONTRACT' && req.body.maidId && req.body.maidId !== booking.maidId) {
      res.status(400).json({ error: 'Cannot change maid on a contract. Terminate and create a new one.' });
      return;
    }

    // Status-only changes are in-place
    const nonStatusKeys = Object.keys(req.body).filter(k => k !== 'status');
    if (nonStatusKeys.length === 0 && req.body.status) {
      await db.updateBookingStatus(req.params.id, req.body.status);
      res.json({ success: true });
      return;
    }

    // Material changes → SCD2
    const newId = await db.scdUpdateBooking(req.params.id, req.body);
    res.json({ success: true, id: newId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/bookings/:id/status
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const { status, date } = req.body;
    const booking = await db.getBookingById(req.params.id);
    if (!booking) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    if (status === BookingStatus.CANCELLED) {
      // Maid cancels
      if (booking.bookingType === 'CONTRACT') {
        // Contract session cancellation — requires date (calendar-selected)
        if (!date) {
          res.status(400).json({ error: 'date is required for contract session cancellation' });
          return;
        }
        const replacement = await db.createLeaveExceptionBooking(booking.id, date);
        // Notify household
        const info = await db.getNotificationInfoForBooking(replacement?.id || booking.id);
        if (info?.householdPushToken) {
          sendPushNotification(
            info.householdPushToken,
            'Contract – Replacement Needed',
            `${info.maidName} cancelled the session on ${date}. Please arrange a replacement.`,
          );
        }
        res.json({ success: true, replacementId: replacement?.id });
        return;
      }
      // Adhoc or Replacement cancellation — status in-place, record stays open
      const cancelledBy = (req.body.cancelledBy as string) || 'MAID';
      await db.updateBookingStatus(req.params.id, BookingStatus.CANCELLED, cancelledBy);

      // Only notify household when the maid cancelled (not when household self-cancels)
      if (cancelledBy !== 'HOUSEHOLD') {
        const info = await db.getNotificationInfoForBooking(req.params.id);
        if (info?.householdPushToken) {
          const dateLabel = new Date(booking.workStartDate + 'T00:00').toLocaleDateString('en-IN', {
            weekday: 'short', day: 'numeric', month: 'short',
          });
          sendPushNotification(
            info.householdPushToken,
            'Booking Cancelled – Replacement Needed',
            `${info.maidName} cancelled ${info.serviceName} on ${dateLabel}. Please arrange a replacement helper.`,
          );
        }
      }
      res.json({ success: true });
      return;
    }

    if (status === BookingStatus.TERMINATED) {
      // Household/admin terminates
      if (booking.bookingType === 'CONTRACT') {
        await db.terminateContract(booking.id);
      } else {
        // Adhoc or Replacement termination — close the record
        await db.terminateBooking(req.params.id);
      }
      res.json({ success: true });
      return;
    }

    // All other status changes — in-place update
    await db.updateBookingStatus(req.params.id, status as BookingStatus);

    // Notify household when maid accepts an ADHOC booking
    if (status === BookingStatus.CONFIRMED && booking.bookingType === 'ADHOC') {
      const info = await db.getNotificationInfoForBooking(req.params.id);
      if (info?.householdPushToken) {
        sendPushNotification(
          info.householdPushToken,
          'Booking Confirmed',
          `${info.maidName} has accepted your ${info.serviceName} booking. See you on ${booking.workStartDate}!`
        );
      }
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/bookings/:id/request-otp
// Contracts auto-advance (no OTP). REPLACEMENT bookings use OTP flow.
router.post('/:id/request-otp', async (req: Request, res: Response) => {
  try {
    const { type } = req.body; // 'start' | 'end'
    const booking = await db.getBookingById(req.params.id);
    if (!booking) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    if (booking.bookingType === 'CONTRACT') {
      // Auto-advance status — no OTP needed
      const nextStatus = type === 'start' ? BookingStatus.IN_PROGRESS : BookingStatus.COMPLETED;
      await db.updateBookingStatus(booking.id, nextStatus);
      res.json({ success: true, status: nextStatus, autoAdvanced: true, bookingId: booking.id });
      return;
    }

    // ADHOC and REPLACEMENT use OTP flow
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
    if (booking?.bookingType === 'CONTRACT') {
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
router.post('/:id/verify-otp', async (req: Request, res: Response) => {
  try {
    const { code, type } = req.body;
    const booking = await db.getBookingById(req.params.id);
    if (booking?.bookingType === 'CONTRACT') {
      res.status(400).json({ error: 'OTP verification is not applicable for contract bookings.' });
      return;
    }
    const masterOtp = process.env.TWILIO_MASTER_OTP || '1234';
    const isValid = code === masterOtp || await db.verifyStoredOtp(req.params.id, type, code);

    if (isValid) {
      const nextStatus = type === 'start' ? BookingStatus.IN_PROGRESS : BookingStatus.COMPLETED;
      await Promise.all([
        db.stampOtpTime(req.params.id, type),
        db.updateBookingStatus(req.params.id, nextStatus),
      ]);
      res.json({ success: true, status: nextStatus });
    } else {
      res.status(400).json({ error: 'The code you entered is incorrect.' });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/bookings/:id/generate-otp
router.post('/:id/generate-otp', async (req: Request, res: Response) => {
  try {
    const { type } = req.body;
    const booking = await db.getBookingById(req.params.id);
    if (booking?.bookingType === 'CONTRACT') {
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
