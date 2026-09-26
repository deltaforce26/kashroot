"""Constants for the sheet-sync confirm page (`app.api.sync.proposals`)."""

from __future__ import annotations

DECISION_APPROVE = "approve"
DECISION_DENY = "deny"

PAGE_TITLE = "Kashroot sheet sync"

INVALID_LINK_MESSAGE = "This link is invalid."
EXPIRED_LINK_MESSAGE = "This link has expired. Run `kashroot sheet-sync propose` again."
ALREADY_DECIDED_MESSAGE = "This proposal was already decided ({status}) — no action taken."
NOT_PENDING_MESSAGE = "This proposal is {status!r} and can no longer be approved or denied."
APPROVED_MESSAGE = (
    "Approved. The import workflow has been triggered — you'll get a WhatsApp "
    "message with the result."
)
APPROVED_DISPATCH_FAILED_MESSAGE = (
    "Approved, but triggering the import workflow failed ({error}). "
    "The link is still valid — try tapping Approve again, or run it manually."
)
DENIED_MESSAGE = "Denied. Nothing was changed; this proposal is discarded."
UNKNOWN_DECISION_MESSAGE = "Unrecognized decision."

AUDIT_ENTITY_TYPE = "sheet_sync_proposal"
AUDIT_ACTOR = "sheet-sync-confirm-page"
