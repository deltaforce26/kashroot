/**
 * Hebrew display labels for the API's enum vocabularies.
 *
 * The console is a Hebrew/RTL tool, but the wire format stays English: every map
 * here is display-only. Raw enum values keep driving `className`, request bodies
 * and query strings, so nothing about the API contract moves when a label does.
 *
 * Where a moderator may need to trace a value back to the database (certificate
 * attribute keys, mainly), the view shows the Hebrew label *and* the raw key.
 */

import type {
  AmenityKey,
  AuditAction,
  CertificateAttribute,
  CertificateSource,
  CertificateState,
  CertificationLevel,
  DietType,
  EvidencePhotoStatus,
  FlagType,
  RecordState,
  RestaurantStatus,
} from "./api/types";

export const ATTRIBUTE_LABELS: Record<CertificateAttribute, string> = {
  glatt: "גלאט",
  chalav_yisrael: "חלב ישראל",
  pas_yisrael: "פת ישראל",
  bishul_yisrael: "בישול ישראל",
  yashan: "ישן",
  kitniyot_pesach: "קטניות בפסח",
  sheruya: "שרויה",
};

export const DIET_TYPE_LABELS: Record<DietType, string> = {
  meat: "בשרי",
  dairy: "חלבי",
  pareve: "פרווה",
  fish: "דגים",
  mixed: "מעורב",
  dairy_pareve: "חלבי ופרווה",
};

export const RESTAURANT_STATUS_LABELS: Record<RestaurantStatus, string> = {
  open: "פעילה",
  closed_temp: "סגורה זמנית",
  closed_perm: "סגורה לצמיתות",
};

export const AMENITY_LABELS: Record<AmenityKey, string> = {
  family: "מתאים למשפחות",
  parking: "חניה",
  accessibility: "נגישות",
  delivery: "משלוחים",
  groups: "קבוצות",
};

export const RECORD_STATE_LABELS: Record<RecordState, string> = {
  list_verified: "אומת מול רשימה רשמית",
  moderator_verified: "אומת בידי מודרטור",
  owner_submitted: "נמסר בידי בעל העסק",
  field_verified: "אומת בבדיקת שטח",
  unknown_pending_verification: "לא ידוע — ממתין לאימות",
};

export const CERTIFICATE_STATE_LABELS: Record<CertificateState, string> = {
  active: "בתוקף",
  expired: "פג תוקף",
  revoked: "בוטלה",
  pending: "ממתינה",
};

export const CERTIFICATE_SOURCE_LABELS: Record<CertificateSource, string> = {
  certifier_portal: "פורטל גוף הכשרות",
  official_list: "רשימה רשמית",
  moderator_verified: "אומת בידי מודרטור",
  owner_submitted: "נמסר בידי בעל העסק",
  field_verification: "בדיקת שטח",
};

export const CERTIFICATION_LEVEL_LABELS: Record<CertificationLevel, string> = {
  unknown: "לא ידועה",
  regular: "רגילה",
  mehadrin: "מהדרין",
};

export const FLAG_TYPE_LABELS: Record<FlagType, string> = {
  closed: "העסק סגור",
  no_certificate_displayed: "לא מוצגת תעודה",
  different_certifier: "גוף כשרות אחר",
  expired_certificate: "תעודה שפג תוקפה",
  wrong_details: "פרטים שגויים",
  wrong_hours: "שעות פתיחה שגויות",
  other: "אחר",
};

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  create: "יצירה",
  update: "עדכון",
  delete: "מחיקה",
  state_change: "שינוי מצב",
};

export const PHOTO_STATUS_LABELS: Record<EvidencePhotoStatus, string> = {
  pending_review: "ממתינה לבדיקה",
  accepted: "אושרה",
  rejected: "נדחתה",
};

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  restaurant: "מסעדה",
  certificate: "תעודה",
  flag: "דיווח",
};

/** Falls back to the raw value so an enum the frontend has not caught up with still renders. */
export function label<T extends string>(map: Record<T, string>, value: T): string {
  return map[value] ?? value;
}
