/**
 * startTwilioVerify language handling.
 *
 * Twilio Verify only ships a default SMS template for hi/kn/mr/te among the app's Indian
 * languages; gu/ta need a custom template and an unsupported Locale returns a 404, so those
 * (plus English and anything unknown) must be sent with NO Locale parameter.
 */

import { startTwilioVerify, verifyLocaleFor } from '../twilio';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.TWILIO_ACCOUNT_SID = 'ACtest';
  process.env.TWILIO_AUTH_TOKEN = 'token';
  process.env.TWILIO_VERIFY_SERVICE_SID = 'VAtest';
  delete process.env.TWILIO_DEMO_MODE;
  delete process.env.TWILIO_DEMO_PHONE;
  (global as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'pending' }),
  });
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

const sentParams = () => {
  const [, opts] = (global as any).fetch.mock.calls[0];
  return opts.body as URLSearchParams;
};

describe('verifyLocaleFor', () => {
  it.each(['hi', 'kn', 'mr', 'te'])('keeps %s (default template exists)', (l) => {
    expect(verifyLocaleFor(l)).toBe(l);
  });

  it.each(['gu', 'ta', 'en', 'fr', '', undefined])('drops %s (no default template)', (l) => {
    expect(verifyLocaleFor(l as any)).toBeUndefined();
  });
});

describe('startTwilioVerify', () => {
  it('sends the Locale for a language with a default SMS template', async () => {
    const res = await startTwilioVerify('+919876543210', 'hi');
    expect(res.success).toBe(true);
    const params = sentParams();
    expect(params.get('To')).toBe('+919876543210');
    expect(params.get('Channel')).toBe('sms');
    expect(params.get('Locale')).toBe('hi');
  });

  it.each(['gu', 'ta', 'en'])('omits Locale for %s so Twilio does not 404', async (l) => {
    await startTwilioVerify('+919876543210', l);
    expect(sentParams().has('Locale')).toBe(false);
  });

  it('omits Locale when none is supplied', async () => {
    await startTwilioVerify('+919876543210');
    expect(sentParams().has('Locale')).toBe(false);
  });

  it('surfaces Twilio errors', async () => {
    (global as any).fetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'bad number' }) });
    const res = await startTwilioVerify('+919876543210', 'hi');
    expect(res).toEqual({ success: false, error: 'bad number' });
  });
});
