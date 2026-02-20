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
app.use('/api/messages', messageRoutes);
app.use('/api/reviews', reviewRoutes);

app.listen(PORT, () => {
  console.log(`[SevaConnect Backend] Running on http://localhost:${PORT}`);
  console.log(`[SevaConnect Backend] Health check: http://localhost:${PORT}/api/health`);
});
