import { Router, Request, Response } from 'express';
import {
  SUPPORTED,
  Locale,
  PageKey,
  LOCALE_NAMES,
  TITLES,
  NAV,
  AUTH_NOTE,
  BODIES,
} from '../legal-content';

const router = Router();

// Public legal/support pages, served as standalone HTML (no auth, no /api prefix) so they can be
// linked from the App Store / Play Store listings and from inside the app:
//   https://sevaconnect-api.onrender.com/privacy
//   https://sevaconnect-api.onrender.com/support
//   https://sevaconnect-api.onrender.com/delete-account
//
// Each page is localized into the app's 7 languages (en, hi, gu, kn, mr, ta, te). The visitor's
// language is picked from the ?lang= query param (falling back to the Accept-Language header, then
// English), and a language switcher is rendered at the top of every page. English is authoritative:
// the privacy and delete-account pages carry a note to that effect. Translations for gu/kn/mr/ta/te
// are AI-drafted and should get a native/legal review before launch. Contact: info@vikasam.co.uk.

// Slug ↔ page key mapping (URL path stays English so existing links keep working).
const PAGES: Record<PageKey, string> = {
  privacy: '/privacy',
  support: '/support',
  deleteAccount: '/delete-account',
};

/** Resolve the visitor's locale from ?lang=, then Accept-Language, defaulting to English. */
function resolveLocale(req: Request): Locale {
  const q = String(req.query.lang || '').toLowerCase().trim();
  if ((SUPPORTED as readonly string[]).includes(q)) return q as Locale;

  const header = String(req.headers['accept-language'] || '').toLowerCase();
  for (const part of header.split(',')) {
    const code = part.split(';')[0].trim().split('-')[0];
    if ((SUPPORTED as readonly string[]).includes(code)) return code as Locale;
  }
  return 'en';
}

/** Language switcher: links to the same page in every supported language. */
function switcher(page: PageKey, active: Locale): string {
  const items = SUPPORTED.map((loc) => {
    const label = LOCALE_NAMES[loc];
    if (loc === active) return `<span class="lang-current" aria-current="true">${label}</span>`;
    return `<a class="lang-link" href="${PAGES[page]}?lang=${loc}">${label}</a>`;
  }).join('');
  return `<nav class="lang-switch" aria-label="Language">${items}</nav>`;
}

/** Footer with cross-page links (localized) + copyright. */
function footer(page: PageKey, loc: Locale): string {
  const links = (['privacy', 'support', 'deleteAccount'] as PageKey[])
    .filter((p) => p !== page)
    .map((p) => `<a href="${PAGES[p]}?lang=${loc}">${NAV[loc][p]}</a>`)
    .join(' · ');
  return `<footer>© 2026 Kamon. All rights reserved.${links ? ' · ' + links : ''}</footer>`;
}

const STYLES = `
    :root { color-scheme: light; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
           max-width: 760px; margin: 0 auto; padding: 24px 20px 64px; color: #1f2937; line-height: 1.6; }
    h1 { font-size: 28px; margin-bottom: 4px; color: #312e81; }
    h2 { font-size: 19px; margin-top: 32px; color: #312e81; }
    .updated { color: #6b7280; font-size: 14px; margin-bottom: 24px; }
    ol, ul { padding-left: 20px; }
    li { margin: 6px 0; }
    a { color: #4338ca; }
    code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; }
    .lang-switch { display: flex; flex-wrap: wrap; gap: 6px 10px; margin-bottom: 24px; padding-bottom: 16px;
                   border-bottom: 1px solid #e5e7eb; font-size: 14px; }
    .lang-switch a { text-decoration: none; }
    .lang-switch a:hover { text-decoration: underline; }
    .lang-current { font-weight: 700; color: #312e81; }
    .auth-note { margin-top: 28px; padding: 12px 16px; background: #f5f3ff; border: 1px solid #ddd6fe;
                 border-radius: 10px; font-size: 13px; color: #4b5563; }
    .contact { margin-top: 24px; padding: 16px 20px; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 10px; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; }
    th, td { text-align: left; padding: 8px 10px; border: 1px solid #e5e7eb; font-size: 14px; vertical-align: top; }
    th { background: #f9fafb; }
    footer { margin-top: 40px; font-size: 13px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 16px; }`;

/** Render a full localized HTML page. */
function renderPage(page: PageKey, loc: Locale): string {
  const authNote =
    page === 'privacy' || page === 'deleteAccount'
      ? `<p class="auth-note">${AUTH_NOTE[loc]}</p>`
      : '';
  return `<!DOCTYPE html>
<html lang="${loc}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="index, follow" />
  <title>${TITLES[loc][page]}</title>
  <style>${STYLES}
  </style>
</head>
<body>
  ${switcher(page, loc)}
  ${BODIES[loc][page]}
  ${authNote}
  ${footer(page, loc)}
</body>
</html>`;
}

function handler(page: PageKey) {
  return (req: Request, res: Response) => {
    const loc = resolveLocale(req);
    // Let caches/CDNs vary the response by ?lang; content also varies by Accept-Language.
    res.set('Vary', 'Accept-Language');
    res.type('html').send(renderPage(page, loc));
  };
}

router.get('/privacy', handler('privacy'));
router.get('/support', handler('support'));
router.get('/delete-account', handler('deleteAccount'));

export default router;
