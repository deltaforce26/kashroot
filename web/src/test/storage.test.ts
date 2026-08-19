import { describe, expect, it } from "vitest";
import {
  PROFILE_SCHEMA_VERSION,
  loadProfile,
  parseProfile,
  saveProfile,
} from "../profile/storage";
import { parseSaved } from "../saved/saved";
import { EMPTY_PROFILE } from "../profile/profile";

describe("profile persistence", () => {
  it("round-trips through localStorage", () => {
    const profile = {
      presetId: "custom" as const,
      whitelist: [{ certifier_id: "c-rubin", min_level: "mehadrin" as const }],
      requiredAttributes: ["pas_yisrael" as const],
      completedOnboarding: true,
    };
    saveProfile(profile);
    expect(loadProfile()).toEqual(profile);
  });

  it("returns the empty profile when nothing is stored", () => {
    expect(loadProfile()).toEqual(EMPTY_PROFILE);
  });

  it("discards a corrupt blob rather than half-trusting it", () => {
    expect(parseProfile("not json")).toBeNull();
    const v = `"version":${PROFILE_SCHEMA_VERSION}`;
    expect(parseProfile(`{${v},"whitelist":"nope","requiredAttributes":[]}`)).toBeNull();
    expect(parseProfile(`{${v},"whitelist":[{"certifier_id":1}],"requiredAttributes":[]}`)).toBeNull();
    expect(
      parseProfile(
        `{${v},"whitelist":[{"certifier_id":"a","min_level":"super"}],"requiredAttributes":[]}`,
      ),
    ).toBeNull();
  });

  it("drops attribute keys it cannot enforce instead of storing them", () => {
    const parsed = parseProfile(
      `{"version":${PROFILE_SCHEMA_VERSION},"whitelist":[],` +
        '"requiredAttributes":["glatt","not_a_real_attribute"],"completedOnboarding":true}',
    );
    expect(parsed?.requiredAttributes).toEqual(["glatt"]);
  });

  it("treats a missing completedOnboarding flag as not completed", () => {
    expect(
      parseProfile(`{"version":${PROFILE_SCHEMA_VERSION},"whitelist":[],"requiredAttributes":[]}`)
        ?.completedOnboarding,
    ).toBe(false);
  });

  /**
   * The incident this guards against: a profile written while the app ran on
   * fixtures, then read back after the app was pointed at the live API. Its
   * certifier ids do not exist server-side, so every request 422s — and clearing it
   * is the only way out. A stored profile from an older schema is now simply gone.
   */
  it("discards a profile written by a superseded schema version", () => {
    expect(
      parseProfile('{"whitelist":[],"requiredAttributes":[],"completedOnboarding":true}'),
    ).toBeNull();
    expect(
      parseProfile('{"version":1,"whitelist":[],"requiredAttributes":[],"completedOnboarding":true}'),
    ).toBeNull();
  });

  /**
   * The "Local Rabbanut" preset was withdrawn after profiles had already been saved
   * from it. Those profiles must keep working: the whitelist stores certifier ids,
   * not the preset name, so nothing the match engine sees changes. Only the row
   * highlight — a purely cosmetic marker — is lost.
   */
  it("keeps a profile saved from the withdrawn Rabbanut preset usable", () => {
    const parsed = parseProfile(
      `{"version":${PROFILE_SCHEMA_VERSION},"presetId":"rabbanut",` +
        '"whitelist":[{"certifier_id":"cert-rab-bb","min_level":"regular"}],' +
        '"requiredAttributes":["glatt"],"completedOnboarding":true}',
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.whitelist).toEqual([{ certifier_id: "cert-rab-bb", min_level: "regular" }]);
    expect(parsed?.requiredAttributes).toEqual(["glatt"]);
    expect(parsed?.completedOnboarding).toBe(true);
    // The unrecognised marker is dropped, not treated as corruption.
    expect(parsed?.presetId).toBeNull();
  });

  it("sweeps away keys left by superseded versions on load", () => {
    localStorage.setItem(
      "kashroot.profile.v1",
      '{"whitelist":[{"certifier_id":"cert-rubin","min_level":"regular"}],"requiredAttributes":[],"completedOnboarding":true}',
    );
    expect(loadProfile()).toEqual(EMPTY_PROFILE);
    expect(localStorage.getItem("kashroot.profile.v1")).toBeNull();
  });
});

describe("saved-list persistence", () => {
  it("keeps well-formed places and drops malformed ones", () => {
    const parsed = parseSaved(
      JSON.stringify({
        lists: [
          {
            id: "l1",
            name: "Saved",
            places: [
              { restaurantId: "r1", nameHe: "נוגטין", verdictAtSave: "match" },
              { restaurantId: "r2", nameHe: "x", verdictAtSave: "maybe" },
              { nameHe: "no id", verdictAtSave: "match" },
            ],
          },
        ],
      }),
    );
    expect(parsed?.lists[0]?.places.map((place) => place.restaurantId)).toEqual(["r1"]);
  });

  it("rejects a non-list payload", () => {
    expect(parseSaved('{"lists":"nope"}')).toBeNull();
    expect(parseSaved("garbage")).toBeNull();
  });
});
