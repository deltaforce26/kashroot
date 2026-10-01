"""Tests for ``GET /v1/sitemap.xml`` (app/api/public_seo.py)."""

from __future__ import annotations

import datetime as dt
import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import get_session
from app.main import create_app
from app.models import (
    Certificate,
    CertificateSource,
    CertificateState,
    CertificationLevel,
    Certifier,
    CertifierType,
    RecordState,
    Restaurant,
    RestaurantStatus,
)

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


def make_covered_restaurant(session, certifier_slug: str, **overrides) -> Restaurant:
    """Create a restaurant plus one certificate from a (new or existing) certifier.

    Parameters:
        session: the test database session.
        certifier_slug (str): slug of the certifier to attach; created when missing.
        **overrides: ``certifier_active`` and ``certificate_state`` configure the
            certifier and certificate; everything else goes to ``make_restaurant``.

    Return:
        Restaurant: the created restaurant.
    """
    certifier_active = overrides.pop("certifier_active", True)
    certificate_state = overrides.pop("certificate_state", CertificateState.ACTIVE)
    certifier = session.query(Certifier).filter_by(slug=certifier_slug).one_or_none()
    if certifier is None:
        certifier = Certifier(
            slug=certifier_slug,
            name_he=certifier_slug,
            type=CertifierType.BADATZ,
            is_active=certifier_active,
        )
        session.add(certifier)
        session.flush()
    restaurant = make_restaurant(session, **overrides)
    session.add(
        Certificate(
            restaurant_id=restaurant.id,
            certifier_id=certifier.id,
            level=CertificationLevel.UNKNOWN,
            attributes={},
            state=certificate_state,
            source=CertificateSource.OFFICIAL_LIST,
            corroboration_count=1,
            verified_at=dt.datetime.now(dt.UTC),
        )
    )
    session.flush()

    return restaurant


def sitemap_paths(client) -> list[str]:
    """Fetch the sitemap and return each ``<loc>`` as a path (origin stripped).

    Parameters:
        client: the test client.

    Return:
        list[str]: the paths, in document order.
    """
    text = client.get("/v1/sitemap.xml").text
    locs = text.split("<loc>")[1:]

    return ["/" + loc.split("</loc>")[0].split("/", 3)[3] for loc in locs]


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


def test_sitemap_origin_honours_trusted_vercel_forwarded_host(client, session) -> None:
    restaurant = make_restaurant(session)
    session.commit()

    response = client.get(
        "/v1/sitemap.xml",
        headers={"X-Forwarded-Host": "kashroot.vercel.app", "X-Forwarded-Proto": "https"},
    )

    assert f"https://kashroot.vercel.app/r/{restaurant.id}" in response.text


def test_sitemap_origin_ignores_spoofed_forwarded_host(client, session) -> None:
    """A forwarded host that does not end with a trusted suffix is ignored outright
    (fail closed) — the response falls back to the request's own base URL rather than
    trusting an attacker-controlled header, since the sitemap is cached by shared
    caches (see app.api.public_seo.resolve_public_web_origin).
    """
    restaurant = make_restaurant(session)
    session.commit()

    response = client.get(
        "/v1/sitemap.xml",
        headers={"X-Forwarded-Host": "evil.example", "X-Forwarded-Proto": "https"},
    )

    assert "evil.example" not in response.text
    assert f"/r/{restaurant.id}" in response.text
    assert "<loc>http" in response.text


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


def test_sitemap_origin_setting_wins_over_trusted_forwarded_host(
    client, session, monkeypatch
) -> None:
    """``settings.public_web_origin`` wins even over an otherwise-trusted
    ``*.vercel.app`` forwarded host."""
    monkeypatch.setattr(settings, "public_web_origin", "https://configured.example")
    restaurant = make_restaurant(session)
    session.commit()

    response = client.get(
        "/v1/sitemap.xml",
        headers={"X-Forwarded-Host": "kashroot.vercel.app", "X-Forwarded-Proto": "https"},
    )

    assert f"https://configured.example/r/{restaurant.id}" in response.text
    assert "kashroot.vercel.app" not in response.text


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


def test_sitemap_vary_header_on_forwarded_host(client, session) -> None:
    make_restaurant(session)
    session.commit()

    response = client.get("/v1/sitemap.xml")

    assert response.headers["vary"] == "X-Forwarded-Host"


def test_sitemap_directory_entries_and_order(client, session) -> None:
    first = make_covered_restaurant(session, "alef", city_slug="jerusalem")
    second = make_covered_restaurant(session, "bet", city_slug="jerusalem")
    third = make_covered_restaurant(session, "alef", city_he="חיפה", city_slug="haifa")
    session.commit()

    paths = sitemap_paths(client)

    assert paths[:8] == [
        "/",
        "/city/haifa",
        "/city/jerusalem",
        "/certifier/alef",
        "/certifier/bet",
        "/city/haifa/alef",
        "/city/jerusalem/alef",
        "/city/jerusalem/bet",
    ]
    assert {path for path in paths[8:]} == {f"/r/{r.id}" for r in (first, second, third)}
    assert len(paths) == 11


def test_sitemap_directory_entries_have_no_lastmod(client, session) -> None:
    make_covered_restaurant(session, "alef")
    session.commit()

    text = client.get("/v1/sitemap.xml").text
    directory_part = text.split("/r/")[0]

    assert "/city/jerusalem</loc></url>" in directory_part
    assert "/certifier/alef</loc></url>" in directory_part
    assert "<lastmod>" not in directory_part


def test_sitemap_skips_slugless_city_and_inactive_certifier_and_closed(client, session) -> None:
    make_covered_restaurant(session, "alef", city_slug=None, city_he=None)
    make_covered_restaurant(session, "old", certifier_active=False)
    make_covered_restaurant(session, "closed_only", status=RestaurantStatus.CLOSED_PERM)
    make_restaurant(session, city_slug="uncovered", city_he="בלי")
    session.commit()

    paths = sitemap_paths(client)

    assert "/certifier/alef" in paths
    assert "/city/jerusalem" in paths
    assert "/city/uncovered" in paths
    assert not any(path.startswith("/city/jerusalem/") for path in paths)
    assert not any("old" in path or "closed_only" in path for path in paths)
    assert "/city/uncovered/alef" not in paths


def test_sitemap_truncates_restaurants_not_directory_entries(client, session, monkeypatch) -> None:
    monkeypatch.setattr("app.api.public_seo.SITEMAP_MAX_URLS", 6)
    for _ in range(4):
        make_covered_restaurant(session, "alef")
    session.commit()

    paths = sitemap_paths(client)

    assert len(paths) == 6
    assert paths[:4] == ["/", "/city/jerusalem", "/certifier/alef", "/city/jerusalem/alef"]
    assert all(path.startswith("/r/") for path in paths[4:])


@pytest.mark.parametrize(
    "state", [CertificateState.REVOKED, CertificateState.EXPIRED, CertificateState.PENDING]
)
def test_sitemap_skips_certifier_pages_for_non_active_certificates(client, session, state) -> None:
    make_covered_restaurant(session, "alef", certificate_state=state)
    make_covered_restaurant(session, "bet", city_he="חיפה", city_slug="haifa")
    session.commit()

    paths = sitemap_paths(client)

    assert "/city/jerusalem" in paths
    assert "/certifier/bet" in paths
    assert "/city/haifa/bet" in paths
    assert "/certifier/alef" not in paths
    assert "/city/jerusalem/alef" not in paths


def test_sitemap_percent_encodes_slugs(client, session) -> None:
    make_covered_restaurant(session, "caf\u00e9 x", city_slug="tel aviv/1")
    session.commit()

    paths = sitemap_paths(client)

    assert "/city/tel%20aviv%2F1" in paths
    assert "/certifier/caf%C3%A9%20x" in paths
    assert "/city/tel%20aviv%2F1/caf%C3%A9%20x" in paths


def test_sitemap_over_cap_truncates_directory_entries_too(client, session, monkeypatch) -> None:
    monkeypatch.setattr("app.api.public_seo.SITEMAP_MAX_URLS", 3)
    for _ in range(3):
        make_covered_restaurant(session, "alef")
    session.commit()

    paths = sitemap_paths(client)

    assert paths == ["/", "/city/jerusalem", "/certifier/alef"]
