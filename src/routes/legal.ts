import { Router, Request, Response } from 'express';

const router = Router();

// Public privacy policy, served as a standalone HTML page (no auth, no /api prefix)
// so it can be linked from the App Store / Play Store listings and from inside the app:
//   https://sevaconnect-api.onrender.com/privacy
// NOTE: review the contact email + company details below before publishing.
const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="index, follow" />
  <title>Kamon — Privacy Policy</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
           max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; color: #1f2937; line-height: 1.6; }
    h1 { font-size: 28px; margin-bottom: 4px; color: #312e81; }
    h2 { font-size: 19px; margin-top: 32px; color: #312e81; }
    .updated { color: #6b7280; font-size: 14px; margin-bottom: 24px; }
    ul { padding-left: 20px; }
    li { margin: 6px 0; }
    a { color: #4338ca; }
    code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; }
    footer { margin-top: 40px; font-size: 13px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 16px; }
  </style>
</head>
<body>
  <h1>Kamon Privacy Policy</h1>
  <p class="updated">Last updated: June 2026</p>

  <p>Kamon ("we", "us", "the app") connects households with domestic service providers ("helpers")
  within residential societies. This policy explains what information we collect, how we use it, and
  the choices you have. By creating an account or using Kamon, you agree to this policy.</p>

  <h2>1. Information we collect</h2>
  <ul>
    <li><strong>Account information</strong> — your name, mobile phone number, username, home/flat address,
        and the society you belong to. Passwords/PINs are stored only as a one-way cryptographic hash; we
        never store them in plain text.</li>
    <li><strong>Helper profile information</strong> (for service providers) — the services you offer, your
        availability and leave schedule, and the societies you serve.</li>
    <li><strong>Bookings &amp; activity</strong> — services you book or fulfil, schedules, prices, status,
        and the ratings and reviews you give or receive.</li>
    <li><strong>Messages</strong> — chat messages you exchange with the other party for a booking.</li>
    <li><strong>Device information</strong> — a push-notification token so we can send you booking alerts.</li>
  </ul>

  <h2>2. How we use your information</h2>
  <ul>
    <li>Create and secure your account, and verify your phone number by one-time passcode (OTP).</li>
    <li>Match households with helpers, and create, schedule, and manage bookings.</li>
    <li>Enable in-app messaging and booking notifications.</li>
    <li>Show ratings and reviews, and provide customer support.</li>
  </ul>

  <h2>3. Phone verification (SMS)</h2>
  <p>To confirm you control your phone number, we send your number to our SMS provider,
  <strong>Twilio</strong>, which delivers a one-time passcode by text message. We do not use your number
  for marketing.</p>

  <h2>4. How information is shared</h2>
  <p>We do <strong>not</strong> sell your personal information and we do <strong>not</strong> use it for
  third-party advertising or tracking. We share information only:</p>
  <ul>
    <li><strong>To fulfil a booking</strong> — when a booking is confirmed, the household and the helper can
        see the information needed to carry it out (e.g. name, relevant address, and phone number) and can
        message each other.</li>
    <li><strong>With service providers who run the app for us</strong> — Twilio (SMS verification), Expo
        (push notifications and app updates), and our hosting/database providers (Render and Neon, where data
        is stored securely). These providers process data only on our behalf.</li>
    <li><strong>When required by law</strong> — to comply with a legal obligation or protect rights and safety.</li>
  </ul>

  <h2>5. Data retention</h2>
  <p>We keep your information while your account is active and as needed to provide the service. You can ask
  us to delete your account and associated personal data at any time (see Contact below); some records may be
  retained where required by law.</p>

  <h2>6. Your rights and choices</h2>
  <ul>
    <li>Access, correct, or update your account information in the app.</li>
    <li>Request deletion of your account and personal data by contacting us.</li>
    <li>Disable push notifications from your device settings.</li>
  </ul>

  <h2>7. Security</h2>
  <p>We protect your data with industry-standard measures, including encrypted connections (HTTPS) and hashed
  credentials. No method of transmission or storage is perfectly secure, but we work to safeguard your
  information.</p>

  <h2>8. Children</h2>
  <p>Kamon is intended for adults (18+) and is not directed to children. We do not knowingly collect personal
  information from children.</p>

  <h2>9. Changes to this policy</h2>
  <p>We may update this policy from time to time. We will post the updated version here and revise the
  "Last updated" date above.</p>

  <h2>10. Contact us</h2>
  <p>For privacy questions or to request data deletion, contact us at
  <a href="mailto:murali@vikasam.co.uk">murali@vikasam.co.uk</a>.</p>

  <footer>© 2026 Kamon. All rights reserved.</footer>
</body>
</html>`;

router.get('/privacy', (_req: Request, res: Response) => {
  res.type('html').send(PRIVACY_HTML);
});

export default router;
