/**
 * Architectural guard for a locked decision: no client-side kashrut logic.
 *
 * The verdict and its reasons come from the API and the client renders them. The
 * fixture server in `src/api/mock/` stands in for the API while Track B builds it,
 * so it is allowed to hold the rules — but only behind the `src/api` boundary, and
 * only until it is deleted.
 *
 * Two checks:
 *   1. Nothing outside `src/api/` imports the mock.
 *   2. No view, component or hook mentions the verdict enum values, which is how a
 *      client-side rule would have to start.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const files = walk(SRC).map((file) => ({
  rel: path.relative(SRC, file).replace(/\\/g, "/"),
  text: readFileSync(file, "utf8"),
}));

/**
 * The patterns, named so the "not vacuous" test at the bottom can fire each one at
 * synthetic source. A regex guard is only as good as its own coverage: the first
 * version of `VERDICT_LITERAL` matched quote characters only, so the same rule
 * written with a template literal would have walked straight past it.
 */
const PATTERNS = {
  /** A verdict enum value written as any kind of string literal, backticks included. */
  verdictLiteral: /["'`](match|no_match|unknown)["'`]/,
  /** Branching on a verdict — how a client-side rule reads once it stops being a literal. */
  verdictBranch: /\bverdict\s*[=!]==|switch\s*\(\s*[\w.?]*\bverdict\b/,
  /** Reading a certificate's attribute map, i.e. deriving from evidence rather than rendering it. */
  attributeRead: /\.attributes\b/,
} as const;

/** `t.attributes` / `strings.attributes` are the *string table*, not a certificate. */
function withoutStringTable(text: string): string {
  return text.replace(/\b(t|strings|STRINGS)\.attributes\b/g, "");
}

const isUiLayer = (rel: string) => rel.startsWith("views/") || rel.startsWith("components/");

describe("no client-side kashrut logic", () => {
  it("keeps the fixture server behind the api boundary", () => {
    const leaks = files
      .filter((file) => !file.rel.startsWith("api/") && !file.rel.startsWith("test/"))
      .filter((file) => /from\s+["'][^"']*api\/mock/.test(file.text))
      .map((file) => file.rel);
    expect(leaks).toEqual([]);
  });

  it("never derives a verdict outside the api and rendering layers", () => {
    // Files allowed to name verdict values: the API layer (wire types + fixture
    // server), the components that *render* a verdict, and the tests.
    const allowed = [
      /^api\//,
      /^test\//,
      /^i18n\/reasons\.ts$/,
      /^components\/VerdictPill\.tsx$/,
      /^components\/EvidencePanel\.tsx$/,
      /^saved\/saved\.ts$/,
      // Validates a stored CertificationLevel, which shares the word "unknown".
      /^profile\/storage\.ts$/,
      /^views\/Saved\.tsx$/,
      /^views\/MapView\.tsx$/,
    ];
    const offenders = files
      .filter((file) => !allowed.some((pattern) => pattern.test(file.rel)))
      .filter(
        (file) =>
          PATTERNS.verdictLiteral.test(file.text) || PATTERNS.verdictBranch.test(file.text),
      )
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  /**
   * A server validation dump once reached a Hebrew consumer screen — English
   * Pydantic output about our own request body, rendered as if it were an answer.
   * Nothing in the UI layer may interpolate a server-supplied string.
   */
  it("never renders a server-supplied error message", () => {
    const offenders = files
      .filter((file) => isUiLayer(file.rel))
      .filter((file) => /(error|caught)\??\.message/.test(file.text))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it("keeps the technical detail to exactly one console.error, in the data layer", () => {
    const logging = files
      .filter((file) => !file.rel.startsWith("test/"))
      .filter((file) => /console\.error/.test(file.text))
      .map((file) => file.rel)
      .sort();
    expect(logging).toEqual(["hooks/useApi.ts", "profile/ProfileProvider.tsx"]);
  });

  /**
   * Widened from the original, which only caught `certificate.attributes` and
   * friends — a rule reached through any other variable name (`row.attributes`,
   * `deciding.attributes`) went unseen. Now *any* attribute-map read in the UI layer
   * is a finding, with the string table's `t.attributes` excluded by name.
   */
  it("has no component reading certificate attributes to decide anything", () => {
    const offenders = files
      .filter((file) => isUiLayer(file.rel))
      .filter((file) => PATTERNS.attributeRead.test(withoutStringTable(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  /**
   * A guard that cannot fail is not a guard. Each pattern is fired at source that
   * really does violate the rule, in the shapes most likely to be written: a
   * template literal instead of a quoted one, a comparison against a verdict that
   * never names its values, and an attribute read through an innocuous variable.
   */
  it("catches the violations it exists to catch", () => {
    expect(PATTERNS.verdictLiteral.test('if (v === "match") show()')).toBe(true);
    expect(PATTERNS.verdictLiteral.test("if (v === `match`) show()")).toBe(true);
    expect(PATTERNS.verdictLiteral.test("const OK = [`no_match`, `unknown`]")).toBe(true);

    expect(PATTERNS.verdictBranch.test("if (item.kashrut.verdict === WANTED) show()")).toBe(true);
    expect(PATTERNS.verdictBranch.test("if (verdict !== wanted) hide()")).toBe(true);
    expect(PATTERNS.verdictBranch.test("switch (item.kashrut.verdict) {")).toBe(true);

    expect(PATTERNS.attributeRead.test(withoutStringTable("row.attributes.glatt"))).toBe(true);
    expect(PATTERNS.attributeRead.test(withoutStringTable("deciding?.attributes[key]"))).toBe(true);
    // …and the string table is still allowed through.
    expect(PATTERNS.attributeRead.test(withoutStringTable("{t.attributes[attribute]}"))).toBe(false);
  });
});
