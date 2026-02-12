import { Router, Request, Response } from 'express';
import { db } from '../services/database';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /api/users/society/:societyId
router.get('/society/:societyId', async (req: Request, res: Response) => {
  try {
    const users = await db.getUsersBySociety(req.params.societyId);
    const safeUsers = users.map(({ password_hash, ...rest }: any) => rest);
    res.json(safeUsers);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/users/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const user = await db.getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const { password_hash, ...safeUser } = user as any;
    res.json(safeUser);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/users/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const updated = await db.updateUser(req.params.id, req.body);
    const { password_hash, ...safeUser } = updated as any;
    res.json(safeUser);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/users/:id/verify
router.post('/:id/verify', async (req: Request, res: Response) => {
  try {
    await db.verifyUser(req.params.id);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/users/:id/skills
router.put('/:id/skills', async (req: Request, res: Response) => {
  try {
    const { skills } = req.body;
    await db.updateMaidSkills(req.params.id, skills);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/users/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await db.deleteUser(req.params.id);
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/users/:id/leave
// body: { date: "2025-01-15", leaveType: "MORNING" | "AFTERNOON" | "FULL" | null }
// Also accepts legacy format: { date: "2025-01-15" } for simple toggle
router.post('/:id/leave', async (req: Request, res: Response) => {
  try {
    const { date, leaveType } = req.body;
    const leaves = await db.setLeave(req.params.id, date, leaveType);
    res.json({ leaves });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
