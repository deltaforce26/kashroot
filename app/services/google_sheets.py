"""Read-only fetch of one private Google Sheet tab, converted to the corpus CSV shape.

`kashroot sheet-sync fetch` (``app.cli``) calls :func:`fetch_sheet_csv`, which
authenticates as a Google service account (``KASHROOT_GOOGLE_SERVICE_ACCOUNT_JSON``),
calls Sheets API ``values.get`` for one tab, and returns the rows as
UTF-8-with-BOM CSV text — the same encoding
:func:`app.ingestion.seed_import.read_rows` expects.

The real credential exchange (:func:`get_access_token`) lazily imports ``google-auth``
so this module still imports cleanly where that dependency is not installed (unit
tests never need it — they mock ``get_access_token`` and drive
:func:`fetch_sheet_values`/:func:`values_to_csv_text` directly against a fake HTTP
client, never a real Google credential).
"""

from __future__ import annotations

import csv
import io

import httpx

from app.services.google_sheets_consts import (
    CSV_BOM,
    CSV_LINE_TERMINATOR,
    DEFAULT_HTTP_TIMEOUT_SECONDS,
    GOOGLE_AUTH_IMPORT_ERROR,
    GOOGLE_SHEETS_AUTH_ERROR,
    GOOGLE_SHEETS_EMPTY_SHEET_ERROR,
    GOOGLE_SHEETS_FETCH_ERROR,
    SHEETS_DATE_TIME_RENDER_OPTION,
    SHEETS_READONLY_SCOPE,
    SHEETS_VALUE_RENDER_OPTION,
    SHEETS_VALUES_URL_TEMPLATE,
)


class GoogleSheetsError(RuntimeError):
    """Raised when the sheet cannot be authenticated to, fetched, or is empty."""


def get_access_token(service_account_json: str) -> str:
    """
    Exchange a Google service-account JSON key for a short-lived OAuth2 access token.

    Parameters:
        service_account_json (str): The raw JSON key contents (``KASHROOT_GOOGLE_
            SERVICE_ACCOUNT_JSON``).

    Return:
        str: A bearer access token, scoped read-only to Sheets.
    """
    try:
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account
    except ImportError as exc:  # pragma: no cover - exercised only without the dep
        raise GoogleSheetsError(GOOGLE_AUTH_IMPORT_ERROR) from exc

    try:
        import json

        info = json.loads(service_account_json)
        credentials = service_account.Credentials.from_service_account_info(
            info, scopes=[SHEETS_READONLY_SCOPE]
        )
        credentials.refresh(Request())
    except Exception as exc:
        raise GoogleSheetsError(GOOGLE_SHEETS_AUTH_ERROR.format(error=exc)) from exc

    token = credentials.token
    if not token:  # pragma: no cover - defensive, google-auth always sets it or raises
        raise GoogleSheetsError(GOOGLE_SHEETS_AUTH_ERROR.format(error="no token returned"))

    return token


def fetch_sheet_values(
    access_token: str,
    sheet_id: str,
    tab: str,
    *,
    client: httpx.Client | None = None,
) -> list[list[str]]:
    """
    Call Sheets API ``values.get`` for one tab and return its raw rows.

    Parameters:
        access_token (str): Bearer token from :func:`get_access_token`.
        sheet_id (str): The spreadsheet id (``KASHROOT_SHEET_ID``).
        tab (str): The tab/sheet name (``KASHROOT_SHEET_TAB``), unbounded so every
            populated cell is returned regardless of the sheet's current size.
        client (httpx.Client | None): HTTP client to use; tests supply a fake so no
            real network call is made.

    Return:
        list[list[str]]: Rows as returned by the API, header row first, each cell
            coerced to ``str`` (Sheets can return numbers/bools for unformatted cells).
    """
    owns_client = client is None
    http_client = client or httpx.Client(timeout=DEFAULT_HTTP_TIMEOUT_SECONDS)
    try:
        url = SHEETS_VALUES_URL_TEMPLATE.format(sheet_id=sheet_id, tab_range=tab)
        response = http_client.get(
            url,
            headers={"Authorization": f"Bearer {access_token}"},
            params={
                "valueRenderOption": SHEETS_VALUE_RENDER_OPTION,
                "dateTimeRenderOption": SHEETS_DATE_TIME_RENDER_OPTION,
            },
        )
    finally:
        if owns_client:
            http_client.close()

    if response.status_code != httpx.codes.OK:
        raise GoogleSheetsError(
            GOOGLE_SHEETS_FETCH_ERROR.format(status=response.status_code, body=response.text)
        )

    payload = response.json()
    raw_rows = payload.get("values") or []
    if not raw_rows:
        raise GoogleSheetsError(GOOGLE_SHEETS_EMPTY_SHEET_ERROR.format(sheet_id=sheet_id, tab=tab))

    return [[str(cell) for cell in row] for row in raw_rows]


def values_to_csv_text(values: list[list[str]]) -> str:
    """
    Render sheet rows as UTF-8-with-BOM CSV text (Excel-compatible, matching
    :func:`app.ingestion.seed_import.read_rows`'s decoding).

    Rows shorter than the header are padded with empty cells — Sheets omits trailing
    empty cells from a row entirely, and a ``csv.DictReader`` on the far end must see
    every column.

    Parameters:
        values (list[list[str]]): Rows, header first, as returned by
            :func:`fetch_sheet_values`.

    Return:
        str: The CSV text, BOM-prefixed.
    """
    header = values[0]
    width = len(header)
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator=CSV_LINE_TERMINATOR)
    for row in values:
        padded = row + [""] * (width - len(row))
        writer.writerow(padded[:width])

    return CSV_BOM + buffer.getvalue()


def fetch_sheet_csv(
    service_account_json: str,
    sheet_id: str,
    tab: str,
    *,
    client: httpx.Client | None = None,
) -> str:
    """
    Fetch one private Google Sheet tab and return it as corpus-shaped CSV text.

    Parameters:
        service_account_json (str): Raw JSON key contents for a Google service
            account the sheet has been shared with as a Viewer.
        sheet_id (str): The spreadsheet id.
        tab (str): The tab/sheet name to read.
        client (httpx.Client | None): HTTP client to use for the Sheets API call;
            tests supply a fake.

    Return:
        str: UTF-8-with-BOM CSV text, ready to write to
            :data:`app.ingestion.seed_import.DEFAULT_CSV_PATH`.
    """
    token = get_access_token(service_account_json)
    values = fetch_sheet_values(token, sheet_id, tab, client=client)

    return values_to_csv_text(values)
