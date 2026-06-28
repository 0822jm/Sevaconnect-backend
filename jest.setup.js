// Tests never hit a real database or send real SMS (services/database and
// services/twilio are always mocked), so JWT_SECRET is the only env var that
// matters here — fall back to a fixed test value if .env isn't present (e.g. CI).
require('dotenv').config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
