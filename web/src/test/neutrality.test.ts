/**
 * Guard for a locked decision: the app never ranks certifiers or rules on halacha.
 *
 * The failure mode this catches is copy drift — a preset subtitle or a chip label
 * that quietly reintroduces a hierarchy ("and above", "recommended", "stricter").
 * The certifier *set* a preset selects is a user convenience; any wording that
 * orders one body against another is not.
 */

import { describe, expect, it } from "vitest";
import { STRINGS, type Lang } from "../i18n/strings";
import type { CertifierChip } from "../api/types";
import { certifierLabel, type ResultView } from "../api/viewmodel";

/**
 * Words that assert a hierarchy between certifiers rather than describing a set.
 *
 * Four families, and each is here because a plausible copy edit reaches for it:
 *   - superlatives ("best", "strictest", "most kosher", "ביותר", "הכי")
 *   - comparatives ("stricter", "safer", "מחמיר יותר", "כשר יותר")
 *   - endorsement ("recommended", "preferred", "trusted", "מומלץ", "עדיף")
 *   - scoring vocabulary ("rating", "ranked", "#1", "דירוג", "כוכבים") — kashrut is
 *     never a number, so the words that turn it into one are banned too.
 *
 * A few deliberate omissions, so the next person does not "complete" the list and
 * break honest copy: bare `יותר` ("נוח יותר לעיניים" is legitimate), bare
 * `סטנדרט` ("הסטנדרט שלכם" is the user's own), and bare "reliable"/"strict", which
 * can describe *evidence* rather than a certifier. Comparative and superlative
 * forms of those are listed instead.
 */
const RANKING_WORDS: Record<Lang, RegExp> = {
  he: new RegExp(
    [
      // superlatives and comparatives
      "ומעלה",
      "ביותר",
      "הכי",
      "המחמיר",
      "מחמירים",
      "מחמיר יותר",
      "פחות מחמיר",
      "מקל יותר",
      "טוב יותר",
      "כשר יותר",
      "מהודר",
      "רמה גבוהה",
      "רמה נמוכה",
      "סטנדרט גבוה",
      "אמין יותר",
      "מהימן יותר",
      // endorsement
      "מומלץ",
      "עדיף",
      "עדיפות",
      "מוביל",
      "בראש הרשימה",
      // scoring
      "דירוג",
      "מדורג",
      "כוכב",
    ].join("|"),
  ),
  en: new RegExp(
    [
      // superlatives and comparatives
      "\\band above\\b",
      "\\bbest\\b",
      "\\bworst\\b",
      "\\bstrictest\\b",
      "\\bstricter\\b",
      "\\bstringent\\b",
      "\\bstringency\\b",
      "\\bstrictness\\b",
      "\\bmost kosher\\b",
      "\\bmore kosher\\b",
      "\\bbetter\\b",
      "\\bhighest\\b",
      "\\bsafest\\b",
      "\\bsafer\\b",
      "\\bpurest\\b",
      "\\bfinest\\b",
      "\\bsuperior\\b",
      "\\binferior\\b",
      "\\b(higher|lower) (standard|level)\\b",
      "\\bgold[- ]standard\\b",
      // endorsement
      "\\brecommend(s|ed|ation)?\\b",
      "\\bpreferred\\b",
      "\\bendorsed\\b",
      "\\btrusted\\b",
      "\\bmore reliable\\b",
      "\\bmost reliable\\b",
      "\\bpremium\\b",
      "\\bleading\\b",
      "\\bmachmir\\b",
      // scoring
      "\\brank(s|ed|ing)?\\b",
      "\\brating\\b",
      "\\btop[- ](rated|choice|tier)\\b",
      "\\b#1\\b",
      "\\bno\\.? ?1\\b",
    ].join("|"),
    "i",
  ),
};

/**
 * Representative arguments for the parameterized strings.
 *
 * ~15 copy strings in the table are functions — `resultsTitle(n)`,
 * `saved.matchCount(n)`, `degradeBody(name, why, verdict)` and friends. They used to
 * be skipped outright, which meant a whole class of user-visible sentence was never
 * scanned for ranking language at all. Every arity is called with each sample so the
 * branchy ones (`verifiedAgo` reads differently at 0, 1, n and over a year) are all
 * covered.
 */
const SAMPLES: unknown[] = [0, 1, 7, 400, "ירושלים", "Jerusalem"];

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "function") {
    for (const sample of SAMPLES) {
      const args = Array.from({ length: value.length }, () => sample);
      try {
        collectStrings((value as (...rest: unknown[]) => unknown)(...args), out);
      } catch {
        // A sample of the wrong type is not a finding; another sample will fit.
      }
    }
  } else if (value && typeof value === "object")
    for (const nested of Object.values(value)) collectStrings(nested, out);
  return out;
}

/** Function-typed entries anywhere in the table, so the scan can prove it saw them. */
function countFunctions(value: unknown): number {
  if (typeof value === "function") return 1;
  if (value && typeof value === "object")
    return Object.values(value).reduce<number>((sum, nested) => sum + countFunctions(nested), 0);
  return 0;
}

describe("certifier neutrality in the string table", () => {
  it.each<Lang>(["he", "en"])("has no ranking language anywhere in %s", (lang) => {
    const offenders = collectStrings(STRINGS[lang]).filter((text) =>
      RANKING_WORDS[lang].test(text),
    );
    expect(offenders).toEqual([]);
  });

  it.each<Lang>(["he", "en"])("scans the parameterized strings in %s, not just the literals", (lang) => {
    const table = STRINGS[lang];
    const scanned = collectStrings(table);
    // The table really does hold a meaningful number of them — this is not a
    // guard over an empty set.
    expect(countFunctions(table)).toBeGreaterThan(10);
    // Sentences that only exist once a function has actually been called.
    expect(scanned).toContain(table.home.resultsTitle(7));
    expect(scanned).toContain(table.saved.matchCount(7));
    expect(scanned).toContain(table.saved.noMatchCount(7));
    expect(scanned).toContain(table.search.resultCount(7));
    expect(scanned).toContain(table.fit.aria(7));
    expect(scanned).toContain(table.restaurant.verifiedBy("Jerusalem"));
    expect(scanned).toContain(table.states.emptyCityTitle("Jerusalem"));
    expect(scanned).toContain(table.saved.degradeBody("Jerusalem", "Jerusalem", "Jerusalem"));
    // …including every branch of the branchy ones.
    expect(scanned).toContain(table.restaurant.verifiedAgo(0));
    expect(scanned).toContain(table.restaurant.verifiedAgo(1));
    expect(scanned).toContain(table.restaurant.verifiedAgo(7));
    expect(scanned).toContain(table.restaurant.verifiedAgo(400));
  });

  it("would catch ranking language hiding inside a parameterized string", () => {
    const table = { home: { resultsTitle: (n: number) => `${n} best restaurants for you` } };
    const offenders = collectStrings(table).filter((text) => RANKING_WORDS.en.test(text));
    expect(offenders.length).toBeGreaterThan(0);
  });

  it("flags the superlatives the first version of this list missed", () => {
    for (const phrase of ["the best certifier", "the strictest badatz", "the most kosher option"]) {
      expect(RANKING_WORDS.en.test(phrase), phrase).toBe(true);
    }
    for (const phrase of ["הגוף הכי מחמיר", "התעודה הטובה ביותר", "מומלץ ביותר", "דירוג כשרות"]) {
      expect(RANKING_WORDS.he.test(phrase), phrase).toBe(true);
    }
  });

  it("leaves honest copy alone", () => {
    for (const phrase of ["נוח יותר לעיניים בערב", "לפי הסטנדרט שלכם", "כל רמות הרבנות שפורסמו"]) {
      expect(RANKING_WORDS.he.test(phrase), phrase).toBe(false);
    }
    for (const phrase of ["Every published Rabbanut level", "Preference fit", "Level not published"]) {
      expect(RANKING_WORDS.en.test(phrase), phrase).toBe(false);
    }
  });

  it("names preset sets by what they contain, not by where they sit on a scale", () => {
    expect(STRINGS.he.presets.mehadrin.title).toBe("רבנות מהדרין + בד״צים");
    expect(STRINGS.en.presets.mehadrin.title).toBe("Rabbanut Mehadrin + Badatzim");
    // The supporting line enumerates; it does not rank.
    expect(STRINGS.en.presets.mehadrin.subtitle).toMatch(/and every Badatz/);
  });

  it("tells the user the certifier list carries no ordering", () => {
    expect(STRINGS.he.onboarding.certifiersLead).toMatch(/אלפביתי/);
    expect(STRINGS.en.onboarding.certifiersLead).toMatch(/alphabetical/);
  });
});

const CHIP = (id: string, he: string, en: string): CertifierChip => ({
  id,
  name_he: he,
  name_en: en,
  type: "badatz",
});

function view(overrides: Partial<ResultView>): ResultView {
  return {
    id: "r1",
    nameHe: "מסעדה",
    nameEn: "Restaurant",
    cityHe: "ירושלים",
    addressHe: "רחוב 1",
    geo: null,
    distanceKm: null,
    kashrut: {
      verdict: "unknown",
      reasons: [],
      confidence: "low",
      freshness: null,
      deciding_certificate_id: null,
    },
    fit: { score: 0, components: [] },
    certifiers: [],
    decidingCertifier: null,
    dietType: null,
    priceLevel: null,
    isOpenNow: null,
    closesAt: null,
    ...overrides,
  };
}

describe("certifier attribution on a card", () => {
  it("names the deciding certifier when the API identifies one", () => {
    const label = certifierLabel(
      view({
        certifiers: [CHIP("a", "בד״ץ א", "Badatz A"), CHIP("b", "בד״ץ ב", "Badatz B")],
        decidingCertifier: CHIP("b", "בד״ץ ב", "Badatz B"),
      }),
      "he",
    );
    expect(label).toBe("בד״ץ ב");
  });

  it("names every certifier when the response does not say which decided", () => {
    const label = certifierLabel(
      view({ certifiers: [CHIP("a", "בד״ץ א", "Badatz A"), CHIP("b", "בד״ץ ב", "Badatz B")] }),
      "he",
    );
    expect(label).toBe("בד״ץ א · בד״ץ ב");
  });

  it("falls back to the Hebrew name when a certifier has no English one", () => {
    const chip: CertifierChip = { ...CHIP("a", "בד״ץ א", ""), name_en: null };
    expect(certifierLabel(view({ certifiers: [chip] }), "en")).toBe("בד״ץ א");
  });

  it("returns nothing rather than inventing a certifier", () => {
    expect(certifierLabel(view({}), "he")).toBeNull();
  });
});
