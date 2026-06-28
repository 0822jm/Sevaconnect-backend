import request from 'supertest';
import { app } from '../../app';
import { db } from '../../services/database';
import { generateToken } from '../../middleware/auth';

jest.mock('../../services/database');

const token = generateToken({ userId: 'user-1', role: 'admin' });
const authHeader = `Bearer ${token}`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/society-services (public)', () => {
  it('returns services for the society without auth', async () => {
    const services = [{ id: 'ss1', name: 'Cleaning' }];
    (db.getSocietyServices as jest.Mock).mockResolvedValue(services);
    const res = await request(app).get('/api/society-services?societyId=soc-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(services);
    expect(db.getSocietyServices).toHaveBeenCalledWith('soc-1');
  });

  it('returns 400 when societyId query param is missing', async () => {
    const res = await request(app).get('/api/society-services');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('societyId query param required');
    expect(db.getSocietyServices).not.toHaveBeenCalled();
  });

  it('returns 500 when db throws', async () => {
    (db.getSocietyServices as jest.Mock).mockRejectedValue(new Error('list fail'));
    const res = await request(app).get('/api/society-services?societyId=soc-1');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('list fail');
  });
});

describe('GET /api/society-services/:id (public)', () => {
  it('returns the society service without auth', async () => {
    const service = { id: 'ss1', name: 'Cleaning' };
    (db.getSocietyServiceById as jest.Mock).mockResolvedValue(service);
    const res = await request(app).get('/api/society-services/ss1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(service);
    expect(db.getSocietyServiceById).toHaveBeenCalledWith('ss1');
  });

  it('returns 404 when not found', async () => {
    (db.getSocietyServiceById as jest.Mock).mockResolvedValue(null);
    const res = await request(app).get('/api/society-services/missing');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Society service not found');
  });

  it('returns 500 when db throws', async () => {
    (db.getSocietyServiceById as jest.Mock).mockRejectedValue(new Error('get fail'));
    const res = await request(app).get('/api/society-services/ss1');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('get fail');
  });
});

describe('POST /api/society-services (protected)', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).post('/api/society-services').send({ societyId: 'soc-1', serviceId: 'svc-1' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No token provided');
  });

  it('returns 401 with an invalid token', async () => {
    const res = await request(app)
      .post('/api/society-services')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ societyId: 'soc-1', serviceId: 'svc-1' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired token');
  });

  it('activates a global service (serviceId present, no other fields required) and returns 201', async () => {
    const created = { id: 'ss1', societyId: 'soc-1', serviceId: 'svc-1' };
    (db.addSocietyService as jest.Mock).mockResolvedValue(created);
    const res = await request(app)
      .post('/api/society-services')
      .set('Authorization', authHeader)
      .send({ societyId: 'soc-1', serviceId: 'svc-1' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(created);
    expect(db.addSocietyService).toHaveBeenCalledWith({
      societyId: 'soc-1',
      serviceId: 'svc-1',
      name: undefined,
      description: undefined,
      price: undefined,
      duration: undefined,
      icon: undefined,
      isGeneric: undefined,
    });
  });

  it('creates an exclusive service with full fields and returns 201', async () => {
    const body = {
      societyId: 'soc-1',
      name: { en: 'Deep Clean' },
      description: 'desc',
      price: 500,
      duration: 90,
      icon: 'broom',
    };
    const created = { id: 'ss2', ...body };
    (db.addSocietyService as jest.Mock).mockResolvedValue(created);
    const res = await request(app).post('/api/society-services').set('Authorization', authHeader).send(body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual(created);
    expect(db.addSocietyService).toHaveBeenCalledWith({
      societyId: 'soc-1',
      serviceId: undefined,
      name: { en: 'Deep Clean' },
      description: 'desc',
      price: 500,
      duration: 90,
      icon: 'broom',
      isGeneric: undefined,
    });
  });

  it('accepts a string name for exclusive services', async () => {
    const body = { societyId: 'soc-1', name: 'Deep Clean', price: 500, duration: 90, icon: 'broom' };
    (db.addSocietyService as jest.Mock).mockResolvedValue({ id: 'ss3', ...body });
    const res = await request(app).post('/api/society-services').set('Authorization', authHeader).send(body);
    expect(res.status).toBe(201);
  });

  it('returns 400 when societyId is missing', async () => {
    const res = await request(app)
      .post('/api/society-services')
      .set('Authorization', authHeader)
      .send({ serviceId: 'svc-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('societyId is required');
    expect(db.addSocietyService).not.toHaveBeenCalled();
  });

  it('returns 400 when exclusive service is missing name', async () => {
    const res = await request(app)
      .post('/api/society-services')
      .set('Authorization', authHeader)
      .send({ societyId: 'soc-1', price: 500, duration: 90, icon: 'broom' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Exclusive services require name (with English), price, duration, and icon');
  });

  it('returns 400 when exclusive service name has no English value', async () => {
    const res = await request(app)
      .post('/api/society-services')
      .set('Authorization', authHeader)
      .send({ societyId: 'soc-1', name: { fr: 'Nettoyage' }, price: 500, duration: 90, icon: 'broom' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Exclusive services require name (with English), price, duration, and icon');
  });

  it('returns 400 when exclusive service is missing price', async () => {
    const res = await request(app)
      .post('/api/society-services')
      .set('Authorization', authHeader)
      .send({ societyId: 'soc-1', name: { en: 'Deep Clean' }, duration: 90, icon: 'broom' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Exclusive services require name (with English), price, duration, and icon');
  });

  it('returns 400 when exclusive service is missing duration', async () => {
    const res = await request(app)
      .post('/api/society-services')
      .set('Authorization', authHeader)
      .send({ societyId: 'soc-1', name: { en: 'Deep Clean' }, price: 500, icon: 'broom' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Exclusive services require name (with English), price, duration, and icon');
  });

  it('returns 400 when exclusive service is missing icon', async () => {
    const res = await request(app)
      .post('/api/society-services')
      .set('Authorization', authHeader)
      .send({ societyId: 'soc-1', name: { en: 'Deep Clean' }, price: 500, duration: 90 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Exclusive services require name (with English), price, duration, and icon');
  });

  it('returns 500 when db throws', async () => {
    (db.addSocietyService as jest.Mock).mockRejectedValue(new Error('add fail'));
    const res = await request(app)
      .post('/api/society-services')
      .set('Authorization', authHeader)
      .send({ societyId: 'soc-1', serviceId: 'svc-1' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('add fail');
  });
});

describe('PUT /api/society-services/:id (protected)', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).put('/api/society-services/ss1').send({ price: 600 });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No token provided');
  });

  it('updates the society service', async () => {
    const updated = { id: 'ss1', price: 600 };
    (db.updateSocietyService as jest.Mock).mockResolvedValue(updated);
    const res = await request(app)
      .put('/api/society-services/ss1')
      .set('Authorization', authHeader)
      .send({ price: 600 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(updated);
    expect(db.updateSocietyService).toHaveBeenCalledWith('ss1', { price: 600 });
  });

  it('returns 500 when db throws', async () => {
    (db.updateSocietyService as jest.Mock).mockRejectedValue(new Error('update fail'));
    const res = await request(app)
      .put('/api/society-services/ss1')
      .set('Authorization', authHeader)
      .send({ price: 600 });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('update fail');
  });
});

describe('DELETE /api/society-services/:id (protected)', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).delete('/api/society-services/ss1');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No token provided');
  });

  it('soft-deletes the society service', async () => {
    (db.deleteSocietyService as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app).delete('/api/society-services/ss1').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.deleteSocietyService).toHaveBeenCalledWith('ss1');
  });

  it('returns 500 when db throws', async () => {
    (db.deleteSocietyService as jest.Mock).mockRejectedValue(new Error('delete fail'));
    const res = await request(app).delete('/api/society-services/ss1').set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('delete fail');
  });
});
