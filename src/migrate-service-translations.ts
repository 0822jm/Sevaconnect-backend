/**
 * Migration: backfill the global services catalog with names + descriptions in
 * all supported languages (en, hi, gu, kn, mr, ta, te).
 *
 * Idempotent: just rewrites the JSONB columns on each row.
 *
 * Run with: npx tsx src/migrate-service-translations.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { Pool } from '@neondatabase/serverless';

type Localized = { en: string; hi: string; gu: string; kn: string; mr: string; ta: string; te: string };

interface Translation {
  id: string;          // services.id
  matchIsGeneric?: boolean; // alternative match: id may not be known (e.g. legacy generic)
  name: Localized;
  description: Localized;
}

// ─── Translations ───────────────────────────────────────────────────────────
const TRANSLATIONS: Translation[] = [
  {
    id: 'srv-cleaning-global',
    name: {
      en: 'Cleaning',
      hi: 'सफाई',
      gu: 'સફાઈ',
      kn: 'ಸ್ವಚ್ಛತೆ',
      mr: 'साफसफाई',
      ta: 'சுத்தம் செய்தல்',
      te: 'శుభ్రపరచడం',
    },
    description: {
      en: 'Floor sweeping, mopping, and dusting',
      hi: 'झाड़ू, पोछा और धूल झाड़ने का काम',
      gu: 'ઝાડુ, પોતું અને ધૂળ સાફ કરવાનું કામ',
      kn: 'ನೆಲ ಗುಡಿಸುವುದು, ಮೋಪ್ ಮಾಡುವುದು ಮತ್ತು ಧೂಳು ತೆಗೆಯುವುದು',
      mr: 'केर काढणे, फरशी पुसणे आणि धूळ झटकणे',
      ta: 'தரை பெருக்குதல், துடைத்தல் மற்றும் தூசி நீக்கம்',
      te: 'నేల ఊడవడం, తుడవడం మరియు ధూళి తొలగించడం',
    },
  },
  {
    id: 'srv-cooking-global',
    name: {
      en: 'Cooking',
      hi: 'खाना बनाना',
      gu: 'રસોઈ',
      kn: 'ಅಡುಗೆ',
      mr: 'स्वयंपाक',
      ta: 'சமையல்',
      te: 'వంట',
    },
    description: {
      en: 'Daily meal preparation and kitchen help',
      hi: 'रोज़ का खाना और रसोई का काम',
      gu: 'રોજનું ભોજન અને રસોડાનું કામ',
      kn: 'ದೈನಂದಿನ ಊಟ ತಯಾರಿಕೆ ಮತ್ತು ಅಡುಗೆ ಸಹಾಯ',
      mr: 'रोजचा स्वयंपाक आणि स्वयंपाकघरातील कामे',
      ta: 'தினசரி உணவு தயாரிப்பு மற்றும் சமையலறை உதவி',
      te: 'రోజువారీ భోజన తయారీ మరియు వంటగది సహాయం',
    },
  },
  {
    id: 'srv-laundry-global',
    name: {
      en: 'Laundry / Ironing',
      hi: 'कपड़े धुलाई / इस्त्री',
      gu: 'કપડાં ધોવા / ઈસ્ત્રી',
      kn: 'ಬಟ್ಟೆ ಒಗೆಯುವುದು / ಇಸ್ತ್ರಿ',
      mr: 'धुलाई / इस्त्री',
      ta: 'துணி துவைத்தல் / இஸ்திரி',
      te: 'బట్టలు ఉతకడం / ఇస్త్రీ',
    },
    description: {
      en: 'Washing, drying and ironing clothes',
      hi: 'कपड़े धोना, सुखाना और इस्त्री करना',
      gu: 'કપડાં ધોવા, સૂકવવા અને ઈસ્ત્રી કરવી',
      kn: 'ಬಟ್ಟೆಗಳನ್ನು ಒಗೆಯುವುದು, ಒಣಗಿಸುವುದು ಮತ್ತು ಇಸ್ತ್ರಿ ಮಾಡುವುದು',
      mr: 'कपडे धुणे, वाळवणे आणि इस्त्री करणे',
      ta: 'துணிகளைத் துவைத்தல், காய வைத்தல் மற்றும் இஸ்திரி இடுதல்',
      te: 'బట్టలు ఉతకడం, ఆరబెట్టడం మరియు ఇస్త్రీ చేయడం',
    },
  },
  {
    // General Help — match by is_generic since the id is not standardized (`srv-5` in current data)
    id: 'srv-5',
    matchIsGeneric: true,
    name: {
      en: 'General Help',
      hi: 'सामान्य सहायता',
      gu: 'સામાન્ય મદદ',
      kn: 'ಸಾಮಾನ್ಯ ಸಹಾಯ',
      mr: 'सामान्य मदत',
      ta: 'பொது உதவி',
      te: 'సాధారణ సహాయం',
    },
    description: {
      en: 'Flexible service for custom tasks',
      hi: 'विशेष कामों के लिए लचीली सेवा',
      gu: 'વિશેષ કાર્યો માટે લવચીક સેવા',
      kn: 'ಕಸ್ಟಮ್ ಕಾರ್ಯಗಳಿಗಾಗಿ ಹೊಂದಿಕೊಳ್ಳುವ ಸೇವೆ',
      mr: 'विशेष कामांसाठी लवचिक सेवा',
      ta: 'தனிப்பயன் பணிகளுக்கான நெகிழ்வான சேவை',
      te: 'అనుకూల పనుల కోసం సరళమైన సేవ',
    },
  },
  {
    id: 'srv-contract-global',
    name: {
      en: 'Contract',
      hi: 'अनुबंध',
      gu: 'કોન્ટ્રાક્ટ',
      kn: 'ಒಪ್ಪಂದ',
      mr: 'करार',
      ta: 'ஒப்பந்தம்',
      te: 'ఒప్పందం',
    },
    description: {
      en: 'Recurring contract service',
      hi: 'नियमित अनुबंध सेवा',
      gu: 'નિયમિત કોન્ટ્રાક્ટ સેવા',
      kn: 'ನಿಯಮಿತ ಒಪ್ಪಂದ ಸೇವೆ',
      mr: 'नियमित करार सेवा',
      ta: 'வழக்கமான ஒப்பந்த சேவை',
      te: 'క్రమబద్ధ ఒప్పంద సేవ',
    },
  },
  {
    id: 'srv-replacement-global',
    name: {
      en: 'Contract Replacement',
      hi: 'अनुबंध प्रतिस्थापन',
      gu: 'કોન્ટ્રાક્ટ રિપ્લેસમેન્ટ',
      kn: 'ಒಪ್ಪಂದ ಬದಲಿ',
      mr: 'करार बदली',
      ta: 'ஒப்பந்த மாற்று',
      te: 'ఒప్పంద ప్రత్యామ్నాయం',
    },
    description: {
      en: 'Hourly rate for replacement maid sessions',
      hi: 'प्रतिस्थापन सत्र की प्रति घंटा दर',
      gu: 'બદલી સત્ર માટે કલાક દીઠ દર',
      kn: 'ಬದಲಿ ಅವಧಿಗಾಗಿ ಗಂಟೆಯ ದರ',
      mr: 'बदली सत्रासाठी तासाचा दर',
      ta: 'மாற்று அமர்வுக்கான மணி நேர விகிதம்',
      te: 'ప్రత్యామ్నాయ సెషన్ కోసం గంట రేటు',
    },
  },
];

async function migrate() {
  console.log('=== Kamon Migration: service translations ===\n');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const t of TRANSLATIONS) {
      const result = t.matchIsGeneric
        ? await client.query(
            `UPDATE services SET name = $1::jsonb, description = $2::jsonb WHERE is_generic = TRUE RETURNING id`,
            [JSON.stringify(t.name), JSON.stringify(t.description)]
          )
        : await client.query(
            `UPDATE services SET name = $1::jsonb, description = $2::jsonb WHERE id = $3 RETURNING id`,
            [JSON.stringify(t.name), JSON.stringify(t.description), t.id]
          );
      const target = t.matchIsGeneric ? `is_generic=TRUE (${t.id})` : t.id;
      console.log(`  ${result.rowCount === 1 ? '✓' : '⚠'} ${target}: ${result.rowCount} row(s) updated`);
    }

    await client.query('COMMIT');
    console.log('\n=== Migration complete ===');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n!!! Migration failed — rolled back !!!');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
