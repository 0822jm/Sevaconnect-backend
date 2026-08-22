import request from 'supertest';
import { app } from '../app';

// The privacy and support pages are public, unauthenticated HTML routes served at the root
// (no /api prefix) so they can be used as the App Store / Play Store listing URLs.
describe('public legal/support pages', () => {
  it('GET /privacy returns an HTML page', async () => {
    const res = await request(app).get('/privacy');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    expect(res.text).toContain('Privacy Policy');
  });

  it('GET /support returns an HTML page with a contact method', async () => {
    const res = await request(app).get('/support');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    expect(res.text).toContain('Support');
    // must expose a way to get help — App Store requires a working support contact
    expect(res.text).toContain('mailto:');
  });
});
