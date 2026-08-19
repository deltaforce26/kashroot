"""Compile-time checks for the search query's PostGIS geography clause (POC_PLAN.md
B6, B8).

``tests/conftest.py`` compiles ``Restaurant.geo`` down to a plain SQLite TEXT column,
so ``ST_DWithin``/``ST_Distance`` cannot actually execute in this suite — that is a
known, deliberate gap (see the conftest docstring and POC_PLAN.md Risk 4), closed by
Track D's integration pass against real Postgres. What *can* be verified without a
live PostGIS server is that the statement ``app.api.public.build_search_statement``
produces is the query we intend: these tests compile it against the PostgreSQL
dialect (never execute it) and inspect the resulting SQL text and bind parameters.
"""

from __future__ import annotations

from app.api.public import build_search_statement
from app.api.schemas_public import GeoPoint, ProfileRequest, SearchRequest


def _compiled_sql(request: SearchRequest) -> tuple[str, dict[str, object]]:
    from sqlalchemy.dialects import postgresql

    stmt = build_search_statement(request)
    compiled = stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": False})

    return str(compiled), dict(compiled.params)


def test_search_with_center_uses_st_dwithin_and_st_distance() -> None:
    request = SearchRequest(
        profile=ProfileRequest(),
        center=GeoPoint(lat=31.7683, lon=35.2137),
        radius_km=7.5,
    )

    sql, params = _compiled_sql(request)

    assert "ST_DWithin" in sql
    assert "ST_Distance" in sql
    assert "ST_GeogFromText" in sql
    assert "distance_m" in sql
    # radius_km is converted to metres before it reaches the SQL layer.
    assert 7.5 * 1000.0 in params.values()


def test_search_with_center_orders_by_distance() -> None:
    request = SearchRequest(
        profile=ProfileRequest(), center=GeoPoint(lat=31.7683, lon=35.2137), radius_km=5.0
    )

    sql, _params = _compiled_sql(request)

    order_by_index = sql.upper().index("ORDER BY")
    assert "distance_m" in sql[order_by_index:]


def test_search_with_center_excludes_null_geo() -> None:
    request = SearchRequest(
        profile=ProfileRequest(), center=GeoPoint(lat=31.7683, lon=35.2137), radius_km=5.0
    )

    sql, _params = _compiled_sql(request)

    assert "geo IS NOT NULL" in sql


def test_search_without_center_never_calls_postgis_functions() -> None:
    """A city-only search has no reference point — the statement must not reference
    any PostGIS function, which is exactly what makes this path safely testable
    against SQLite (see tests/test_public_search_api.py).
    """
    request = SearchRequest(profile=ProfileRequest(), city="jerusalem")

    sql, _params = _compiled_sql(request)

    assert "ST_DWithin" not in sql
    assert "ST_Distance" not in sql
    assert "city_slug" in sql


def test_search_uses_the_existing_geo_index_no_new_index_needed() -> None:
    """Documents the B6 decision: the GIST index created by migration 0001
    (``ix_restaurant_geo``) already covers this query shape (ST_DWithin + ST_Distance
    ordering on ``Restaurant.geo``), so B6 needed no new Alembic migration.
    """
    from pathlib import Path

    from alembic.config import Config
    from alembic.script import ScriptDirectory

    root = Path(__file__).resolve().parents[1]
    script = ScriptDirectory.from_config(Config(str(root / "alembic.ini")))
    upgrade_ops_source = (root / "alembic" / "versions" / "0001_initial_schema.py").read_text(
        encoding="utf-8"
    )

    assert script.get_revision("0001_initial_schema") is not None
    assert "ix_restaurant_geo" in upgrade_ops_source
    assert "gist" in upgrade_ops_source


def test_search_query_adds_ilike_clause_over_name_and_address(session) -> None:  # noqa: ARG001
    request = SearchRequest(profile=ProfileRequest(), city="jerusalem", query="פיצה")

    sql, params = _compiled_sql(request)

    assert sql.upper().count("ILIKE") == 3
    assert any("%פיצה%" in str(value) for value in params.values())


def test_search_without_query_has_no_ilike_clause(session) -> None:  # noqa: ARG001
    request = SearchRequest(profile=ProfileRequest(), city="jerusalem")

    sql, _params = _compiled_sql(request)

    assert "ILIKE" not in sql.upper()


def test_search_filters_by_diet_and_price(session) -> None:  # noqa: ARG001 - fixture ensures models registered
    request = SearchRequest(
        profile=ProfileRequest(),
        city="jerusalem",
        filters={"diet_type": "meat", "price_level": 2},
    )

    sql, params = _compiled_sql(request)

    assert "diet_type" in sql
    assert "price_level" in sql
    assert "meat" in params.values()
    assert 2 in params.values()
