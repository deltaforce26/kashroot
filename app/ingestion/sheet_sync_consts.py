"""Constants for the Google Sheet -> WhatsApp approve/deny sync pipeline.

See `app.ingestion.sheet_sync` and `docs/sheet-sync-runbook.md`.
"""

from __future__ import annotations

import datetime as dt

PIPELINE_ACTOR_PROPOSE = "sheet-sync"
APPLY_ACTOR_TEMPLATE = "sheet-sync:{proposal_id}"

PROPOSAL_TOKEN_TTL = dt.timedelta(hours=24)
PROPOSAL_TOKEN_BYTES = 32

#: How many deleted/skipped restaurant names to list by name in the summary before
#: collapsing the rest into "and N more" — keeps the message readable and, combined
#: with Twilio's hard per-message cap, sendable in one WhatsApp message.
MAX_NAMES_LISTED = 15

SUMMARY_HEADER_CHANGES = "Kashroot sheet sync — changes detected"
SUMMARY_HEADER_NO_CHANGES = "Kashroot sheet sync — no changes"
SUMMARY_LINE_RESTAURANTS = "Restaurants: +{created} ~{updated}"
SUMMARY_LINE_CERTIFICATES = "Certificates: +{created} ~{updated}"
SUMMARY_LINE_DELETED = "Deleted: {count}"
SUMMARY_LINE_KEPT_SKIPPED = "Kept (skipped prune): {count}"
SUMMARY_LINE_NEEDS_REVIEW = "Needs review: {count}"
SUMMARY_DELETED_NAMES_HEADER = "Deleted restaurants:"
SUMMARY_SKIPPED_NAMES_HEADER = "Skipped (not seed-origin — review):"
SUMMARY_NAME_MORE_TEMPLATE = "…and {count} more"
SUMMARY_NO_CHANGES_BODY = "The sheet changed, but the corpus diff is empty — nothing to apply."

CONFIRM_LINK_TEMPLATE = "{origin}/sync/proposals/{proposal_id}?t={token}"

APPLY_RESULT_SUCCESS_TEMPLATE = "Applied proposal {proposal_id}.\n{summary}"
APPLY_RESULT_FAILURE_TEMPLATE = "Sheet sync APPLY FAILED for proposal {proposal_id}: {error}"

PROPOSAL_NOT_FOUND_ERROR = "no sheet_sync_proposal with id {proposal_id}"
PROPOSAL_NOT_APPROVED_ERROR = (
    "proposal {proposal_id} is {status!r}, not approved — cannot apply"
)

AUDIT_ENTITY_TYPE = "sheet_sync_proposal"
