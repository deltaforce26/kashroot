/**
 * The restaurant field vocabulary, shared by the row editor and the create panel.
 *
 * Lifted verbatim out of `views/Restaurants.tsx` so the two forms render the same
 * fields, in the same order, with the same labels and the same LTR isolation. The
 * create form can therefore reach no field the edit form cannot — which is also the
 * server's rule (both requests are intersected with `EDITABLE_RESTAURANT_FIELDS`).
 */

import { AMENITY_KEYS, type AmenityKey } from "../api/types";

/** Free-text fields, in the order the editor lays them out. */
export type TextField =
  | "name_he"
  | "name_en"
  | "branch_label"
  | "address_he"
  | "address_en"
  | "city_he"
  | "city_en"
  | "city_slug"
  | "neighborhood_he"
  | "phone"
  | "website"
  | "menu_url"
  | "business_type_he"
  | "notes";

export const FIELD_LABELS: Record<TextField, string> = {
  name_he: "שם (עברית)",
  name_en: "שם (אנגלית)",
  branch_label: "שם הסניף",
  address_he: "כתובת (עברית)",
  address_en: "כתובת (אנגלית)",
  city_he: "עיר (עברית)",
  city_en: "עיר (אנגלית)",
  city_slug: "מזהה עיר (slug)",
  neighborhood_he: "שכונה (עברית)",
  phone: "טלפון",
  website: "אתר אינטרנט",
  menu_url: "קישור לתפריט",
  business_type_he: "סוג העסק (עברית)",
  notes: "הערות לרשומה",
};

/** Latin-only fields: forced LTR so a slug or URL never reorders under bidi. */
export const LTR_FIELDS: ReadonlySet<TextField> = new Set<TextField>([
  "city_slug",
  "phone",
  "website",
  "menu_url",
]);

export const FIELD_GROUPS: ReadonlyArray<{ title: string; fields: readonly TextField[] }> = [
  { title: "זיהוי", fields: ["name_he", "name_en", "branch_label"] },
  {
    title: "מיקום",
    fields: ["address_he", "address_en", "city_he", "city_en", "city_slug", "neighborhood_he"],
  },
  { title: "יצירת קשר", fields: ["phone", "website", "menu_url"] },
];

/** Tri-state, like the certificate attribute editor: "—" means nothing recorded. */
export const AMENITY_CHOICES = ["", "true", "false"] as const;

export type AmenityChoice = (typeof AMENITY_CHOICES)[number];

export const AMENITY_CHOICE_LABELS: Record<AmenityChoice, string> = {
  "": "— לא נרשם",
  true: "כן",
  false: "לא",
};

/**
 * The tri-state amenity draft as the API wants it: an unrecorded amenity is
 * omitted entirely rather than guessed as `false`.
 */
export function amenitiesFrom(amenities: Record<string, string>): Partial<Record<AmenityKey, boolean>> {
  const built: Partial<Record<AmenityKey, boolean>> = {};
  for (const key of AMENITY_KEYS) {
    if (amenities[key] !== "") built[key] = amenities[key] === "true";
  }

  return built;
}
