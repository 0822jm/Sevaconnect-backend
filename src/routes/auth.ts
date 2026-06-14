import { Router, Request, Response } from 'express';
import { db } from '../services/database';
import { generateToken } from '../middleware/auth';
import { startTwilioVerify, checkTwilioVerify, formatPhoneE164 } from '../services/twilio';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const user = await db.login(username, password);
    if (!user) {
      res.status(401).json({ error: 'Invalid identifier or 6-digit PIN.' });
      return;
    }

    const token = generateToken({ userId: user.id, role: user.role });
    const { password_hash, ...safeUser } = user as any;
    res.json({ token, user: safeUser });
  } catch (e: any) {
    console.error('[Auth Login Error]', e);
    res.status(500).json({ error: e.message || 'Login failed' });
  }
});

// POST /api/auth/register/send-otp — validate fields + send Twilio OTP
router.post('/register/send-otp', async (req: Request, res: Response) => {
  try {
    const { phone, name, username, role, societyId } = req.body;
    console.log('[Register Send OTP] Received body:', JSON.stringify(req.body));
    const missingOtp = [!phone && 'phone', !name && 'name', !username && 'username', !role && 'role', !societyId && 'societyId'].filter(Boolean);
    if (missingOtp.length > 0) {
      res.status(400).json({ error: `Missing required fields: ${missingOtp.join(', ')}` });
      return;
    }

    // Check for duplicate phone before sending OTP (cheap fail-fast — username
    // collision is also checked at registerUser time but won't waste an OTP
    // because validation happens before Twilio in /register too).
    const isDuplicate = await db.isPhoneRegistered(phone);
    if (isDuplicate) {
      res.status(400).json({ error: 'This phone number is already registered to an account.' });
      return;
    }

    // Validate auto-accept time fields before consuming OTP
    const { autoAcceptFrom, autoAcceptTo } = req.body;
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (autoAcceptFrom !== undefined && autoAcceptFrom !== null && !timeRe.test(autoAcceptFrom)) {
      res.status(400).json({ error: 'autoAcceptFrom must be HH:MM' });
      return;
    }
    if (autoAcceptTo !== undefined && autoAcceptTo !== null && !timeRe.test(autoAcceptTo)) {
      res.status(400).json({ error: 'autoAcceptTo must be HH:MM' });
      return;
    }
    if (autoAcceptFrom != null && autoAcceptTo != null) {
      const toMins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
      if (toMins(autoAcceptTo) <= toMins(autoAcceptFrom)) {
        res.status(400).json({ error: 'autoAcceptTo must be after autoAcceptFrom' });
        return;
      }
    }

    const formattedPhone = formatPhoneE164(phone);
    const result = await startTwilioVerify(formattedPhone);
    if (result.success) {
      console.log(`[Register OTP] Verification sent to ${formattedPhone} for ${name}`);
      res.json({ success: true, message: 'Verification code sent via SMS' });
    } else {
      res.status(500).json({ error: result.error || 'Failed to send verification code' });
    }
  } catch (e: any) {
    console.error('[Auth Register Send OTP Error]', e);
    res.status(500).json({ error: e.message || 'Failed to send OTP' });
  }
});

// POST /api/auth/register — verify OTP then create user
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, phone, username, password, role, societyId, address, otp, skills, autoAccept, autoAcceptFrom, autoAcceptTo } = req.body;
    console.log('[Register] Received body:', JSON.stringify(req.body));
    const missingReg = [!name && 'name', !phone && 'phone', !username && 'username', !password && 'password', !role && 'role', !societyId && 'societyId', !otp && 'otp'].filter(Boolean);
    if (missingReg.length > 0) {
      res.status(400).json({ error: `Missing required fields: ${missingReg.join(', ')}` });
      return;
    }

    // Validate skills BEFORE Twilio so a bad payload doesn't consume the OTP.
    if (skills !== undefined && skills !== null) {
      if (!Array.isArray(skills) || skills.some((s: any) => typeof s !== 'string')) {
        res.status(400).json({ error: 'skills must be an array of strings' });
        return;
      }
      const valid = await db.validateSkillIds(societyId, skills);
      if (!valid) {
        res.status(400).json({ error: 'Invalid skill ids' });
        return;
      }
    }

    // Verify OTP before creating user
    const formattedPhone = formatPhoneE164(phone);
    const verifyResult = await checkTwilioVerify(formattedPhone, otp);
    if (!verifyResult.success) {
      res.status(400).json({ error: verifyResult.error || 'Incorrect verification code' });
      return;
    }

    const id = await db.registerUser({ name, phone, username, password, role, societyId, address, skills: skills || [], autoAccept: autoAccept || false, autoAcceptFrom: autoAcceptFrom || null, autoAcceptTo: autoAcceptTo || null });
    res.status(201).json({ id, message: 'Registration successful. Pending society admin approval.' });
  } catch (e: any) {
    console.error('[Auth Register Error]', e);
    res.status(400).json({ error: e.message || 'Registration failed' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { username } = req.body;
    if (!username) {
      res.status(400).json({ error: 'Username is required' });
      return;
    }

    const phone = await db.getUserPhoneByUsername(username);
    if (!phone) {
      res.status(404).json({ error: 'No user found' });
      return;
    }

    const result = await startTwilioVerify(phone);
    if (result.success) {
      res.json({ success: true, message: 'Verification code sent via SMS' });
    } else {
      res.status(500).json({ error: result.error || 'Failed to send OTP' });
    }
  } catch (e: any) {
    console.error('[Auth Forgot Password Error]', e);
    res.status(500).json({ error: e.message || 'Failed to process request' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req: Request, res: Response) => {
  try {
    const { username, otp } = req.body;
    if (!username || !otp) {
      res.status(400).json({ error: 'Username and OTP are required' });
      return;
    }

    const verifyResult = await checkTwilioVerify(username, otp);
    if (!verifyResult.success) {
      res.status(400).json({ error: verifyResult.error || 'Incorrect verification code' });
      return;
    }

    const user = await db.verifyForgotPasswordOtp(username);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const token = generateToken({ userId: user.id, role: user.role });
    const { password_hash, ...safeUser } = user as any;
    res.json({ token, user: safeUser });
  } catch (e: any) {
    console.error('[Auth Verify OTP Error]', e);
    res.status(500).json({ error: e.message || 'Verification failed' });
  }
});

export default router;
