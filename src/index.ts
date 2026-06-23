import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { db } from './services/database';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import societyRoutes from './routes/societies';
import serviceRoutes from './routes/services';
import societyServiceRoutes from './routes/societyServices';
import bookingRoutes from './routes/bookings';
import contractUploadRoutes from './routes/contractUploads';
import messageRoutes from './routes/messages';
import reviewRoutes from './routes/reviews';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/societies', societyRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/society-services', societyServiceRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/contract-uploads', contractUploadRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/reviews', reviewRoutes);

app.listen(PORT, () => {
  console.log(`[Kamon Backend] Running on http://localhost:${PORT}`);
  console.log(`[Kamon Backend] Health check: http://localhost:${PORT}/api/health`);

  // Stale-booking sweep: NO_SHOW / INCOMPLETE for ADHOC bookings whose day has passed.
  // Primary trigger = daily cron at 00:30 IST; on free-tier the service may be asleep, so the
  // lazy on-fetch fallback (db.maybeSweepStaleBookings in booking-list routes) is the real safety net.
  db.sweepStaleBookings()
    .then((r) => console.log(`[sweepStaleBookings] startup: ${r.noShow} no-show, ${r.incomplete} incomplete`))
    .catch((e) => console.error('[sweepStaleBookings] startup failed', e));

  cron.schedule(
    '30 0 * * *',
    () => {
      db.sweepStaleBookings()
        .then((r) => console.log(`[sweepStaleBookings] cron: ${r.noShow} no-show, ${r.incomplete} incomplete`))
        .catch((e) => console.error('[sweepStaleBookings] cron failed', e));
    },
    { timezone: 'Asia/Kolkata' },
  );
});
