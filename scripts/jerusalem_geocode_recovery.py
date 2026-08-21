"""Jerusalem geocode coverage recovery — POC Thu 20 Aug 2026 demo (POC_PLAN.md A5).

Jerusalem started at 64/140 geocoded (45.7%), the lowest of the demo's lead cities,
almost entirely because ``eda_haredit_jerusalem_poster`` OCR noise either (a) flags
restaurants ``needs_review`` at seed-import time before geocoding ever runs, or
(b) leaves trailing mall/neighbourhood tokens and misspelled street names in
``address_he`` that make ``app.ingestion.geocode`` return ``partial_match`` /
``multiple_candidates`` instead of a clean ROOFTOP/RANGE_INTERPOLATED single match.

This script does NOT change the geocode accept bar (still: status OK, exactly one
candidate, ROOFTOP/RANGE_INTERPOLATED, locality in ``CITY_LOCALITY_ALIASES``). It only
changes which rows are eligible to be tried against that bar, in two ways:

1. **Address corrections** (``ADDRESS_CORRECTIONS``) — every entry was verified against
   the restaurant's *own* cached Google response (``geocode_cache``) before being
   written here: either Google already resolved the OCR'd query to a single precise
   ROOFTOP/RANGE result and was only blocked by a trailing non-address token (a mall
   name, a neighbourhood name, garbled OCR tail), or Google's own fuzzy match on the
   full garbled string already landed on one specific, precise, correctly-spelled
   street name. No correction here was invented from outside knowledge of Jerusalem
   geography — each is grounded in what Google itself already said about that exact
   query. Two- and three-way ties that Google could not resolve (e.g. Keren Kayemet
   in Rechavia vs. Mevaseret Zion; HaPalmach 42 vs. Emek Refaim 42, both real,
   distinct, both ROOFTOP) are deliberately NOT included — that is a genuine ambiguity
   this script has no evidence to break.

2. **Phone-only needs_review unblocking** (``PHONE_ONLY_REVIEW_IDS``) — 20 Jerusalem
   rows were flagged ``needs_review`` at seed-import time with the *exact* audited
   note "phone-to-row alignment on poster imperfect; verify phone" (see
   ``app.ingestion.seed_import`` / the ``eda_haredit_jerusalem_poster`` source). That
   note names the phone column, not the address, as the ambiguous field; the address
   itself was never in question. ``app.ingestion.geocode`` excludes every
   ``needs_review`` restaurant on the conservative assumption doubt covers the address
   too — correct as a blanket default, but here the per-row evidence says otherwise.
   This script clears ``needs_review`` for exactly these audited rows so they become
   geocode candidates (still subject to the unchanged accept bar), and opens a
   ``Flag(WRONG_DETAILS)`` on each so the phone-verification need is not lost — it
   moves to the moderation queue instead of silently disappearing.

``duplicate_place_id`` rows are deliberately NOT touched here: every Jerusalem
duplicate_place_id case checked resolves to a shopping-mall or office-building street
address shared by several genuinely distinct businesses (Ramot Mall, Har Hotzvim
Kiryat Mada, Paran St Ramat Eshkol...). Google Geocoding returns one place (the
building), and ``Restaurant.google_place_id`` is unique in the schema, so only one
tenant can ever hold that point. No address correction changes this — it is a
building-level precision ceiling, not an OCR error. Confirmed for every group: the
first restaurant at each contested place_id already holds a written geo point.

Idempotent and re-runnable: every write is keyed by a fixed ``restaurant_id`` and
guarded by asserting the current ``address_he`` matches what this script expects
before changing it, so a second run is a no-op (mismatches raise instead of silently
overwriting unrelated data). Geocoding itself is delegated entirely to
``app.ingestion.geocode.geocode_restaurants`` — this script never writes a geo point
directly.

Run (dry run first — reports the correction diff and rolls back; geocoding step still
needs ``--apply`` for its own API calls, run separately via ``kashroot geocode``):

    python -m scripts.jerusalem_geocode_recovery --dry-run
    python -m scripts.jerusalem_geocode_recovery --apply
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import uuid

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import session_scope
from app.ingestion.geocode import GeocodeError, GoogleGeocoder, geocode_restaurants
from app.models import AuditAction, AuditLog, Flag, FlagState, FlagType, Restaurant

ACTOR = "data-pipeline:jerusalem-recovery"
CORRECTION_REASON = "jerusalem_address_ocr_repair"
PHONE_UNBLOCK_REASON = "jerusalem_phone_only_ambiguity_unblocked_for_geocoding"
PHONE_FLAG_MESSAGE = (
    "Seed import flagged this row needs_review for phone-to-row alignment on the "
    "eda_haredit_jerusalem_poster source (poster layout, not the address). Address "
    "was cleared for geocoding by scripts/jerusalem_geocode_recovery.py; the phone "
    "number itself is still unverified and needs moderator review."
)


@dataclasses.dataclass(frozen=True)
class AddressCorrection:
    """One audited address fix: what the source OCR produced, what it should read,
    and the cached-response evidence that justified the change.

    Parameters:
        restaurant_id (uuid.UUID): Row to correct.
        name_he (str): Business name, for the audit trail and human review.
        old_address_he (str): The address currently in the database (guard value).
        new_address_he (str): The corrected address to write.
        rationale (str): Why this specific correction, grounded in the row's own
            cached Google response.

    Return:
        None
    """

    restaurant_id: uuid.UUID
    name_he: str
    old_address_he: str
    new_address_he: str
    rationale: str


ADDRESS_CORRECTIONS: tuple[AddressCorrection, ...] = (
    # -- partial_match: trailing mall/neighbourhood token blocked an already-precise
    # -- street+number match Google had already returned for the OCR'd query. -------
    AddressCorrection(
        uuid.UUID("7c211793-1884-46f3-8117-cf0047b466b2"),
        "MEAT CHOICE",
        "אגריפס 88 מרכז",
        "אגריפס 88",
        "cached response already ROOFTOP-matched 'אגריפס 88'; trailing 'מרכז' unparsed",
    ),
    AddressCorrection(
        uuid.UUID("13fbb561-4e47-415c-8588-19f1b342be0b"),
        "איטליז מטעם חפץ חיים",
        "אגריפס 8 מרכז",
        "אגריפס 8",
        "cached response already ROOFTOP-matched 'אגריפס 8'; trailing 'מרכז' unparsed",
    ),
    AddressCorrection(
        uuid.UUID("5c359adc-0d64-43a3-8917-b8b5bd42db1a"),
        "בורגר ביט",
        "שמגר 16 קניון רב שפע בעלז",
        "שמגר 16",
        "cached response already ROOFTOP-matched 'שמגר 16'; mall+neighbourhood tail unparsed",
    ),
    AddressCorrection(
        uuid.UUID("e11ea709-fc42-412f-8de4-53f313eacd9b"),
        "בייגל קפה אקספרס",
        "פארן 7 מרכז מסחרי",
        "פארן 7",
        "cached response already ROOFTOP-matched 'פארן 7'; trailing 'מרכז מסחרי' unparsed",
    ),
    AddressCorrection(
        uuid.UUID("6ff60f10-d3a3-4951-9588-fff5b403a65d"),
        "גבינה ועגבניה",
        "המלך ג'ורג' 52 מרכז",
        "המלך ג'ורג' 52",
        "cached response already ROOFTOP-matched the street; trailing 'מרכז' unparsed",
    ),
    AddressCorrection(
        uuid.UUID("7e74a848-44b2-48e9-a118-d966daba46bd"),
        "טשולנט עולמי / מיטיים",
        "הנגר 2 מיר",
        "הנגר 2",
        "cached response already ROOFTOP-matched 'הנגר 2'; trailing 'מיר' (neighbourhood) unparsed",
    ),
    AddressCorrection(
        uuid.UUID("2b439361-7485-460e-83a9-ad7200c25012"),
        "מאפיית THE RYE",
        "הרב סרוצקין 18 בעלז",
        "הרב סורוצקין 18",
        "OCR dropped a vav (סרוצקין -> סורוצקין); cached response already ROOFTOP-"
        "matched the corrected spelling, blocked only by trailing 'בעלז'",
    ),
    AddressCorrection(
        uuid.UUID("1faefdd1-590b-49d4-97ac-497378178121"),
        "מאפיית לחם פיינגולד",
        "פינת האפרסק 1 מרכז",
        "האפרסק 1",
        "cached response already RANGE_INTERPOLATED-matched 'האפרסק 1'; 'פינת' "
        "('corner of') and trailing 'מרכז' unparsed",
    ),
    AddressCorrection(
        uuid.UUID("c2822d10-ae3c-4e53-8bfe-2e6ae96dd27d"),
        "מגדניית מרציפן",
        "אגריפס 81 מרכז",
        "אגריפס 81",
        "cached response already ROOFTOP-matched 'אגריפס 81'; trailing 'מרכז' unparsed",
    ),
    AddressCorrection(
        uuid.UUID("5ad95316-7f6e-4fc3-a14f-a4be3ac7ed67"),
        "מגדניית מרציפן",
        "אגריפס 44 מרכז",
        "אגריפס 44",
        "cached response already ROOFTOP-matched 'אגריפס 44'; trailing 'מרכז' unparsed",
    ),
    AddressCorrection(
        uuid.UUID("087871ff-b55d-419a-8963-ce127d491357"),
        "מיני קצפת",
        "שמגר 21 בעלז",
        "שמגר 21",
        "cached response already ROOFTOP-matched 'שמגר 21'; trailing 'בעלז' unparsed",
    ),
    AddressCorrection(
        uuid.UUID("9eff6ac7-6c2f-4b58-a554-a8902ac9553a"),
        "מיסטר בייגל",
        "שמגר 16 קניון רב שפע בעלז",
        "שמגר 16",
        "same building as בורגר ביט / קצפת below; expect duplicate_place_id for two "
        "of the three once corrected — a real mall, not a data error",
    ),
    AddressCorrection(
        uuid.UUID("1f0987a4-ee90-467d-b221-9c020a7838a7"),
        "סושי טוקיו",
        "זוננפלד 12 מיר",
        "זוננפלד 12",
        "cached response already ROOFTOP-matched 'הרב זוננפלד 12'; trailing 'מיר' unparsed",
    ),
    AddressCorrection(
        uuid.UUID("f23d5a24-c8aa-4d36-8354-f9b29449a52f"),
        "סושי טוקיו",
        "אגריפס 111 מרכז",
        "אגריפס 111",
        "cached response already ROOFTOP-matched 'אגריפס 111'; trailing 'מרכז' unparsed",
    ),
    AddressCorrection(
        uuid.UUID("ea538912-9d4d-402d-81e1-819aba92d844"),
        "סי דג",
        "יעקב אהליהב 5 גבעת שאול",
        "יעקב אליאב 5",
        "OCR garbled the street name (אהליהב -> אליאב); cached response already "
        "ROOFTOP-matched the corrected spelling, blocked only by trailing neighbourhood",
    ),
    AddressCorrection(
        uuid.UUID("f84bdac1-afe8-4bd9-ade4-041e711a071a"),
        "פיצה האט",
        "זלמן שניאור 1 ת. דקל מנטה ניות",
        "זלמן שניאור 1",
        "cached response already ROOFTOP-matched 'זלמן שניאור 1'; trailing text is "
        "unreadable OCR noise, not part of any address",
    ),
    AddressCorrection(
        uuid.UUID("93236e99-c1e6-4a86-83c2-983e27a5d618"),
        "פיצה האט TAKE AWAY",
        "יפו 228 מרכז",
        "יפו 228",
        "cached response already ROOFTOP-matched 'יפו 228' (central bus station); "
        "trailing 'מרכז' unparsed",
    ),
    AddressCorrection(
        uuid.UUID("834b4fe6-079f-4297-8f9a-319f891b8a42"),
        "פיצה האט TAKE AWAY",
        "בן הלל 15 מרכז",
        "בן הלל 15",
        "cached response already ROOFTOP-matched 'בן הלל 15'; trailing 'מרכז' unparsed",
    ),
    AddressCorrection(
        uuid.UUID("bfa3d9d5-3b81-4278-a1bd-d65487b30bb1"),
        "פיצה פפידו",
        "שטראוס 3 מרכז",
        "שטראוס 3",
        "cached response already ROOFTOP-matched 'נתן שטראוס 3'; trailing 'מרכז' unparsed",
    ),
    AddressCorrection(
        uuid.UUID("3a96e99b-505d-4ad1-b54a-ff10a38e02e1"),
        "פליימס",
        "בית ישראל 2 מיר",
        "בית ישראל 2",
        "cached response already ROOFTOP-matched 'בית ישראל 2'; trailing 'מיר' unparsed",
    ),
    AddressCorrection(
        uuid.UUID("9b4cf534-9033-4a27-b52b-eb289b075201"),
        "קצפת",
        "שמגר 16 קניון רב שפע בעלז",
        "שמגר 16",
        "third business at the same mall building as בורגר ביט / מיסטר בייגל above",
    ),
    # -- multiple_candidates: raw response inspected directly; corrected query -------
    # -- collapses two/three candidates to the one Jerusalem match. ------------------
    AddressCorrection(
        uuid.UUID("1e9d471e-8d13-423a-a151-b4d0a2df45c0"),
        "חלב ודבש בוטיק קפה",
        "ההגנה 21 מרכז מסחרי גבעה הצרפתית",
        "ההגנה 21",
        "raw response had 2 candidates: 'רחוב ההגנה 21' ROOFTOP and a GEOMETRIC_CENTER "
        "mall centroid; dropping the mall/neighbourhood tail should leave one",
    ),
    AddressCorrection(
        uuid.UUID("58474f31-6a1f-4f61-8d00-71cec2132750"),
        "מאפיית לחם פיינגולד",
        "עוזיאל 92 בית וגן",
        "הרב עוזיאל 92",
        "Bayit VeGan. raw response had 2 ROOFTOP candidates for bare 'עוזיאל' "
        "(Google also parsed the neighbourhood name 'בית וגן' as a street); the full "
        "official name 'הרב עוזיאל' (Rav Uziel St, the well-known Bayit VeGan street) "
        "was one of the two returned matches",
    ),
    AddressCorrection(
        uuid.UUID("3cfd661f-05a7-470d-948d-75181f0a35bd"),
        "פיצה האט",
        "אורגוואי 1 מרכז מסחרי קרית יובל",
        "אורוגואי 1",
        "OCR defective spelling (אורגוואי -> plene אורוגואי, Uruguay St); raw response "
        "had 3 ROOFTOP candidates at different house numbers on the misspelled query, "
        "the corrected spelling with the mall tail dropped should resolve to house no. 1",
    ),
)

#: Restaurants flagged needs_review at seed-import time with the audited note
#: "phone-to-row alignment on poster imperfect; verify phone" — address not in
#: question. See module docstring point 2.
PHONE_ONLY_REVIEW_IDS: tuple[uuid.UUID, ...] = (
    uuid.UUID("3e581dbd-c9be-45b8-8604-50bddcc9d9f1"),
    uuid.UUID("9dc4ae83-5995-4e10-b67b-9dda22ccba39"),
    uuid.UUID("5d40b435-8ece-471e-beb8-84acc24962a4"),
    uuid.UUID("a475ae60-cadf-4865-a67b-35282b1f8690"),
    uuid.UUID("c51bf6f0-22fa-4481-bfbf-203eb544d1e7"),
    uuid.UUID("862568d4-f475-424c-9009-844a8f403c0d"),
    uuid.UUID("696ac5fd-0b9e-4704-859b-66fd639f0693"),
    uuid.UUID("ee00f3be-6083-40be-a259-bb69e45756d8"),
    uuid.UUID("d6c4f4b3-021d-46d9-8beb-6d53c0eab7db"),
    uuid.UUID("69123b38-0b09-4790-af8b-212020f51c60"),  # Bayit VeGan (הפסגה 25)
    uuid.UUID("8ec0d4c3-59e4-4158-8659-4eaa6f363cd3"),
    uuid.UUID("b8ad66d4-d471-43fd-a937-f15a89657410"),
    uuid.UUID("121034b2-bd1b-4c48-872a-9dfd2681d818"),
    uuid.UUID("fc8cf957-85aa-4813-a3bc-939d3104f748"),
    uuid.UUID("ead77475-dcb5-4c85-9702-b43da54df09b"),
    uuid.UUID("6ed1e287-be5a-4d95-8d44-7187023626ea"),
    uuid.UUID("b644116c-7e67-40e0-9df2-3dffbd160d6f"),
    uuid.UUID("e81fe910-0b4d-4bc5-a110-3938c7a6a358"),
    uuid.UUID("52c28db6-3576-4a50-9cc2-f76c4677e756"),
    uuid.UUID("f0cb7c0b-dd50-46c4-8462-58a7cd65d1da"),
)


def apply_address_corrections(session: Session) -> int:
    """Write every audited address correction, each guarded by its expected current
    value, with a full before/after audit row.

    Parameters:
        session (Session): Active SQLAlchemy session; caller controls commit/rollback.

    Return:
        int: Number of restaurants corrected.
    """
    corrected = 0
    for fix in ADDRESS_CORRECTIONS:
        restaurant = session.get(Restaurant, fix.restaurant_id)
        if restaurant is None:
            raise GeocodeError(f"restaurant {fix.restaurant_id} not found ({fix.name_he})")
        if restaurant.address_he != fix.old_address_he:
            raise GeocodeError(
                f"restaurant {fix.restaurant_id} ({fix.name_he}) address_he changed "
                f"since this script was written: expected {fix.old_address_he!r}, "
                f"found {restaurant.address_he!r} — re-verify before re-running"
            )
        before = restaurant.address_he
        restaurant.address_he = fix.new_address_he
        restaurant.needs_review = False
        session.add(
            AuditLog(
                entity_type="restaurant",
                entity_id=restaurant.id,
                action=AuditAction.UPDATE,
                changes={
                    "address_he": {"before": before, "after": fix.new_address_he},
                    "needs_review": {"before": True, "after": False},
                },
                actor=ACTOR,
                evidence={"reason": CORRECTION_REASON, "rationale": fix.rationale},
            )
        )
        corrected += 1

    return corrected


def unblock_phone_only_rows(session: Session) -> int:
    """Clear ``needs_review`` for the audited phone-only ambiguity rows and open a
    ``Flag`` so the phone-verification need survives in the moderation queue.

    Parameters:
        session (Session): Active SQLAlchemy session; caller controls commit/rollback.

    Return:
        int: Number of restaurants unblocked.
    """
    unblocked = 0
    for restaurant_id in PHONE_ONLY_REVIEW_IDS:
        restaurant = session.get(Restaurant, restaurant_id)
        if restaurant is None:
            raise GeocodeError(f"restaurant {restaurant_id} not found")
        if not restaurant.needs_review:
            continue
        restaurant.needs_review = False
        session.add(
            AuditLog(
                entity_type="restaurant",
                entity_id=restaurant.id,
                action=AuditAction.UPDATE,
                changes={"needs_review": {"before": True, "after": False}},
                actor=ACTOR,
                evidence={"reason": PHONE_UNBLOCK_REASON},
            )
        )
        session.add(
            Flag(
                restaurant_id=restaurant.id,
                type=FlagType.WRONG_DETAILS,
                state=FlagState.OPEN,
                message=PHONE_FLAG_MESSAGE,
            )
        )
        unblocked += 1

    return unblocked


def main() -> None:
    """CLI entry point: apply corrections (optionally dry-run), then hand off to the
    real geocode pipeline for Jerusalem.

    Parameters:
        None

    Return:
        None
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write changes (default dry-run).")
    args = parser.parse_args()
    dry_run = not args.apply

    with session_scope() as session:
        n_corrected = apply_address_corrections(session)
        n_unblocked = unblock_phone_only_rows(session)
        print(f"address corrections: {n_corrected}")
        print(f"phone-only rows unblocked: {n_unblocked}")
        if dry_run:
            session.rollback()
            print("DRY RUN — rolled back, nothing written. Re-run with --apply.")

            return
        print("APPLIED — corrections committed.")

    if not settings.google_maps_api_key:
        print(
            "no KASHROOT_GOOGLE_MAPS_API_KEY set — skipping the geocode step; "
            "run `kashroot geocode --apply --city jerusalem` separately."
        )

        return

    geocoder = GoogleGeocoder(settings.google_maps_api_key, delay_ms=settings.geocode_delay_ms)
    with session_scope() as session:
        stats = geocode_restaurants(
            session,
            geocoder,
            dry_run=False,
            allow_api_calls=True,
            actor=ACTOR,
            city="jerusalem",
        )
    print(f"geocode run (jerusalem, applied) — {dt.datetime.now(dt.UTC).isoformat()}")
    for key, value in stats.as_dict().items():
        print(f"  {key}: {value}")


if __name__ == "__main__":
    main()
