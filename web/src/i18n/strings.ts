/**
 * The whole UI string layer. Hebrew is the source language — the design was drawn
 * in Hebrew and 3h is the same screens rendered in English, so both come from one
 * component tree with `dir` flipped rather than a forked layout.
 *
 * `Strings = typeof he` makes the English table exhaustive: a missing key is a
 * compile error, not a silent Hebrew leak into the English UI.
 */

export type Lang = "he" | "en";

export const DIR: Record<Lang, "rtl" | "ltr"> = { he: "rtl", en: "ltr" };

const he = {
  appName: "Kashroot",
  nav: { home: "בית", search: "חיפוש", map: "מפה", saved: "שמורים", profile: "פרופיל" },

  onboarding: {
    skip: "דילוג",
    presetTitle: "איך אתם אוכלים?",
    presetLead:
      "מגדירים פעם אחת — ומעכשיו כל מסעדה נבדקת לפי הסטנדרט שלכם. אפשר לדייק בהמשך.",
    continue: "המשך",
    neutralityNote: "האפליקציה לא פוסקת הלכה — אתם בוחרים, אנחנו מציגים עובדות ומקורות.",
    certifiersTitle: "אילו גופי כשרות?",
    certifiersLead: "סמנו את הגופים שאתם מקבלים. הרשימה מוצגת בסדר אלפביתי בלבד.",
    extraRequirements: "דרישות נוספות",
    extraRequirementsLead: "כל דרישה חייבת להופיע במפורש בתעודה כדי להיחשב כמתקיימת.",
    finish: "סיום — הצגת התאמות",
    noneSelected: "לא נבחר אף גוף כשרות — בלי רשימה אין מה לבדוק מולו.",
    selectedCount: (n: number) => `${n} נבחרו`,
  },

  // Preset copy names the set each one selects. It never says one certifier is
  // stricter, better or higher than another — the app does not rule on halacha, and
  // a preset is a shortcut for filling your own list, not a recommendation.
  presets: {
    // `rabbanut` ("רבנות מקומית") was withdrawn with its preset — see the note on
    // PRESET_ORDER in profile/profile.ts. Restore the copy when the preset returns.
    any: { title: "כל תעודת כשרות", subtitle: "כל מסעדה עם תעודה בתוקף" },
    mehadrin: { title: "רבנות מהדרין + בד״צים", subtitle: "רבנות ברמת מהדרין, וכל הבד״צים ברשימה" },
    badatz: { title: "בד״צים נבחרים בלבד", subtitle: "בוחרים בדיוק אילו גופי כשרות" },
    custom: { title: "מותאם אישית", subtitle: "רשימה מלאה + דרישות מיוחדות" },
  },

  home: {
    nearYou: "מחפשים ליד",
    changeCity: "שינוי עיר",
    searchPlaceholder: "חיפוש מקום, עיר או מסעדה…",
    openFilters: "סינון תוצאות",
    filtersActive: "סינון פעיל",
    resultsTitle: (n: number) => `${n} מסעדות נבדקו עבורך`,
    resultsSub: "לפי הפרופיל שלך · במרחק הליכה ונסיעה קצרה",
    tabs: { all: "הכל", meat: "בשרי", dairy: "חלבי", pareve: "פרווה" },
  },

  // The soft-filter screen. Only facets the corpus can actually answer appear here:
  // price level, opening hours and amenities are unpopulated for nearly every seed
  // record, so offering them would ship controls that can only empty the list.
  filters: {
    title: "סינון",
    lead: "מצמצם את התוצאות. לא קובע כשרות.",
    city: "עיר",
    diet: "סוג מטבח",
    anyDiet: "הכל",
    radius: "מרחק ממרכז העיר",
    radiusValue: (km: number) => `${km} ק״מ`,
    kashrutTitle: "כשרות אינה מסנן",
    kashrutBody:
      "ההתאמה נקבעת מהפרופיל שלכם, ותוצאה שאינה מתאימה לא נעלמת מהרשימה — היא מוצגת עם התווית שלה.",
    kashrutLink: "עריכת הפרופיל הכשרותי ›",
    unavailable:
      "טווח מחירים, ״פתוח עכשיו״ ונגישות עדיין לא נאספו ברוב הרשומות, ולכן אינם מוצעים כאן.",
    reset: "איפוס",
    apply: "הצגת התוצאות",
  },

  search: {
    searchingNear: "מחפשים ליד",
    placeholder: "חיפוש לפי שם או רחוב…",
    // The design draws category chips (bakeries, ice cream, cafés). The corpus has
    // no category field — only the published diet type — so the chips filter by that
    // rather than pretending to a category we cannot back with data.
    allFilter: "הכל",
    resultCount: (n: number) => `${n} תוצאות`,
  },

  verdict: {
    match: "מתאים לך",
    matchLong: "מתאים לפרופיל שלך",
    noMatch: "לא מתאים לך",
    noMatchLong: "לא מתאים לפרופיל שלך",
    unknown: "לא מאומת",
    unknownLong: "אין לנו מספיק ראיות",
    whyMatch: "למה זה מתאים לך",
    whyNoMatch: "למה זה לא מתאים לך",
    whyUnknown: "מה חסר לנו כאן",
    unknownHelp:
      "״לא מאומת״ זה לא ״לא כשר״. זה אומר שאין בידינו ראיה מאומתת שעונה על הפרופיל שלכם — ואנחנו לא מנחשים.",
    noMatchHelp: "לפי מה שפורסם, התעודה כאן לא עונה על מה שהגדרתם. העובדות למטה.",
    // A closing paragraph written per cause. UNKNOWN is a primary path through this
    // product, not an edge case, so "we don't know" gets a real explanation of what
    // is missing and what would change the answer — never a shrug.
    followUp: {
      evidence_stale:
        "האימות האחרון שלנו כאן ישן מכדי להסתמך עליו. ייתכן מאוד שהתעודה תקפה לחלוטין — פשוט לא בדקנו לאחרונה, ולא ננחש. נציג תשובה ברורה ברגע שנאמת מחדש.",
      no_freshness_evidence:
        "מעולם לא אימתנו את הרשומה הזו בעצמנו, ולכן אין לנו על מה להסתמך. זה חוסר אצלנו, לא ממצא על העסק.",
      certificate_expired:
        "התוקף פג ולא הגיעה אלינו ראיה לחידוש. עסקים רבים מחדשים בזמן — אנחנו פשוט עוד לא ראינו את התעודה החדשה.",
      certificate_not_yet_valid: "התעודה שבידינו עוד לא נכנסה לתוקף, ולכן אינה משמשת כראיה.",
      certificate_pending: "התעודה אצלנו ממתינה לאימות. עד שיושלם, אנחנו לא מסתמכים עליה.",
      attribute_unknown:
        "התעודה פשוט לא מציינת את מה שביקשתם. ייתכן שזה מתקיים בפועל — אבל לא נניח את זה עבורכם.",
      level_unknown:
        "רמת התעודה לא פורסמה, ולכן אי אפשר לאשר את המינימום שהגדרתם לגוף הזה.",
      no_certificate:
        "אין אצלנו תעודה עבור העסק הזה. זה לא אומר שאין לו — רק שלא אימתנו אחת.",
      certificate_state_unrecognized:
        "מצב התעודה לא מזוהה אצלנו, ולכן איננו מסתמכים עליה. זו זהירות מצדנו.",
      certifier_not_in_whitelist:
        "גוף הכשרות הזה פשוט לא ברשימה שלכם. אפשר להוסיף אותו בפרופיל בכל רגע — והתשובה כאן תשתנה מיד.",
      attribute_false:
        "הדרישה הזו פורסמה במפורש כלא מתקיימת. זו עובדה שמופיעה בתעודה, לא הערכה שלנו.",
      level_below_minimum:
        "הרמה שפורסמה על התעודה נמוכה מהמינימום שהגדרתם לגוף הזה. אפשר לשנות את המינימום בפרופיל.",
      certificate_revoked:
        "גוף הכשרות ביטל את התעודה. זו עובדה שהוא פרסם — לא מסקנה שלנו.",
    },
  },

  fit: {
    label: "התאמת העדפות",
    aria: (score: number) => `ציון התאמת העדפות ${score} מתוך 100 — מרחק, שעות ונוחות בלבד`,
    explain: "מרחק, פתוח עכשיו, טווח מחירים ונוחות. לא קשור לכשרות.",
    components: {
      distance: "מרחק",
      open_now: "פתוח עכשיו",
      price: "טווח מחירים",
      amenities: "נוחות",
      diet: "סוג מטבח",
    },
  },

  restaurant: {
    certificate: "תעודת הכשר",
    validUntil: (date: string) => `בתוקף עד ${date}`,
    noExpiry: "לא פורסם תאריך תפוגה",
    verifiedBy: (who: string) => `אומת ע״י ${who}`,
    verifiedAgo: (days: number) =>
      days === 0 ? "אומת היום" : days === 1 ? "אומת אתמול" : `אומת לפני ${days} ימים`,
    neverVerified: "לא אומת מעולם על ידינו",
    source: "מקור",
    sources: {
      certifier_portal: "פורטל גוף הכשרות",
      official_list: "רשימה רשמית שפורסמה",
      moderator_verified: "אימות מנהל תוכן",
      owner_submitted: "נמסר ע״י בעל העסק",
      field_verification: "בדיקה בשטח",
    },
    otherCertificates: "תעודות נוספות ברשומה",
    navigate: "ניווט",
    call: "התקשרות",
    save: "שמירה",
    saved: "נשמר",
    report: "משהו לא מדויק? דיווח על עסק ›",
    hours: "שעות",
    certificatePhoto: "צילום\nתעודה",
    noCertificate: "לא קיימת אצלנו תעודה עבור העסק הזה.",
  },

  saved: {
    title: "שמורים",
    footer:
      "רשימות נשמרות למכשיר וזמינות ללא קליטה.\nשיתוף רשימה יוצר קישור לצפייה בלבד.",
    offline: "זמין אופליין",
    placesCount: (n: number) => `${n} מקומות`,
    matchCount: (n: number) => `${n} מתאימים`,
    unknownCount: (n: number) => `${n} לא מאומת`,
    noMatchCount: (n: number) => `${n} לא מתאימים`,
    listPhoto: "תמונת רשימה",
    newList: "רשימה חדשה",
    degradeTitle: (list: string) => `עדכון כשרות ברשימה ״${list}״`,
    degradeBody: (name: string, why: string, verdict: string) =>
      `״${name}״ — ${why}. הסטטוס ירד ל״${verdict}״ עד לעדכון ראיה חדשה.`,
    empty: {
      title: "עוד אין רשימות שמורות",
      body: "כל מקום שתשמרו מופיע כאן, נשאר על המכשיר וזמין גם ללא קליטה.",
    },
    removeFromList: "הסרה מהרשימה",
  },

  profile: {
    title: "הפרופיל הכשרותי שלך",
    lead: "מגדירים פעם אחת — וכל מסעדה נבדקת מולו.",
    certifiers: "גופי כשרות שאתם מקבלים",
    required: "נדרש על התעודה",
    edit: "עריכה",
    none: "לא נבחר",
    diet: "מטבח",
    dietValue: "בשרי + חלבי",
    language: "שפה",
    notifications: "התראות",
    notificationsValue: "מקומות שמורים בלבד",
    darkMode: "מצב כהה",
    darkModeSub: "נוח יותר לעיניים בערב",
    neutrality: "האפליקציה לא פוסקת הלכה — אתם בוחרים, אנחנו מציגים ראיות.",
    resetProfile: "איפוס הפרופיל",
  },

  map: {
    map: "מפה",
    list: "רשימה",
    placeholder: (city: string) => `מפה — ${city}`,
    note: "מוצגים רק עסקים שיש להם מיקום ממופה במאגר.",
    // The map has a real design for having no map — see useGoogleMaps.
    unavailableTitle: "המפה לא זמינה כרגע",
    unavailableNoKey: "לא הוגדר מפתח מפות לאפליקציה הזו. הרשימה עובדת כרגיל.",
    unavailableError: "לא הצלחנו לטעון את המפה — ייתכן שאין חיבור לרשת. הרשימה עובדת כרגיל.",
    toList: "מעבר לרשימה",
    youAreHere: "המיקום שלך",
    pinsShown: (n: number) => `${n} מקומות על המפה`,
  },

  origin: {
    fromDevice: "מהמיקום שלך",
    fromCity: (city: string) => `ממרכז ${city}`,
    useMyLocation: "השתמשו במיקום שלי",
    locating: "מאתרים…",
    unavailable: "מודדים ממרכז העיר",
    backToCity: "מדידה ממרכז העיר",
    privacy: "המיקום נשלח רק לשרת שלנו, לא נשמר במכשיר ולא משותף.",
  },

  states: {
    loading: "בודקים מול הפרופיל שלך…",
    loadingShort: "טוען…",
    errorTitle: "לא הצלחנו להביא תשובה",
    errorNetwork: "אין חיבור לשרת. בדקו את החיבור ונסו שוב.",
    errorGeneric: "משהו השתבש בצד שלנו.",
    retry: "ניסיון חוזר",
    offlineTitle: "אתם במצב לא מקוון",
    offlineBody: "מוצג מידע שנשמר במכשיר. ייתכן שהסטטוס השתנה מאז.",
    emptyTitle: "אין כאן מקומות שתואמים את הפרופיל",
    emptyBody:
      "לא מצאנו באזור הזה עסק עם ראיה מאומתת שעונה על מה שהגדרתם. זו התשובה הכנה — לא תקלה.",
    emptyActionWiden: "הרחבת הרשימה בפרופיל",
    emptyActionAll: "הצגת כל המקומות באזור, כולל לא מאומתים",
    // Only ~56% of the corpus has coordinates, so a distance search cannot see the
    // rest. The count above a list must never read as "this is everything here".
    coverageNoteNearby:
      "לא לכל עסק במאגר יש עדיין מיקום ממופה. עסקים בלי מיקום אינם מופיעים בחיפוש לפי מרחק, כך שהרשימה הזו חלקית.",
    coverageNoteCity:
      "המאגר שלנו עדיין לא מכסה את כל העסקים בעיר. מה שמוצג כאן הוא מה שאימתנו — לא כל מה שקיים.",
    // The API matches an exact case-insensitive substring — no fuzzy matching and no
    // Hebrew normalization. The corpus really does contain both פתח תקווה and פתח
    // תקוה, so a miss usually means a spelling difference, not a missing business.
    // Say that, rather than asserting the place does not exist.
    emptyQueryTitle: (query: string) => `לא מצאנו תוצאה ל״${query}״`,
    emptyQueryBody:
      "החיפוש מחפש את הטקסט בדיוק כפי שהוקלד, בשם או בכתובת. כתיב שונה לא יימצא — למשל ״תקוה״ מול ״תקווה״. נסו חלק מהשם, או איות אחר.",
    emptyQueryAction: "ניקוי החיפוש",
    emptyCityTitle: (city: string) => `אין לנו עדיין מקומות ב${city}`,
    emptyCityBody:
      "המאגר לא מכסה עדיין את כל הערים בארץ. זו חסר בנתונים שלנו — לא אמירה על העיר.",
    emptyCityAction: "מעבר לעיר אחרת",
    noVerifiedTitle: "אין כאן מקום שעומד בפרופיל שלך על סמך ראיה מאומתת",
    noVerifiedBody:
      "המקומות מוצגים כמו שהם, עם מה שידוע לנו על כל אחד. ״לא מאומת״ אינו ״לא כשר״ — פשוט אין בידינו ראיה שעונה על מה שהגדרתם.",
    notFound: "העסק הזה לא נמצא במאגר.",
    back: "חזרה",
  },

  // Two page-level states, distinct from the in-screen ones above. Everything in
  // `states` is a caveat drawn inside a working screen; these two replace the screen
  // entirely — an address that leads nowhere, and a screen that crashed rendering.
  notFoundPage: {
    title: "אין כאן מסך כזה",
    body: "הכתובת שהגעתם אליה לא קיימת באפליקציה. ייתכן שהקישור ישן, או שנפלה בו טעות הקלדה.",
    path: (path: string) => `הכתובת שביקשתם: ${path}`,
    home: "מעבר למסך הבית",
    back: "חזרה למסך הקודם",
  },

  // No server text reaches this page either — the crash goes to the console, the
  // user gets the sentence we wrote, plus the one fact that matters to them: the
  // profile and the saved lists live in localStorage and survive the crash.
  errorPage: {
    title: "המסך הזה נפל",
    body: "התקלה אצלנו. שום דבר שהגדרתם לא אבד — הפרופיל והרשימות השמורות נשמרים במכשיר.",
    retry: "טעינה מחדש של המסך",
    home: "מעבר למסך הבית",
    devDetails: "פרטים טכניים (בנייה מקומית בלבד)",
  },

  install: {
    title: "להתקין את Kashroot?",
    body: "מוסיפים למסך הבית ומקבלים גישה מהירה, גם ללא קליטה.",
    action: "התקנה",
    dismiss: "לא עכשיו",
  },

  attributes: {
    glatt: "גלאט",
    chalav_yisrael: "חלב ישראל",
    pas_yisrael: "פת ישראל",
    bishul_yisrael: "בישול ישראל",
    yashan: "ישן",
    kitniyot_pesach: "קטניות בפסח",
    sheruya: "שרויה",
  },

  levels: { unknown: "רמה לא פורסמה", regular: "רגיל", mehadrin: "מהדרין" },

  diet: {
    meat: "בשרי",
    dairy: "חלבי",
    pareve: "פרווה",
    fish: "דגים",
    mixed: "מעורב",
    dairy_pareve: "חלבי/פרווה",
  },

  photoPlaceholder: "צילום מנה",
  mockBanner: "נתוני הדגמה — ה־API הציבורי עדיין לא מחובר.",
  units: { km: "ק״מ", m: "מ׳", closesAt: (time: string) => `עד ${time}` },
};

/** Structural contract for every language table. */
export type Strings = typeof he;

const en: Strings = {
  appName: "Kashroot",
  nav: { home: "Home", search: "Search", map: "Map", saved: "Saved", profile: "Profile" },

  onboarding: {
    skip: "Skip",
    presetTitle: "How do you eat?",
    presetLead:
      "Set it once — from now on every restaurant is checked against your standard. You can refine it later.",
    continue: "Continue",
    neutralityNote: "The app never rules on halacha — you choose, we show facts and sources.",
    certifiersTitle: "Which certifiers?",
    certifiersLead: "Tick the bodies you accept. The list is in alphabetical order only.",
    extraRequirements: "Additional requirements",
    extraRequirementsLead:
      "Each requirement must appear explicitly on the certificate to count as met.",
    finish: "Done — show my matches",
    noneSelected: "No certifier selected — without a list there is nothing to check against.",
    selectedCount: (n: number) => `${n} selected`,
  },

  presets: {
    any: { title: "Any certification", subtitle: "Any restaurant with a valid certificate" },
    mehadrin: {
      title: "Rabbanut Mehadrin + Badatzim",
      subtitle: "Rabbanut at Mehadrin level, and every Badatz on the list",
    },
    badatz: { title: "Selected Badatzim only", subtitle: "Pick exactly which certifiers" },
    custom: { title: "Custom", subtitle: "Full list + specific requirements" },
  },

  home: {
    nearYou: "Searching near",
    changeCity: "Change city",
    searchPlaceholder: "Search a place, city or restaurant…",
    openFilters: "Filter results",
    filtersActive: "Filters on",
    resultsTitle: (n: number) => `${n} restaurants checked for you`,
    resultsSub: "Against your profile · within a short walk or drive",
    tabs: { all: "All", meat: "Meat", dairy: "Dairy", pareve: "Pareve" },
  },

  filters: {
    title: "Filters",
    lead: "Narrows the results. Never decides kashrut.",
    city: "City",
    diet: "Kitchen",
    anyDiet: "All",
    radius: "Distance from the city centre",
    radiusValue: (km: number) => `${km} km`,
    kashrutTitle: "Kashrut is not a filter",
    kashrutBody:
      "Your profile decides the verdict, and a result that does not match is never hidden — it stays in the list with its own label.",
    kashrutLink: "Edit your kashrut profile ›",
    unavailable:
      "Price range, open-now and accessibility are not recorded for most entries yet, so they are not offered here.",
    reset: "Reset",
    apply: "Show results",
  },

  search: {
    searchingNear: "Searching near",
    placeholder: "Search by name or street…",
    allFilter: "All",
    resultCount: (n: number) => `${n} results`,
  },

  verdict: {
    match: "Matches you",
    matchLong: "Matches your profile",
    noMatch: "Does not match",
    noMatchLong: "Does not match your profile",
    unknown: "Not verified",
    unknownLong: "We don't have enough evidence",
    whyMatch: "Why this matches you",
    whyNoMatch: "Why this does not match you",
    whyUnknown: "What we're missing here",
    unknownHelp:
      "“Not verified” does not mean “not kosher”. It means we hold no verified evidence that meets your profile — and we never guess.",
    noMatchHelp:
      "Going by what was published, the certificate here does not meet what you set. The facts are below.",
    followUp: {
      evidence_stale:
        "Our last check here is too old to rely on. The certificate may well be perfectly valid — we simply haven't looked recently, and we won't guess. You'll get a clear answer the moment we re-verify.",
      no_freshness_evidence:
        "We have never verified this record ourselves, so there is nothing for us to stand behind. That's a gap on our side, not a finding about the business.",
      certificate_expired:
        "It expired and no evidence of renewal has reached us. Plenty of businesses renew on time — we just haven't seen the new certificate yet.",
      certificate_not_yet_valid:
        "The certificate we hold is not in force yet, so it isn't treated as evidence.",
      certificate_pending:
        "The certificate we hold is awaiting verification. Until that's done, we don't rely on it.",
      attribute_unknown:
        "The certificate simply doesn't state what you asked for. It may well hold in practice — but we won't assume it on your behalf.",
      level_unknown:
        "The certificate level was never published, so the minimum you set for this certifier can't be confirmed.",
      no_certificate:
        "We hold no certificate for this business. That doesn't mean it has none — only that we haven't verified one.",
      certificate_state_unrecognized:
        "We don't recognise this certificate's state, so we don't rely on it. That's caution on our part.",
      certifier_not_in_whitelist:
        "This certifier just isn't on your list. Add it in your profile any time and this answer changes immediately.",
      attribute_false:
        "This requirement was explicitly published as not held. That's a fact stated on the certificate, not our assessment.",
      level_below_minimum:
        "The level published on the certificate is below the minimum you set for this certifier. You can change that minimum in your profile.",
      certificate_revoked:
        "The certifier revoked this certificate. That is a fact they published — not a conclusion of ours.",
    },
  },

  fit: {
    label: "Preference fit",
    aria: (score: number) =>
      `Preference fit score ${score} out of 100 — distance, hours and amenities only`,
    explain: "Distance, open now, price range and amenities. Nothing to do with kashrut.",
    components: {
      distance: "Distance",
      open_now: "Open now",
      price: "Price range",
      amenities: "Amenities",
      diet: "Kitchen type",
    },
  },

  restaurant: {
    certificate: "Kashrut certificate",
    validUntil: (date: string) => `Valid until ${date}`,
    noExpiry: "No expiry date published",
    verifiedBy: (who: string) => `Verified by ${who}`,
    verifiedAgo: (days: number) =>
      days === 0 ? "Verified today" : days === 1 ? "Verified yesterday" : `Verified ${days} days ago`,
    neverVerified: "Never verified by us",
    source: "Source",
    sources: {
      certifier_portal: "Certifier portal",
      official_list: "Published official list",
      moderator_verified: "Moderator verification",
      owner_submitted: "Submitted by the owner",
      field_verification: "Field verification",
    },
    otherCertificates: "Other certificates on this record",
    navigate: "Directions",
    call: "Call",
    save: "Save",
    saved: "Saved",
    report: "Something inaccurate? Report this business ›",
    hours: "Hours",
    certificatePhoto: "certificate\nphoto",
    noCertificate: "We hold no certificate for this business.",
  },

  saved: {
    title: "Saved",
    footer:
      "Lists are stored on your device and work without a connection.\nSharing a list creates a view-only link.",
    offline: "Available offline",
    placesCount: (n: number) => `${n} places`,
    matchCount: (n: number) => `${n} match`,
    unknownCount: (n: number) => `${n} not verified`,
    noMatchCount: (n: number) => `${n} don't match`,
    listPhoto: "list photo",
    newList: "New list",
    degradeTitle: (list: string) => `Kashrut update in “${list}”`,
    degradeBody: (name: string, why: string, verdict: string) =>
      `“${name}” — ${why}. The status dropped to “${verdict}” until new evidence arrives.`,
    empty: {
      title: "No saved lists yet",
      body: "Every place you save appears here, stays on your device and works offline.",
    },
    removeFromList: "Remove from list",
  },

  profile: {
    title: "Your kashrut profile",
    lead: "Set once — every restaurant is checked against it.",
    certifiers: "Certifiers you accept",
    required: "Required on the certificate",
    edit: "Edit",
    none: "None selected",
    diet: "Diet",
    dietValue: "Meat + Dairy",
    language: "Language",
    notifications: "Notifications",
    notificationsValue: "Saved places only",
    darkMode: "Dark mode",
    darkModeSub: "Easier on the eyes after dark",
    neutrality: "The app never rules on halacha — you choose, we show evidence.",
    resetProfile: "Reset profile",
  },

  map: {
    map: "Map",
    list: "List",
    placeholder: (city: string) => `map — ${city}`,
    note: "Only businesses with a mapped location in our records appear here.",
    unavailableTitle: "The map isn't available right now",
    unavailableNoKey: "No maps key is configured for this build. The list works as usual.",
    unavailableError:
      "We couldn't load the map — you may be offline. The list works as usual.",
    toList: "Go to the list",
    youAreHere: "Your location",
    pinsShown: (n: number) => `${n} places on the map`,
  },

  origin: {
    fromDevice: "from your location",
    fromCity: (city: string) => `from the centre of ${city}`,
    useMyLocation: "Use my location",
    locating: "Locating…",
    unavailable: "Measuring from the city centre",
    backToCity: "Measure from the city centre",
    privacy: "Your location goes only to our own server. It is never stored or shared.",
  },

  states: {
    loading: "Checking against your profile…",
    loadingShort: "Loading…",
    errorTitle: "We couldn't get an answer",
    errorNetwork: "No connection to the server. Check your connection and try again.",
    errorGeneric: "Something went wrong on our side.",
    retry: "Try again",
    offlineTitle: "You are offline",
    offlineBody: "Showing information saved on this device. The status may have changed since.",
    emptyTitle: "Nothing here matches your profile",
    emptyBody:
      "We found no business in this area with verified evidence meeting what you set. That is the honest answer — not a failure.",
    emptyActionWiden: "Widen the list in your profile",
    emptyActionAll: "Show every place here, unverified included",
    coverageNoteNearby:
      "Not every business in our records has a mapped location yet. Those without one don't appear in a distance search, so this list is partial.",
    coverageNoteCity:
      "Our records don't cover every business in this city yet. What you see here is what we have verified — not everything that exists.",
    emptyQueryTitle: (query: string) => `No results for “${query}”`,
    emptyQueryBody:
      "We match the text exactly as typed, against the name and the address. A different spelling won't be found — Hebrew place names often have two. Try part of the name, or another spelling.",
    emptyQueryAction: "Clear the search",
    emptyCityTitle: (city: string) => `We have no places in ${city} yet`,
    emptyCityBody:
      "Our corpus does not cover every city yet. That is a gap in our data — not a statement about the city.",
    emptyCityAction: "Try another city",
    noVerifiedTitle: "Nothing here meets your profile on verified evidence",
    noVerifiedBody:
      "The places below are shown as they are, with whatever we know about each. “Not verified” is not “not kosher” — we simply hold no evidence meeting what you set.",
    notFound: "This business is not in our records.",
    back: "Back",
  },

  notFoundPage: {
    title: "There is no screen here",
    body: "The address you landed on doesn't exist in the app. The link may be old, or have a typo in it.",
    path: (path: string) => `You asked for: ${path}`,
    home: "Go to the home screen",
    back: "Back to the previous screen",
  },

  errorPage: {
    title: "This screen crashed",
    body: "That is on us. Nothing you set is lost — your profile and your saved lists stay on this device.",
    retry: "Reload the screen",
    home: "Go to the home screen",
    devDetails: "Technical details (local builds only)",
  },

  install: {
    title: "Install Kashroot?",
    body: "Add it to your home screen for quick access, even without a connection.",
    action: "Install",
    dismiss: "Not now",
  },

  attributes: {
    glatt: "Glatt",
    chalav_yisrael: "Chalav Yisrael",
    pas_yisrael: "Pas Yisrael",
    bishul_yisrael: "Bishul Yisrael",
    yashan: "Yashan",
    kitniyot_pesach: "Kitniyot on Pesach",
    sheruya: "Sheruya",
  },

  levels: { unknown: "Level not published", regular: "Regular", mehadrin: "Mehadrin" },

  diet: {
    meat: "Meat",
    dairy: "Dairy",
    pareve: "Pareve",
    fish: "Fish",
    mixed: "Mixed",
    dairy_pareve: "Dairy/Pareve",
  },

  photoPlaceholder: "dish photo",
  mockBanner: "Demo data — the public API is not wired up yet.",
  units: { km: "km", m: "m", closesAt: (time: string) => `until ${time}` },
};

export const STRINGS: Record<Lang, Strings> = { he, en };
