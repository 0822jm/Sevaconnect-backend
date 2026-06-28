import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import societyRoutes from './routes/societies';
import serviceRoutes from './routes/services';
import societyServiceRoutes from './routes/societyServices';
import bookingRoutes from './routes/bookings';
import contractUploadRoutes from './routes/contractUploads';
import messageRoutes from './routes/messages';
import reviewRoutes from './routes/reviews';

// Express app wiring, kept separate from index.ts's app.listen() / cron startup
// so tests can import `app` and drive it with supertest without binding a port
// or scheduling the cron job.
export const app = express();

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
