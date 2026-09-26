"""Trigger the `sheet-sync-apply.yml` GitHub Actions workflow (`workflow_dispatch`).

Called from the confirm page (``app.api.sync``) the moment a person taps Approve —
the API process itself never runs the import; it only asks GitHub Actions to.
"""

from __future__ import annotations

import uuid

import httpx

from app.services.github_dispatch_consts import (
    DEFAULT_GITHUB_REF,
    DEFAULT_HTTP_TIMEOUT_SECONDS,
    DISPATCH_ERROR,
    DISPATCH_URL_TEMPLATE,
    GITHUB_API_BASE,
    GITHUB_API_VERSION,
    PROPOSAL_ID_INPUT_KEY,
)


class GitHubDispatchError(RuntimeError):
    """Raised when GitHub rejects the workflow_dispatch request."""


def dispatch_sheet_sync_apply(
    proposal_id: uuid.UUID,
    *,
    token: str,
    repo: str,
    workflow_file: str,
    ref: str = DEFAULT_GITHUB_REF,
    client: httpx.Client | None = None,
) -> None:
    """
    Fire `workflow_dispatch` for the sheet-sync-apply workflow with one input.

    Parameters:
        proposal_id (uuid.UUID): The approved proposal to apply — becomes the
            workflow's ``proposal_id`` input.
        token (str): A fine-grained GitHub PAT with Actions: read & write on this
            repo only (``KASHROOT_GITHUB_DISPATCH_TOKEN``).
        repo (str): ``"<owner>/<repo>"`` (``KASHROOT_GITHUB_REPO``).
        workflow_file (str): The workflow's filename, e.g. ``"sheet-sync-apply.yml"``.
        ref (str): Branch or tag to run the workflow from. Defaults to ``main``.
        client (httpx.Client | None): HTTP client to use; tests supply a fake so no
            real network call is made.

    Return:
        None
    """
    owner, _, name = repo.partition("/")
    url = DISPATCH_URL_TEMPLATE.format(
        api_base=GITHUB_API_BASE, owner=owner, repo=name, workflow=workflow_file
    )
    owns_client = client is None
    http_client = client or httpx.Client(timeout=DEFAULT_HTTP_TIMEOUT_SECONDS)
    try:
        response = http_client.post(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": GITHUB_API_VERSION,
            },
            json={"ref": ref, "inputs": {PROPOSAL_ID_INPUT_KEY: str(proposal_id)}},
        )
    finally:
        if owns_client:
            http_client.close()

    if response.status_code != httpx.codes.NO_CONTENT:
        raise GitHubDispatchError(
            DISPATCH_ERROR.format(status=response.status_code, body=response.text)
        )
