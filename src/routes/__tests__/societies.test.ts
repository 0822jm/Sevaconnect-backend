import request from 'supertest';
import { app } from '../../app';
import { db } from '../../services/database';
import { generateToken } from '../../middleware/auth';

jest.mock('../../services/database');

const token = generateToken({ userId: 'admin-1', role: 'SYS_ADMIN' });
const authHeader = `Bearer ${token}`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/societies', () => {
  it('returns societies without requiring auth', async () => {
    const societies = [{ id: 'soc-1', name: 'Green Park' }];
    (db.getSocieties as jest.Mock).mockResolvedValue(societies);
    const res = await request(app).get('/api/societies');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(societies);
  });

  it('returns 500 when db throws', async () => {
    (db.getSocieties as jest.Mock).mockRejectedValue(new Error('db fail'));
    const res = await request(app).get('/api/societies');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('db fail');
  });
});

describe('auth requirement for routes below', () => {
  it('returns 401 with no token on /with-stats', async () => {
    const res = await request(app).get('/api/societies/with-stats?start=2025-01-01&end=2025-01-31');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No token provided');
  });

  it('returns 401 with an invalid token', async () => {
    const res = await request(app)
      .get('/api/societies/with-stats?start=2025-01-01&end=2025-01-31')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired token');
  });
});

describe('GET /api/societies/with-stats', () => {
  it('returns 400 when start or end query params missing', async () => {
    const res = await request(app)
      .get('/api/societies/with-stats')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('start and end query params required');
  });

  it('returns stats data on success', async () => {
    const data = [{ id: 'soc-1', totalBookings: 5 }];
    (db.getSocietiesWithStats as jest.Mock).mockResolvedValue(data);
    const res = await request(app)
      .get('/api/societies/with-stats?start=2025-01-01&end=2025-01-31')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(data);
    expect(db.getSocietiesWithStats).toHaveBeenCalledWith('2025-01-01', '2025-01-31');
  });

  it('returns 500 when db throws', async () => {
    (db.getSocietiesWithStats as jest.Mock).mockRejectedValue(new Error('stats fail'));
    const res = await request(app)
      .get('/api/societies/with-stats?start=2025-01-01&end=2025-01-31')
      .set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('stats fail');
  });
});

describe('POST /api/societies', () => {
  it('creates a society and returns 201', async () => {
    const created = { id: 'soc-2', name: 'Blue Heights' };
    (db.createSociety as jest.Mock).mockResolvedValue(created);
    const res = await request(app)
      .post('/api/societies')
      .set('Authorization', authHeader)
      .send({ name: 'Blue Heights' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(created);
    expect(db.createSociety).toHaveBeenCalledWith({ name: 'Blue Heights' });
  });

  it('returns 400 when db throws', async () => {
    (db.createSociety as jest.Mock).mockRejectedValue(new Error('create fail'));
    const res = await request(app)
      .post('/api/societies')
      .set('Authorization', authHeader)
      .send({ name: 'Blue Heights' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('create fail');
  });
});

describe('GET /api/societies/:id', () => {
  it('returns the society', async () => {
    const society = { id: 'soc-1', name: 'Green Park' };
    (db.getSocietyById as jest.Mock).mockResolvedValue(society);
    const res = await request(app).get('/api/societies/soc-1').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(society);
    expect(db.getSocietyById).toHaveBeenCalledWith('soc-1');
  });

  it('returns 404 when society not found', async () => {
    (db.getSocietyById as jest.Mock).mockResolvedValue(null);
    const res = await request(app).get('/api/societies/missing').set('Authorization', authHeader);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Society not found');
  });

  it('returns 500 when db throws', async () => {
    (db.getSocietyById as jest.Mock).mockRejectedValue(new Error('lookup fail'));
    const res = await request(app).get('/api/societies/soc-1').set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('lookup fail');
  });
});

describe('GET /api/societies/:id/stats', () => {
  it('returns stats for the society', async () => {
    const stats = { totalMaids: 10, totalHouseholds: 20 };
    (db.getSocietyStats as jest.Mock).mockResolvedValue(stats);
    const res = await request(app).get('/api/societies/soc-1/stats').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(stats);
    expect(db.getSocietyStats).toHaveBeenCalledWith('soc-1');
  });

  it('returns 500 when db throws', async () => {
    (db.getSocietyStats as jest.Mock).mockRejectedValue(new Error('stats fail'));
    const res = await request(app).get('/api/societies/soc-1/stats').set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('stats fail');
  });
});

describe('GET /api/societies/:id/activity', () => {
  it('returns recent activity', async () => {
    const activity = [{ type: 'booking_created', at: '2025-01-01' }];
    (db.getRecentSocietyActivity as jest.Mock).mockResolvedValue(activity);
    const res = await request(app).get('/api/societies/soc-1/activity').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(activity);
    expect(db.getRecentSocietyActivity).toHaveBeenCalledWith('soc-1');
  });

  it('returns 500 when db throws', async () => {
    (db.getRecentSocietyActivity as jest.Mock).mockRejectedValue(new Error('activity fail'));
    const res = await request(app).get('/api/societies/soc-1/activity').set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('activity fail');
  });
});

describe('GET /api/societies/:id/bookings', () => {
  it('returns bookings for the society', async () => {
    const bookings = [{ id: 'bk-1' }];
    (db.getBookingsBySociety as jest.Mock).mockResolvedValue(bookings);
    const res = await request(app).get('/api/societies/soc-1/bookings').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(bookings);
    expect(db.getBookingsBySociety).toHaveBeenCalledWith('soc-1');
  });

  it('returns 500 when db throws', async () => {
    (db.getBookingsBySociety as jest.Mock).mockRejectedValue(new Error('bookings fail'));
    const res = await request(app).get('/api/societies/soc-1/bookings').set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('bookings fail');
  });
});

describe('POST /api/societies/:id/reset-pin', () => {
  it('resets the admin pin and returns the result', async () => {
    const result = { newPin: '1234' };
    (db.resetSocietyAdminPin as jest.Mock).mockResolvedValue(result);
    const res = await request(app).post('/api/societies/soc-1/reset-pin').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(result);
    expect(db.resetSocietyAdminPin).toHaveBeenCalledWith('soc-1');
  });

  it('returns 400 when db throws', async () => {
    (db.resetSocietyAdminPin as jest.Mock).mockRejectedValue(new Error('reset fail'));
    const res = await request(app).post('/api/societies/soc-1/reset-pin').set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('reset fail');
  });
});
