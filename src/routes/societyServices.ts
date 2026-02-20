import { Router, Request, Response } from 'express';
import { db } from '../services/database';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /api/society-services?societyId=X
router.get('/', async (req: Request, res: Response) => {
  try {
    const societyId = req.query.societyId as string;
    if (!societyId) {
      res.status(400).json({ error: 'societyId query param required' });
      return;
    }
    const services = await db.getSocietyServices(societyId);
    res.json(services);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/society-services/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const service = await db.getSocietyServiceById(req.params.id);
    if (!service) {
      res.status(404).json({ error: 'Society service not found' });
      return;
    }
    res.json(service);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/society-services — activate a global service or create exclusive
router.post('/', async (req: Request, res: Response) => {
  try {
    const { societyId, serviceId, name, description, price, duration, icon, isGeneric } = req.body;
    if (!societyId) {
      res.status(400).json({ error: 'societyId is required' });
      return;
    }
    // For exclusive services, name must be provided with at least an English value
    const nameEn = name && (typeof name === 'string' ? name : name.en);
    if (!serviceId && (!nameEn || price == null || duration == null || !icon)) {
      res.status(400).json({ error: 'Exclusive services require name (with English), price, duration, and icon' });
      return;
    }
    const service = await db.addSocietyService({ societyId, serviceId, name, description, price, duration, icon, isGeneric });
    res.status(201).json(service);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/society-services/:id — update overrides
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const service = await db.updateSocietyService(req.params.id, req.body);
    res.json(service);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/society-services/:id — soft delete (deactivate)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await db.deleteSocietyService(req.params.id);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
