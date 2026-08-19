import { describe, expect, it } from "vitest";
import type { CertifierView } from "../api/viewmodel";
import {
  certifierName,
  EMPTY_PROFILE,
  expandPreset,
  isProfileUsable,
  isWhitelisted,
  minLevelFor,
  PRESET_ORDER,
  profileFromPreset,
  sortCertifiersForDisplay,
  toPayload,
  toggleAttribute,
  toggleCertifier,
} from "../profile/profile";

const CERTIFIERS: CertifierView[] = [
  { id: "c-rubin", nameHe: "בד״ץ מהדרין — רובין", nameEn: "Badatz Mehadrin (Rubin)", type: "badatz", levels: ["mehadrin"] },
  { id: "c-eda", nameHe: "בד״ץ העדה החרדית", nameEn: "Badatz Eda Haredit", type: "badatz", levels: ["mehadrin"] },
  { id: "c-rab-bb", nameHe: "רבנות בני ברק", nameEn: "Rabbanut Bnei Brak", type: "rabbanut_local", levels: ["regular", "mehadrin"] },
  { id: "c-rab-nat", nameHe: "הרבנות הראשית", nameEn: "Chief Rabbanut", type: "rabbanut_national", levels: ["regular"] },
];

describe("preset expansion", () => {
  it("'any' whitelists every certifier at its base published level", () => {
    const whitelist = expandPreset("any", CERTIFIERS);
    expect(whitelist).toHaveLength(CERTIFIERS.length);
    expect(whitelist.every((entry) => entry.min_level === "regular")).toBe(true);
  });

  /**
   * The one-tap "Local Rabbanut" preset is withdrawn until national Rabbanut data
   * exists — a coverage decision, not a product opinion. See `PRESET_ORDER`. It is
   * not offered anywhere, and a user who wants Rabbanut Bnei Brak selects it by hand
   * in the picker, which the next assertion shows still works.
   */
  it("does not offer a one-tap Rabbanut preset while the corpus holds one Rabbanut", () => {
    expect(PRESET_ORDER).not.toContain("rabbanut");
    expect(PRESET_ORDER).toEqual(["any", "mehadrin", "badatz", "custom"]);
  });

  it("still lets a Rabbanut be whitelisted by hand", () => {
    const chosen = toggleCertifier(profileFromPreset("custom", CERTIFIERS), "c-rab-bb");
    expect(isWhitelisted(chosen, "c-rab-bb")).toBe(true);
    expect(isProfileUsable(chosen)).toBe(true);
  });

  it("'mehadrin' raises the minimum for Rabbanut but not for Badatz", () => {
    const whitelist = expandPreset("mehadrin", CERTIFIERS);
    const byId = Object.fromEntries(whitelist.map((entry) => [entry.certifier_id, entry.min_level]));
    expect(byId["c-rab-bb"]).toBe("mehadrin");
    expect(byId["c-rab-nat"]).toBe("mehadrin");
    // A Badatz is taken at its own base level: the app does not rank one body's
    // level against another's.
    expect(byId["c-rubin"]).toBe("regular");
    expect(byId["c-eda"]).toBe("regular");
  });

  it("'badatz' selects Badatz certifiers as a starting point", () => {
    const ids = expandPreset("badatz", CERTIFIERS).map((entry) => entry.certifier_id);
    expect(ids.sort()).toEqual(["c-eda", "c-rubin"]);
  });

  it("'custom' starts empty and is therefore not usable yet", () => {
    const profile = profileFromPreset("custom", CERTIFIERS);
    expect(profile.whitelist).toEqual([]);
    expect(isProfileUsable(profile)).toBe(false);
  });

  it("a preset never sets a required attribute on the user's behalf", () => {
    for (const preset of PRESET_ORDER) {
      expect(profileFromPreset(preset, CERTIFIERS).requiredAttributes).toEqual([]);
    }
  });
});

describe("whitelist editing", () => {
  it("toggles a certifier on and off", () => {
    const base = profileFromPreset("custom", CERTIFIERS);
    const added = toggleCertifier(base, "c-rubin");
    expect(isWhitelisted(added, "c-rubin")).toBe(true);
    expect(minLevelFor(added, "c-rubin")).toBe("regular");
    expect(isWhitelisted(toggleCertifier(added, "c-rubin"), "c-rubin")).toBe(false);
  });

  it("marks an edited profile as custom, so the preset row stops claiming ownership", () => {
    const base = profileFromPreset("any", CERTIFIERS);
    expect(base.presetId).toBe("any");
    expect(toggleCertifier(base, "c-rubin").presetId).toBe("custom");
  });

  it("toggles required attributes", () => {
    const withAttr = toggleAttribute(EMPTY_PROFILE, "chalav_yisrael");
    expect(withAttr.requiredAttributes).toEqual(["chalav_yisrael"]);
    expect(toggleAttribute(withAttr, "chalav_yisrael").requiredAttributes).toEqual([]);
  });
});

describe("wire payload", () => {
  it("sorts deterministically so identical profiles produce identical requests", () => {
    const a = toggleCertifier(toggleCertifier(EMPTY_PROFILE, "c-rubin"), "c-eda");
    const b = toggleCertifier(toggleCertifier(EMPTY_PROFILE, "c-eda"), "c-rubin");
    expect(toPayload(a)).toEqual(toPayload(b));
  });

  it("carries the whitelist and required attributes and nothing else", () => {
    const profile = toggleAttribute(toggleCertifier(EMPTY_PROFILE, "c-rubin"), "pas_yisrael");
    expect(toPayload(profile)).toEqual({
      whitelist: [{ certifier_id: "c-rubin", min_level: "regular" }],
      required_attributes: ["pas_yisrael"],
      // Layer 2 preferences go out empty: the POC collects none.
      preferred_diets: [],
      preferred_price_level: null,
      wanted_amenities: [],
    });
  });
});

describe("certifier display order", () => {
  it("is alphabetical by displayed name — never by type or stringency", () => {
    const he = sortCertifiersForDisplay(CERTIFIERS, "he").map((certifier) => certifier.nameHe);
    expect(he).toEqual([...he].sort((a, b) => a.localeCompare(b, "he")));

    const en = sortCertifiersForDisplay(CERTIFIERS, "en").map((certifier) =>
      certifierName(certifier, "en"),
    );
    expect(en).toEqual([...en].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("does not group Badatz certifiers ahead of Rabbanut ones", () => {
    const types = sortCertifiersForDisplay(CERTIFIERS, "en").map((certifier) => certifier.type);
    // Alphabetically the English names interleave the two types; a type-ordered list
    // would have all badatz first.
    expect(types).not.toEqual(["badatz", "badatz", "rabbanut_local", "rabbanut_national"]);
  });
});
