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
    const res = await request(app).get('/api/reviews/maid/maid-1');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No token provided');
  });

  it('returns 401 with an invalid token', async () => {
    const res = await request(app).get('/api/reviews/maid/maid-1').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired token');
  });
});

describe('GET /api/reviews/maid/:maidId', () => {
  it('returns reviews for the maid', async () => {
    const reviews = [{ id: 'r1', rating: 5, comment: 'Great' }];
    (db.getReviewsForMaid as jest.Mock).mockResolvedValue(reviews);
    const res = await request(app).get('/api/reviews/maid/maid-1').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(reviews);
    expect(db.getReviewsForMaid).toHaveBeenCalledWith('maid-1');
  });

  it('returns 500 when db throws', async () => {
    (db.getReviewsForMaid as jest.Mock).mockRejectedValue(new Error('reviews fail'));
    const res = await request(app).get('/api/reviews/maid/maid-1').set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('reviews fail');
  });
});

describe('POST /api/reviews', () => {
  const validBody = {
    bookingId: 'b1',
    maidId: 'maid-1',
    householdId: 'h1',
    householdName: 'Alice',
    rating: 5,
    comment: 'Great job',
  };

  it('adds a review and returns 201', async () => {
    (db.addReview as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app).post('/api/reviews').set('Authorization', authHeader).send(validBody);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
    expect(db.addReview).toHaveBeenCalledWith(validBody);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', authHeader)
      .send({ bookingId: 'b1', maidId: 'maid-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing required fields');
    expect(db.addReview).not.toHaveBeenCalled();
  });

  it('returns 400 when rating is missing', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', authHeader)
      .send({ bookingId: 'b1', maidId: 'maid-1', householdId: 'h1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing required fields');
  });

  it('returns 500 when db throws', async () => {
    (db.addReview as jest.Mock).mockRejectedValue(new Error('add review fail'));
    const res = await request(app).post('/api/reviews').set('Authorization', authHeader).send(validBody);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('add review fail');
  });
});
