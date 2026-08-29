"""Seed corpus importer — `data/seed/kashroot_seed_corpus.csv` → the database.

What this pipeline does and does *not* establish (see data/README.md):

* It establishes **status + certifier** only. Those six source documents are official
  published lists — source-hierarchy level 1 (PRD §13).
* It establishes **no certificate attributes** (glatt, pas yisrael…) and **no expiry
  dates**, because the sources contain none. Certificates are therefore written with
  ``attributes = {}`` (every attribute *unknown*) and ``valid_until = NULL``. A profile
  that requires any attribute will resolve to UNKNOWN against these records — never to
  MATCH. That is the fail-safe rule working as designed, not a gap to patch later by
  guessing.
* Rows flagged ``needs_review`` (ambiguous poster layout) land as PENDING certificates
  so they never serve a MATCH before a moderator has seen them.

The pipeline is idempotent: restaurants upsert on ``dedupe_key``, certificates on
``import_key``. Re-running after a corpus rebuild produces updates, not duplicates.
"""

from __future__ import annotations

import csv
import datetime as dt
import uuid
from collections.abc import Iterator
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ingestion.normalize import (
    normalize_phone,
    normalize_text,
    parse_csv_bool,
    restaurant_dedupe_key,
    slugify_city,
    split_branch_addresses,
)
from app.models import (
    AuditAction,
    AuditLog,
    Certificate,
    CertificateSource,
    CertificateState,
    CertificationLevel,
    Certifier,
    CertifierType,
    DietType,
    IngestionRun,
    IngestionRunState,
    RecordState,
    Restaurant,
    SourceDocument,
    SourceDocumentKind,
)

PIPELINE = "seed_corpus"
PIPELINE_VERSION = "1.0.0"
DEFAULT_CSV_PATH = Path("data/seed/kashroot_seed_corpus.csv")
SOURCES_DIR = Path("data/sources")


#: Certifiers referenced by the seed corpus. Rabbanut entries are *local religious
#: councils*, never a single national body (PRD §16) — the corpus currently holds
#: none, since ``rabbanut_bnei_brak`` was merged into ``landa_bnei_brak`` (see the
#: note on that entry below).
CERTIFIER_SEED: dict[str, dict[str, Any]] = {
    "badatz_mehadrin_rubin": {
        "name_he": 'בד"ץ מהדרין - הרב רובין',
        "name_en": "Badatz Mehadrin (Rubin)",
        "type": CertifierType.BADATZ,
    },
    "badatz_eda_haredit": {
        "name_he": 'בד"ץ העדה החרדית',
        "name_en": "Badatz Eda Haredit",
        "type": CertifierType.BADATZ,
    },
    # MERGED (Aug 2026, product decision): the former ``rabbanut_bnei_brak`` slug was
    # folded into this entry — 122 corpus records reassigned, 9 of which had held both
    # slugs. Both source documents survive the merge, so provenance and
    # ``corroboration_count`` (which counts source documents, not certifiers) are
    # unchanged; only the certifier attribution moved.
    "landa_bnei_brak": {
        "name_he": 'בד"ץ שארית ישראל - הרב לנדא',
        "name_en": "Badatz Rav Landa (Bnei Brak)",
        "type": CertifierType.BADATZ,
    },
}

#: The seven source documents behind the corpus. ``date_label`` is the document's own
#: published (or, where the source carries none, received) list date — a property of the
#: document, never inferred from whichever corpus row happens to cite it first. A row may
#: cite documents of different dates, so deriving the label from row order mislabels the
#: older document with the newer one's date and silently inflates its freshness.
SOURCE_DOCUMENT_SEED: dict[str, dict[str, Any]] = {
    # Published as the Bnei Brak rabbanut kitchens list; attributed to landa_bnei_brak
    # since the merge. The document itself is untouched — this is the provenance of
    # where the records came from, which the merge deliberately preserves.
    "rabbanut_bb_kitchens_pdf": {
        "title": "Rabbanut Bnei Brak — certified kitchens list",
        "kind": SourceDocumentKind.PDF,
        "certifier_slug": "landa_bnei_brak",
        "file": "rabbanut_bb_kitchens.pdf",
        "date_label": "Tamuz 5786 (Jun-Jul 2026)",
    },
    "rubin_restaurants_pdf": {
        "title": "Badatz Mehadrin (Rubin) — certified restaurants list",
        "kind": SourceDocumentKind.PDF,
        "certifier_slug": "badatz_mehadrin_rubin",
        "file": "rubin_restaurants.pdf",
        "date_label": "5786 (2026)",
    },
    "eda_haredit_jerusalem_poster": {
        "title": "Badatz Eda Haredit — Jerusalem poster",
        "kind": SourceDocumentKind.IMAGE,
        "certifier_slug": "badatz_eda_haredit",
        "file": "eda_haredit_jerusalem_poster.jpg",
        "date_label": "Summer 5786 (2026)",
        "notes": "Poster layout; phone-to-row alignment imperfect in the meat section.",
    },
    "eda_haredit_south_poster": {
        "title": "Badatz Eda Haredit — south poster",
        "kind": SourceDocumentKind.IMAGE,
        "certifier_slug": "badatz_eda_haredit",
        "file": "eda_haredit_south_poster.jpg",
        "date_label": "Summer 5786 (2026)",
    },
    "eda_haredit_north_pdf": {
        "title": "Badatz Eda Haredit — north list",
        "kind": SourceDocumentKind.PDF,
        "certifier_slug": "badatz_eda_haredit",
        "file": "eda_haredit_north.pdf",
        "date_label": "Summer 5786 (2026)",
        "notes": "Heavy OCR noise; most needs_review rows originate here.",
    },
    "landa_vacation_cities_poster": {
        "title": "Badatz Rav Landa — vacation cities poster",
        "kind": SourceDocumentKind.IMAGE,
        "certifier_slug": "landa_bnei_brak",
        "file": "landa_vacation_cities_poster.jpg",
        "date_label": "Av 5786 (Jul-Aug 2026)",
    },
    "landa_restaurants_elul_5786": {
        "title": "Badatz Rav Landa — certified restaurants list",
        "kind": SourceDocumentKind.MANUAL,
        "certifier_slug": "landa_bnei_brak",
        "file": "landa_restaurants_elul_5786.csv",
        "date_label": "Elul 5786 (Aug-Sep 2026)",
        "notes": (
            "Restaurant categories only (מסעדה חלבית / מסעדות ומזנונים / מעדניות). "
            "Supersedes the restaurant rows of rabbanut_bb_kitchens_pdf and "
            "landa_vacation_cities_poster; halls, hotels, institutions and pure "
            "catering are outside its scope. No publication date on the source — the "
            "label records receipt (2026-08-29), not publication."
        ),
    },
}

#: Hebrew-calendar list labels → the **earliest** Gregorian date the label can mean.
#: Earliest = oldest = most conservative for freshness maths. A list can only get
#: staler than we think, never fresher — doubt degrades, never upgrades.
SOURCE_DATE_EARLIEST: dict[str, dt.date] = {
    "Tamuz 5786 (Jun-Jul 2026)": dt.date(2026, 6, 16),
    "Av 5786 (Jul-Aug 2026)": dt.date(2026, 7, 15),
    "Elul 5786 (Aug-Sep 2026)": dt.date(2026, 8, 14),
    "Summer 5786 (2026)": dt.date(2026, 6, 1),
    "5786 (2026)": dt.date(2025, 9, 23),  # 1 Tishrei 5786
}

RECORD_STATE_MAP: dict[str, RecordState] = {
    "LIST_VERIFIED": RecordState.LIST_VERIFIED,
    "UNKNOWN_PENDING_VERIFICATION": RecordState.UNKNOWN_PENDING_VERIFICATION,
}


class SeedImportError(RuntimeError):
    """Raised on data the pipeline refuses to guess about."""


@dataclass
class SeedImportStats:
    rows_read: int = 0
    branch_rows_split: int = 0
    certifiers_created: int = 0
    source_documents_created: int = 0
    restaurants_created: int = 0
    restaurants_updated: int = 0
    restaurants_unchanged: int = 0
    certificates_created: int = 0
    certificates_updated: int = 0
    certificates_unchanged: int = 0
    needs_review: int = 0
    pending_certificates: int = 0
    #: field name → count of rows whose value changed (the diff-review summary)
    changed_fields: dict[str, int] = field(default_factory=dict)

    def note_change(self, entity: str, field_name: str) -> None:
        key = f"{entity}.{field_name}"
        self.changed_fields[key] = self.changed_fields.get(key, 0) + 1

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def read_rows(csv_path: Path) -> Iterator[dict[str, str]]:
    """The corpus is written UTF-8 with BOM (Excel compatibility) — decode accordingly."""
    with csv_path.open(encoding="utf-8-sig", newline="") as fh:
        yield from csv.DictReader(fh)


def _apply(obj: Any, values: dict[str, Any], stats: SeedImportStats, entity: str) -> dict[str, Any]:
    """Set attributes, returning ``{field: {"before": …, "after": …}}`` for the audit log."""
    changes: dict[str, Any] = {}
    for key, new in values.items():
        old = getattr(obj, key)
        if _values_equal(old, new):
            continue
        changes[key] = {"before": _jsonable(old), "after": _jsonable(new)}
        setattr(obj, key, new)
        stats.note_change(entity, key)
    return changes


def _as_utc(value: dt.datetime) -> dt.datetime:
    return value.replace(tzinfo=dt.UTC) if value.tzinfo is None else value.astimezone(dt.UTC)


def _values_equal(old: Any, new: Any) -> bool:
    """Equality for diffing. Datetimes are compared in UTC so that a driver returning
    naive timestamps never makes a re-run look like a change.
    """
    if isinstance(old, dt.datetime) and isinstance(new, dt.datetime):
        return _as_utc(old) == _as_utc(new)
    return bool(old == new)


def _jsonable(value: Any) -> Any:
    """Audit payloads land in JSONB — everything in them must survive json.dumps."""
    if isinstance(value, dt.date | dt.datetime):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, StrEnum):
        return value.value
    return value


def _ensure_certifiers(session: Session, stats: SeedImportStats) -> dict[str, Certifier]:
    existing = {c.slug: c for c in session.scalars(select(Certifier))}
    for slug, spec in CERTIFIER_SEED.items():
        if slug in existing:
            continue
        certifier = Certifier(slug=slug, **spec)
        session.add(certifier)
        existing[slug] = certifier
        stats.certifiers_created += 1
    session.flush()
    return existing


def _ensure_source_documents(
    session: Session,
    certifiers: dict[str, Certifier],
    stats: SeedImportStats,
) -> dict[str, SourceDocument]:
    existing = {d.slug: d for d in session.scalars(select(SourceDocument))}
    for slug, spec in SOURCE_DOCUMENT_SEED.items():
        label = spec.get("date_label")
        doc = existing.get(slug)
        if doc is None:
            doc = SourceDocument(slug=slug)
            session.add(doc)
            existing[slug] = doc
            stats.source_documents_created += 1
        doc.title = spec["title"]
        doc.kind = spec["kind"]
        doc.certifier_id = certifiers[spec["certifier_slug"]].id
        doc.uri = str(SOURCES_DIR / spec["file"])
        doc.notes = spec.get("notes")
        if label:
            doc.source_date_label = label
            doc.source_date = SOURCE_DATE_EARLIEST.get(label)
    session.flush()
    return existing


def _row_certifier_slugs(row: dict[str, str]) -> list[str]:
    slugs = [s.strip() for s in (row.get("certifier_ids") or "").split(";") if s.strip()]
    unknown = [s for s in slugs if s not in CERTIFIER_SEED]
    if unknown:
        raise SeedImportError(
            f"unknown certifier id(s) {unknown} — add them to CERTIFIER_SEED before importing"
        )
    if not slugs:
        raise SeedImportError("row has no certifier_ids; a record without a certifier is not a record")
    return slugs


def _row_source_slugs(row: dict[str, str]) -> list[str]:
    slugs = [s.strip() for s in (row.get("source_documents") or "").split(";") if s.strip()]
    unknown = [s for s in slugs if s not in SOURCE_DOCUMENT_SEED]
    if unknown:
        raise SeedImportError(f"unknown source document(s) {unknown}")
    return slugs


def _parse_diet(row: dict[str, str]) -> DietType | None:
    raw = (row.get("diet_type") or "").strip()
    if not raw:
        return None
    try:
        return DietType(raw)
    except ValueError as exc:  # pragma: no cover - guarded by corpus contract
        raise SeedImportError(f"unknown diet_type {raw!r}") from exc


def _parse_record_state(row: dict[str, str]) -> RecordState:
    raw = (row.get("record_state") or "").strip()
    try:
        return RECORD_STATE_MAP[raw]
    except KeyError as exc:
        raise SeedImportError(f"unknown record_state {raw!r}") from exc


def import_seed(
    session: Session,
    csv_path: Path = DEFAULT_CSV_PATH,
    *,
    dry_run: bool = False,
    actor: str = "cli",
) -> SeedImportStats:
    """Import the seed corpus. Returns the diff summary.

    ``dry_run=True`` performs every read and write against the session, reports the
    diff, then rolls the data back — the diff-review step of a versioned pipeline. The
    ``IngestionRun`` row itself is kept either way, so reviews leave a trail.
    """
    csv_path = Path(csv_path)
    if not csv_path.exists():
        raise SeedImportError(f"seed corpus not found: {csv_path}")

    run = IngestionRun(
        pipeline=PIPELINE,
        pipeline_version=PIPELINE_VERSION,
        source_label=str(csv_path),
        actor=actor,
        dry_run=dry_run,
        state=IngestionRunState.RUNNING,
        started_at=dt.datetime.now(dt.UTC),
    )
    session.add(run)
    session.commit()
    run_id = run.id

    stats = SeedImportStats()
    try:
        _run_import(session, csv_path, run_id, stats)
    except Exception as exc:
        session.rollback()
        _finish_run(session, run_id, IngestionRunState.FAILED, stats, error=str(exc))
        raise

    if dry_run:
        session.rollback()
    else:
        session.commit()
    _finish_run(session, run_id, IngestionRunState.COMPLETED, stats)
    return stats


def _finish_run(
    session: Session,
    run_id: Any,
    state: IngestionRunState,
    stats: SeedImportStats,
    error: str | None = None,
) -> None:
    run = session.get(IngestionRun, run_id)
    if run is None:  # pragma: no cover - the run row is committed before work starts
        return
    run.state = state
    run.finished_at = dt.datetime.now(dt.UTC)
    run.stats = stats.as_dict()
    run.error = error
    session.commit()


def _run_import(
    session: Session, csv_path: Path, run_id: Any, stats: SeedImportStats
) -> None:
    rows = list(read_rows(csv_path))
    stats.rows_read = len(rows)

    certifiers = _ensure_certifiers(session, stats)
    documents = _ensure_source_documents(session, certifiers, stats)

    restaurants = {r.dedupe_key: r for r in session.scalars(select(Restaurant))}
    certificates = {
        c.import_key: c
        for c in session.scalars(select(Certificate).where(Certificate.import_key.is_not(None)))
    }

    for row in rows:
        _import_row(session, row, certifiers, documents, restaurants, certificates, run_id, stats)

    session.flush()


def _primary_document(
    source_slugs: list[str], documents: dict[str, SourceDocument]
) -> SourceDocument | None:
    """
    Pick the document that dates a row's certificate: the most recent one it cites.

    A row corroborated by several lists is only as fresh as its freshest evidence, and
    that evidence is what ``valid_from`` / ``verified_at`` must record. Choosing by
    corpus column order instead would let a refresh land without moving the date it
    exists to move. Documents with no known date lose to any dated one, so an undated
    source can never make a record look fresher than its dated evidence supports.

    Parameters:
        source_slugs (list[str]): Source-document slugs cited by the row, in corpus order.
        documents (dict[str, SourceDocument]): Every seeded document, keyed by slug.

    Return:
        SourceDocument | None: The freshest cited document, or None when the row cites none.
    """
    cited = [documents[slug] for slug in source_slugs]
    if not cited:
        return None

    return max(cited, key=lambda doc: doc.source_date or dt.date.min)


def _import_row(
    session: Session,
    row: dict[str, str],
    certifiers: dict[str, Certifier],
    documents: dict[str, SourceDocument],
    restaurants: dict[str, Restaurant],
    certificates: dict[str, Certificate],
    run_id: Any,
    stats: SeedImportStats,
) -> None:
    certifier_slugs = _row_certifier_slugs(row)
    source_slugs = _row_source_slugs(row)
    primary_doc = _primary_document(source_slugs, documents)

    needs_review = parse_csv_bool(row.get("needs_review"))
    record_state = _parse_record_state(row)
    name_he = normalize_text(row.get("restaurant_name_he"))
    if not name_he:
        raise SeedImportError("row has no restaurant_name_he")
    city_he = normalize_text(row.get("city_he"))
    city_en = normalize_text(row.get("city_en"))
    corroboration = int((row.get("corroboration_count") or "1").strip() or 1)

    addresses = split_branch_addresses(row.get("address_he"))
    if len(addresses) > 1:
        stats.branch_rows_split += 1

    for address in addresses:
        dedupe_key = restaurant_dedupe_key(name_he, city_he, address)
        values: dict[str, Any] = {
            "name_he": name_he,
            "address_he": address,
            "city_he": city_he,
            "city_en": city_en,
            "city_slug": slugify_city(city_en, city_he),
            "phone": normalize_phone(row.get("phone")),
            "business_type_he": normalize_text(row.get("business_type_he")),
            "diet_type": _parse_diet(row),
            "record_state": record_state,
            "needs_review": needs_review,
            "corroboration_count": corroboration,
            "branch_label": address if len(addresses) > 1 else None,
            "notes": normalize_text(row.get("notes")),
        }

        restaurant = restaurants.get(dedupe_key)
        if restaurant is None:
            restaurant = Restaurant(dedupe_key=dedupe_key, **values)
            session.add(restaurant)
            session.flush()
            restaurants[dedupe_key] = restaurant
            stats.restaurants_created += 1
            _audit(
                session,
                "restaurant",
                restaurant.id,
                AuditAction.CREATE,
                {k: {"before": None, "after": _jsonable(v)} for k, v in values.items()},
                primary_doc,
                run_id,
            )
        else:
            changes = _apply(restaurant, values, stats, "restaurant")
            if changes:
                stats.restaurants_updated += 1
                _audit(
                    session,
                    "restaurant",
                    restaurant.id,
                    AuditAction.UPDATE,
                    changes,
                    primary_doc,
                    run_id,
                )
            else:
                stats.restaurants_unchanged += 1

        if needs_review:
            stats.needs_review += 1

        for slug in certifier_slugs:
            _import_certificate(
                session,
                restaurant,
                certifiers[slug],
                primary_doc,
                row,
                needs_review or record_state is RecordState.UNKNOWN_PENDING_VERIFICATION,
                corroboration,
                certificates,
                run_id,
                stats,
            )


def _import_certificate(
    session: Session,
    restaurant: Restaurant,
    certifier: Certifier,
    document: SourceDocument | None,
    row: dict[str, str],
    provisional: bool,
    corroboration: int,
    certificates: dict[str, Certificate],
    run_id: Any,
    stats: SeedImportStats,
) -> None:
    import_key = f"seed:{restaurant.dedupe_key}:{certifier.slug}"
    list_date = document.source_date if document else None
    verified_at = (
        dt.datetime.combine(list_date, dt.time.min, tzinfo=dt.UTC) if list_date else None
    )

    values: dict[str, Any] = {
        "restaurant_id": restaurant.id,
        "certifier_id": certifier.id,
        # The sources publish neither a level nor any attribute. UNKNOWN level + empty
        # attributes is the honest record; the gate reads that as "cannot confirm".
        "level": CertificationLevel.UNKNOWN,
        "attributes": {},
        "valid_from": list_date,
        "valid_until": None,  # no validity window in these sources — freshness governs
        "state": CertificateState.PENDING if provisional else CertificateState.ACTIVE,
        "source": CertificateSource.OFFICIAL_LIST,
        "source_document_id": document.id if document else None,
        "verified_by_label": f"pipeline:{PIPELINE}@{PIPELINE_VERSION}",
        "verified_at": verified_at,
        "corroboration_count": corroboration,
        "notes": normalize_text(row.get("notes")),
    }
    if provisional:
        stats.pending_certificates += 1

    certificate = certificates.get(import_key)
    if certificate is None:
        certificate = Certificate(import_key=import_key, **values)
        session.add(certificate)
        session.flush()
        certificates[import_key] = certificate
        stats.certificates_created += 1
        _audit(
            session,
            "certificate",
            certificate.id,
            AuditAction.CREATE,
            {k: {"before": None, "after": _jsonable(v)} for k, v in values.items()},
            document,
            run_id,
        )
        return

    changes = _apply(certificate, values, stats, "certificate")
    if not changes:
        stats.certificates_unchanged += 1
        return
    stats.certificates_updated += 1
    # A move between ACTIVE / PENDING is a kashrut status change — log it as such.
    action = AuditAction.STATE_CHANGE if "state" in changes else AuditAction.UPDATE
    _audit(session, "certificate", certificate.id, action, changes, document, run_id)


def _audit(
    session: Session,
    entity_type: str,
    entity_id: Any,
    action: AuditAction,
    changes: dict[str, Any],
    document: SourceDocument | None,
    run_id: Any,
) -> None:
    session.add(
        AuditLog(
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            changes=changes,
            actor=f"pipeline:{PIPELINE}@{PIPELINE_VERSION}",
            evidence={"source_document": document.slug} if document else {},
            ingestion_run_id=run_id,
        )
    )
