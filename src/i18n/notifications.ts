// Backend-side translations for push notification title/body copy. Deliberately independent
// of the mobile app's i18n system (separate git repos, no shared package) — this is a small,
// self-contained module for the ~18 notification "kinds" the backend sends.
//
// Translation note: gu/kn/mr/ta/te copy below is a best-effort machine-assisted translation
// (not reviewed by a native speaker) — same caveat as the rest of this app's i18n, worth a
// native-speaker pass before relying on it for a launch.

export type SupportedLocale = 'en' | 'hi' | 'gu' | 'kn' | 'mr' | 'ta' | 'te';

export const SUPPORTED_LOCALES: SupportedLocale[] = ['en', 'hi', 'gu', 'kn', 'mr', 'ta', 'te'];

export type NotificationKey =
  | 'booking.newRequest'
  | 'booking.requestSentAutoAccept'
  | 'booking.requestSentPendingApproval'
  | 'booking.confirmedManual'
  | 'booking.declinedByMaid'
  | 'booking.cancelledByMaid'
  | 'booking.cancelledByHousehold'
  | 'booking.replacementAssignedContract'
  | 'booking.replacementAssignedAdhoc'
  | 'booking.delayedHousehold'
  | 'booking.delayedMaid'
  | 'contract.createdMaid'
  | 'contract.createdHousehold'
  | 'contract.updated'
  | 'contract.terminatedByMaid'
  | 'contract.terminatedByHousehold'
  | 'contract.replacementNeededLeave'
  | 'contract.replacementNeededCancel'
  | 'society.joinRequested'
  | 'society.joinApproved';

interface Template {
  title: string;
  body: string;
}

const templates: Record<NotificationKey, Record<SupportedLocale, Template>> = {
  'booking.newRequest': {
    en: { title: 'New Booking Request', body: '%{householdName} has requested a booking for %{date} at %{time}. Tap to review.' },
    hi: { title: 'नई बुकिंग रिक्वेस्ट', body: '%{householdName} ने %{date} को %{time} बजे के लिए बुकिंग का अनुरोध किया है। समीक्षा के लिए टैप करें।' },
    gu: { title: 'નવી બુકિંગ વિનંતી', body: '%{householdName} એ %{date} ના રોજ %{time} વાગ્યે બુકિંગ માટે વિનંતી કરી છે. સમીક્ષા માટે ટેપ કરો.' },
    kn: { title: 'ಹೊಸ ಬುಕಿಂಗ್ ವಿನಂತಿ', body: '%{householdName} %{date} ರಂದು %{time} ಗೆ ಬುಕಿಂಗ್ ವಿನಂತಿಸಿದ್ದಾರೆ. ಪರಿಶೀಲಿಸಲು ಟ್ಯಾಪ್ ಮಾಡಿ.' },
    mr: { title: 'नवीन बुकिंग विनंती', body: '%{householdName} यांनी %{date} रोजी %{time} वाजता बुकिंगची विनंती केली आहे. पुनरावलोकनासाठी टॅप करा.' },
    ta: { title: 'புதிய முன்பதிவு கோரிக்கை', body: '%{householdName} %{date} அன்று %{time} மணிக்கு முன்பதிவு கோரியுள்ளார். மதிப்பாய்வு செய்ய தட்டவும்.' },
    te: { title: 'కొత్త బుకింగ్ అభ్యర్థన', body: '%{householdName} %{date} న %{time} కి బుకింగ్ కోరారు. సమీక్షించడానికి నొక్కండి.' },
  },
  'booking.requestSentAutoAccept': {
    en: { title: 'Booking Confirmed', body: '%{maidName} has auto-accepted your booking for %{date} at %{time}.' },
    hi: { title: 'बुकिंग की पुष्टि हुई', body: '%{maidName} ने %{date} को %{time} बजे की आपकी बुकिंग स्वतः स्वीकार कर ली है।' },
    gu: { title: 'બુકિંગ કન્ફર્મ થયું', body: '%{maidName} એ %{date} ના રોજ %{time} વાગ્યાની તમારી બુકિંગ ઓટો-સ્વીકારી છે.' },
    kn: { title: 'ಬುಕಿಂಗ್ ಖಚಿತವಾಗಿದೆ', body: '%{maidName} %{date} ರಂದು %{time} ಗೆ ನಿಮ್ಮ ಬುಕಿಂಗ್ ಅನ್ನು ಸ್ವಯಂ-ಸ್ವೀಕರಿಸಿದ್ದಾರೆ.' },
    mr: { title: 'बुकिंग निश्चित झाले', body: '%{maidName} यांनी %{date} रोजी %{time} वाजताची तुमची बुकिंग स्वयं-स्वीकारली आहे.' },
    ta: { title: 'முன்பதிவு உறுதி செய்யப்பட்டது', body: '%{maidName} %{date} அன்று %{time} மணிக்கான உங்கள் முன்பதிவை தானாக ஏற்றுக்கொண்டார்.' },
    te: { title: 'బుకింగ్ ధృవీకరించబడింది', body: '%{maidName} %{date} న %{time} కి మీ బుకింగ్‌ను స్వయంచాలకంగా ఆమోదించారు.' },
  },
  'booking.requestSentPendingApproval': {
    en: { title: 'Booking Request Sent', body: "Your request for %{date} at %{time} has been sent to %{maidName}. You'll be notified when they respond." },
    hi: { title: 'बुकिंग रिक्वेस्ट भेजी गई', body: '%{date} को %{time} बजे के लिए आपका अनुरोध %{maidName} को भेज दिया गया है। जवाब मिलते ही आपको सूचित किया जाएगा।' },
    gu: { title: 'બુકિંગ વિનંતી મોકલાઈ', body: '%{date} ના રોજ %{time} વાગ્યાની તમારી વિનંતી %{maidName} ને મોકલવામાં આવી છે. જવાબ મળતાં જ તમને જાણ કરવામાં આવશે.' },
    kn: { title: 'ಬುಕಿಂಗ್ ವಿನಂತಿ ಕಳುಹಿಸಲಾಗಿದೆ', body: '%{date} ರಂದು %{time} ಗೆ ನಿಮ್ಮ ವಿನಂತಿಯನ್ನು %{maidName} ಗೆ ಕಳುಹಿಸಲಾಗಿದೆ. ಅವರು ಪ್ರತಿಕ್ರಿಯಿಸಿದಾಗ ನಿಮಗೆ ತಿಳಿಸಲಾಗುವುದು.' },
    mr: { title: 'बुकिंग विनंती पाठवली', body: '%{date} रोजी %{time} वाजताची तुमची विनंती %{maidName} यांना पाठवली आहे. त्यांनी प्रतिसाद दिल्यावर तुम्हाला कळवले जाईल.' },
    ta: { title: 'முன்பதிவு கோரிக்கை அனுப்பப்பட்டது', body: '%{date} அன்று %{time} மணிக்கான உங்கள் கோரிக்கை %{maidName} க்கு அனுப்பப்பட்டுள்ளது. அவர் பதிலளித்தவுடன் உங்களுக்குத் தெரிவிக்கப்படும்.' },
    te: { title: 'బుకింగ్ అభ్యర్థన పంపబడింది', body: '%{date} న %{time} కి మీ అభ్యర్థన %{maidName} కి పంపబడింది. వారు స్పందించగానే మీకు తెలియజేయబడుతుంది.' },
  },
  'booking.confirmedManual': {
    en: { title: 'Booking Confirmed', body: '%{maidName} has accepted your %{serviceName} booking. See you on %{date}!' },
    hi: { title: 'बुकिंग की पुष्टि हुई', body: '%{maidName} ने आपकी %{serviceName} बुकिंग स्वीकार कर ली है। %{date} को मिलते हैं!' },
    gu: { title: 'બુકિંગ કન્ફર્મ થયું', body: '%{maidName} એ તમારી %{serviceName} બુકિંગ સ્વીકારી છે. %{date} ના રોજ મળીશું!' },
    kn: { title: 'ಬುಕಿಂಗ್ ಖಚಿತವಾಗಿದೆ', body: '%{maidName} ನಿಮ್ಮ %{serviceName} ಬುಕಿಂಗ್ ಅನ್ನು ಸ್ವೀಕರಿಸಿದ್ದಾರೆ. %{date} ರಂದು ಭೇಟಿಯಾಗೋಣ!' },
    mr: { title: 'बुकिंग निश्चित झाले', body: '%{maidName} यांनी तुमची %{serviceName} बुकिंग स्वीकारली आहे. %{date} रोजी भेटूया!' },
    ta: { title: 'முன்பதிவு உறுதி செய்யப்பட்டது', body: '%{maidName} உங்கள் %{serviceName} முன்பதிவை ஏற்றுக்கொண்டார். %{date} அன்று சந்திப்போம்!' },
    te: { title: 'బుకింగ్ ధృవీకరించబడింది', body: '%{maidName} మీ %{serviceName} బుకింగ్‌ను ఆమోదించారు. %{date} న కలుద్దాం!' },
  },
  'booking.delayedHousehold': {
    en: { title: 'Booking Delayed', body: "Your %{serviceName} booking on %{date} at %{time} hasn't been completed as scheduled. Tap to check." },
    hi: { title: 'बुकिंग में देरी', body: '%{date} को %{time} बजे की आपकी %{serviceName} बुकिंग तय समय पर पूरी नहीं हुई है। जांचने के लिए टैप करें।' },
    gu: { title: 'બુકિંગમાં વિલંબ', body: '%{date} ના રોજ %{time} વાગ્યાની તમારી %{serviceName} બુકિંગ સમયસર પૂર્ણ થઈ નથી. તપાસવા માટે ટેપ કરો.' },
    kn: { title: 'ಬುಕಿಂಗ್ ವಿಳಂಬ', body: '%{date} ರಂದು %{time} ಗೆ ನಿಮ್ಮ %{serviceName} ಬುಕಿಂಗ್ ನಿಗದಿತ ಸಮಯಕ್ಕೆ ಪೂರ್ಣಗೊಂಡಿಲ್ಲ. ಪರಿಶೀಲಿಸಲು ಟ್ಯಾಪ್ ಮಾಡಿ.' },
    mr: { title: 'बुकिंगला विलंब', body: '%{date} रोजी %{time} वाजताची तुमची %{serviceName} बुकिंग वेळेवर पूर्ण झालेली नाही. तपासण्यासाठी टॅप करा.' },
    ta: { title: 'முன்பதிவு தாமதம்', body: '%{date} அன்று %{time} மணிக்கான உங்கள் %{serviceName} முன்பதிவு திட்டமிட்டபடி முடிக்கப்படவில்லை. சரிபார்க்க தட்டவும்.' },
    te: { title: 'బుకింగ్ ఆలస్యం', body: '%{date} న %{time} కి మీ %{serviceName} బుకింగ్ షెడ్యూల్ ప్రకారం పూర్తి కాలేదు. తనిఖీ చేయడానికి నొక్కండి.' },
  },
  'booking.delayedMaid': {
    en: { title: 'Job Overdue', body: "Your job on %{date} at %{time} hasn't been marked started or completed. Tap to update it." },
    hi: { title: 'काम में देरी', body: '%{date} को %{time} बजे का आपका काम शुरू या पूरा के रूप में चिह्नित नहीं हुआ है। इसे अपडेट करने के लिए टैप करें।' },
    gu: { title: 'કામમાં વિલંબ', body: '%{date} ના રોજ %{time} વાગ્યાનું તમારું કામ શરૂ કે પૂર્ણ તરીકે ચિહ્નિત થયું નથી. અપડેટ કરવા માટે ટેપ કરો.' },
    kn: { title: 'ಕೆಲಸ ವಿಳಂಬ', body: '%{date} ರಂದು %{time} ಗೆ ನಿಮ್ಮ ಕೆಲಸವನ್ನು ಪ್ರಾರಂಭಿಸಲಾಗಿದೆ ಅಥವಾ ಪೂರ್ಣಗೊಂಡಿದೆ ಎಂದು ಗುರುತಿಸಲಾಗಿಲ್ಲ. ನವೀಕರಿಸಲು ಟ್ಯಾಪ್ ಮಾಡಿ.' },
    mr: { title: 'कामाला विलंब', body: '%{date} रोजी %{time} वाजताचे तुमचे काम सुरू किंवा पूर्ण म्हणून चिन्हांकित केलेले नाही. अपडेट करण्यासाठी टॅप करा.' },
    ta: { title: 'வேலை தாமதம்', body: '%{date} அன்று %{time} மணிக்கான உங்கள் வேலை தொடங்கப்பட்டதாக அல்லது முடிக்கப்பட்டதாக குறிக்கப்படவில்லை. புதுப்பிக்க தட்டவும்.' },
    te: { title: 'పని ఆలస్యం', body: '%{date} న %{time} కి మీ పని ప్రారంభించబడిందని లేదా పూర్తయిందని గుర్తించబడలేదు. నవీకరించడానికి నొక్కండి.' },
  },
  'booking.declinedByMaid': {
    en: { title: 'Booking Declined', body: '%{maidName} is unable to accept your booking request for %{date}.' },
    hi: { title: 'बुकिंग अस्वीकृत', body: '%{maidName} %{date} के लिए आपकी बुकिंग रिक्वेस्ट स्वीकार करने में असमर्थ हैं।' },
    gu: { title: 'બુકિંગ નકારાયું', body: '%{maidName} %{date} માટે તમારી બુકિંગ વિનંતી સ્વીકારી શકતા નથી.' },
    kn: { title: 'ಬುಕಿಂಗ್ ತಿರಸ್ಕರಿಸಲಾಗಿದೆ', body: '%{maidName} %{date} ಗಾಗಿ ನಿಮ್ಮ ಬುಕಿಂಗ್ ವಿನಂತಿಯನ್ನು ಸ್ವೀಕರಿಸಲು ಸಾಧ್ಯವಾಗುತ್ತಿಲ್ಲ.' },
    mr: { title: 'बुकिंग नाकारले', body: '%{maidName} %{date} साठी तुमची बुकिंग विनंती स्वीकारू शकत नाहीत.' },
    ta: { title: 'முன்பதிவு நிராகரிக்கப்பட்டது', body: '%{date} க்கான உங்கள் முன்பதிவு கோரிக்கையை %{maidName} ஏற்க முடியவில்லை.' },
    te: { title: 'బుకింగ్ తిరస్కరించబడింది', body: '%{date} కోసం మీ బుకింగ్ అభ్యర్థనను %{maidName} ఆమోదించలేకపోయారు.' },
  },
  'booking.cancelledByMaid': {
    en: { title: 'Booking Cancelled', body: '%{maidName} cancelled %{serviceName} on %{date}. Please arrange a replacement helper.' },
    hi: { title: 'बुकिंग रद्द हुई', body: '%{maidName} ने %{date} की %{serviceName} रद्द कर दी है। कृपया प्रतिस्थापन सहायक की व्यवस्था करें।' },
    gu: { title: 'બુકિંગ રદ થયું', body: '%{maidName} એ %{date} ની %{serviceName} રદ કરી છે. કૃપા કરી રિપ્લેસમેન્ટ સહાયકની વ્યવસ્થા કરો.' },
    kn: { title: 'ಬುಕಿಂಗ್ ರದ್ದಾಗಿದೆ', body: '%{maidName} %{date} ರ %{serviceName} ಅನ್ನು ರದ್ದುಗೊಳಿಸಿದ್ದಾರೆ. ದಯವಿಟ್ಟು ಬದಲಿ ಸಹಾಯಕರನ್ನು ವ್ಯವಸ್ಥೆ ಮಾಡಿ.' },
    mr: { title: 'बुकिंग रद्द झाले', body: '%{maidName} यांनी %{date} ची %{serviceName} रद्द केली आहे. कृपया बदली सहाय्यकाची व्यवस्था करा.' },
    ta: { title: 'முன்பதிவு ரத்து செய்யப்பட்டது', body: '%{maidName} %{date} அன்றைய %{serviceName} ஐ ரத்து செய்தார். மாற்று உதவியாளரை ஏற்பாடு செய்யவும்.' },
    te: { title: 'బుకింగ్ రద్దు చేయబడింది', body: '%{maidName} %{date} నాటి %{serviceName} ను రద్దు చేశారు. దయచేసి ప్రత్యామ్నాయ సహాయకురాలిని ఏర్పాటు చేసుకోండి.' },
  },
  'booking.cancelledByHousehold': {
    en: { title: 'Booking Cancelled', body: '%{householdName} cancelled your booking for %{date} at %{time}.' },
    hi: { title: 'बुकिंग रद्द हुई', body: '%{householdName} ने %{date} को %{time} बजे की आपकी बुकिंग रद्द कर दी है।' },
    gu: { title: 'બુકિંગ રદ થયું', body: '%{householdName} એ %{date} ના રોજ %{time} વાગ્યાની તમારી બુકિંગ રદ કરી છે.' },
    kn: { title: 'ಬುಕಿಂಗ್ ರದ್ದಾಗಿದೆ', body: '%{householdName} %{date} ರಂದು %{time} ಗೆ ನಿಮ್ಮ ಬುಕಿಂಗ್ ಅನ್ನು ರದ್ದುಗೊಳಿಸಿದ್ದಾರೆ.' },
    mr: { title: 'बुकिंग रद्द झाले', body: '%{householdName} यांनी %{date} रोजी %{time} वाजताची तुमची बुकिंग रद्द केली आहे.' },
    ta: { title: 'முன்பதிவு ரத்து செய்யப்பட்டது', body: '%{householdName} %{date} அன்று %{time} மணிக்கான உங்கள் முன்பதிவை ரத்து செய்தார்.' },
    te: { title: 'బుకింగ్ రద్దు చేయబడింది', body: '%{householdName} %{date} న %{time} కి మీ బుకింగ్‌ను రద్దు చేశారు.' },
  },
  'booking.replacementAssignedContract': {
    en: { title: 'Contract Session Assigned', body: 'You have been assigned as a replacement helper on %{date} at %{time}.' },
    hi: { title: 'अनुबंध सत्र सौंपा गया', body: 'आपको %{date} को %{time} बजे के लिए प्रतिस्थापन सहायक नियुक्त किया गया है।' },
    gu: { title: 'કરાર સેશન સોંપાયું', body: 'તમને %{date} ના રોજ %{time} વાગ્યે રિપ્લેસમેન્ટ સહાયક તરીકે સોંપવામાં આવ્યા છે.' },
    kn: { title: 'ಒಪ್ಪಂದ ಅವಧಿ ನಿಯೋಜಿಸಲಾಗಿದೆ', body: 'ನಿಮ್ಮನ್ನು %{date} ರಂದು %{time} ಗೆ ಬದಲಿ ಸಹಾಯಕರಾಗಿ ನಿಯೋಜಿಸಲಾಗಿದೆ.' },
    mr: { title: 'करार सत्र नेमले', body: 'तुम्हाला %{date} रोजी %{time} वाजता बदली सहाय्यक म्हणून नेमले आहे.' },
    ta: { title: 'ஒப்பந்த அமர்வு ஒதுக்கப்பட்டது', body: '%{date} அன்று %{time} மணிக்கு மாற்று உதவியாளராக நீங்கள் நியமிக்கப்பட்டுள்ளீர்கள்.' },
    te: { title: 'ఒప్పంద సెషన్ కేటాయించబడింది', body: '%{date} న %{time} కి మిమ్మల్ని ప్రత్యామ్నాయ సహాయకురాలిగా నియమించారు.' },
  },
  'booking.replacementAssignedAdhoc': {
    en: { title: 'New Booking Assigned', body: 'You have been assigned as a replacement helper on %{date} at %{time}.' },
    hi: { title: 'नई बुकिंग सौंपी गई', body: 'आपको %{date} को %{time} बजे के लिए प्रतिस्थापन सहायक नियुक्त किया गया है।' },
    gu: { title: 'નવી બુકિંગ સોંપાઈ', body: 'તમને %{date} ના રોજ %{time} વાગ્યે રિપ્લેસમેન્ટ સહાયક તરીકે સોંપવામાં આવ્યા છે.' },
    kn: { title: 'ಹೊಸ ಬುಕಿಂಗ್ ನಿಯೋಜಿಸಲಾಗಿದೆ', body: 'ನಿಮ್ಮನ್ನು %{date} ರಂದು %{time} ಗೆ ಬದಲಿ ಸಹಾಯಕರಾಗಿ ನಿಯೋಜಿಸಲಾಗಿದೆ.' },
    mr: { title: 'नवीन बुकिंग नेमले', body: 'तुम्हाला %{date} रोजी %{time} वाजता बदली सहाय्यक म्हणून नेमले आहे.' },
    ta: { title: 'புதிய முன்பதிவு ஒதுக்கப்பட்டது', body: '%{date} அன்று %{time} மணிக்கு மாற்று உதவியாளராக நீங்கள் நியமிக்கப்பட்டுள்ளீர்கள்.' },
    te: { title: 'కొత్త బుకింగ్ కేటాయించబడింది', body: '%{date} న %{time} కి మిమ్మల్ని ప్రత్యామ్నాయ సహాయకురాలిగా నియమించారు.' },
  },
  'contract.createdMaid': {
    en: { title: 'New Contract', body: '%{householdName} has created a contract with you starting %{startDate}.' },
    hi: { title: 'नया अनुबंध', body: '%{householdName} ने आपके साथ %{startDate} से शुरू होने वाला अनुबंध बनाया है।' },
    gu: { title: 'નવો કરાર', body: '%{householdName} એ તમારી સાથે %{startDate} થી શરૂ થતો કરાર બનાવ્યો છે.' },
    kn: { title: 'ಹೊಸ ಒಪ್ಪಂದ', body: '%{householdName} %{startDate} ರಿಂದ ಪ್ರಾರಂಭವಾಗುವ ಒಪ್ಪಂದವನ್ನು ನಿಮ್ಮೊಂದಿಗೆ ರಚಿಸಿದ್ದಾರೆ.' },
    mr: { title: 'नवीन करार', body: '%{householdName} यांनी तुमच्यासोबत %{startDate} पासून सुरू होणारा करार तयार केला आहे.' },
    ta: { title: 'புதிய ஒப்பந்தம்', body: '%{householdName} %{startDate} முதல் தொடங்கும் ஒப்பந்தத்தை உங்களுடன் உருவாக்கியுள்ளார்.' },
    te: { title: 'కొత్త ఒప్పందం', body: '%{householdName} మీతో %{startDate} నుండి ప్రారంభమయ్యే ఒప్పందాన్ని సృష్టించారు.' },
  },
  'contract.createdHousehold': {
    en: { title: 'Contract Created', body: 'Your contract with %{maidName} starts %{startDate}.' },
    hi: { title: 'अनुबंध बना', body: '%{maidName} के साथ आपका अनुबंध %{startDate} से शुरू होगा।' },
    gu: { title: 'કરાર બન્યો', body: '%{maidName} સાથેનો તમારો કરાર %{startDate} થી શરૂ થશે.' },
    kn: { title: 'ಒಪ್ಪಂದ ರಚಿಸಲಾಗಿದೆ', body: '%{maidName} ಜೊತೆಗಿನ ನಿಮ್ಮ ಒಪ್ಪಂದ %{startDate} ರಿಂದ ಪ್ರಾರಂಭವಾಗುತ್ತದೆ.' },
    mr: { title: 'करार तयार झाला', body: '%{maidName} सोबतचा तुमचा करार %{startDate} पासून सुरू होईल.' },
    ta: { title: 'ஒப்பந்தம் உருவாக்கப்பட்டது', body: '%{maidName} உடனான உங்கள் ஒப்பந்தம் %{startDate} முதல் தொடங்கும்.' },
    te: { title: 'ఒప్పందం సృష్టించబడింది', body: '%{maidName} తో మీ ఒప్పందం %{startDate} నుండి ప్రారంభమవుతుంది.' },
  },
  'contract.updated': {
    en: { title: 'Contract Updated', body: '%{householdName} has updated your contract. %{changes}.' },
    hi: { title: 'अनुबंध अपडेट हुआ', body: '%{householdName} ने आपका अनुबंध अपडेट किया है। %{changes}।' },
    gu: { title: 'કરાર અપડેટ થયો', body: '%{householdName} એ તમારો કરાર અપડેટ કર્યો છે. %{changes}.' },
    kn: { title: 'ಒಪ್ಪಂದ ನವೀಕರಿಸಲಾಗಿದೆ', body: '%{householdName} ನಿಮ್ಮ ಒಪ್ಪಂದವನ್ನು ನವೀಕರಿಸಿದ್ದಾರೆ. %{changes}.' },
    mr: { title: 'करार अद्ययावत झाला', body: '%{householdName} यांनी तुमचा करार अद्ययावत केला आहे. %{changes}.' },
    ta: { title: 'ஒப்பந்தம் புதுப்பிக்கப்பட்டது', body: '%{householdName} உங்கள் ஒப்பந்தத்தைப் புதுப்பித்துள்ளார். %{changes}.' },
    te: { title: 'ఒప్పందం నవీకరించబడింది', body: '%{householdName} మీ ఒప్పందాన్ని నవీకరించారు. %{changes}.' },
  },
  'contract.terminatedByMaid': {
    en: { title: 'Contract Terminated', body: 'Your contract with %{maidName} has been terminated by the maid.' },
    hi: { title: 'अनुबंध समाप्त हुआ', body: '%{maidName} के साथ आपका अनुबंध सहायिका द्वारा समाप्त कर दिया गया है।' },
    gu: { title: 'કરાર સમાપ્ત થયો', body: '%{maidName} સાથેનો તમારો કરાર સહાયિકા દ્વારા સમાપ્ત કરવામાં આવ્યો છે.' },
    kn: { title: 'ಒಪ್ಪಂದ ಕೊನೆಗೊಂಡಿದೆ', body: '%{maidName} ಜೊತೆಗಿನ ನಿಮ್ಮ ಒಪ್ಪಂದವನ್ನು ಸಹಾಯಕಿ ಕೊನೆಗೊಳಿಸಿದ್ದಾರೆ.' },
    mr: { title: 'करार संपुष्टात आला', body: '%{maidName} सोबतचा तुमचा करार सहाय्यिकेने संपुष्टात आणला आहे.' },
    ta: { title: 'ஒப்பந்தம் முடிவுற்றது', body: '%{maidName} உடனான உங்கள் ஒப்பந்தத்தை உதவியாளர் முடித்துவிட்டார்.' },
    te: { title: 'ఒప్పందం ముగిసింది', body: '%{maidName} తో మీ ఒప్పందాన్ని సహాయకురాలు ముగించారు.' },
  },
  'contract.terminatedByHousehold': {
    en: { title: 'Contract Terminated', body: 'Your contract with %{householdName} has been terminated.' },
    hi: { title: 'अनुबंध समाप्त हुआ', body: '%{householdName} के साथ आपका अनुबंध समाप्त कर दिया गया है।' },
    gu: { title: 'કરાર સમાપ્ત થયો', body: '%{householdName} સાથેનો તમારો કરાર સમાપ્ત કરવામાં આવ્યો છે.' },
    kn: { title: 'ಒಪ್ಪಂದ ಕೊನೆಗೊಂಡಿದೆ', body: '%{householdName} ಜೊತೆಗಿನ ನಿಮ್ಮ ಒಪ್ಪಂದವನ್ನು ಕೊನೆಗೊಳಿಸಲಾಗಿದೆ.' },
    mr: { title: 'करार संपुष्टात आला', body: '%{householdName} सोबतचा तुमचा करार संपुष्टात आणला आहे.' },
    ta: { title: 'ஒப்பந்தம் முடிவுற்றது', body: '%{householdName} உடனான உங்கள் ஒப்பந்தம் முடிக்கப்பட்டது.' },
    te: { title: 'ఒప్పందం ముగిసింది', body: '%{householdName} తో మీ ఒప్పందం ముగించబడింది.' },
  },
  'contract.replacementNeededLeave': {
    en: { title: 'Contract – Replacement Needed', body: '%{maidName} is unavailable on %{date} for %{leaveDesc}. Please arrange a replacement helper.' },
    hi: { title: 'अनुबंध – प्रतिस्थापन आवश्यक', body: '%{maidName} %{date} को %{leaveDesc} के लिए उपलब्ध नहीं हैं। कृपया प्रतिस्थापन सहायक की व्यवस्था करें।' },
    gu: { title: 'કરાર – રિપ્લેસમેન્ટની જરૂર', body: '%{maidName} %{date} ના રોજ %{leaveDesc} માટે ઉપલબ્ધ નથી. કૃપા કરી રિપ્લેસમેન્ટ સહાયકની વ્યવસ્થા કરો.' },
    kn: { title: 'ಒಪ್ಪಂದ – ಬದಲಿ ಅಗತ್ಯವಿದೆ', body: '%{maidName} %{date} ರಂದು %{leaveDesc} ಗಾಗಿ ಲಭ್ಯವಿಲ್ಲ. ದಯವಿಟ್ಟು ಬದಲಿ ಸಹಾಯಕರನ್ನು ವ್ಯವಸ್ಥೆ ಮಾಡಿ.' },
    mr: { title: 'करार – बदली आवश्यक', body: '%{maidName} %{date} रोजी %{leaveDesc} साठी उपलब्ध नाहीत. कृपया बदली सहाय्यकाची व्यवस्था करा.' },
    ta: { title: 'ஒப்பந்தம் – மாற்று தேவை', body: '%{maidName} %{date} அன்று %{leaveDesc} க்கு கிடைக்கவில்லை. மாற்று உதவியாளரை ஏற்பாடு செய்யவும்.' },
    te: { title: 'ఒప్పందం – ప్రత్యామ్నాయం అవసరం', body: '%{maidName} %{date} న %{leaveDesc} కోసం అందుబాటులో లేరు. దయచేసి ప్రత్యామ్నాయ సహాయకురాలిని ఏర్పాటు చేసుకోండి.' },
  },
  'contract.replacementNeededCancel': {
    en: { title: 'Contract – Replacement Needed', body: '%{maidName} cancelled the session on %{date}. Please arrange a replacement.' },
    hi: { title: 'अनुबंध – प्रतिस्थापन आवश्यक', body: '%{maidName} ने %{date} का सत्र रद्द कर दिया है। कृपया प्रतिस्थापन की व्यवस्था करें।' },
    gu: { title: 'કરાર – રિપ્લેસમેન્ટની જરૂર', body: '%{maidName} એ %{date} નું સેશન રદ કર્યું છે. કૃપા કરી રિપ્લેસમેન્ટની વ્યવસ્થા કરો.' },
    kn: { title: 'ಒಪ್ಪಂದ – ಬದಲಿ ಅಗತ್ಯವಿದೆ', body: '%{maidName} %{date} ರ ಅವಧಿಯನ್ನು ರದ್ದುಗೊಳಿಸಿದ್ದಾರೆ. ದಯವಿಟ್ಟು ಬದಲಿ ವ್ಯವಸ್ಥೆ ಮಾಡಿ.' },
    mr: { title: 'करार – बदली आवश्यक', body: '%{maidName} यांनी %{date} चे सत्र रद्द केले आहे. कृपया बदलीची व्यवस्था करा.' },
    ta: { title: 'ஒப்பந்தம் – மாற்று தேவை', body: '%{maidName} %{date} அன்றைய அமர்வை ரத்து செய்தார். மாற்று ஏற்பாடு செய்யவும்.' },
    te: { title: 'ఒప్పందం – ప్రత్యామ్నాయం అవసరం', body: '%{maidName} %{date} నాటి సెషన్‌ను రద్దు చేశారు. దయచేసి ప్రత్యామ్నాయాన్ని ఏర్పాటు చేసుకోండి.' },
  },
  'society.joinRequested': {
    en: { title: 'New Helper Request', body: '%{maidName} has requested to serve your society. Review and approve in Verify Users.' },
    hi: { title: 'नई सहायिका रिक्वेस्ट', body: '%{maidName} ने आपकी सोसाइटी में सेवा देने का अनुरोध किया है। Verify Users में समीक्षा कर स्वीकृति दें।' },
    gu: { title: 'નવી સહાયિકા વિનંતી', body: '%{maidName} એ તમારી સોસાયટીમાં સેવા આપવાની વિનંતી કરી છે. Verify Users માં સમીક્ષા કરી મંજૂર કરો.' },
    kn: { title: 'ಹೊಸ ಸಹಾಯಕಿ ವಿನಂತಿ', body: '%{maidName} ನಿಮ್ಮ ಸೊಸೈಟಿಯಲ್ಲಿ ಸೇವೆ ಸಲ್ಲಿಸಲು ವಿನಂತಿಸಿದ್ದಾರೆ. Verify Users ನಲ್ಲಿ ಪರಿಶೀಲಿಸಿ ಅನುಮೋದಿಸಿ.' },
    mr: { title: 'नवीन सहाय्यिका विनंती', body: '%{maidName} यांनी तुमच्या सोसायटीत सेवा देण्याची विनंती केली आहे. Verify Users मध्ये पुनरावलोकन करून मंजूर करा.' },
    ta: { title: 'புதிய உதவியாளர் கோரிக்கை', body: '%{maidName} உங்கள் சங்கத்தில் சேவை செய்ய கோரியுள்ளார். Verify Users இல் மதிப்பாய்வு செய்து ஒப்புதல் அளிக்கவும்.' },
    te: { title: 'కొత్త సహాయకురాలి అభ్యర్థన', body: '%{maidName} మీ సొసైటీలో సేవ చేయడానికి అభ్యర్థించారు. Verify Users లో సమీక్షించి ఆమోదించండి.' },
  },
  'society.joinApproved': {
    en: { title: 'Society Approved', body: "You're now approved to take jobs in %{societyName}." },
    hi: { title: 'सोसाइटी स्वीकृत', body: 'अब आप %{societyName} में काम ले सकते हैं।' },
    gu: { title: 'સોસાયટી મંજૂર થઈ', body: 'હવે તમે %{societyName} માં કામ લઈ શકો છો.' },
    kn: { title: 'ಸೊಸೈಟಿ ಅನುಮೋದಿಸಲಾಗಿದೆ', body: 'ಈಗ ನೀವು %{societyName} ನಲ್ಲಿ ಕೆಲಸ ತೆಗೆದುಕೊಳ್ಳಲು ಅನುಮೋದಿತರಾಗಿದ್ದೀರಿ.' },
    mr: { title: 'सोसायटी मंजूर', body: 'आता तुम्ही %{societyName} मध्ये काम घेण्यास मंजूर आहात.' },
    ta: { title: 'சங்கம் அங்கீகரிக்கப்பட்டது', body: 'இப்போது நீங்கள் %{societyName} இல் வேலைகளை எடுக்க அங்கீகரிக்கப்பட்டுள்ளீர்கள்.' },
    te: { title: 'సొసైటీ ఆమోదించబడింది', body: 'ఇప్పుడు మీరు %{societyName} లో పనులు తీసుకోవడానికి ఆమోదించబడ్డారు.' },
  },
};

function resolveLocale(locale: string | null | undefined): SupportedLocale {
  return (SUPPORTED_LOCALES as string[]).includes(locale || '') ? (locale as SupportedLocale) : 'en';
}

function renderTemplate(str: string, params: Record<string, string | number>): string {
  return str.replace(/%\{(\w+)\}/g, (_match, key) => (params[key] !== undefined ? String(params[key]) : ''));
}

export function getNotificationContent(
  key: NotificationKey,
  locale: string | null | undefined,
  params: Record<string, string | number> = {},
): { title: string; body: string } {
  const loc = resolveLocale(locale);
  const template = templates[key][loc] || templates[key].en;
  return {
    title: renderTemplate(template.title, params),
    body: renderTemplate(template.body, params),
  };
}
