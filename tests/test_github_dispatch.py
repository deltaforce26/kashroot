"""Tests for `app.services.github_dispatch` — `httpx.MockTransport` only, never a
real call to api.github.com.
"""

from __future__ import annotations

import unittest
import uuid

import httpx

from app.services.github_dispatch import GitHubDispatchError, dispatch_sheet_sync_apply

PROPOSAL_ID = uuid.uuid4()


def _mock_client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


class DispatchSheetSyncApplyTests(unittest.TestCase):
    def test_posts_to_the_workflow_dispatches_endpoint(self) -> None:
        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["auth"] = request.headers.get("authorization")

            return httpx.Response(204)

        dispatch_sheet_sync_apply(
            PROPOSAL_ID,
            token="ghp_token",
            repo="deltaforce26/kashroot",
            workflow_file="sheet-sync-apply.yml",
            client=_mock_client(handler),
        )

        self.assertIn(
            "/repos/deltaforce26/kashroot/actions/workflows/sheet-sync-apply.yml/dispatches",
            captured["url"],
        )
        self.assertEqual(captured["auth"], "Bearer ghp_token")

    def test_sends_proposal_id_as_an_input(self) -> None:
        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            import json

            captured["body"] = json.loads(request.content)

            return httpx.Response(204)

        dispatch_sheet_sync_apply(
            PROPOSAL_ID,
            token="ghp_token",
            repo="deltaforce26/kashroot",
            workflow_file="sheet-sync-apply.yml",
            client=_mock_client(handler),
        )

        self.assertEqual(captured["body"]["inputs"]["proposal_id"], str(PROPOSAL_ID))
        self.assertEqual(captured["body"]["ref"], "main")

    def test_non_204_raises(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(404, text="workflow not found")

        with self.assertRaises(GitHubDispatchError):
            dispatch_sheet_sync_apply(
                PROPOSAL_ID,
                token="ghp_token",
                repo="deltaforce26/kashroot",
                workflow_file="sheet-sync-apply.yml",
                client=_mock_client(handler),
            )


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
