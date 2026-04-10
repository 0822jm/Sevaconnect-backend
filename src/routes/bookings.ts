import { Router, Request, Response } from 'express';
import { db, BookingStatus, UserRole } from '../services/database';
import { authMiddleware } from '../middleware/auth';

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
      const newId = await db.scdUpdateBooking(req.params.id, { status: BookingStatus.COMPLETED, active: false, effEndDate: new Date().toISOString().split('T')[0] });
      res.json({ success: true, newId });
    } else {
      await db.updateBookingStatus(req.params.id, status as BookingStatus);
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
        await db.scdUpdateBooking(req.params.id, { status: BookingStatus.COMPLETED, active: false, effEndDate: new Date().toISOString().split('T')[0] });
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
