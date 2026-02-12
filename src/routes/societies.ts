import { Router, Request, Response } from 'express';
import { db } from '../services/database';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Public: GET /api/societies (needed for registration screen)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const societies = await db.getSocieties();
    res.json(societies);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// All routes below require authentication
router.use(authMiddleware);

// GET /api/societies/with-stats — must be before /:id
router.get('/with-stats', async (req: Request, res: Response) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      res.status(400).json({ error: 'start and end query params required' });
      return;
    }
    const data = await db.getSocietiesWithStats(start as string, end as string);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/societies
router.post('/', async (req: Request, res: Response) => {
  try {
    const result = await db.createSociety(req.body);
    res.status(201).json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/societies/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const society = await db.getSocietyById(req.params.id);
    if (!society) {
      res.status(404).json({ error: 'Society not found' });
      return;
    }
    res.json(society);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/societies/:id/stats
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const stats = await db.getSocietyStats(req.params.id);
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/societies/:id/activity
router.get('/:id/activity', async (req: Request, res: Response) => {
  try {
    const activity = await db.getRecentSocietyActivity(req.params.id);
    res.json(activity);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
