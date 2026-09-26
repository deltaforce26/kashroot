"""Confirm page for one `SheetSyncProposal` — Approve/Deny, reached directly from the
WhatsApp link (`{KASHROOT_PUBLIC_API_ORIGIN}/sync/proposals/{id}?t={token}`), never
through the Vercel `/v1/*`/`/api/*` proxy (render.yaml) since the link points at this
API service's own origin.

GET renders the summary plus two HTML `<form method="post">` buttons — never plain
`<a>` links — so a WhatsApp/iMessage link-preview crawler fetching the page (a GET)
can never itself trigger a decision; only an explicit POST can. GET is therefore
strictly read-only: it never touches the database beyond a lookup.

POST verifies the token in constant time, requires status ``pending`` and
``expires_at`` in the future, and is single-use: the first successful decision moves
the proposal out of ``pending`` for good. Approving dispatches
`sheet-sync-apply.yml` via `app.services.github_dispatch`; denying only records the
decision.
"""

from __future__ import annotations

import datetime as dt
import html
import uuid

from fastapi import APIRouter, Depends, Form
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.api.sync.consts import (
    ALREADY_DECIDED_MESSAGE,
    APPROVED_DISPATCH_FAILED_MESSAGE,
    APPROVED_MESSAGE,
    AUDIT_ACTOR,
    AUDIT_ENTITY_TYPE,
    DECISION_APPROVE,
    DECISION_DENY,
    DENIED_MESSAGE,
    EXPIRED_LINK_MESSAGE,
    INVALID_LINK_MESSAGE,
    NOT_PENDING_MESSAGE,
    PAGE_TITLE,
    UNKNOWN_DECISION_MESSAGE,
)
from app.core.config import settings
from app.db.session import get_session
from app.ingestion.sheet_sync import tokens_match
from app.models import AuditAction, AuditLog, SheetSyncProposal, SheetSyncProposalStatus
from app.services.github_dispatch import GitHubDispatchError, dispatch_sheet_sync_apply

router = APIRouter(prefix="/sync", tags=["sheet-sync"])


def _page(title: str, body_html: str) -> HTMLResponse:
    """
    Wrap a body fragment in a minimal, mobile-friendly, Hebrew-safe HTML page.

    Parameters:
        title (str): The ``<title>`` and on-page heading.
        body_html (str): Pre-escaped HTML for the page body.

    Return:
        HTMLResponse: The rendered page, UTF-8.
    """
    safe_title = html.escape(title)
    document = (
        "<!doctype html><html><head>"
        '<meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{safe_title}</title>"
        "<style>"
        "body{font-family:system-ui,sans-serif;max-width:480px;margin:2rem auto;"
        "padding:0 1rem;line-height:1.5;color:#1a1a1a}"
        "pre{white-space:pre-wrap;background:#f4f4f4;padding:1rem;border-radius:8px;"
        "direction:auto;text-align:start}"
        "button{font-size:1.1rem;padding:0.75rem 1.5rem;margin:0.5rem 0.5rem 0 0;"
        "border-radius:8px;border:none;color:#fff;cursor:pointer}"
        ".approve{background:#1a7f37}.deny{background:#b91c1c}"
        "</style></head><body>"
        f"<h1>{safe_title}</h1>{body_html}"
        "</body></html>"
    )

    return HTMLResponse(content=document)


def _decision_forms(proposal_id: uuid.UUID, token: str) -> str:
    """Two POST forms (never GET links) so a link-preview crawler can't decide."""
    safe_token = html.escape(token, quote=True)

    return (
        f'<form method="post" action="/sync/proposals/{proposal_id}/decide" style="display:inline">'
        f'<input type="hidden" name="token" value="{safe_token}">'
        f'<input type="hidden" name="decision" value="{DECISION_APPROVE}">'
        '<button class="approve" type="submit">Approve</button>'
        "</form>"
        f'<form method="post" action="/sync/proposals/{proposal_id}/decide" style="display:inline">'
        f'<input type="hidden" name="token" value="{safe_token}">'
        f'<input type="hidden" name="decision" value="{DECISION_DENY}">'
        '<button class="deny" type="submit">Deny</button>'
        "</form>"
    )


@router.get("/proposals/{proposal_id}", response_class=HTMLResponse)
def get_proposal_confirm_page(
    proposal_id: uuid.UUID,
    t: str,
    session: Session = Depends(get_session),
) -> HTMLResponse:
    """
    Show a proposal's summary and, while it is still decidable, Approve/Deny forms.

    Strictly side-effect free: this handler only reads the database.

    Parameters:
        proposal_id (uuid.UUID): The proposal to show.
        t (str): The raw decision token from the query string.
        session (Session): Injected database session.

    Return:
        HTMLResponse: The confirm page, or an explanatory page when the link is
            invalid, expired, or the proposal was already decided.
    """
    proposal = session.get(SheetSyncProposal, proposal_id)
    if proposal is None or not tokens_match(t, proposal.token_hash):
        return _page(PAGE_TITLE, f"<p>{html.escape(INVALID_LINK_MESSAGE)}</p>")

    summary_html = f"<pre>{html.escape(proposal.summary_text)}</pre>"

    if proposal.status is not SheetSyncProposalStatus.PENDING:
        message = ALREADY_DECIDED_MESSAGE.format(status=proposal.status.value)

        return _page(PAGE_TITLE, f"{summary_html}<p>{html.escape(message)}</p>")

    if proposal.expires_at <= dt.datetime.now(dt.UTC):
        return _page(PAGE_TITLE, f"{summary_html}<p>{html.escape(EXPIRED_LINK_MESSAGE)}</p>")

    return _page(PAGE_TITLE, summary_html + _decision_forms(proposal_id, t))


def _record_decision(
    session: Session, proposal: SheetSyncProposal, new_status: SheetSyncProposalStatus
) -> None:
    """Move a pending proposal to a decided status and write the audit row."""
    before = proposal.status.value
    proposal.status = new_status
    proposal.decided_at = dt.datetime.now(dt.UTC)
    session.add(
        AuditLog(
            entity_type=AUDIT_ENTITY_TYPE,
            entity_id=proposal.id,
            action=AuditAction.STATE_CHANGE,
            changes={"status": {"before": before, "after": new_status.value}},
            actor=AUDIT_ACTOR,
            evidence={},
        )
    )


@router.post("/proposals/{proposal_id}/decide", response_class=HTMLResponse)
def post_proposal_decision(
    proposal_id: uuid.UUID,
    token: str = Form(...),
    decision: str = Form(...),
    session: Session = Depends(get_session),
) -> HTMLResponse:
    """
    Apply a single-use Approve/Deny decision to a pending proposal.

    Parameters:
        proposal_id (uuid.UUID): The proposal being decided.
        token (str): The raw decision token, from the hidden form field.
        decision (str): ``"approve"`` or ``"deny"``.
        session (Session): Injected database session.

    Return:
        HTMLResponse: A confirmation or error page. Never redirects, so a page
            reload never resubmits the form (the browser would just GET the confirm
            page again, which is safe).
    """
    proposal = session.get(SheetSyncProposal, proposal_id, with_for_update=True)
    if proposal is None or not tokens_match(token, proposal.token_hash):
        return _page(PAGE_TITLE, f"<p>{html.escape(INVALID_LINK_MESSAGE)}</p>")

    if proposal.status is not SheetSyncProposalStatus.PENDING:
        message = NOT_PENDING_MESSAGE.format(status=proposal.status.value)

        return _page(PAGE_TITLE, f"<p>{html.escape(message)}</p>")

    if proposal.expires_at <= dt.datetime.now(dt.UTC):
        return _page(PAGE_TITLE, f"<p>{html.escape(EXPIRED_LINK_MESSAGE)}</p>")

    if decision == DECISION_DENY:
        _record_decision(session, proposal, SheetSyncProposalStatus.DENIED)

        return _page(PAGE_TITLE, f"<p>{html.escape(DENIED_MESSAGE)}</p>")

    if decision != DECISION_APPROVE:
        return _page(PAGE_TITLE, f"<p>{html.escape(UNKNOWN_DECISION_MESSAGE)}</p>")

    try:
        dispatch_sheet_sync_apply(
            proposal.id,
            token=settings.github_dispatch_token or "",
            repo=settings.github_repo,
            workflow_file=settings.sheet_sync_workflow_file,
        )
    except GitHubDispatchError as exc:
        message = APPROVED_DISPATCH_FAILED_MESSAGE.format(error=exc)

        return _page(PAGE_TITLE, f"<p>{html.escape(message)}</p>")

    _record_decision(session, proposal, SheetSyncProposalStatus.APPROVED)

    return _page(PAGE_TITLE, f"<p>{html.escape(APPROVED_MESSAGE)}</p>")
