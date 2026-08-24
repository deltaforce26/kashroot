"""Constants for the moderation console API — ``/api/admin/*``.

STANDARDS.md: paging limits, SLA windows, upload caps and the fail-safe state
ranking live here rather than inline in the routers, so the invariants they encode
are readable in one place.
"""

from __future__ import annotations

from zoneinfo import ZoneInfo

from app.models import CertificateSource, CertificateState

MAX_PAGE_LIMIT = 200
DEFAULT_PAGE_LIMIT = 50
DEFAULT_EXPIRY_WINDOW_DAYS = 14  # PRD §13 SLA: surface expiring certs 14 days early

#: All expiry-window boundaries are civil dates in Israel — a certificate printed
#: "valid until 15 Av" expires at the end of that day *in Israel*, regardless of the
#: server's timezone.
ISRAEL_TZ = ZoneInfo("Asia/Jerusalem")

#: Kashrut-status severity order for certificate states. Used to *enforce* the
#: fail-safe invariant: moderation transitions (other than verify-renewal, which
#: requires evidence) may only move a certificate to a strictly lower rank.
STATE_RANK: dict[CertificateState, int] = {
    CertificateState.REVOKED: 0,
    CertificateState.EXPIRED: 1,
    CertificateState.PENDING: 2,
    CertificateState.ACTIVE: 3,
}

#: The one state a moderation degrade may target. EXPIRED is the model's "degraded"
#: state: the match engine reads it as UNKNOWN, never as MATCH (fail-safe).
DEGRADE_TARGET = CertificateState.EXPIRED

MAX_PHOTO_BYTES = 15 * 1024 * 1024  # 15 MB

#: Slack on top of MAX_PHOTO_BYTES when judging the *request* Content-Length: the
#: multipart framing (boundary lines, part headers) rides in the same body. Requests
#: whose declared length exceeds cap + slack cannot possibly carry a valid file.
MULTIPART_OVERHEAD_ALLOWANCE = 16 * 1024

#: Accepted upload types → object-key extension. The declared Content-Type must ALSO
#: match the file's magic bytes (see ``photos.magic_bytes_match``) — headers alone are
#: client-controlled and untrusted.
PHOTO_EXTENSIONS: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
}

#: The source level an accepted photo review confers (PRD §13 source hierarchy):
#: a moderator verified the physical certificate from photo evidence. Applied only
#: when it is a strict upgrade per SOURCE_AUTHORITY — an accepted photo must never
#: *lower* the provenance of a certificate already sourced from the certifier portal.
PHOTO_VERIFIED_SOURCE = CertificateSource.MODERATOR_VERIFIED

#: Fields of a new evidence-photo row recorded in its CREATE audit entry.
AUDITED_UPLOAD_FIELDS = (
    "certificate_id",
    "storage_key",
    "content_type",
    "size_bytes",
    "sha256",
    "status",
)


#: The three fields ``app.ingestion.normalize.restaurant_dedupe_key`` is built from.
#: Correcting any of them invalidates the record's natural key, so the key is
#: recomputed in the same transaction — otherwise the next ingestion run would fail to
#: match the corrected row and would insert a duplicate beside it.
RESTAURANT_IDENTITY_FIELDS: tuple[str, ...] = ("name_he", "city_he", "address_he")

#: Editable fields validated as URLs. They arrive as pydantic ``Url`` objects and are
#: written back as plain strings (the columns are Text).
URL_RESTAURANT_FIELDS: tuple[str, ...] = ("website", "menu_url")

#: Free-text search over the restaurant directory (name / address / city).
MAX_RESTAURANT_QUERY_LENGTH = 200

DEDUPE_KEY_CONFLICT_DETAIL = (
    "another restaurant already occupies that name/city/address identity — two rows "
    "may not share a dedupe key. Resolve the duplicate before renaming this record."
)
