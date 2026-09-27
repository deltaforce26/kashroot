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
  /** Nullable as on `Restaurant.city_en`; every fixture happens to have one. */
  city_en: string | null;
  /** `Restaurant.city_slug`, kept for parity with the wire model; never filtered on. */
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
  /**
   * The deciding certificate's photo review state. Absent = no photo (`none`).
   * Mutated at runtime by the mock upload endpoint, via a copy in `./server`.
   */
  photo?: FixturePhoto;
  /** Google Places enrichment. Absent = no place id known, same as the live default. */
  places?: FixturePlaces;
}

export interface FixturePhoto {
  status: "pending" | "accepted";
  url: string | null;
}

/** One Google-attributed photo. `mockRestaurantPlaces` fills in `index` and `url`. */
export interface FixturePlacePhoto {
  attributions: { display_name: string; uri: string | null }[];
}

/** `day` is 0 = Sunday. Mirrors `PlaceHoursDayOut`. */
export interface FixturePlaceHoursDay {
  day: number;
  ranges: { open: string; close: string }[];
  closed: boolean;
  always_open: boolean;
}

/**
 * Google Places enrichment for a fixture restaurant. Absent on most restaurants —
 * on purpose, so "no place id" is the default and not a special case any fixture
 * has to opt out of.
 */
export interface FixturePlaces {
  place_id_known: boolean;
  photos: FixturePlacePhoto[];
  /** `null` = no hours published, exactly like the wire's `hours: null`. */
  days: FixturePlaceHoursDay[] | null;
}

/**
 * A drawn stand-in for an accepted certificate photo: an inline SVG, so the offline
 * demo needs no network and no binary asset. It is plainly a placeholder.
 */
export const PLACEHOLDER_CERTIFICATE_PHOTO = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" width="600" height="800">
<rect width="300" height="400" fill="#f7f3e6"/>
<rect x="14" y="14" width="272" height="372" fill="none" stroke="#8a7a4a" stroke-width="4"/>
<rect x="24" y="24" width="252" height="352" fill="none" stroke="#8a7a4a" stroke-width="1"/>
<text x="150" y="80" font-family="serif" font-size="30" font-weight="700" text-anchor="middle" fill="#3b3320">תעודת כשרות</text>
<g fill="#b9ab82"><rect x="60" y="120" width="180" height="8" rx="4"/><rect x="45" y="145" width="210" height="8" rx="4"/><rect x="45" y="170" width="210" height="8" rx="4"/><rect x="70" y="195" width="160" height="8" rx="4"/><rect x="45" y="235" width="210" height="8" rx="4"/><rect x="80" y="260" width="140" height="8" rx="4"/></g>
<circle cx="220" cy="325" r="34" fill="none" stroke="#2d5aa0" stroke-width="4"/>
<circle cx="220" cy="325" r="25" fill="none" stroke="#2d5aa0" stroke-width="1.5"/>
<path d="M50 330 q20 -25 40 0 t40 0" fill="none" stroke="#3b3320" stroke-width="2"/>
<text x="150" y="372" font-family="monospace" font-size="11" text-anchor="middle" fill="#8a7a4a">DEMO PLACEHOLDER</text>
</svg>`,
)}`;

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
    // An accepted photo: the card shows it, and offers only a report.
    photo: { status: "accepted", url: PLACEHOLDER_CERTIFICATE_PHOTO },
    // Open around the clock, every day — the simplest hours case, and one with no
    // dependence on which real-world weekday the test suite happens to run on.
    places: {
      place_id_known: true,
      photos: [
        { attributions: [{ display_name: "Dana K.", uri: "https://maps.google.com/contrib/1" }] },
        { attributions: [{ display_name: "Yossi M.", uri: null }] },
      ],
      days: Array.from({ length: 7 }, (_, day) => ({
        day,
        ranges: [],
        closed: false,
        always_open: true,
      })),
    },
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
    // A public upload awaiting review: no upload offered, no photo shown yet.
    photo: { status: "pending", url: null },
    // Open every evening past midnight except Thursday, which crosses into the
    // small hours of Friday — the cross-midnight case.
    places: {
      place_id_known: true,
      photos: [{ attributions: [{ display_name: "Ruti B.", uri: "https://maps.google.com/contrib/2" }] }],
      days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        day,
        ranges: [{ open: "18:00", close: day === 4 ? "02:00" : "23:30" }],
        closed: false,
        always_open: false,
      })),
    },
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
    // Closed for Shabbat, with an early Friday close — the launch cities' most
    // common hours shape.
    places: {
      place_id_known: true,
      photos: [],
      days: [0, 1, 2, 3, 4].map((day) => ({
        day,
        ranges: [{ open: "09:00", close: "22:00" }],
        closed: false,
        always_open: false,
      })).concat([
        { day: 5, ranges: [{ open: "09:00", close: "14:30" }], closed: false, always_open: false },
        { day: 6, ranges: [], closed: true, always_open: false },
      ]),
    },
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
