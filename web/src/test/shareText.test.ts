/**
 * The exact text that leaves the app when a saved list is shared.
 *
 * Locked here because it is the one place the product speaks to someone who has not
 * installed it: it must read like a message a person wrote, and it must never carry
 * a verdict — the recipient's own profile answers that.
 */

import { describe, expect, it } from "vitest";
import { STRINGS } from "../i18n/strings";
import type { SavedList, SavedPlace } from "../saved/saved";
import { savedListAsText } from "../saved/shareText";

const ORIGIN = "https://kashroot.app";

function place(overrides: Partial<SavedPlace> = {}): SavedPlace {
  return {
    restaurantId: "id-1",
    nameHe: "נוגטין",
    nameEn: "Nougatine",
    cityHe: "ירושלים",
    dietType: null,
    verdictAtSave: "match",
    certifierLabel: "בד״צ",
    savedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function list(name: string, places: SavedPlace[]): SavedList {
  return { id: `list-${name}`, name, places };
}

describe("savedListAsText", () => {
  it("is empty when the list is empty", () => {
    expect(savedListAsText(list("שמורים", []), "he", STRINGS.he, ORIGIN)).toBe("");
  });

  it("names the list, then each place over two lines", () => {
    const text = savedListAsText(list("טיול צפון", [place()]), "he", STRINGS.he, ORIGIN);
    expect(text).toBe(
      [
        "טיול צפון — מקום ששמרתי ב־Kashroot:",
        "",
        "• נוגטין · ירושלים",
        `  ${ORIGIN}/r/id-1`,
        "",
        STRINGS.he.saved.shareNote,
      ].join("\n"),
    );
  });

  it("counts the places in the heading", () => {
    const text = savedListAsText(
      list("שמורים", [place(), place({ restaurantId: "id-2" })]),
      "he",
      STRINGS.he,
      ORIGIN,
    );
    expect(text.startsWith("שמורים — 2 מקומות ששמרתי ב־Kashroot:")).toBe(true);
  });

  it("omits the city separator when the place has no city", () => {
    const text = savedListAsText(list("שמורים", [place({ cityHe: null })]), "he", STRINGS.he, ORIGIN);
    expect(text).toContain("• נוגטין\n");
    expect(text).not.toContain("·");
  });

  it("uses English names and copy in English", () => {
    const text = savedListAsText(list("Up north", [place()]), "en", STRINGS.en, ORIGIN);
    expect(text).toContain("• Nougatine · ירושלים");
    expect(text.startsWith("Up north — a place I saved on Kashroot:")).toBe(true);
  });

  it("never carries a verdict or a certifier out of the sender's screen", () => {
    const text = savedListAsText(
      list("שמורים", [place({ verdictAtSave: "match" })]),
      "he",
      STRINGS.he,
      ORIGIN,
    );
    for (const word of ["match", "מתאים", "בד״צ"]) {
      expect(text).not.toContain(word);
    }
  });
});
