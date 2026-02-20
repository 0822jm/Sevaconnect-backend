import { Router, Request, Response } from 'express';
import { db } from '../services/database';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /api/services — global catalogue; pass ?all=true to include inactive
router.get('/', async (req: Request, res: Response) => {
  try {
    const services = req.query.all === 'true'
      ? await db.getAllServices()
      : await db.getServices();
    res.json(services);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/services/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const service = await db.getServiceById(req.params.id);
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    res.json(service);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/services
router.post('/', async (req: Request, res: Response) => {
  try {
    const service = await db.addService(req.body);
    res.status(201).json(service);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/services/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const updated = await db.updateService(req.params.id, req.body);
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/services/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await db.deleteService(req.params.id);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
