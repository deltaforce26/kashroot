"""Tests for `GET`/`POST /sync/proposals/{id}` (`app.api.sync.proposals`)."""

from __future__ import annotations

import datetime as dt
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_session
from app.ingestion.sheet_sync import generate_token, hash_text
from app.main import create_app
from app.models import SheetSyncProposal, SheetSyncProposalStatus
from app.services.github_dispatch import GitHubDispatchError

# ------------------------------------------------------------------------ fixtures


@pytest.fixture
def client(session):
    app = create_app()

    def _override_session():
        yield session
        session.commit()

    app.dependency_overrides[get_session] = _override_session
    with TestClient(app) as test_client:
        yield test_client


def make_proposal(session, **overrides) -> tuple[SheetSyncProposal, str]:
    token = overrides.pop("token", generate_token())
    defaults = dict(
        csv_sha256="deadbeef",
        csv_text="header\nrow\n",
        summary_text="Restaurants: +1 ~0",
        status=SheetSyncProposalStatus.PENDING,
        token_hash=hash_text(token),
        expires_at=dt.datetime.now(dt.UTC) + dt.timedelta(hours=24),
    )
    defaults.update(overrides)
    proposal = SheetSyncProposal(**defaults)
    session.add(proposal)
    session.commit()

    return proposal, token


# ------------------------------------------------------------------------ GET


def test_get_with_wrong_token_shows_invalid_link(client, session):
    proposal, _token = make_proposal(session)

    response = client.get(f"/sync/proposals/{proposal.id}", params={"t": "wrong-token"})

    assert response.status_code == 200
    assert "invalid" in response.text.lower()
    assert "Approve" not in response.text


def test_get_pending_shows_approve_and_deny_forms(client, session):
    proposal, token = make_proposal(session)

    response = client.get(f"/sync/proposals/{proposal.id}", params={"t": token})

    assert "Approve" in response.text
    assert "Deny" in response.text
    assert proposal.summary_text in response.text
    assert '<form method="post"' in response.text


def test_get_expired_proposal_shows_expired_message(client, session):
    proposal, token = make_proposal(
        session, expires_at=dt.datetime.now(dt.UTC) - dt.timedelta(hours=1)
    )

    response = client.get(f"/sync/proposals/{proposal.id}", params={"t": token})

    assert "expired" in response.text.lower()
    assert "Approve" not in response.text


def test_get_already_decided_proposal_shows_decided_message(client, session):
    proposal, token = make_proposal(session, status=SheetSyncProposalStatus.DENIED)

    response = client.get(f"/sync/proposals/{proposal.id}", params={"t": token})

    assert "denied" in response.text.lower()
    assert "Approve" not in response.text


def test_get_is_side_effect_free(client, session):
    proposal, token = make_proposal(session)

    client.get(f"/sync/proposals/{proposal.id}", params={"t": token})

    refreshed = session.get(SheetSyncProposal, proposal.id)
    assert refreshed.status is SheetSyncProposalStatus.PENDING
    assert refreshed.decided_at is None


# ------------------------------------------------------------------------ POST deny


def test_post_deny_marks_denied(client, session):
    proposal, token = make_proposal(session)

    response = client.post(
        f"/sync/proposals/{proposal.id}/decide", data={"token": token, "decision": "deny"}
    )

    assert response.status_code == 200
    assert "denied" in response.text.lower()
    refreshed = session.get(SheetSyncProposal, proposal.id)
    assert refreshed.status is SheetSyncProposalStatus.DENIED
    assert refreshed.decided_at is not None


def test_post_deny_is_single_use(client, session):
    proposal, token = make_proposal(session)
    client.post(f"/sync/proposals/{proposal.id}/decide", data={"token": token, "decision": "deny"})

    second = client.post(
        f"/sync/proposals/{proposal.id}/decide", data={"token": token, "decision": "deny"}
    )

    assert "can no longer be approved or denied" in second.text


def test_post_with_wrong_token_does_not_decide(client, session):
    proposal, _token = make_proposal(session)

    client.post(
        f"/sync/proposals/{proposal.id}/decide",
        data={"token": "wrong", "decision": "deny"},
    )

    refreshed = session.get(SheetSyncProposal, proposal.id)
    assert refreshed.status is SheetSyncProposalStatus.PENDING


# ------------------------------------------------------------------------ POST approve


def test_post_approve_dispatches_and_marks_approved(client, session):
    proposal, token = make_proposal(session)

    with patch("app.api.sync.proposals.dispatch_sheet_sync_apply") as mocked:
        response = client.post(
            f"/sync/proposals/{proposal.id}/decide", data={"token": token, "decision": "approve"}
        )

    mocked.assert_called_once()
    assert mocked.call_args.args[0] == proposal.id
    assert response.status_code == 200
    assert "Approved" in response.text
    refreshed = session.get(SheetSyncProposal, proposal.id)
    assert refreshed.status is SheetSyncProposalStatus.APPROVED


def test_post_approve_leaves_pending_when_dispatch_fails(client, session):
    proposal, token = make_proposal(session)

    with patch(
        "app.api.sync.proposals.dispatch_sheet_sync_apply",
        side_effect=GitHubDispatchError("boom"),
    ):
        response = client.post(
            f"/sync/proposals/{proposal.id}/decide", data={"token": token, "decision": "approve"}
        )

    assert "failed" in response.text.lower()
    refreshed = session.get(SheetSyncProposal, proposal.id)
    assert refreshed.status is SheetSyncProposalStatus.PENDING  # link stays usable


def test_post_deny_never_dispatches(client, session):
    proposal, token = make_proposal(session)

    with patch("app.api.sync.proposals.dispatch_sheet_sync_apply") as mocked:
        client.post(
            f"/sync/proposals/{proposal.id}/decide", data={"token": token, "decision": "deny"}
        )

    mocked.assert_not_called()
