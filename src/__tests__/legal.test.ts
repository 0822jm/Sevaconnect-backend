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

  it('GET /delete-account returns an HTML page describing deletion steps and data retention', async () => {
    const res = await request(app).get('/delete-account');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    expect(res.text).toContain('Kamon');
    // Play Store requires the page to cover: how to request deletion, and what's deleted vs kept
    expect(res.text).toContain('Delete Account');
    expect(res.text).toContain('What gets deleted');
    expect(res.text).toContain('mailto:');
  });

  // The pages are localized into the app's 7 languages via ?lang=; English is the default/fallback.
  const localePages: Array<[string, string, string]> = [
    // [lang, page, a phrase expected in that translation]
    ['hi', '/privacy', 'गोपनीयता नीति'],
    ['gu', '/support', 'સપોર્ટ'],
    ['kn', '/delete-account', 'ಖಾತೆ'],
    ['mr', '/privacy', 'गोपनीयता धोरण'],
    ['ta', '/support', 'ஆதரவு'],
    ['te', '/delete-account', 'తొలగించండి'],
  ];
  it.each(localePages)('GET %s?lang serves the translated page', async (lang, page, phrase) => {
    const res = await request(app).get(`${page}?lang=${lang}`);
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    expect(res.text).toContain(`<html lang="${lang}">`);
    expect(res.text).toContain(phrase);
    // language switcher is always present
    expect(res.text).toContain('lang-switch');
  });

  it('falls back to English for an unsupported ?lang value', async () => {
    const res = await request(app).get('/privacy?lang=fr');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<html lang="en">');
    expect(res.text).toContain('Privacy Policy');
  });

  it('honours the Accept-Language header when no ?lang is given', async () => {
    const res = await request(app).get('/privacy').set('Accept-Language', 'ta-IN,ta;q=0.9,en;q=0.8');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<html lang="ta">');
  });

  it('?lang takes precedence over the Accept-Language header', async () => {
    // Query param wins even when the header asks for a different supported language.
    const res = await request(app).get('/privacy?lang=hi').set('Accept-Language', 'ta-IN,ta;q=0.9');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<html lang="hi">');
  });

  it('normalises the ?lang value (uppercase / surrounding whitespace)', async () => {
    const res = await request(app).get('/privacy?lang=%20HI%20'); // " HI " → hi
    expect(res.status).toBe(200);
    expect(res.text).toContain('<html lang="hi">');
  });

  it('falls through to Accept-Language when ?lang is unsupported', async () => {
    // Unsupported query param must not short-circuit to English if the header offers a supported one.
    const res = await request(app).get('/privacy?lang=fr').set('Accept-Language', 'gu-IN,gu;q=0.9');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<html lang="gu">');
  });

  it('defaults to English when neither ?lang nor Accept-Language is usable', async () => {
    const res = await request(app).get('/privacy').set('Accept-Language', 'fr-FR,fr;q=0.9');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<html lang="en">');
  });

  // NOTE: the string "auth-note" also appears in the CSS (.auth-note {...}) on every page, so we
  // assert on the rendered paragraph markup `class="auth-note"`, which is only emitted when the
  // note itself is rendered — otherwise these pass trivially off the stylesheet.
  it('the privacy page carries the English-authoritative note', async () => {
    const res = await request(app).get('/privacy?lang=hi');
    expect(res.text).toContain('class="auth-note"');
  });

  it('the delete-account page carries the English-authoritative note', async () => {
    const res = await request(app).get('/delete-account?lang=hi');
    expect(res.text).toContain('class="auth-note"');
  });

  it('the support page does NOT carry the authoritative note', async () => {
    // The note is only appended to privacy + delete-account, not support.
    const res = await request(app).get('/support?lang=hi');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('class="auth-note"');
  });

  it('marks the active language in the switcher and links the others', async () => {
    const res = await request(app).get('/privacy?lang=hi');
    // active locale rendered as a non-link current marker...
    expect(res.text).toContain('lang-current');
    // ...and other locales are switch links pointing back at this page with ?lang=
    expect(res.text).toContain('/privacy?lang=en');
    expect(res.text).toContain('/privacy?lang=gu');
  });

  it('sets Vary: Accept-Language so caches key on language negotiation', async () => {
    const res = await request(app).get('/privacy');
    expect(res.headers['vary']).toMatch(/Accept-Language/i);
  });
});
