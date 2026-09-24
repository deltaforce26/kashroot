"""Tests for ``GET /v1/sitemap.xml`` (app/api/public_seo.py)."""

from __future__ import annotations

import datetime as dt
import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import get_session
from app.main import create_app
from app.models import RecordState, Restaurant, RestaurantStatus

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


def make_restaurant(session, **overrides) -> Restaurant:
    defaults: dict = {
        "dedupe_key": f"test:{uuid.uuid4().hex}",
        "name_he": "מסעדת בדיקה",
        "city_he": "ירושלים",
        "city_slug": "jerusalem",
        "record_state": RecordState.LIST_VERIFIED,
        "needs_review": False,
        "corroboration_count": 1,
        "status": RestaurantStatus.OPEN,
        "amenities": {},
    }
    defaults.update(overrides)
    restaurant = Restaurant(**defaults)
    session.add(restaurant)
    session.flush()

    return restaurant


# --------------------------------------------------------------------------- tests


def test_sitemap_content_type_is_xml(client, session) -> None:
    make_restaurant(session)
    session.commit()

    response = client.get("/v1/sitemap.xml")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/xml")


def test_sitemap_contains_urlset_and_home(client, session) -> None:
    make_restaurant(session)
    session.commit()

    response = client.get("/v1/sitemap.xml")

    assert "<urlset" in response.text
    assert "http://www.sitemaps.org/schemas/sitemap/0.9" in response.text


def test_sitemap_contains_restaurant_entry(client, session) -> None:
    restaurant = make_restaurant(session)
    session.commit()

    response = client.get("/v1/sitemap.xml")

    assert f"/r/{restaurant.id}" in response.text


def test_sitemap_excludes_closed_restaurant(client, session) -> None:
    """Matches POST /v1/search's own unconditional candidate-set filter."""
    open_restaurant = make_restaurant(session, status=RestaurantStatus.OPEN)
    closed_restaurant = make_restaurant(session, status=RestaurantStatus.CLOSED_PERM)
    session.commit()

    response = client.get("/v1/sitemap.xml")

    assert f"/r/{open_restaurant.id}" in response.text
    assert f"/r/{closed_restaurant.id}" not in response.text


def test_sitemap_lastmod_is_date_only(client, session) -> None:
    restaurant = make_restaurant(session, updated_at=dt.datetime(2026, 3, 14, 9, 30, tzinfo=dt.UTC))
    session.commit()

    response = client.get("/v1/sitemap.xml")

    assert "<lastmod>2026-03-14</lastmod>" in response.text
    assert f"/r/{restaurant.id}" in response.text


def test_sitemap_origin_falls_back_to_forwarded_headers(client, session) -> None:
    restaurant = make_restaurant(session)
    session.commit()

    response = client.get(
        "/v1/sitemap.xml",
        headers={"X-Forwarded-Host": "kashroot.example", "X-Forwarded-Proto": "https"},
    )

    assert f"https://kashroot.example/r/{restaurant.id}" in response.text


def test_sitemap_origin_honours_setting_override(client, session, monkeypatch) -> None:
    monkeypatch.setattr(settings, "public_web_origin", "https://configured.example")
    restaurant = make_restaurant(session)
    session.commit()

    response = client.get(
        "/v1/sitemap.xml",
        headers={"X-Forwarded-Host": "should-be-ignored.example"},
    )

    assert f"https://configured.example/r/{restaurant.id}" in response.text
    assert "should-be-ignored.example" not in response.text


def test_sitemap_origin_falls_back_to_request_base_url_with_no_headers(client, session) -> None:
    restaurant = make_restaurant(session)
    session.commit()

    response = client.get("/v1/sitemap.xml")

    assert f"/r/{restaurant.id}" in response.text
    assert "<loc>http" in response.text


def test_sitemap_cache_control_header(client, session) -> None:
    make_restaurant(session)
    session.commit()

    response = client.get("/v1/sitemap.xml")

    assert response.headers["cache-control"] == "public, max-age=3600"
