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
  <p class="updated">Last updated: July 2026</p>

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
  <a href="mailto:info@vikasam.co.uk">info@vikasam.co.uk</a>.</p>

  <footer>© 2026 Kamon. All rights reserved.</footer>
</body>
</html>`;

router.get('/privacy', (_req: Request, res: Response) => {
  res.type('html').send(PRIVACY_HTML);
});

// Public support page, served as a standalone HTML page (no auth, no /api prefix) so it can be
// used as the App Store / Play Store "Support URL" and linked from inside the app:
//   https://sevaconnect-api.onrender.com/support
// NOTE: review the contact email + company details below before publishing.
const SUPPORT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="index, follow" />
  <title>Kamon — Support</title>
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
    .contact { margin-top: 24px; padding: 16px 20px; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 10px; }
    footer { margin-top: 40px; font-size: 13px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 16px; }
  </style>
</head>
<body>
  <h1>Kamon Support</h1>
  <p class="updated">We're here to help.</p>

  <p>Kamon connects households with trusted local home helpers for one-time and recurring visits.
  If you need help with your account, a booking, or anything else in the app, please reach out — we
  aim to respond within 1–2 business days.</p>

  <div class="contact">
    <strong>Contact us</strong><br />
    Email: <a href="mailto:info@vikasam.co.uk">info@vikasam.co.uk</a>
  </div>

  <h2>Common questions</h2>
  <ul>
    <li><strong>Booking a helper</strong> — On the home screen, tap a service or "Book Service", choose a
        date and time, select a helper (or "Any available helper"), and confirm. Your booking then appears
        under "My Bookings".</li>
    <li><strong>Verification codes</strong> — When a job starts or ends, a 6-digit code appears on your
        booking detail screen. Read it aloud to your helper to confirm the visit. It is shown in the app,
        not sent by SMS.</li>
    <li><strong>Cancelling or rescheduling</strong> — Open the booking from "My Bookings" to cancel.
        Please note the cancellation notice period shown in the app.</li>
    <li><strong>Changing your language</strong> — Kamon is available in English, Hindi, Gujarati, Marathi,
        Kannada, Telugu, and Tamil. Change it any time from Settings → Language, or on the login screen.</li>
    <li><strong>Deleting your account</strong> — You can delete your account and personal data from
        Settings, or by emailing us at the address above.</li>
  </ul>

  <h2>Report a problem</h2>
  <p>If something isn't working, email <a href="mailto:info@vikasam.co.uk">info@vikasam.co.uk</a> with a
  short description and, if possible, your device model and app version (shown in the app's side menu).
  This helps us resolve the issue faster.</p>

  <footer>© 2026 Kamon. All rights reserved. · <a href="/privacy">Privacy Policy</a></footer>
</body>
</html>`;

router.get('/support', (_req: Request, res: Response) => {
  res.type('html').send(SUPPORT_HTML);
});

// Public account-deletion page, served as a standalone HTML page (no auth, no /api prefix) so it
// can be used as the Play Store "Delete account URL" and linked from inside the app:
//   https://sevaconnect-api.onrender.com/delete-account
// NOTE: review the contact email + company details below before publishing.
const DELETE_ACCOUNT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="index, follow" />
  <title>Kamon — Delete Your Account</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
           max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; color: #1f2937; line-height: 1.6; }
    h1 { font-size: 28px; margin-bottom: 4px; color: #312e81; }
    h2 { font-size: 19px; margin-top: 32px; color: #312e81; }
    .updated { color: #6b7280; font-size: 14px; margin-bottom: 24px; }
    ol, ul { padding-left: 20px; }
    li { margin: 6px 0; }
    a { color: #4338ca; }
    .contact { margin-top: 24px; padding: 16px 20px; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 10px; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; }
    th, td { text-align: left; padding: 8px 10px; border: 1px solid #e5e7eb; font-size: 14px; vertical-align: top; }
    th { background: #f9fafb; }
    footer { margin-top: 40px; font-size: 13px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 16px; }
  </style>
</head>
<body>
  <h1>Delete Your Kamon Account</h1>
  <p class="updated">Last updated: September 2026</p>

  <p>Kamon lets you request deletion of your account and associated personal data at any time,
  directly in the app or by email. This page explains how, and exactly what happens to your data.</p>

  <h2>How to request deletion</h2>
  <ol>
    <li><strong>In the app (fastest):</strong> Open Kamon → tap the menu → <strong>Settings</strong> →
        scroll to the bottom → tap <strong>Delete Account</strong> → confirm. Your account and personal
        data are removed immediately.</li>
    <li><strong>By email:</strong> If you can't access the app, email
        <a href="mailto:info@vikasam.co.uk">info@vikasam.co.uk</a> from the address associated with your
        account (or include your registered phone number/username) and ask us to delete your account. We
        will action this promptly.</li>
  </ol>

  <h2>What gets deleted</h2>
  <p>As soon as a deletion request is confirmed, the following happens immediately — there is no waiting
  period:</p>
  <table>
    <tr><th>Deleted or removed</th><th>Kept</th></tr>
    <tr>
      <td>
        <ul>
          <li>Name, username, and password</li>
          <li>Phone number and address</li>
          <li>Society/community membership</li>
          <li>Push-notification token</li>
          <li>Helper skills, availability, and leave records</li>
          <li>Auto-accept and preferred-helper settings</li>
          <li>Chat messages you sent</li>
        </ul>
      </td>
      <td>
        <ul>
          <li>Records of <em>completed</em> bookings and any ratings/reviews, kept for accounting,
              dispute resolution, and platform integrity — but no longer linked to your name, phone
              number, or address (shown as "Deleted User")</li>
          <li>Any information we're required to retain by law</li>
        </ul>
      </td>
    </tr>
  </table>
  <p>Any booking that is still open or in progress at the time of deletion is automatically cancelled.
  Your account is immediately deactivated and can no longer be logged into or matched with new bookings.</p>

  <h2>Questions</h2>
  <div class="contact">
    <strong>Contact us</strong><br />
    Email: <a href="mailto:info@vikasam.co.uk">info@vikasam.co.uk</a>
  </div>

  <footer>© 2026 Kamon. All rights reserved. · <a href="/privacy">Privacy Policy</a> ·
  <a href="/support">Support</a></footer>
</body>
</html>`;

router.get('/delete-account', (_req: Request, res: Response) => {
  res.type('html').send(DELETE_ACCOUNT_HTML);
});

export default router;
