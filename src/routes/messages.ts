import { Router, Request, Response } from 'express';
import { db } from '../services/database';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /api/messages/counts?bookingIds=id1,id2,id3
// Must be BEFORE /:bookingId to avoid being caught by that route
router.get('/counts', async (req: Request, res: Response) => {
  try {
    const ids = ((req.query.bookingIds as string) || '').split(',').filter(Boolean);
    if (!ids.length) { res.json({}); return; }
    const counts = await db.getMessageCounts(ids);
    res.json(counts);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/messages/:bookingId
router.get('/:bookingId', async (req: Request, res: Response) => {
  try {
    const messages = await db.getMessages(req.params.bookingId);
    res.json(messages);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/messages
router.post('/', async (req: Request, res: Response) => {
  try {
    const { bookingId, senderId, senderName, text } = req.body;
    if (!bookingId || !senderId || !senderName || !text) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }
    const message = await db.sendMessage({ bookingId, senderId, senderName, text });
    res.status(201).json(message);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
