"""Constants for triggering the `sheet-sync-apply.yml` GitHub Actions workflow."""

from __future__ import annotations

DEFAULT_GITHUB_REPO = "deltaforce26/kashroot"
DEFAULT_GITHUB_REF = "main"
DEFAULT_WORKFLOW_FILE = "sheet-sync-apply.yml"

GITHUB_API_BASE = "https://api.github.com"
DISPATCH_URL_TEMPLATE = (
    "{api_base}/repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches"
)
GITHUB_API_VERSION = "2022-11-28"
DEFAULT_HTTP_TIMEOUT_SECONDS = 15.0

DISPATCH_ERROR = "GitHub workflow_dispatch failed ({status}): {body}"
PROPOSAL_ID_INPUT_KEY = "proposal_id"
