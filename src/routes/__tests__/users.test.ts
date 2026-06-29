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
    const res = await request(app).get('/api/users/user-1');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No token provided');
  });

  it('returns 401 with an invalid token', async () => {
    const res = await request(app).get('/api/users/user-1').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired token');
  });
});

describe('GET /api/users/society/:societyId', () => {
  it('returns users with password_hash stripped', async () => {
    (db.getUsersBySociety as jest.Mock).mockResolvedValue([
      { id: 'u1', name: 'Alice', password_hash: 'secret' },
      { id: 'u2', name: 'Bob', password_hash: 'secret2' },
    ]);
    const res = await request(app).get('/api/users/society/soc-1').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'u1', name: 'Alice' },
      { id: 'u2', name: 'Bob' },
    ]);
    expect(db.getUsersBySociety).toHaveBeenCalledWith('soc-1');
  });

  it('returns 500 when db throws', async () => {
    (db.getUsersBySociety as jest.Mock).mockRejectedValue(new Error('db fail'));
    const res = await request(app).get('/api/users/society/soc-1').set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('db fail');
  });
});

describe('GET /api/users/:id', () => {
  it('returns the user with password_hash stripped', async () => {
    (db.getUserById as jest.Mock).mockResolvedValue({ id: 'u1', name: 'Alice', password_hash: 'secret' });
    const res = await request(app).get('/api/users/u1').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'u1', name: 'Alice' });
  });

  it('returns 404 when user not found', async () => {
    (db.getUserById as jest.Mock).mockResolvedValue(null);
    const res = await request(app).get('/api/users/missing').set('Authorization', authHeader);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });
});

describe('POST /api/users/:id/delete', () => {
  it('lets the owner delete (anonymise) their own account', async () => {
    (db.deactivateUser as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app).post('/api/users/user-1/delete').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.deactivateUser).toHaveBeenCalledWith('user-1');
  });

  it("rejects deleting someone else's account (403)", async () => {
    const res = await request(app).post('/api/users/u2/delete').set('Authorization', authHeader);
    expect(res.status).toBe(403);
    expect(db.deactivateUser).not.toHaveBeenCalled();
  });

  it('allows a system admin to delete any account', async () => {
    (db.deactivateUser as jest.Mock).mockResolvedValue(undefined);
    const sysToken = `Bearer ${generateToken({ userId: 'admin-9', role: 'SYS_ADMIN' })}`;
    const res = await request(app).post('/api/users/u2/delete').set('Authorization', sysToken);
    expect(res.status).toBe(200);
    expect(db.deactivateUser).toHaveBeenCalledWith('u2');
  });

  it('returns 400 when db throws', async () => {
    (db.deactivateUser as jest.Mock).mockRejectedValue(new Error('Admin accounts cannot be deleted this way'));
    const res = await request(app).post('/api/users/user-1/delete').set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Admin accounts cannot be deleted this way');
  });
});

describe('PUT /api/users/:id', () => {
  it('updates the user and strips password_hash', async () => {
    (db.updateUser as jest.Mock).mockResolvedValue({ id: 'u1', name: 'Alice Updated', password_hash: 'secret' });
    const res = await request(app)
      .put('/api/users/u1')
      .set('Authorization', authHeader)
      .send({ name: 'Alice Updated' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'u1', name: 'Alice Updated' });
    expect(db.updateUser).toHaveBeenCalledWith('u1', { name: 'Alice Updated' });
  });

  it('returns 500 when db throws', async () => {
    (db.updateUser as jest.Mock).mockRejectedValue(new Error('update fail'));
    const res = await request(app).put('/api/users/u1').set('Authorization', authHeader).send({ name: 'X' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('update fail');
  });
});

describe('POST /api/users/:id/verify', () => {
  it('verifies the user', async () => {
    (db.verifyUser as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app).post('/api/users/u1/verify').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.verifyUser).toHaveBeenCalledWith('u1');
  });

  it('returns 500 when db throws', async () => {
    (db.verifyUser as jest.Mock).mockRejectedValue(new Error('verify fail'));
    const res = await request(app).post('/api/users/u1/verify').set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('verify fail');
  });
});

describe('PUT /api/users/:id/push-token', () => {
  it('saves the push token', async () => {
    (db.savePushToken as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app)
      .put('/api/users/u1/push-token')
      .set('Authorization', authHeader)
      .send({ token: 'ExponentPushToken[abc]' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.savePushToken).toHaveBeenCalledWith('u1', 'ExponentPushToken[abc]');
  });

  it('returns 400 when token is missing', async () => {
    const res = await request(app).put('/api/users/u1/push-token').set('Authorization', authHeader).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('token is required');
  });

  it('returns 400 when token is not a string', async () => {
    const res = await request(app)
      .put('/api/users/u1/push-token')
      .set('Authorization', authHeader)
      .send({ token: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('token is required');
  });
});

describe('PUT /api/users/:id/auto-accept', () => {
  it('updates auto-accept with enabled only', async () => {
    (db.updateAutoAccept as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app)
      .put('/api/users/u1/auto-accept')
      .set('Authorization', authHeader)
      .send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.updateAutoAccept).toHaveBeenCalledWith('u1', true, undefined, undefined);
  });

  it('updates auto-accept with valid fromTime/toTime', async () => {
    (db.updateAutoAccept as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app)
      .put('/api/users/u1/auto-accept')
      .set('Authorization', authHeader)
      .send({ enabled: true, fromTime: '09:00', toTime: '17:00' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.updateAutoAccept).toHaveBeenCalledWith('u1', true, '09:00', '17:00');
  });

  it('returns 400 when enabled is not a boolean', async () => {
    const res = await request(app)
      .put('/api/users/u1/auto-accept')
      .set('Authorization', authHeader)
      .send({ enabled: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('enabled must be a boolean');
  });

  it('returns 400 for malformed fromTime', async () => {
    const res = await request(app)
      .put('/api/users/u1/auto-accept')
      .set('Authorization', authHeader)
      .send({ enabled: true, fromTime: '9am' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('fromTime must be HH:MM');
  });

  it('returns 400 for malformed toTime', async () => {
    const res = await request(app)
      .put('/api/users/u1/auto-accept')
      .set('Authorization', authHeader)
      .send({ enabled: true, toTime: '25:00' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('toTime must be HH:MM');
  });

  it('returns 400 when toTime is not after fromTime', async () => {
    const res = await request(app)
      .put('/api/users/u1/auto-accept')
      .set('Authorization', authHeader)
      .send({ enabled: true, fromTime: '17:00', toTime: '09:00' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('toTime must be after fromTime');
  });
});

describe('PUT /api/users/:id/skills', () => {
  it('updates skills when valid', async () => {
    (db.getUserById as jest.Mock).mockResolvedValue({ id: 'u1', societyId: 'soc-1' });
    (db.validateSkillIds as jest.Mock).mockResolvedValue(true);
    (db.updateMaidSkills as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app)
      .put('/api/users/u1/skills')
      .set('Authorization', authHeader)
      .send({ skills: ['cleaning', 'cooking'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.validateSkillIds).toHaveBeenCalledWith('soc-1', ['cleaning', 'cooking']);
    expect(db.updateMaidSkills).toHaveBeenCalledWith('u1', ['cleaning', 'cooking']);
  });

  it('returns 400 when skills is not an array of strings', async () => {
    const res = await request(app)
      .put('/api/users/u1/skills')
      .set('Authorization', authHeader)
      .send({ skills: ['ok', 123] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('skills must be an array of strings');
  });

  it('returns 404 when user not found', async () => {
    (db.getUserById as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .put('/api/users/missing/skills')
      .set('Authorization', authHeader)
      .send({ skills: ['cleaning'] });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('returns 400 when skill ids are invalid', async () => {
    (db.getUserById as jest.Mock).mockResolvedValue({ id: 'u1', societyId: 'soc-1' });
    (db.validateSkillIds as jest.Mock).mockResolvedValue(false);
    const res = await request(app)
      .put('/api/users/u1/skills')
      .set('Authorization', authHeader)
      .send({ skills: ['bogus'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid skill ids');
  });
});

describe('DELETE /api/users/:id', () => {
  it('deletes the user', async () => {
    (db.deleteUser as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app).delete('/api/users/u1').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.deleteUser).toHaveBeenCalledWith('u1');
  });

  it('returns 400 when db throws', async () => {
    (db.deleteUser as jest.Mock).mockRejectedValue(new Error('cannot delete'));
    const res = await request(app).delete('/api/users/u1').set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('cannot delete');
  });
});

describe('POST /api/users/:id/leave', () => {
  it('sets a leave and returns leaves array', async () => {
    (db.setLeave as jest.Mock).mockResolvedValue(['2025-01-15']);
    const res = await request(app)
      .post('/api/users/u1/leave')
      .set('Authorization', authHeader)
      .send({ date: '2025-01-15', leaveType: 'FULL' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ leaves: ['2025-01-15'] });
    expect(db.setLeave).toHaveBeenCalledWith('u1', '2025-01-15', 'FULL');
  });

  it('returns 500 when db throws', async () => {
    (db.setLeave as jest.Mock).mockRejectedValue(new Error('leave fail'));
    const res = await request(app)
      .post('/api/users/u1/leave')
      .set('Authorization', authHeader)
      .send({ date: '2025-01-15' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('leave fail');
  });
});

describe('GET /api/users/:maidId/societies', () => {
  it('returns the societies for the maid', async () => {
    const societies = [
      { societyId: 'soc-1', societyName: 'Green Park', skills: ['cleaning'], isVerified: true, isPrimary: true },
    ];
    (db.getMaidSocieties as jest.Mock).mockResolvedValue(societies);
    const res = await request(app).get('/api/users/maid-1/societies').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(societies);
  });

  it('returns 500 when db throws', async () => {
    (db.getMaidSocieties as jest.Mock).mockRejectedValue(new Error('soc fail'));
    const res = await request(app).get('/api/users/maid-1/societies').set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('soc fail');
  });
});

describe('POST /api/users/:maidId/societies', () => {
  it('requests an additional society with skills and notifies admins', async () => {
    (db.validateSkillIds as jest.Mock).mockResolvedValue(true);
    (db.requestMaidSociety as jest.Mock).mockResolvedValue(undefined);
    (db.getSocietyAdminTokens as jest.Mock).mockResolvedValue([]);
    (db.getUserById as jest.Mock).mockResolvedValue({ id: 'maid-1', name: 'Maid One' });
    const res = await request(app)
      .post('/api/users/maid-1/societies')
      .set('Authorization', authHeader)
      .send({ societyId: 'soc-2', skills: ['cleaning'] });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
    expect(db.requestMaidSociety).toHaveBeenCalledWith('maid-1', 'soc-2', ['cleaning']);
  });

  it('requests an additional society with no skills provided', async () => {
    (db.requestMaidSociety as jest.Mock).mockResolvedValue(undefined);
    (db.getSocietyAdminTokens as jest.Mock).mockResolvedValue([]);
    (db.getUserById as jest.Mock).mockResolvedValue({ id: 'maid-1', name: 'Maid One' });
    const res = await request(app)
      .post('/api/users/maid-1/societies')
      .set('Authorization', authHeader)
      .send({ societyId: 'soc-2' });
    expect(res.status).toBe(201);
    expect(db.requestMaidSociety).toHaveBeenCalledWith('maid-1', 'soc-2', []);
    expect(db.validateSkillIds).not.toHaveBeenCalled();
  });

  it('returns 400 when societyId is missing', async () => {
    const res = await request(app)
      .post('/api/users/maid-1/societies')
      .set('Authorization', authHeader)
      .send({ skills: ['cleaning'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('societyId is required');
  });

  it('returns 400 when skills is not an array of strings', async () => {
    const res = await request(app)
      .post('/api/users/maid-1/societies')
      .set('Authorization', authHeader)
      .send({ societyId: 'soc-2', skills: ['ok', 1] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('skills must be an array of strings');
  });

  it('returns 400 when skill ids are invalid for the society', async () => {
    (db.validateSkillIds as jest.Mock).mockResolvedValue(false);
    const res = await request(app)
      .post('/api/users/maid-1/societies')
      .set('Authorization', authHeader)
      .send({ societyId: 'soc-2', skills: ['bogus'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid skill ids for this society');
  });

  it('returns 400 when db throws', async () => {
    (db.requestMaidSociety as jest.Mock).mockRejectedValue(new Error('request fail'));
    const res = await request(app)
      .post('/api/users/maid-1/societies')
      .set('Authorization', authHeader)
      .send({ societyId: 'soc-2' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('request fail');
  });
});

describe('PUT /api/users/:maidId/societies/:societyId/skills', () => {
  it('updates per-society skills when valid', async () => {
    (db.validateSkillIds as jest.Mock).mockResolvedValue(true);
    (db.updateMaidSocietySkills as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app)
      .put('/api/users/maid-1/societies/soc-2/skills')
      .set('Authorization', authHeader)
      .send({ skills: ['cooking'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.updateMaidSocietySkills).toHaveBeenCalledWith('maid-1', 'soc-2', ['cooking']);
  });

  it('allows empty skills array without validation', async () => {
    (db.updateMaidSocietySkills as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app)
      .put('/api/users/maid-1/societies/soc-2/skills')
      .set('Authorization', authHeader)
      .send({ skills: [] });
    expect(res.status).toBe(200);
    expect(db.validateSkillIds).not.toHaveBeenCalled();
  });

  it('returns 400 when skills is not an array of strings', async () => {
    const res = await request(app)
      .put('/api/users/maid-1/societies/soc-2/skills')
      .set('Authorization', authHeader)
      .send({ skills: 'cooking' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('skills must be an array of strings');
  });

  it('returns 400 when skill ids are invalid', async () => {
    (db.validateSkillIds as jest.Mock).mockResolvedValue(false);
    const res = await request(app)
      .put('/api/users/maid-1/societies/soc-2/skills')
      .set('Authorization', authHeader)
      .send({ skills: ['bogus'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid skill ids for this society');
  });
});

describe('POST /api/users/:maidId/societies/:societyId/verify', () => {
  it('verifies the maid for the society and notifies if token exists', async () => {
    (db.verifyMaidSociety as jest.Mock).mockResolvedValue(undefined);
    (db.getUserPushToken as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .post('/api/users/maid-1/societies/soc-2/verify')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.verifyMaidSociety).toHaveBeenCalledWith('maid-1', 'soc-2');
  });

  it('returns 500 when db throws', async () => {
    (db.verifyMaidSociety as jest.Mock).mockRejectedValue(new Error('verify fail'));
    const res = await request(app)
      .post('/api/users/maid-1/societies/soc-2/verify')
      .set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('verify fail');
  });
});

describe('DELETE /api/users/:maidId/societies/:societyId', () => {
  it('removes the maid from the society', async () => {
    (db.leaveMaidSociety as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app)
      .delete('/api/users/maid-1/societies/soc-2')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.leaveMaidSociety).toHaveBeenCalledWith('maid-1', 'soc-2');
  });

  it('returns 500 when db throws', async () => {
    (db.leaveMaidSociety as jest.Mock).mockRejectedValue(new Error('leave society fail'));
    const res = await request(app)
      .delete('/api/users/maid-1/societies/soc-2')
      .set('Authorization', authHeader);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('leave society fail');
  });
});
