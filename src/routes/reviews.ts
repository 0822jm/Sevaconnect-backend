import { Router, Request, Response } from 'express';
import { db } from '../services/database';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /api/reviews/maid/:maidId
router.get('/maid/:maidId', async (req: Request, res: Response) => {
  try {
    const reviews = await db.getReviewsForMaid(req.params.maidId);
    res.json(reviews);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/reviews
router.post('/', async (req: Request, res: Response) => {
  try {
    const { bookingId, maidId, householdId, householdName, rating, comment } = req.body;
    if (!bookingId || !maidId || !householdId || !rating) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }
    await db.addReview({ bookingId, maidId, householdId, householdName, rating, comment });
    res.status(201).json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
