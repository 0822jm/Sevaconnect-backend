import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { generateToken, authMiddleware, AuthPayload } from '../auth';

function mockReq(authHeader?: string): Request {
  return {
    headers: authHeader !== undefined ? { authorization: authHeader } : {},
  } as unknown as Request;
}

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('generateToken', () => {
  it('returns a JWT that decodes back to the original payload', () => {
    const payload: AuthPayload = { userId: 'u-123', role: 'household' };
    const token = generateToken(payload);
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as AuthPayload;
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.role).toBe(payload.role);
  });
});

describe('authMiddleware', () => {
  it('returns 401 "No token provided" when there is no Authorization header', () => {
    const req = mockReq(undefined);
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token provided' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 "No token provided" when header does not start with "Bearer "', () => {
    const req = mockReq('Token abc123');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token provided' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() and sets req.user for a valid token', () => {
    const payload: AuthPayload = { userId: 'u-456', role: 'maid' };
    const token = generateToken(payload);
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ userId: payload.userId, role: payload.role });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 "Invalid or expired token" for an expired token', () => {
    const expiredToken = jwt.sign({ userId: 'u-789', role: 'maid' }, process.env.JWT_SECRET!, {
      expiresIn: -10, // already expired
    });
    const req = mockReq(`Bearer ${expiredToken}`);
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 "Invalid or expired token" for a garbage/invalid token', () => {
    const req = mockReq('Bearer not-a-real-jwt');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 "Invalid or expired token" for a token signed with a different secret', () => {
    const wrongSecretToken = jwt.sign({ userId: 'u-999', role: 'admin' }, 'some-other-secret');
    const req = mockReq(`Bearer ${wrongSecretToken}`);
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });
});
