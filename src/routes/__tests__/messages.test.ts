import request from 'supertest';
import { app } from '../../app';
import { db } from '../../services/database';
import { generateToken } from '../../middleware/auth';

jest.mock('../../services/database');

const token = generateToken({ userId: 'user-1', role: 'household' });
const authHeader = `Bearer ${token}`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('auth requirement', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/messages/booking-1');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No token provided');
  });

  it('returns 401 with an invalid token', async () => {
    const res = await request(app).get('/api/messages/booking-1').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired token');
  });
});

describe('GET /api/messages/counts', () => {
  it('returns {} when bookingIds query param is missing', async () => {
    const res = await request(app).get('/api/messages/counts').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
    expect(db.getMessageCounts).not.toHaveBeenCalled();
  });

  it('returns {} when bookingIds query param is empty', async () => {
    const res = await request(app).get('/api/messages/counts?bookingIds=').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
    expect(db.getMessageCounts).not.toHaveBeenCalled();
  });

  it('returns counts for the given booking ids', async () => {
    (db.getMessageCounts as jest.Mock).mockResolvedValue({ b1: 2, b2: 0 });
    const res = await request(app).get('/api/messages/counts?bookingIds=b1,b2').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ b1: 2, b2: 0 });
    expect(db.getMessageCounts).toHaveBeenCalledWith(['b1', 'b2'], 'user-1');
  });

  it('returns 500 when db throws', async () => {
    (db.getMessageCounts as jest.Mock).mockRejectedValue(new Error('counts fail'));
    const res = await request(app).get('/api/messages/counts?bookingIds=b1').set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('counts fail');
  });
});

describe('PUT /api/messages/:bookingId/read', () => {
  it('marks messages as read', async () => {
    (db.markMessagesRead as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app).put('/api/messages/booking-1/read').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(db.markMessagesRead).toHaveBeenCalledWith('booking-1', 'user-1');
  });

  it('returns 500 when db throws', async () => {
    (db.markMessagesRead as jest.Mock).mockRejectedValue(new Error('mark read fail'));
    const res = await request(app).put('/api/messages/booking-1/read').set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('mark read fail');
  });
});

describe('GET /api/messages/:bookingId', () => {
  it('returns messages for the booking', async () => {
    const messages = [{ id: 'm1', text: 'hi' }];
    (db.getMessages as jest.Mock).mockResolvedValue(messages);
    const res = await request(app).get('/api/messages/booking-1').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(messages);
    expect(db.getMessages).toHaveBeenCalledWith('booking-1');
  });

  it('returns 500 when db throws', async () => {
    (db.getMessages as jest.Mock).mockRejectedValue(new Error('get messages fail'));
    const res = await request(app).get('/api/messages/booking-1').set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('get messages fail');
  });
});

describe('POST /api/messages', () => {
  const validBody = { bookingId: 'b1', senderId: 'u1', senderName: 'Alice', text: 'Hello' };

  it('sends a message and returns 201', async () => {
    const created = { id: 'm1', ...validBody };
    (db.sendMessage as jest.Mock).mockResolvedValue(created);
    const res = await request(app).post('/api/messages').set('Authorization', authHeader).send(validBody);
    expect(res.status).toBe(201);
    expect(res.body).toEqual(created);
    expect(db.sendMessage).toHaveBeenCalledWith(validBody);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', authHeader)
      .send({ bookingId: 'b1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing required fields');
    expect(db.sendMessage).not.toHaveBeenCalled();
  });

  it('returns 500 when db throws', async () => {
    (db.sendMessage as jest.Mock).mockRejectedValue(new Error('send fail'));
    const res = await request(app).post('/api/messages').set('Authorization', authHeader).send(validBody);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('send fail');
  });
});
