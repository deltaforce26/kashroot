"""Google Sheet -> WhatsApp approve/deny -> `seed-import --apply --prune` pipeline.

Twice a day (GitHub Actions cron, `.github/workflows/sheet-sync.yml`):

1. `fetch` pulls the private Google Sheet and writes it to
   :data:`app.ingestion.seed_import.DEFAULT_CSV_PATH`.
2. `propose` (this module's :func:`propose`) hashes that file. Unchanged since the
   last proposal (of any status) -> exit quietly, nothing written, nothing sent.
   Changed -> run `import_seed(dry_run=True, prune=True)`, supersede older pending
   proposals, store this run's exact CSV snapshot + summary as a new
   :class:`app.models.SheetSyncProposal`, and WhatsApp a one-link summary — unless the
   dry run shows no actual diff, in which case the proposal is stored as
   ``no_changes`` and nothing is sent.
3. The person taps Approve/Deny on the confirm page (``app.api.sync``), which
   dispatches `sheet-sync-apply.yml` on approval.
4. `apply` (this module's :func:`apply_proposal`) writes the *stored* snapshot
   (never re-fetching the sheet) to ``DEFAULT_CSV_PATH`` and imports it for real.

The database is meant to end up matching the sheet exactly, so every proposal runs
with ``prune=True`` — the existing seed-prune safety rules
(:mod:`app.ingestion.seed_prune`) decide what is safe to delete; everything else is
reported as skipped, never silently kept or removed.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import secrets
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ingestion.seed_import import DEFAULT_CSV_PATH, SeedImportStats, import_seed
from app.ingestion.seed_prune import PruneStats
from app.ingestion.sheet_sync_consts import (
    APPLY_ACTOR_TEMPLATE,
    APPLY_RESULT_FAILURE_TEMPLATE,
    APPLY_RESULT_SUCCESS_TEMPLATE,
    AUDIT_ENTITY_TYPE,
    CONFIRM_LINK_TEMPLATE,
    MAX_NAMES_LISTED,
    PIPELINE_ACTOR_PROPOSE,
    PROPOSAL_NOT_APPROVED_ERROR,
    PROPOSAL_NOT_FOUND_ERROR,
    PROPOSAL_TOKEN_BYTES,
    PROPOSAL_TOKEN_TTL,
    SUMMARY_DELETED_NAMES_HEADER,
    SUMMARY_HEADER_CHANGES,
    SUMMARY_HEADER_NO_CHANGES,
    SUMMARY_LINE_CERTIFICATES,
    SUMMARY_LINE_DELETED,
    SUMMARY_LINE_KEPT_SKIPPED,
    SUMMARY_LINE_NEEDS_REVIEW,
    SUMMARY_LINE_RESTAURANTS,
    SUMMARY_NAME_MORE_TEMPLATE,
    SUMMARY_NO_CHANGES_BODY,
    SUMMARY_SKIPPED_NAMES_HEADER,
)
from app.models import AuditAction, AuditLog, SheetSyncProposal, SheetSyncProposalStatus
from app.services.google_sheets import fetch_sheet_csv
from app.services.twilio_whatsapp import WhatsAppSender


class SheetSyncError(RuntimeError):
    """Raised on a proposal/apply precondition this pipeline refuses to proceed past."""


def hash_text(text: str) -> str:
    """
    SHA-256 of a string, hex-encoded.

    Parameters:
        text (str): The text to hash (CSV content, or a raw decision token).

    Return:
        str: 64-character lowercase hex digest.
    """
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def generate_token() -> str:
    """
    A fresh, high-entropy, URL-safe single-use decision token.

    Return:
        str: A random token; only its hash (:func:`hash_text`) is ever stored.
    """
    return secrets.token_urlsafe(PROPOSAL_TOKEN_BYTES)


def tokens_match(presented_token: str, stored_token_hash: str) -> bool:
    """
    Verify a presented token against the stored hash, in constant time.

    Parameters:
        presented_token (str): The raw token from the confirm-page URL/form.
        stored_token_hash (str): :func:`hash_text` of the token generated at
            proposal time.

    Return:
        bool: True when the presented token hashes to the stored value.
    """
    return hmac.compare_digest(hash_text(presented_token), stored_token_hash)


def build_confirm_link(origin: str, proposal_id: uuid.UUID, token: str) -> str:
    """
    The one link sent over WhatsApp for a proposal.

    Parameters:
        origin (str): ``KASHROOT_PUBLIC_API_ORIGIN``, no trailing slash needed.
        proposal_id (uuid.UUID): The proposal to link to.
        token (str): The raw decision token (never the hash).

    Return:
        str: ``{origin}/sync/proposals/{id}?t={token}``.
    """
    return CONFIRM_LINK_TEMPLATE.format(
        origin=origin.rstrip("/"), proposal_id=proposal_id, token=token
    )


def _format_name_block(header: str, names: list[str]) -> list[str]:
    """Render a truncated, human-readable list of names under one header line."""
    if not names:
        return []

    lines = [header, *[f"- {name}" for name in names[:MAX_NAMES_LISTED]]]
    remaining = len(names) - MAX_NAMES_LISTED
    if remaining > 0:
        lines.append(SUMMARY_NAME_MORE_TEMPLATE.format(count=remaining))

    return lines


def is_no_op(stats: SeedImportStats) -> bool:
    """
    Whether a dry run's diff is empty — nothing would actually change.

    Parameters:
        stats (SeedImportStats): The result of an `import_seed(dry_run=True, ...)`
            call.

    Return:
        bool: True when no restaurant/certificate was created, updated or (with
            ``prune=True``) deleted.
    """
    prune: PruneStats | None = stats.prune
    pruned_changes = bool(prune) and (prune.restaurants_deleted or prune.certificates_deleted)

    return not (
        stats.restaurants_created
        or stats.restaurants_updated
        or stats.certificates_created
        or stats.certificates_updated
        or pruned_changes
    )


def build_summary_text(stats: SeedImportStats) -> str:
    """
    Render a `SeedImportStats` dry run as the human-readable message sent over
    WhatsApp and shown on the confirm page.

    Parameters:
        stats (SeedImportStats): The result of an `import_seed(dry_run=True,
            prune=True)` call.

    Return:
        str: A multi-line, concise summary — counts first, then named lists.
    """
    if is_no_op(stats):
        return f"{SUMMARY_HEADER_NO_CHANGES}\n\n{SUMMARY_NO_CHANGES_BODY}"

    lines = [
        SUMMARY_HEADER_CHANGES,
        "",
        SUMMARY_LINE_RESTAURANTS.format(
            created=stats.restaurants_created, updated=stats.restaurants_updated
        ),
        SUMMARY_LINE_CERTIFICATES.format(
            created=stats.certificates_created, updated=stats.certificates_updated
        ),
        SUMMARY_LINE_NEEDS_REVIEW.format(count=stats.needs_review),
    ]

    prune = stats.prune
    if prune is not None:
        lines.append(SUMMARY_LINE_DELETED.format(count=prune.restaurants_deleted))
        lines.append(SUMMARY_LINE_KEPT_SKIPPED.format(count=prune.prune_skipped))
        lines.extend(
            _format_name_block(SUMMARY_DELETED_NAMES_HEADER, prune.deleted_restaurant_names)
        )
        lines.extend(
            _format_name_block(
                SUMMARY_SKIPPED_NAMES_HEADER,
                [entry["name"] for entry in prune.skipped_restaurants],
            )
        )

    return "\n".join(lines)


def fetch_and_write_sheet(
    service_account_json: str,
    sheet_id: str,
    tab: str,
    csv_path: Path = DEFAULT_CSV_PATH,
) -> Path:
    """
    Fetch the private Google Sheet and write it verbatim to the seed-corpus CSV path.

    Parameters:
        service_account_json (str): Raw JSON key for the Google service account.
        sheet_id (str): The spreadsheet id.
        tab (str): The tab/sheet name.
        csv_path (Path): Where to write the fetched CSV.

    Return:
        Path: ``csv_path``, for convenience.
    """
    csv_text = fetch_sheet_csv(service_account_json, sheet_id, tab)
    csv_path.write_text(csv_text, encoding="utf-8", newline="")

    return csv_path


def _latest_proposal(session: Session) -> SheetSyncProposal | None:
    """The most recently created proposal, of any status, or None if none exist."""
    return session.scalars(
        select(SheetSyncProposal).order_by(SheetSyncProposal.created_at.desc()).limit(1)
    ).first()


def _supersede_pending_proposals(session: Session) -> None:
    """Mark every still-pending proposal superseded — a fresh one is about to replace
    it as the one live decision link.
    """
    pending = session.scalars(
        select(SheetSyncProposal).where(SheetSyncProposal.status == SheetSyncProposalStatus.PENDING)
    ).all()
    for proposal in pending:
        proposal.status = SheetSyncProposalStatus.SUPERSEDED


def propose(
    session: Session,
    *,
    csv_path: Path = DEFAULT_CSV_PATH,
    public_api_origin: str,
    whatsapp_sender: WhatsAppSender,
    actor: str = PIPELINE_ACTOR_PROPOSE,
) -> SheetSyncProposal | None:
    """
    Diff the fetched sheet against the last proposal and, if it changed, store a new
    one and WhatsApp its summary (unless the diff is empty).

    Parameters:
        session (Session): The active database session.
        csv_path (Path): Where :func:`fetch_and_write_sheet` (or the caller) already
            wrote the freshly fetched sheet.
        public_api_origin (str): ``KASHROOT_PUBLIC_API_ORIGIN``, for the confirm link.
        whatsapp_sender (WhatsAppSender): Where to send the summary; a
            :class:`app.services.twilio_whatsapp.NullWhatsAppSender` is a safe no-op
            default in dev/tests.
        actor (str): Audit/ingestion-run actor label.

    Return:
        SheetSyncProposal | None: The new proposal (``pending`` or ``no_changes``), or
            None when the sheet is unchanged since the last proposal of any status —
            in which case nothing is written or sent.
    """
    csv_text = csv_path.read_text(encoding="utf-8-sig")
    csv_sha256 = hash_text(csv_text)

    latest = _latest_proposal(session)
    if latest is not None and latest.csv_sha256 == csv_sha256:
        return None

    stats = import_seed(session, csv_path, dry_run=True, actor=actor, prune=True)
    _supersede_pending_proposals(session)

    summary_text = build_summary_text(stats)
    no_op = is_no_op(stats)
    token = generate_token()
    now = dt.datetime.now(dt.UTC)

    proposal = SheetSyncProposal(
        csv_sha256=csv_sha256,
        csv_text=csv_text,
        summary_text=summary_text,
        status=SheetSyncProposalStatus.NO_CHANGES if no_op else SheetSyncProposalStatus.PENDING,
        token_hash=hash_text(token),
        expires_at=now + PROPOSAL_TOKEN_TTL,
    )
    session.add(proposal)
    session.commit()

    if not no_op:
        link = build_confirm_link(public_api_origin, proposal.id, token)
        whatsapp_sender.send(summary=summary_text, link=link)

    return proposal


def get_proposal_or_error(session: Session, proposal_id: uuid.UUID) -> SheetSyncProposal:
    """
    Load a proposal by id or raise :class:`SheetSyncError`.

    Parameters:
        session (Session): The active database session.
        proposal_id (uuid.UUID): The proposal to load.

    Return:
        SheetSyncProposal: The loaded row.
    """
    proposal = session.get(SheetSyncProposal, proposal_id)
    if proposal is None:
        raise SheetSyncError(PROPOSAL_NOT_FOUND_ERROR.format(proposal_id=proposal_id))

    return proposal


def write_proposal_snapshot(
    session: Session, proposal_id: uuid.UUID, csv_path: Path = DEFAULT_CSV_PATH
) -> SheetSyncProposal:
    """
    Write an approved proposal's stored CSV snapshot to disk, without importing it.

    A separate step from :func:`apply_proposal` so a workflow can run the contract
    tests against the exact file about to be imported before the import itself runs.

    Parameters:
        session (Session): The active database session.
        proposal_id (uuid.UUID): The approved proposal to write.
        csv_path (Path): Where to write the snapshot (``DEFAULT_CSV_PATH``).

    Return:
        SheetSyncProposal: The loaded proposal, unchanged.
    """
    proposal = get_proposal_or_error(session, proposal_id)
    if proposal.status is not SheetSyncProposalStatus.APPROVED:
        raise SheetSyncError(
            PROPOSAL_NOT_APPROVED_ERROR.format(proposal_id=proposal_id, status=proposal.status)
        )

    # ``csv_text`` was decoded with ``utf-8-sig`` when stored (see :func:`propose`),
    # which strips a BOM if present — re-encoding with ``utf-8-sig`` here restores it,
    # matching the Excel-compatible shape every other seed-corpus CSV is written in.
    csv_path.write_text(proposal.csv_text, encoding="utf-8-sig", newline="")

    return proposal


def apply_proposal(
    session: Session,
    proposal_id: uuid.UUID,
    *,
    csv_path: Path = DEFAULT_CSV_PATH,
    whatsapp_sender: WhatsAppSender,
) -> SheetSyncProposal:
    """
    Import an approved proposal's stored snapshot for real and record the outcome.

    Assumes :func:`write_proposal_snapshot` already wrote ``csv_path`` — this never
    re-fetches the sheet or rewrites the snapshot itself, so what gets imported is
    exactly the file the workflow's contract-test step just validated.

    Parameters:
        session (Session): The active database session.
        proposal_id (uuid.UUID): The approved proposal to apply.
        csv_path (Path): Where the snapshot was written (``DEFAULT_CSV_PATH``).
        whatsapp_sender (WhatsAppSender): Where to send the result.

    Return:
        SheetSyncProposal: The proposal, now ``applied`` or ``failed``.
    """
    proposal = get_proposal_or_error(session, proposal_id)
    if proposal.status is not SheetSyncProposalStatus.APPROVED:
        raise SheetSyncError(
            PROPOSAL_NOT_APPROVED_ERROR.format(proposal_id=proposal_id, status=proposal.status)
        )

    actor = APPLY_ACTOR_TEMPLATE.format(proposal_id=proposal_id)
    now = dt.datetime.now(dt.UTC)
    try:
        stats = import_seed(session, csv_path, dry_run=False, actor=actor, prune=True)
    except Exception as exc:
        proposal.status = SheetSyncProposalStatus.FAILED
        proposal.result_text = APPLY_RESULT_FAILURE_TEMPLATE.format(
            proposal_id=proposal_id, error=exc
        )
        session.add(
            AuditLog(
                entity_type=AUDIT_ENTITY_TYPE,
                entity_id=proposal.id,
                action=AuditAction.STATE_CHANGE,
                changes={
                    "status": {
                        "before": SheetSyncProposalStatus.APPROVED.value,
                        "after": SheetSyncProposalStatus.FAILED.value,
                    }
                },
                actor=actor,
                evidence={"error": str(exc)},
            )
        )
        session.commit()
        whatsapp_sender.send(summary=proposal.result_text, link=None)

        return proposal

    proposal.status = SheetSyncProposalStatus.APPLIED
    proposal.applied_at = now
    proposal.result_text = APPLY_RESULT_SUCCESS_TEMPLATE.format(
        proposal_id=proposal_id, summary=build_summary_text(stats)
    )
    session.add(
        AuditLog(
            entity_type=AUDIT_ENTITY_TYPE,
            entity_id=proposal.id,
            action=AuditAction.STATE_CHANGE,
            changes={
                "status": {
                    "before": SheetSyncProposalStatus.APPROVED.value,
                    "after": SheetSyncProposalStatus.APPLIED.value,
                }
            },
            actor=actor,
            evidence={},
        )
    )
    session.commit()
    whatsapp_sender.send(summary=proposal.result_text, link=None)

    return proposal
