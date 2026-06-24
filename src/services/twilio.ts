export interface VerifyResponse {
  success: boolean;
  status?: string;
  error?: string;
}

const getConfig = () => {
  // Demo overrides are OPT-IN and OFF by default. Production therefore always sends the
  // OTP to the real number and never accepts a master code. To enable the testing
  // conveniences locally, set TWILIO_DEMO_MODE=true (and optionally TWILIO_DEMO_PHONE to
  // route every OTP to one test number, TWILIO_MASTER_OTP for a bypass code). The
  // NODE_ENV guard means even an accidental TWILIO_DEMO_MODE=true is ignored in production.
  const demoMode =
    process.env.TWILIO_DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production';
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
    authToken: process.env.TWILIO_AUTH_TOKEN!,
    verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID!,
    demoPhone: demoMode ? (process.env.TWILIO_DEMO_PHONE || '') : '',
    masterOtp: demoMode ? (process.env.TWILIO_MASTER_OTP || '') : '',
  };
};

export const formatPhoneE164 = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (phone.startsWith('+')) return phone;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`;
};

export const startTwilioVerify = async (to: string): Promise<VerifyResponse> => {
  const config = getConfig();
  const targetPhone = config.demoPhone || to;

  try {
    const response = await fetch(
      `https://verify.twilio.com/v2/Services/${config.verifyServiceSid}/Verifications`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: targetPhone, Channel: 'sms' }),
      }
    );

    const data: any = await response.json();

    if (response.ok) {
      console.log(`[Twilio Verify Start] Verification sent to ${targetPhone}. Status: ${data.status}`);
      return { success: true, status: data.status };
    } else {
      console.error(`[Twilio Verify Error] ${data.message}`);
      return { success: false, error: data.message };
    }
  } catch (e: any) {
    console.error(`[Twilio Network Error]`, e);
    return { success: false, error: e.message || 'Twilio Verify API failed' };
  }
};

export const checkTwilioVerify = async (to: string, code: string): Promise<VerifyResponse> => {
  const config = getConfig();

  if (config.masterOtp && code === config.masterOtp) {
    console.log('[Twilio Verify Bypass] Master OTP accepted (demo mode).');
    return { success: true, status: 'approved' };
  }

  const targetPhone = config.demoPhone || to;

  try {
    const response = await fetch(
      `https://verify.twilio.com/v2/Services/${config.verifyServiceSid}/VerificationCheck`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: targetPhone, Code: code }),
      }
    );

    const data: any = await response.json();

    if (response.ok && data.status === 'approved') {
      console.log(`[Twilio Verify Success] Code verified for ${targetPhone}.`);
      return { success: true, status: data.status };
    } else {
      console.error(`[Twilio Verify Error] Verification failed: ${data.message || 'Incorrect code'}`);
      return { success: false, error: data.message || 'The code you entered is incorrect or expired.' };
    }
  } catch (e: any) {
    console.error(`[Twilio Network Error]`, e);
    return { success: false, error: e.message || 'Twilio Verify API failed' };
  }
};
