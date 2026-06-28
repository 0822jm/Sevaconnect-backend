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

describe('auth requirement', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/services');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No token provided');
  });

  it('returns 401 with an invalid token', async () => {
    const res = await request(app).get('/api/services').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired token');
  });
});

describe('GET /api/services', () => {
  it('returns active services by default', async () => {
    const services = [{ id: 's1', name: 'Cleaning' }];
    (db.getServices as jest.Mock).mockResolvedValue(services);
    const res = await request(app).get('/api/services').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(services);
    expect(db.getServices).toHaveBeenCalled();
    expect(db.getAllServices).not.toHaveBeenCalled();
  });

  it('returns all services including inactive when all=true', async () => {
    const services = [{ id: 's1', name: 'Cleaning' }, { id: 's2', name: 'Cooking', active: false }];
    (db.getAllServices as jest.Mock).mockResolvedValue(services);
    const res = await request(app).get('/api/services?all=true').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(services);
    expect(db.getAllServices).toHaveBeenCalled();
    expect(db.getServices).not.toHaveBeenCalled();
  });

  it('returns 500 when db throws', async () => {
    (db.getServices as jest.Mock).mockRejectedValue(new Error('services fail'));
    const res = await request(app).get('/api/services').set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('services fail');
  });
});

describe('GET /api/services/:id', () => {
  it('returns the service', async () => {
    const service = { id: 's1', name: 'Cleaning' };
    (db.getServiceById as jest.Mock).mockResolvedValue(service);
    const res = await request(app).get('/api/services/s1').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(service);
    expect(db.getServiceById).toHaveBeenCalledWith('s1');
  });

  it('returns 404 when service not found', async () => {
    (db.getServiceById as jest.Mock).mockResolvedValue(null);
    const res = await request(app).get('/api/services/missing').set('Authorization', authHeader);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Service not found');
  });

  it('returns 500 when db throws', async () => {
    (db.getServiceById as jest.Mock).mockRejectedValue(new Error('get service fail'));
    const res = await request(app).get('/api/services/s1').set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('get service fail');
  });
});

describe('POST /api/services', () => {
  const body = { name: 'Cleaning', price: 100, duration: 60, icon: 'broom' };

  it('creates a service and returns 201', async () => {
    const created = { id: 's1', ...body };
    (db.addService as jest.Mock).mockResolvedValue(created);
    const res = await request(app).post('/api/services').set('Authorization', authHeader).send(body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual(created);
    expect(db.addService).toHaveBeenCalledWith(body);
  });

  it('returns 500 when db throws', async () => {
    (db.addService as jest.Mock).mockRejectedValue(new Error('add fail'));
    const res = await request(app).post('/api/services').set('Authorization', authHeader).send(body);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('add fail');
  });
});

describe('PUT /api/services/:id', () => {
  it('updates the service', async () => {
    const updated = { id: 's1', name: 'Cleaning Updated' };
    (db.updateService as jest.Mock).mockResolvedValue(updated);
    const res = await request(app)
      .put('/api/services/s1')
      .set('Authorization', authHeader)
      .send({ name: 'Cleaning Updated' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(updated);
    expect(db.updateService).toHaveBeenCalledWith('s1', { name: 'Cleaning Updated' });
  });

  it('returns 500 when db throws', async () => {
    (db.updateService as jest.Mock).mockRejectedValue(new Error('update fail'));
    const res = await request(app).put('/api/services/s1').set('Authorization', authHeader).send({ name: 'X' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('update fail');
  });
});

describe('DELETE /api/services/:id', () => {
  it('deletes the service', async () => {
    (db.deleteService as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app).delete('/api/services/s1').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.deleteService).toHaveBeenCalledWith('s1');
  });

  it('returns 500 when db throws', async () => {
    (db.deleteService as jest.Mock).mockRejectedValue(new Error('delete fail'));
    const res = await request(app).delete('/api/services/s1').set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('delete fail');
  });
});
