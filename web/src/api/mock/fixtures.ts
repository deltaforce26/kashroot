/**
 * Demo fixture data for the mock server. Not shipped once Track B's endpoints land.
 *
 * Shapes mirror the real corpus: five charedi-leaning certifiers, Jerusalem /
 * Bnei Brak weighted, certificate-level attributes, and a deliberate spread of
 * evidence quality so all three verdicts and the degradation banner are reachable.
 */

import type {
  CertificateAttribute,
  CertificateSource,
  CertificateState,
  CertificationLevel,
  CertifierChip,
  DietType,
} from "../types";

export const CERTIFIERS: CertifierChip[] = [
  { id: "cert-eda", name_he: "בד״ץ העדה החרדית", name_en: "Badatz Eda Haredit", type: "badatz" },
  {
    id: "cert-rubin",
    name_he: "בד״ץ מהדרין — הרב רובין",
    name_en: "Badatz Mehadrin (Rubin)",
    type: "badatz",
  },
  { id: "cert-landa", name_he: "בד״ץ לנדא — בני ברק", name_en: "Badatz Landa", type: "badatz" },
  {
    id: "cert-rab-bb",
    name_he: "רבנות בני ברק — רבני העיר",
    name_en: "Rabbanut Bnei Brak",
    type: "rabbanut_local",
  },
  {
    id: "cert-rab-jlm",
    name_he: "רבנות ירושלים",
    name_en: "Rabbanut Jerusalem",
    type: "rabbanut_local",
  },
];

export interface FixtureCertificate {
  certificate_id: string;
  certifier_id: string;
  state: CertificateState;
  level: CertificationLevel;
  attributes: Partial<Record<CertificateAttribute, boolean>>;
  valid_from: string | null;
  valid_until: string | null;
  /** Days before "today" the evidence was last confirmed; null = never confirmed. */
  verified_days_ago: number | null;
  verified_by: string | null;
  source: CertificateSource;
}

export interface FixtureRestaurant {
  id: string;
  name_he: string;
  name_en: string;
  city_he: string;
  city_en: string;
  /** `Restaurant.city_slug` — what `POST /v1/search` filters on. */
  city_slug: string;
  address_he: string;
  address_en: string;
  diet_type: DietType;
  price_level: number | null;
  phone: string | null;
  lat: number;
  lon: number;
  amenities: Partial<Record<string, boolean>>;
  certificates: FixtureCertificate[];
}

export const RESTAURANTS: FixtureRestaurant[] = [
  {
    id: "r-nougatine",
    name_he: "נוגטין",
    name_en: "Nougatine",
    city_he: "ירושלים",
    city_en: "Jerusalem",
    city_slug: "jerusalem",
    address_he: "עוזיאל 28, בית וגן",
    address_en: "Uziel 28, Bayit VeGan",
    diet_type: "dairy",
    price_level: 2,
    phone: null,
    lat: 31.7651,
    lon: 35.1838,
    amenities: { family: true, accessibility: true },
    certificates: [
      {
        // Rubin's whole published list is dated 2025-09-23 — 328 days old. Inside
        // the 365-day window, so it is fresh and this restaurant reads MATCH, which
        // is what the design drew and what the live database returns. Verified
        // against the live API, not assumed.
        certificate_id: "c-nougatine-1",
        certifier_id: "cert-rubin",
        state: "active",
        level: "unknown",
        attributes: { chalav_yisrael: true, pas_yisrael: true, bishul_yisrael: true },
        valid_from: "2025-10-01",
        valid_until: "2026-09-30",
        verified_days_ago: 328,
        verified_by: "pipeline:seed_corpus@1.0.0",
        source: "official_list",
      },
    ],
  },
  {
    id: "r-hapisga",
    name_he: "מזנון הפסגה",
    name_en: "Hapisga Deli",
    city_he: "ירושלים",
    city_en: "Jerusalem",
    city_slug: "jerusalem",
    address_he: "הפסגה 23, בית וגן",
    address_en: "HaPisga 23, Bayit VeGan",
    diet_type: "meat",
    price_level: 2,
    phone: null,
    lat: 31.7638,
    lon: 35.1795,
    amenities: { groups: true, delivery: true },
    certificates: [
      // Two rows for the same certifier: the bare published list, and a moderator
      // review carrying attributes. Mirrors the seeded demo slice on real data,
      // where a moderator-verified certificate is what makes an attribute
      // requirement satisfiable at all.
      {
        certificate_id: "c-hapisga-1",
        certifier_id: "cert-rubin",
        state: "active",
        level: "unknown",
        attributes: { glatt: true, pas_yisrael: true, bishul_yisrael: true },
        valid_from: "2025-12-01",
        valid_until: "2026-12-31",
        verified_days_ago: 328,
        verified_by: "pipeline:seed_corpus@1.0.0",
        source: "official_list",
      },
      {
        certificate_id: "c-hapisga-2",
        certifier_id: "cert-rubin",
        state: "active",
        level: "unknown",
        attributes: { glatt: true, pas_yisrael: true, bishul_yisrael: true, chalav_yisrael: true },
        valid_from: "2025-12-01",
        valid_until: "2026-12-31",
        verified_days_ago: 5,
        verified_by: "DEMO-SEED (POC 2026-08-20, not a real moderator review)",
        source: "moderator_verified",
      },
    ],
  },
  {
    id: "r-katzefet",
    name_he: "קצפת",
    name_en: "Katzefet",
    city_he: "ירושלים",
    city_en: "Jerusalem",
    city_slug: "jerusalem",
    address_he: "שד׳ הרצל 102",
    address_en: "Herzl Blvd 102",
    diet_type: "dairy",
    price_level: 1,
    phone: null,
    lat: 31.7723,
    lon: 35.1889,
    amenities: { family: true },
    certificates: [
      {
        certificate_id: "c-katzefet-1",
        certifier_id: "cert-rubin",
        state: "active",
        level: "unknown",
        // pas_yisrael deliberately absent — the tri-state gap that yields UNKNOWN.
        attributes: { chalav_yisrael: true },
        valid_from: "2026-01-01",
        valid_until: null,
        verified_days_ago: 328,
        verified_by: "pipeline:seed_corpus@1.0.0",
        source: "official_list",
      },
    ],
  },
  {
    id: "r-sushi-bvg",
    name_he: "סושי בית וגן",
    name_en: "Sushi Bayit VeGan",
    city_he: "ירושלים",
    city_en: "Jerusalem",
    city_slug: "jerusalem",
    address_he: "הפסגה 37",
    address_en: "HaPisga 37",
    diet_type: "fish",
    price_level: 3,
    phone: null,
    lat: 31.7632,
    lon: 35.1811,
    amenities: {},
    // No certificate at all → UNKNOWN for every profile. The honest empty answer.
    certificates: [],
  },
  {
    id: "r-angel-bvg",
    name_he: "מאפיית אנג׳ל — בית וגן",
    name_en: "Angel Bakery — Bayit VeGan",
    city_he: "ירושלים",
    city_en: "Jerusalem",
    city_slug: "jerusalem",
    address_he: "החיד״א 9",
    address_en: "HaChida 9",
    diet_type: "pareve",
    price_level: 1,
    phone: null,
    lat: 31.7662,
    lon: 35.1852,
    amenities: { parking: true },
    certificates: [
      {
        certificate_id: "c-angel-1",
        certifier_id: "cert-eda",
        state: "active",
        level: "unknown",
        attributes: { pas_yisrael: true, yashan: true, chalav_yisrael: true },
        valid_from: "2025-09-01",
        // Expires inside the 30-day window → informational "expires soon" reason.
        valid_until: "2026-09-05",
        verified_days_ago: 4,
        verified_by: "DEMO-SEED (POC 2026-08-20, not a real moderator review)",
        source: "moderator_verified",
      },
    ],
  },
  {
    id: "r-pizza-nechama",
    name_he: "פיצה נחמה",
    name_en: "Pizza Nechama",
    city_he: "בני ברק",
    city_en: "Bnei Brak",
    city_slug: "bnei-brak",
    address_he: "רבי עקיבא 88",
    address_en: "Rabbi Akiva 88",
    diet_type: "dairy",
    price_level: 1,
    phone: null,
    lat: 32.0841,
    lon: 34.8319,
    amenities: { family: true, delivery: true },
    certificates: [
      {
        certificate_id: "c-pizza-1",
        certifier_id: "cert-rab-bb",
        state: "active",
        level: "unknown",
        attributes: { chalav_yisrael: true, pas_yisrael: true },
        valid_from: "2026-02-01",
        valid_until: "2026-11-30",
        verified_days_ago: 8,
        verified_by: "DEMO-SEED (POC 2026-08-20, not a real moderator review)",
        source: "moderator_verified",
      },
    ],
  },
  {
    id: "r-shawarma",
    name_he: "שווארמה השכונה",
    name_en: "Shawarma HaShchuna",
    city_he: "בני ברק",
    city_en: "Bnei Brak",
    city_slug: "bnei-brak",
    address_he: "ז׳בוטינסקי 5",
    address_en: "Jabotinsky 5",
    diet_type: "meat",
    price_level: 2,
    phone: null,
    lat: 32.0866,
    lon: 34.8402,
    amenities: { groups: true },
    certificates: [
      {
        certificate_id: "c-shawarma-1",
        certifier_id: "cert-landa",
        state: "active",
        level: "unknown",
        attributes: {
          glatt: true,
          bishul_yisrael: true,
          pas_yisrael: true,
          chalav_yisrael: true,
        },
        valid_from: "2026-01-15",
        valid_until: "2027-01-14",
        verified_days_ago: 3,
        verified_by: "DEMO-SEED (POC 2026-08-20, not a real moderator review)",
        source: "moderator_verified",
      },
    ],
  },
  {
    id: "r-cafe-alit",
    name_he: "קפה עלית",
    name_en: "Cafe Alit",
    city_he: "ירושלים",
    city_en: "Jerusalem",
    city_slug: "jerusalem",
    address_he: "אגודת ספורט בית״ר 1, מלחה",
    address_en: "Agudat Sport Beitar 1, Malha",
    diet_type: "dairy",
    price_level: 2,
    phone: null,
    lat: 31.7511,
    lon: 35.1873,
    amenities: { parking: true, accessibility: true },
    certificates: [
      {
        certificate_id: "c-alit-1",
        certifier_id: "cert-rab-jlm",
        state: "active",
        level: "unknown",
        attributes: {},
        valid_from: "2025-06-01",
        valid_until: null,
        // The one deliberately stale fixture. Nothing in the live corpus is stale
        // under the 365-day window, but the cause recurs as data ages and it is the
        // clearest illustration of the fail-safe rule, so it stays covered.
        verified_days_ago: 400,
        verified_by: "pipeline:seed_corpus@1.0.0",
        source: "official_list",
      },
    ],
  },
  {
    id: "r-burger-bite",
    name_he: "בורגר ביט",
    name_en: "Burger Bite",
    city_he: "ירושלים",
    city_en: "Jerusalem",
    city_slug: "jerusalem",
    address_he: "כנפי נשרים 12",
    address_en: "Kanfei Nesharim 12",
    diet_type: "meat",
    price_level: 2,
    phone: null,
    lat: 31.7889,
    lon: 35.1932,
    amenities: { family: true, delivery: true },
    certificates: [
      {
        certificate_id: "c-burger-1",
        certifier_id: "cert-rab-jlm",
        state: "active",
        level: "unknown",
        // Published as explicitly non-glatt: a definitive fact, so NO_MATCH — not doubt.
        attributes: { glatt: false, bishul_yisrael: true },
        valid_from: "2026-03-01",
        valid_until: "2027-02-28",
        verified_days_ago: 15,
        verified_by: "DEMO-SEED (POC 2026-08-20, not a real moderator review)",
        source: "moderator_verified",
      },
    ],
  },
  {
    id: "r-haagam",
    name_he: "מסעדת האגם",
    name_en: "HaAgam Restaurant",
    city_he: "טבריה",
    city_en: "Tiberias",
    city_slug: "tiberias",
    address_he: "טיילת יגאל אלון 3",
    address_en: "Yigal Alon Promenade 3",
    diet_type: "meat",
    price_level: 3,
    phone: null,
    lat: 32.7898,
    lon: 35.5401,
    amenities: { groups: true, parking: true },
    certificates: [
      {
        certificate_id: "c-haagam-1",
        certifier_id: "cert-landa",
        state: "active",
        level: "unknown",
        attributes: { glatt: true, bishul_yisrael: true },
        valid_from: "2025-08-15",
        // Past expiry with no renewal evidence → auto-degrade. Drives the 3f banner.
        valid_until: "2026-08-14",
        verified_days_ago: 30,
        verified_by: "DEMO-SEED (POC 2026-08-20, not a real moderator review)",
        source: "moderator_verified",
      },
    ],
  },
  {
    id: "r-grill-habira",
    name_he: "גריל הבירה",
    name_en: "Grill HaBira",
    city_he: "ירושלים",
    city_en: "Jerusalem",
    city_slug: "jerusalem",
    address_he: "יפו 71",
    address_en: "Jaffa 71",
    diet_type: "meat",
    price_level: 2,
    phone: null,
    lat: 31.7846,
    lon: 35.2135,
    amenities: {},
    certificates: [
      {
        certificate_id: "c-grill-1",
        certifier_id: "cert-rab-jlm",
        // Revoked is a definitive fact → NO_MATCH under every profile.
        state: "revoked",
        level: "unknown",
        attributes: { glatt: true },
        valid_from: "2025-11-01",
        valid_until: "2026-10-31",
        verified_days_ago: 9,
        verified_by: "DEMO-SEED (POC 2026-08-20, not a real moderator review)",
        source: "moderator_verified",
      },
    ],
  },
];

/** Default search centre — Bayit VeGan, Jerusalem, matching the design's header. */
export const DEFAULT_CENTER = { lat: 31.7649, lon: 35.1846 };

/** The city the demo opens on. */
export const DEFAULT_CITY_SLUG = "jerusalem";
