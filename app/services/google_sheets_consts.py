"""Constants for the Google Sheets read-only fetch (`kashroot sheet-sync fetch`).

STANDARDS.md: no plain strings in code — the API endpoint, scope and timeouts live
here rather than inline in `app.services.google_sheets`.
"""

from __future__ import annotations

#: Read-only scope — this pipeline never writes to the sheet.
SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"

#: Google's OAuth2 token endpoint, used to exchange a signed service-account JWT for
#: a short-lived access token.
GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token"

#: `values.get` on one tab, the full used range (unbounded A:ZZ is safe: Sheets
#: returns only populated cells).
SHEETS_VALUES_URL_TEMPLATE = (
    "https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{tab_range}"
)
SHEETS_VALUE_RENDER_OPTION = "UNFORMATTED_VALUE"
SHEETS_DATE_TIME_RENDER_OPTION = "FORMATTED_STRING"

DEFAULT_HTTP_TIMEOUT_SECONDS = 30.0

#: utf-8-sig: the byte-order mark Excel needs to open the CSV with Hebrew intact,
#: exactly matching how `app.ingestion.seed_import.read_rows` decodes the corpus.
CSV_BOM = "﻿"
CSV_LINE_TERMINATOR = "\r\n"

GOOGLE_SHEETS_EMPTY_SHEET_ERROR = "sheet {sheet_id!r} tab {tab!r} returned no rows"
GOOGLE_SHEETS_AUTH_ERROR = (
    "failed to obtain a Google access token from the service account: {error}"
)
GOOGLE_SHEETS_FETCH_ERROR = "Google Sheets API request failed ({status}): {body}"

#: Lazily-imported dependency, only needed for the real token exchange — see
#: `app.services.google_sheets.get_access_token`.
GOOGLE_AUTH_IMPORT_ERROR = (
    "google-auth is required to fetch the live sheet (`pip install google-auth`); "
    "tests should mock app.services.google_sheets.get_access_token instead of "
    "exercising the real credential exchange."
)
