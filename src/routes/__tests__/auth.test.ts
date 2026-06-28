import request from 'supertest';
import { app } from '../../app';
import { db } from '../../services/database';
import { formatPhoneE164, startTwilioVerify, checkTwilioVerify } from '../../services/twilio';

jest.mock('../../services/database');
jest.mock('../../services/twilio');

beforeEach(() => {
  jest.clearAllMocks();
  (formatPhoneE164 as jest.Mock).mockImplementation((p: string) => p);
});

describe('POST /api/auth/login', () => {
  it('returns 400 when username or password missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'foo' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Username and password are required');
  });

  it('returns 401 when db.login returns null', async () => {
    (db.login as jest.Mock).mockResolvedValue(null);
    const res = await request(app).post('/api/auth/login').send({ username: 'foo', password: '123456' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid identifier or 6-digit PIN.');
  });

  it('returns 200 with token and user, stripping password_hash, on success', async () => {
    (db.login as jest.Mock).mockResolvedValue({
      id: 'u1',
      role: 'household',
      username: 'foo',
      password_hash: 'secret-hash',
    });
    const res = await request(app).post('/api/auth/login').send({ username: 'foo', password: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toEqual({ id: 'u1', role: 'household', username: 'foo' });
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('returns 500 when db.login throws', async () => {
    (db.login as jest.Mock).mockRejectedValue(new Error('db down'));
    const res = await request(app).post('/api/auth/login').send({ username: 'foo', password: '123456' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('db down');
  });
});

describe('POST /api/auth/register/send-otp', () => {
  const validBody = {
    phone: '9876543210',
    name: 'Jane',
    username: 'jane1',
    role: 'maid',
    societyId: 'soc1',
  };

  it('returns 400 listing missing required fields', async () => {
    const res = await request(app).post('/api/auth/register/send-otp').send({ phone: '9876543210' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing required fields: name, username, role, societyId');
  });

  it('returns 400 when phone already registered', async () => {
    (db.isPhoneRegistered as jest.Mock).mockResolvedValue(true);
    const res = await request(app).post('/api/auth/register/send-otp').send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('This phone number is already registered to an account.');
  });

  it('returns 400 when autoAcceptFrom format is invalid', async () => {
    (db.isPhoneRegistered as jest.Mock).mockResolvedValue(false);
    const res = await request(app)
      .post('/api/auth/register/send-otp')
      .send({ ...validBody, autoAcceptFrom: '9am' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('autoAcceptFrom must be HH:MM');
  });

  it('returns 400 when autoAcceptTo format is invalid', async () => {
    (db.isPhoneRegistered as jest.Mock).mockResolvedValue(false);
    const res = await request(app)
      .post('/api/auth/register/send-otp')
      .send({ ...validBody, autoAcceptTo: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('autoAcceptTo must be HH:MM');
  });

  it('returns 400 when autoAcceptTo <= autoAcceptFrom', async () => {
    (db.isPhoneRegistered as jest.Mock).mockResolvedValue(false);
    const res = await request(app)
      .post('/api/auth/register/send-otp')
      .send({ ...validBody, autoAcceptFrom: '10:00', autoAcceptTo: '09:00' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('autoAcceptTo must be after autoAcceptFrom');
  });

  it('sends OTP via formatted E.164 phone and returns 200 on success', async () => {
    (db.isPhoneRegistered as jest.Mock).mockResolvedValue(false);
    (formatPhoneE164 as jest.Mock).mockImplementation((p: string) => `+91${p}`);
    (startTwilioVerify as jest.Mock).mockResolvedValue({ success: true });
    const res = await request(app).post('/api/auth/register/send-otp').send(validBody);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Verification code sent via SMS' });
    expect(startTwilioVerify).toHaveBeenCalledWith('+919876543210');
  });
});

describe('POST /api/auth/register', () => {
  const validBody = {
    name: 'Jane',
    phone: '9876543210',
    username: 'jane1',
    password: '123456',
    role: 'maid',
    societyId: 'soc1',
    otp: '123456',
  };

  it('returns 400 listing missing required fields', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'Jane' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing required fields: phone, username, password, role, societyId, otp');
  });

  it('returns 400 when skills is not an array of strings', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validBody, skills: [1, 2] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('skills must be an array of strings');
  });

  it('returns 400 when db.validateSkillIds returns false', async () => {
    (db.validateSkillIds as jest.Mock).mockResolvedValue(false);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validBody, skills: ['cleaning'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid skill ids');
    expect(db.validateSkillIds).toHaveBeenCalledWith('soc1', ['cleaning']);
  });

  it('returns 400 when checkTwilioVerify fails', async () => {
    (checkTwilioVerify as jest.Mock).mockResolvedValue({ success: false, error: 'Incorrect code' });
    const res = await request(app).post('/api/auth/register').send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Incorrect code');
  });

  it('returns 201 with id and message on success', async () => {
    (checkTwilioVerify as jest.Mock).mockResolvedValue({ success: true });
    (db.registerUser as jest.Mock).mockResolvedValue('new-user-id');
    const res = await request(app).post('/api/auth/register').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'new-user-id', message: 'Registration successful. Pending society admin approval.' });
  });
});

describe('POST /api/auth/forgot-password', () => {
  it('returns 400 when username missing', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Username is required');
  });

  it('returns 404 when no phone found for username', async () => {
    (db.getUserPhoneByUsername as jest.Mock).mockResolvedValue(null);
    const res = await request(app).post('/api/auth/forgot-password').send({ username: 'jane1' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('No user found');
  });

  it('returns 200 on success', async () => {
    (db.getUserPhoneByUsername as jest.Mock).mockResolvedValue('9876543210');
    (startTwilioVerify as jest.Mock).mockResolvedValue({ success: true });
    const res = await request(app).post('/api/auth/forgot-password').send({ username: 'jane1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Verification code sent via SMS' });
  });
});

describe('POST /api/auth/verify-otp', () => {
  it('returns 400 when username or otp missing', async () => {
    const res = await request(app).post('/api/auth/verify-otp').send({ username: 'jane1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Username and OTP are required');
  });

  it('returns 404 when no phone found for username', async () => {
    (db.getUserPhoneByUsername as jest.Mock).mockResolvedValue(null);
    const res = await request(app).post('/api/auth/verify-otp').send({ username: 'jane1', otp: '123456' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('No user found');
  });

  it('returns 400 when checkTwilioVerify fails', async () => {
    (db.getUserPhoneByUsername as jest.Mock).mockResolvedValue('9876543210');
    (checkTwilioVerify as jest.Mock).mockResolvedValue({ success: false, error: 'Incorrect verification code' });
    const res = await request(app).post('/api/auth/verify-otp').send({ username: 'jane1', otp: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Incorrect verification code');
  });

  it('returns 404 when db.verifyForgotPasswordOtp returns null', async () => {
    (db.getUserPhoneByUsername as jest.Mock).mockResolvedValue('9876543210');
    (checkTwilioVerify as jest.Mock).mockResolvedValue({ success: true });
    (db.verifyForgotPasswordOtp as jest.Mock).mockResolvedValue(null);
    const res = await request(app).post('/api/auth/verify-otp').send({ username: 'jane1', otp: '123456' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('returns 200 with token and user, stripping password_hash, on success', async () => {
    (db.getUserPhoneByUsername as jest.Mock).mockResolvedValue('9876543210');
    (checkTwilioVerify as jest.Mock).mockResolvedValue({ success: true });
    (db.verifyForgotPasswordOtp as jest.Mock).mockResolvedValue({
      id: 'u2',
      role: 'household',
      username: 'jane1',
      password_hash: 'secret-hash',
    });
    const res = await request(app).post('/api/auth/verify-otp').send({ username: 'jane1', otp: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toEqual({ id: 'u2', role: 'household', username: 'jane1' });
    expect(res.body.user.password_hash).toBeUndefined();
  });
});
