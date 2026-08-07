import { Router, Request, Response } from 'express';
import { db, BookingStatus, UserRole, redactMatchingMaid, isMaidSlotConflict } from '../services/database';
import { authMiddleware } from '../middleware/auth';
import { sendLocalizedNotification } from '../services/pushNotifications';
import { notifyDelayedBookings } from '../services/delayedSweep';
import { reassignAndNotify, sweepTimedOutAnyMaid } from '../services/anyMaidReassign';
import { validateAdhocBookingTimes } from '../utils/bookingValidation';

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
    void notifyDelayedBookings(); // fire-and-forget same-day "Delayed" pushes (throttled ~15min)
    void sweepTimedOutAnyMaid(); // fire-and-forget any-maid accept-timeout re-picks (throttled ~5min)
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
      sendLocalizedNotification(
        info.householdPushToken,
        info.householdPreferredLocale,
        'contract.replacementNeededLeave',
        { maidName: info.maidName, date, leaveDesc },
        { type: 'contract', id: contractId },
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
    // Maid must serve the household's society — as their primary society OR an
    // approved secondary (multi-society) membership.
    if (!(await db.isMaidMemberOfSociety(maidId, household.societyId))) {
      res.status(400).json({ error: 'Maid does not serve this society' }); return;
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
      sendLocalizedNotification(
        (maid as any).expo_push_token,
        (maid as any).preferredLocale,
        'contract.createdMaid',
        { householdName: household.name || 'A household', startDate },
        { type: 'contract', id: bk.id },
      );
    }
    // Notify household — confirmation their own contract creation succeeded
    if ((household as any).expo_push_token) {
      sendLocalizedNotification(
        (household as any).expo_push_token,
        (household as any).preferredLocale,
        'contract.createdHousehold',
        { maidName: maid.name || 'Maid', startDate },
        { type: 'contract', id: bk.id },
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
    void notifyDelayedBookings();
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

    // Working-hours + future-time validation for ADHOC bookings (see utils/bookingValidation)
    if (bookingType === 'ADHOC') {
      const timeError = validateAdhocBookingTimes(req.body);
      if (timeError) {
        res.status(400).json({ error: timeError });
        return;
      }
    }

    if (bookingType !== 'CONTRACT' && req.body.maidId) {
      // Resolve the booking's society from the household and enforce that the maid
      // serves it (primary or approved secondary), then validate skills FOR that society.
      const household = await db.getUserById(req.body.householdId);
      const societyId = (household as any)?.societyId;
      if (!societyId) {
        res.status(400).json({ error: 'Household is not assigned to a society' });
        return;
      }
      if (!(await db.isMaidMemberOfSociety(req.body.maidId, societyId))) {
        res.status(400).json({ error: 'Maid does not serve this society' });
        return;
      }
      const requiredIds: string[] = Array.isArray(req.body.societyServiceIds) && req.body.societyServiceIds.length
        ? req.body.societyServiceIds
        : (req.body.societyServiceId ? [req.body.societyServiceId] : []);
      if (requiredIds.length > 0) {
        const maidSkills: string[] = await db.getMaidSkillsForSociety(req.body.maidId, societyId);
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
    if (req.body.maidId) {
      const info = await db.getNotificationInfoForBooking(booking.id);
      // Notify maid when the booking still requires their manual acceptance
      if (booking.status === BookingStatus.REQUESTED) {
        const maidInfo = await db.getUserPushInfo(req.body.maidId);
        if (maidInfo?.pushToken) {
          sendLocalizedNotification(
            maidInfo.pushToken,
            maidInfo.preferredLocale,
            'booking.newRequest',
            { householdName: info?.householdName || 'A household', date: booking.workStartDate, time: booking.startTime },
            { type: 'booking_request', id: booking.id },
          );
        }
      }
      // Notify household — either an auto-accept confirmation or a "request sent" confirmation,
      // distinguishing the two per the auto-accept requirement.
      if (info?.householdPushToken) {
        if ((booking as any).autoAccepted) {
          sendLocalizedNotification(
            info.householdPushToken,
            info.householdPreferredLocale,
            'booking.requestSentAutoAccept',
            { maidName: info.maidName, date: booking.workStartDate, time: booking.startTime },
            { type: 'booking', id: booking.id },
          );
        } else if (booking.status === BookingStatus.REQUESTED) {
          sendLocalizedNotification(
            info.householdPushToken,
            info.householdPreferredLocale,
            'booking.requestSentPendingApproval',
            { date: booking.workStartDate, time: booking.startTime, maidName: info.maidName },
            { type: 'booking', id: booking.id },
          );
        }
      }
    }
    res.status(201).json(booking);
  } catch (e: any) {
    // The exclusion constraint fired: this maid was concurrently booked for an overlapping slot.
    if (isMaidSlotConflict(e)) {
      res.status(409).json({ error: 'This maid is no longer available for the selected time.' });
      return;
    }
    res.status(500).json({ error: e.message });
  }
});

// POST /api/bookings/book-any-maid — household chose "any available maid"; the SERVER assigns one
// (weighted by trust score) from the eligible pool. No maidId is trusted from the client. `poolType`
// tells us which option the client displayed:
//   'AUTO_ACCEPT' → maids whose auto-accept covers the slot → booking is instantly CONFIRMED.
//   'ANY'         → maids without auto-accept → REQUESTED; the assigned maid stays HIDDEN from the
//                   household ("matching you with a maid…") until they accept.
// Idempotency-key protects against double-submits / cross-instance retries.
router.post('/book-any-maid', async (req: Request, res: Response) => {
  try {
    const bookingType = req.body.bookingType || 'ADHOC';
    const poolType: 'AUTO_ACCEPT' | 'ANY' = req.body.poolType === 'AUTO_ACCEPT' ? 'AUTO_ACCEPT' : 'ANY';
    const idempotencyKey: string | null = req.body.idempotencyKey || null;

    // Working-hours + future-time validation (identical to the named-maid flow).
    if (bookingType === 'ADHOC') {
      const timeError = validateAdhocBookingTimes(req.body);
      if (timeError) {
        res.status(400).json({ error: timeError });
        return;
      }
    }

    // Idempotency: a retried request with the same key returns the already-created booking
    // (redacted if still awaiting the maid's acceptance).
    if (idempotencyKey) {
      const existing = await db.getBookingByIdempotencyKey(idempotencyKey);
      if (existing) {
        res.status(201).json(redactMatchingMaid(existing, 'HOUSEHOLD'));
        return;
      }
    }

    // Resolve the booking's society from the household.
    const household = await db.getUserById(req.body.householdId);
    const societyId = (household as any)?.societyId;
    if (!societyId) {
      res.status(400).json({ error: 'Household is not assigned to a society' });
      return;
    }

    const requiredServiceIds: string[] = Array.isArray(req.body.societyServiceIds) && req.body.societyServiceIds.length
      ? req.body.societyServiceIds
      : (req.body.societyServiceId ? [req.body.societyServiceId] : []);

    // Exclude the preferred maid — they're offered separately at the top of the list.
    const excludeIds: string[] = [];
    if (req.body.preferredMaidId) excludeIds.push(req.body.preferredMaidId);

    const pool = await db.getAvailableMaidPool({
      societyId,
      date: req.body.workStartDate,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
      requiredServiceIds,
      excludeIds,
    });

    // Partition: a maid "covers" the slot when auto-accept is on AND (no window ⇒ always, else the
    // slot fits inside the window) — mirrors createBooking's auto-accept detection exactly so the
    // resulting status matches the pool the household picked.
    const covers = (m: { autoAccept: boolean; autoAcceptFrom: string | null; autoAcceptTo: string | null }) =>
      m.autoAccept && ((!m.autoAcceptFrom || !m.autoAcceptTo)
        ? true
        : (req.body.startTime >= m.autoAcceptFrom && req.body.endTime <= m.autoAcceptTo));
    const subPool = poolType === 'AUTO_ACCEPT' ? pool.filter(covers) : pool.filter((m) => !covers(m));

    if (subPool.length === 0) {
      res.status(409).json({ error: 'NO_MAIDS_AVAILABLE', poolType });
      return;
    }

    // Strip any client-supplied identity/control fields — the server assigns the maid.
    const { maidId, poolType: _pt, idempotencyKey: _ik, preferredMaidId: _pm, ...bookingParams } = req.body;

    const result = await db.assignAnyMaid({ poolType, pool: subPool, bookingParams, idempotencyKey });
    if (!result) {
      res.status(409).json({ error: 'NO_MAIDS_AVAILABLE', poolType });
      return;
    }

    const { booking, maidId: assignedMaidId, maidName } = result;
    const info = await db.getNotificationInfoForBooking(booking.id);

    if (booking.status === BookingStatus.CONFIRMED) {
      // Auto-accept pool — the maid is revealed; household gets the confirmation.
      if (info?.householdPushToken) {
        sendLocalizedNotification(
          info.householdPushToken,
          info.householdPreferredLocale,
          'booking.requestSentAutoAccept',
          { maidName: maidName || info.maidName, date: booking.workStartDate, time: booking.startTime },
          { type: 'booking', id: booking.id },
        );
      }
    } else {
      // Manual pool — REQUESTED. Notify the assigned maid; the household sees a nameless "matching…".
      const maidInfo = await db.getUserPushInfo(assignedMaidId);
      if (maidInfo?.pushToken) {
        sendLocalizedNotification(
          maidInfo.pushToken,
          maidInfo.preferredLocale,
          'booking.newRequest',
          { householdName: info?.householdName || 'A household', date: booking.workStartDate, time: booking.startTime },
          { type: 'booking_request', id: booking.id },
        );
      }
      if (info?.householdPushToken) {
        sendLocalizedNotification(
          info.householdPushToken,
          info.householdPreferredLocale,
          'booking.anyMaidMatching',
          { date: booking.workStartDate, time: booking.startTime },
          { type: 'booking', id: booking.id },
        );
      }
    }

    // Redact the assigned maid from the household's own response while still REQUESTED.
    res.status(201).json(redactMatchingMaid(booking, 'HOUSEHOLD'));
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
          sendLocalizedNotification(
            info.maidPushToken,
            info.maidPreferredLocale,
            'contract.updated',
            { householdName: info.householdName, changes: changes.join(', ') },
            { type: 'contract', id: booking.id },
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
        sendLocalizedNotification(
          info.householdPushToken,
          info.householdPreferredLocale,
          'contract.terminatedByMaid',
          { maidName: info.maidName },
          { type: 'contract', id: req.params.contractId },
        );
      }
    } else {
      const info = booking.stagingContractId
        ? await db.getMaidInfoForContract(booking.stagingContractId).catch(() => null)
        : null;
      await db.terminateContract(req.params.contractId);
      if (info?.maidPushToken) {
        sendLocalizedNotification(
          info.maidPushToken,
          info.maidPreferredLocale,
          'contract.terminatedByHousehold',
          { householdName: info.householdName },
          { type: 'contract', id: req.params.contractId },
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
    // The replacement maid must serve the booking's society (primary or secondary).
    const rHousehold = await db.getUserById(booking.householdId);
    const rSocietyId = (rHousehold as any)?.societyId;
    if (rSocietyId && !(await db.isMaidMemberOfSociety(replacementMaidId, rSocietyId))) {
      res.status(400).json({ error: 'Replacement maid does not serve this society' });
      return;
    }

    const result = await db.assignReplacementForBooking(req.params.id, replacementMaidId);

    // Notify replacement maid
    const pushToken = (replacementMaid as any).expo_push_token;
    if (pushToken) {
      const dateLabel = new Date(booking.workStartDate + 'T00:00').toLocaleDateString('en-IN', {
        weekday: 'short', day: 'numeric', month: 'short',
      });
      sendLocalizedNotification(
        pushToken,
        replacementMaid.preferredLocale,
        result.bookingType === 'REPLACEMENT' ? 'booking.replacementAssignedContract' : 'booking.replacementAssignedAdhoc',
        { date: dateLabel, time: booking.startTime },
        { type: 'booking', id: result.newBookingId },
      );
    }

    res.json({ success: true, newBookingId: result.newBookingId });
  } catch (e: any) {
    if (isMaidSlotConflict(e)) {
      res.status(409).json({ error: 'This maid is no longer available for the selected time.' });
      return;
    }
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
          sendLocalizedNotification(
            info.householdPushToken,
            info.householdPreferredLocale,
            'contract.replacementNeededCancel',
            { maidName: info.maidName, date },
            { type: 'contract', id: booking.id },
          );
        }
        res.json({ success: true, replacementId: replacement?.id });
        return;
      }
      // Adhoc or Replacement cancellation — status in-place, record stays open
      const cancelledBy = (req.body.cancelledBy as string) || 'MAID';

      // "Any maid" decline: the assigned maid declining a still-REQUESTED any-maid booking must NOT
      // cancel it — silently re-pick another eligible maid (or cancel only if the pool is exhausted).
      // Handle this BEFORE the cancel below so the row is never marked CANCELLED on a normal decline.
      if (cancelledBy !== 'HOUSEHOLD' && booking.status === BookingStatus.REQUESTED && booking.anyMaidPool) {
        await reassignAndNotify(req.params.id, 'decline');
        res.json({ success: true, reassigned: true });
        return;
      }

      const preUpdateStatus = booking.status; // capture before the mutation below
      await db.updateBookingStatus(req.params.id, BookingStatus.CANCELLED, cancelledBy);

      if (cancelledBy === 'HOUSEHOLD') {
        // Notify the maid — previously skipped entirely.
        const info = await db.getMaidNotificationInfoForBooking(req.params.id);
        if (info?.maidPushToken) {
          sendLocalizedNotification(
            info.maidPushToken,
            info.maidPreferredLocale,
            'booking.cancelledByHousehold',
            { householdName: info.householdName, date: booking.workStartDate, time: booking.startTime },
            { type: 'booking', id: req.params.id },
          );
        }
      } else {
        // Maid acted: a still-REQUESTED booking being cancelled is a decline (nothing was ever
        // confirmed); a CONFIRMED booking being cancelled is a genuine cancellation. Distinguish
        // using the pre-update status rather than reusing the same wording for both.
        const info = await db.getNotificationInfoForBooking(req.params.id);
        if (info?.householdPushToken) {
          const dateLabel = new Date(booking.workStartDate + 'T00:00').toLocaleDateString('en-IN', {
            weekday: 'short', day: 'numeric', month: 'short',
          });
          if (preUpdateStatus === BookingStatus.REQUESTED) {
            sendLocalizedNotification(
              info.householdPushToken,
              info.householdPreferredLocale,
              'booking.declinedByMaid',
              { maidName: info.maidName, date: dateLabel },
              { type: 'booking', id: req.params.id },
            );
          } else {
            sendLocalizedNotification(
              info.householdPushToken,
              info.householdPreferredLocale,
              'booking.cancelledByMaid',
              { maidName: info.maidName, serviceName: info.serviceName, date: dateLabel },
              { type: 'booking', id: req.params.id },
            );
          }
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

    // Notify household when maid manually accepts an ADHOC booking (auto-accept never reaches
    // this route — it resolves synchronously inside createBooking — so this is always a manual
    // accept, no auto/manual branching needed here).
    if (status === BookingStatus.CONFIRMED && booking.bookingType === 'ADHOC') {
      const info = await db.getNotificationInfoForBooking(req.params.id);
      if (info?.householdPushToken) {
        sendLocalizedNotification(
          info.householdPushToken,
          info.householdPreferredLocale,
          'booking.confirmedManual',
          { maidName: info.maidName, serviceName: info.serviceName, date: booking.workStartDate },
          { type: 'booking', id: req.params.id },
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

// POST /api/bookings/:id/report-no-show
// Household action on a Delayed card: mark a not-yet-started ad-hoc/replacement booking as NO_SHOW
// on demand (the same-day equivalent of the nightly sweep's CONFIRMED → NO_SHOW transition), so the
// household doesn't have to wait until the next day. Contracts have no per-session state, so N/A.
router.post('/:id/report-no-show', async (req: Request, res: Response) => {
  try {
    const booking = await db.getBookingById(req.params.id);
    if (!booking) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }
    if (booking.bookingType === 'CONTRACT') {
      res.status(400).json({ error: 'No-show reporting is not applicable for contract bookings.' });
      return;
    }
    if (booking.status !== BookingStatus.CONFIRMED) {
      res.status(409).json({ error: 'Only a confirmed, not-yet-started booking can be reported as a no-show.' });
      return;
    }
    await db.updateBookingStatus(req.params.id, BookingStatus.NO_SHOW);
    res.json({ success: true, status: BookingStatus.NO_SHOW });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
