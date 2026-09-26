"""Tests for `app.services.google_sheets` — no real Google/HTTP call, ever.

`fetch_sheet_values`/`fetch_sheet_csv` are exercised against `httpx.Client`s built on
`httpx.MockTransport`, which intercepts the request before it reaches a socket — the
same technique used for the Twilio/GitHub tests, so no test in this module can reach
a real network endpoint.
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

import httpx

from app.services.google_sheets import (
    GoogleSheetsError,
    fetch_sheet_csv,
    fetch_sheet_values,
    values_to_csv_text,
)


class ValuesToCsvTextTests(unittest.TestCase):
    def test_bom_prefixed(self) -> None:
        text = values_to_csv_text([["a", "b"], ["1", "2"]])

        self.assertTrue(text.startswith("﻿"))

    def test_renders_header_and_rows(self) -> None:
        text = values_to_csv_text([["a", "b"], ["1", "2"]])

        self.assertIn("a,b", text)
        self.assertIn("1,2", text)

    def test_short_rows_are_padded_to_header_width(self) -> None:
        """Sheets omits trailing empty cells from a row entirely; a DictReader on the
        far end must still see every column.
        """
        text = values_to_csv_text([["a", "b", "c"], ["1"]])

        self.assertIn("1,,", text)

    def test_hebrew_cells_round_trip(self) -> None:
        text = values_to_csv_text([["restaurant_name_he"], ['מסעדה כשרה']])

        self.assertIn("מסעדה כשרה", text)


def _mock_client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


class FetchSheetValuesTests(unittest.TestCase):
    def test_returns_string_rows(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"values": [["a", "b"], [1, True]]})

        rows = fetch_sheet_values("tok", "sheet123", "Sheet1", client=_mock_client(handler))

        self.assertEqual(rows, [["a", "b"], ["1", "True"]])

    def test_sends_bearer_token(self) -> None:
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["auth"] = request.headers.get("authorization")

            return httpx.Response(200, json={"values": [["a"]]})

        fetch_sheet_values("secret-token", "sheet123", "Sheet1", client=_mock_client(handler))

        self.assertEqual(seen["auth"], "Bearer secret-token")

    def test_non_200_raises(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(403, text="forbidden")

        with self.assertRaises(GoogleSheetsError):
            fetch_sheet_values("tok", "sheet123", "Sheet1", client=_mock_client(handler))

    def test_empty_values_raises(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"values": []})

        with self.assertRaises(GoogleSheetsError):
            fetch_sheet_values("tok", "sheet123", "Sheet1", client=_mock_client(handler))

    def test_missing_values_key_raises(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={})

        with self.assertRaises(GoogleSheetsError):
            fetch_sheet_values("tok", "sheet123", "Sheet1", client=_mock_client(handler))


class FetchSheetCsvTests(unittest.TestCase):
    def test_fetches_and_converts(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"values": [["a", "b"], ["1", "2"]]})

        with patch("app.services.google_sheets.get_access_token", return_value="tok") as mocked:
            csv_text = fetch_sheet_csv(
                '{"type": "service_account"}', "sheet123", "Sheet1", client=_mock_client(handler)
            )

        mocked.assert_called_once_with('{"type": "service_account"}')
        self.assertTrue(csv_text.startswith("﻿"))
        self.assertIn("a,b", csv_text)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
