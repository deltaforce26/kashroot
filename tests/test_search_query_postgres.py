"""Real-PostgreSQL verification for the ``query`` free-text search parameter
(Change 3), run against the live seeded corpus (531 restaurants) rather than the
SQLite fixture.

``tests/conftest.py``'s ``session`` fixture is SQLite (see its docstring) and cannot
exercise real ``ILIKE`` collation behaviour against Hebrew text. This module instead
opens a session directly against ``app.core.config.get_settings().database_url`` — in
this environment that already points at the docker-compose Postgres instance on port
5433 (see ``.env`` / ``docker-compose.yml``) — and issues read-only ``POST
/v1/search`` requests over the real, already-seeded data. It never writes: every
request's session is rolled back, never committed, in ``client``'s dependency
override below.

If no reachable PostgreSQL instance is configured, every test here is skipped rather
than failed — this module is an integration check on top of the SQLite-backed unit
tests in ``tests/test_public_search_api.py``, not a replacement for them.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.connection import build_connect_args, normalized_url
from app.db.session import get_session
from app.main import create_app
from app.models import Restaurant

#: A city with enough real corpus rows (140, per the seeded data) that a
#: substring-vs-no-substring split cannot be a fluke of small sample size.
_TEST_CITY_SLUG = "jerusalem"


def _reachable_engine():  # noqa: ANN202
    """A SQLAlchemy engine bound to the real database, or None if unreachable."""
    settings = get_settings()
    engine = create_engine(
        normalized_url(settings.database_url),
        future=True,
        pool_pre_ping=True,
        connect_args=build_connect_args(
            settings.database_url,
            prepared_statements=settings.db_prepared_statements,
            search_path=settings.db_search_path,
        ),
    )
    try:
        with engine.connect():
            pass
    except Exception:
        engine.dispose()
        return None

    return engine


@pytest.fixture(scope="module")
def pg_engine():
    engine = _reachable_engine()
    if engine is None:
        pytest.skip("no reachable PostgreSQL instance at settings.database_url")
    yield engine
    engine.dispose()


@pytest.fixture
def pg_session(pg_engine) -> Session:
    with Session(pg_engine, autoflush=False, expire_on_commit=False) as session:
        yield session


@pytest.fixture
def client(pg_session):
    app = create_app()

    def _override_session():
        yield pg_session
        # Read-only: never persist anything back to the shared corpus.
        pg_session.rollback()

    app.dependency_overrides[get_session] = _override_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _search(client, query: str, *, page_size: int = 100) -> dict:
    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": []},
            "city": _TEST_CITY_SLUG,
            "query": query,
            "page_size": page_size,
        },
    )
    assert response.status_code == 200

    return response.json()


def test_hebrew_substring_matches_restaurants_with_pizza_in_name(client, pg_session) -> None:
    """ "פיצה" (pizza) as a Hebrew substring must match every Jerusalem restaurant
    whose ``name_he`` contains it, and only those — confirmed against the real,
    already-seeded corpus, not synthetic rows.
    """
    expected_ids = {
        str(row.id)
        for row in pg_session.execute(
            select(Restaurant).where(
                Restaurant.city_slug == _TEST_CITY_SLUG,
                Restaurant.name_he.ilike("%פיצה%"),
            )
        ).scalars()
    }
    assert expected_ids, "seed data must contain a Jerusalem restaurant with פיצה in its name"

    body = _search(client, "פיצה")

    returned_ids = {item["restaurant_id"] for item in body["items"]}
    assert returned_ids == expected_ids
    assert body["total"] == len(expected_ids)


def test_hebrew_mid_word_substring_is_not_tokenized(client) -> None:
    """ "יצה" is the tail of "פיצה" (pizza), not a whole word or root on its own — an
    exact-substring implementation must still match every "פיצה" restaurant, proving
    this is plain SQL substring matching, not any kind of word/root tokenization.
    """
    whole_word = _search(client, "פיצה")
    mid_word = _search(client, "יצה")

    assert whole_word["total"] > 0
    assert mid_word["total"] == whole_word["total"]
    assert {i["restaurant_id"] for i in mid_word["items"]} == {
        i["restaurant_id"] for i in whole_word["items"]
    }


def test_hebrew_query_matches_address_not_only_name(client, pg_session) -> None:
    """ "אגריפס" (a Jerusalem street name) appears in ``address_he`` on some seed rows
    that do not have it in ``name_he`` — proving the address field is genuinely
    searched, not just the name columns.
    """
    name_matches = (
        pg_session.execute(
            select(Restaurant.id).where(
                Restaurant.city_slug == _TEST_CITY_SLUG,
                Restaurant.name_he.ilike("%אגריפס%"),
            )
        )
        .scalars()
        .all()
    )
    assert not name_matches, "test assumes no Jerusalem restaurant has אגריפס in its name_he"

    address_matches = {
        str(row)
        for row in pg_session.execute(
            select(Restaurant.id).where(
                Restaurant.city_slug == _TEST_CITY_SLUG,
                Restaurant.address_he.ilike("%אגריפס%"),
            )
        ).scalars()
    }
    assert address_matches, "seed data must contain a Jerusalem address with אגריפס"

    body = _search(client, "אגריפס")

    assert {item["restaurant_id"] for item in body["items"]} == address_matches


def test_query_with_no_hebrew_matches_returns_empty(client) -> None:
    body = _search(client, "zzzznonexistentxyzשוגגגג")

    assert body["total"] == 0
    assert body["items"] == []


def test_english_ascii_query_is_case_insensitive_against_real_postgres(client, pg_session) -> None:
    """Confirms real ``ILIKE`` case-folding (as opposed to SQLite's ASCII-only LIKE
    fallback) on whatever ASCII text exists in the corpus's Hebrew-name column.
    """
    ascii_row = pg_session.execute(
        select(Restaurant.name_he).where(
            Restaurant.city_slug == _TEST_CITY_SLUG,
            Restaurant.name_he.op("~")("[A-Za-z]"),
        )
    ).first()
    if ascii_row is None:
        pytest.skip("no ASCII-lettered restaurant name in the seeded Jerusalem corpus")

    upper_hit = _search(client, ascii_row[0].upper())
    lower_hit = _search(client, ascii_row[0].lower())

    assert upper_hit["total"] > 0
    assert upper_hit["total"] == lower_hit["total"]
