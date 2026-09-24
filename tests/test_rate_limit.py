"""Tests for the reusable per-IP rate limiter (``app.services.rate_limit``).

Two layers:

* Unit tests call the dependency function and the backends directly, with a fake
  ``Request`` built from a raw ASGI scope and an injectable clock, so the fixed
  window can be advanced deterministically without sleeping.
* One end-to-end test exercises the real anonymous upload endpoint through
  ``TestClient`` to confirm the dependency is actually wired in and returns 429 with
  a ``Retry-After`` header and ``detail: "rate_limited"``.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from starlette.requests import Request

from app.api.deps import get_media_storage
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
    Flag,
    RecordState,
    Restaurant,
    RestaurantStatus,
)
from app.services.notifications import get_email_sender
from app.services.rate_limit import (
    HybridRateLimitBackend,
    InMemoryRateLimitBackend,
    RateLimitRule,
    get_rate_limit_backend,
    rate_limiter,
)
from app.storage import InMemoryMediaStorage

JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 128


def make_request(
    client_host: str | None = "1.2.3.4", headers: dict[str, str] | None = None
) -> Request:
    scope = {
        "type": "http",
        "client": (client_host, 12345) if client_host is not None else None,
        "headers": [
            (name.lower().encode("latin-1"), value.encode("latin-1"))
            for name, value in (headers or {}).items()
        ],
    }
    return Request(scope)


# --------------------------------------------------------------------------- unit


def test_under_limit_allows_every_request() -> None:
    backend = InMemoryRateLimitBackend()
    dependency = rate_limiter("scope_a", lambda: [RateLimitRule(3, 60)])
    request = make_request()

    for _ in range(3):
        dependency(request, backend)


def test_over_limit_raises_429_with_retry_after() -> None:
    backend = InMemoryRateLimitBackend()
    dependency = rate_limiter("scope_b", lambda: [RateLimitRule(2, 60)])
    request = make_request()

    dependency(request, backend)
    dependency(request, backend)

    with pytest.raises(HTTPException) as exc_info:
        dependency(request, backend)

    assert exc_info.value.status_code == 429
    assert exc_info.value.detail == "rate_limited"
    retry_after = int(exc_info.value.headers["Retry-After"])
    assert 0 < retry_after <= 60


def test_separate_ips_counted_separately() -> None:
    backend = InMemoryRateLimitBackend()
    dependency = rate_limiter("scope_c", lambda: [RateLimitRule(1, 60)])

    dependency(make_request(client_host="1.1.1.1"), backend)
    dependency(make_request(client_host="2.2.2.2"), backend)

    with pytest.raises(HTTPException):
        dependency(make_request(client_host="1.1.1.1"), backend)

    with pytest.raises(HTTPException):
        dependency(make_request(client_host="2.2.2.2"), backend)


def test_x_forwarded_for_ignored_when_untrusted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "trust_proxy_headers", False)
    backend = InMemoryRateLimitBackend()
    dependency = rate_limiter("scope_d", lambda: [RateLimitRule(1, 60)])

    dependency(make_request(client_host="9.9.9.9", headers={"X-Forwarded-For": "1.1.1.1"}), backend)

    with pytest.raises(HTTPException):
        dependency(
            make_request(client_host="9.9.9.9", headers={"X-Forwarded-For": "5.5.5.5"}), backend
        )


def test_x_forwarded_for_first_hop_honored_when_trusted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "trust_proxy_headers", True)
    backend = InMemoryRateLimitBackend()
    dependency = rate_limiter("scope_e", lambda: [RateLimitRule(1, 60)])

    dependency(
        make_request(client_host="9.9.9.9", headers={"X-Forwarded-For": "1.1.1.1, 10.0.0.1"}),
        backend,
    )

    with pytest.raises(HTTPException):
        dependency(
            make_request(client_host="9.9.9.9", headers={"X-Forwarded-For": "1.1.1.1, 10.0.0.2"}),
            backend,
        )

    dependency(
        make_request(client_host="9.9.9.9", headers={"X-Forwarded-For": "2.2.2.2"}),
        backend,
    )


def test_window_resets_after_expiry() -> None:
    now = [1_000_000.0]
    backend = InMemoryRateLimitBackend(clock=lambda: now[0])
    dependency = rate_limiter("scope_f", lambda: [RateLimitRule(1, 60)])
    request = make_request()

    dependency(request, backend)

    with pytest.raises(HTTPException):
        dependency(request, backend)

    now[0] += 61

    dependency(request, backend)


def test_redis_error_falls_back_to_memory() -> None:
    class ExplodingBackend:
        def incr(self, key: str, window_seconds: int) -> tuple[int, int]:
            raise ConnectionError("redis is down")

    fallback = InMemoryRateLimitBackend()
    hybrid = HybridRateLimitBackend(primary=ExplodingBackend(), fallback=fallback)
    dependency = rate_limiter("scope_g", lambda: [RateLimitRule(1, 60)])
    request = make_request()

    dependency(request, hybrid)

    with pytest.raises(HTTPException):
        dependency(request, hybrid)


def test_no_primary_backend_uses_fallback_directly() -> None:
    fallback = InMemoryRateLimitBackend()
    hybrid = HybridRateLimitBackend(primary=None, fallback=fallback)

    count, retry_after = hybrid.incr("k", 60)

    assert count == 1
    assert retry_after > 0


# ---------------------------------------------------------------------- end-to-end


@pytest.fixture
def storage() -> InMemoryMediaStorage:
    return InMemoryMediaStorage()


@pytest.fixture
def client(session, monkeypatch: pytest.MonkeyPatch, storage: InMemoryMediaStorage):
    monkeypatch.setattr(settings, "photo_upload_rate_limit_per_hour", 2)
    monkeypatch.setattr(settings, "photo_upload_rate_limit_per_day", 100)
    app = create_app()

    def _override_session():
        yield session
        session.commit()

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_media_storage] = lambda: storage
    rate_limit_backend = InMemoryRateLimitBackend()
    app.dependency_overrides[get_rate_limit_backend] = lambda: rate_limit_backend
    with TestClient(app) as test_client:
        yield test_client


def make_cert_chain(session):
    certifier = Certifier(
        slug=f"certifier_{uuid.uuid4().hex[:8]}",
        name_he='בד"ץ בדיקה',
        name_en="Badatz Test",
        type=CertifierType.BADATZ,
        is_active=True,
    )
    session.add(certifier)
    session.flush()

    restaurant = Restaurant(
        dedupe_key=f"test:{uuid.uuid4().hex}",
        name_he="מסעדת בדיקה",
        city_he="ירושלים",
        city_slug="jerusalem",
        record_state=RecordState.LIST_VERIFIED,
        needs_review=False,
        corroboration_count=1,
        status=RestaurantStatus.OPEN,
        amenities={},
    )
    session.add(restaurant)
    session.flush()

    certificate = Certificate(
        restaurant_id=restaurant.id,
        certifier_id=certifier.id,
        level=CertificationLevel.UNKNOWN,
        attributes={},
        state=CertificateState.ACTIVE,
        source=CertificateSource.OFFICIAL_LIST,
        corroboration_count=1,
    )
    session.add(certificate)
    session.flush()

    return restaurant, certificate


def upload(client: TestClient, restaurant_id, certificate_id, *, filename: str = "certificate.jpg"):
    return client.post(
        f"/v1/restaurants/{restaurant_id}/certificate-photo",
        data={"certificate_id": str(certificate_id)},
        files={"file": (filename, JPEG_BYTES, "image/jpeg")},
    )


def test_endpoint_allows_up_to_the_configured_limit(client: TestClient, session) -> None:
    restaurant, certificate = make_cert_chain(session)

    response = upload(client, restaurant.id, certificate.id)

    assert response.status_code == 201


def test_endpoint_returns_429_over_the_configured_limit(client: TestClient, session) -> None:
    restaurant, certificate = make_cert_chain(session)
    first = upload(client, restaurant.id, certificate.id)
    assert first.status_code == 201

    second_restaurant, second_certificate = make_cert_chain(session)
    second = upload(client, second_restaurant.id, second_certificate.id, filename="two.jpg")
    assert second.status_code == 201

    third_restaurant, third_certificate = make_cert_chain(session)
    third = upload(client, third_restaurant.id, third_certificate.id, filename="three.jpg")

    assert third.status_code == 429
    assert third.json()["detail"] == "rate_limited"
    assert int(third.headers["Retry-After"]) > 0


def test_endpoint_counts_a_rejected_oversize_upload(client: TestClient, session) -> None:
    from app.api.admin.consts import MAX_PHOTO_BYTES

    restaurant, certificate = make_cert_chain(session)
    oversize = b"\xff\xd8\xff\xe0" + b"\x00" * (MAX_PHOTO_BYTES + 1)

    first = client.post(
        f"/v1/restaurants/{restaurant.id}/certificate-photo",
        data={"certificate_id": str(certificate.id)},
        files={"file": ("big.jpg", oversize, "image/jpeg")},
    )
    assert first.status_code == 413

    second = client.post(
        f"/v1/restaurants/{restaurant.id}/certificate-photo",
        data={"certificate_id": str(certificate.id)},
        files={"file": ("big2.jpg", oversize, "image/jpeg")},
    )
    assert second.status_code == 413

    third = upload(client, restaurant.id, certificate.id, filename="third.jpg")

    assert third.status_code == 429


# ------------------------------------------------------------- flag report, end-to-end


class RecordingSender:
    """A fake :class:`EmailSender` that records every call it receives, so a test can
    assert none happened when a report is rejected for being over the rate limit.
    """

    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def send(self, *, to, subject, html_body, text_body) -> None:  # noqa: ANN001
        self.calls.append({"to": list(to)})


@pytest.fixture
def recording_sender() -> RecordingSender:
    return RecordingSender()


@pytest.fixture
def flag_client(
    session, monkeypatch: pytest.MonkeyPatch, storage: InMemoryMediaStorage, recording_sender
):
    monkeypatch.setattr(settings, "flag_report_rate_limit_per_hour", 2)
    monkeypatch.setattr(settings, "flag_report_rate_limit_per_day", 100)
    monkeypatch.setattr(settings, "resend_api_key", "re_test_key")
    monkeypatch.setattr(settings, "report_email_from", "reports@kashroot.example")
    monkeypatch.setattr(settings, "report_email_to", "mod1@example.com")
    app = create_app()

    def _override_session():
        yield session
        session.commit()

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_media_storage] = lambda: storage
    app.dependency_overrides[get_email_sender] = lambda: recording_sender
    rate_limit_backend = InMemoryRateLimitBackend()
    app.dependency_overrides[get_rate_limit_backend] = lambda: rate_limit_backend
    with TestClient(app) as test_client:
        yield test_client


def report_flag(client: TestClient, restaurant_id) -> object:
    return client.post(f"/v1/restaurants/{restaurant_id}/flags", json={"type": "other"})


def test_flag_report_allows_up_to_the_configured_limit(flag_client: TestClient, session) -> None:
    restaurant, _ = make_cert_chain(session)

    response = report_flag(flag_client, restaurant.id)

    assert response.status_code == 201


def test_flag_report_returns_429_over_the_configured_limit(
    flag_client: TestClient, session, recording_sender
) -> None:
    restaurant, _ = make_cert_chain(session)

    first = report_flag(flag_client, restaurant.id)
    assert first.status_code == 201
    second = report_flag(flag_client, restaurant.id)
    assert second.status_code == 201

    before_flag_count = len(session.scalars(select(Flag)).all())
    third = report_flag(flag_client, restaurant.id)

    assert third.status_code == 429
    assert third.json()["detail"] == "rate_limited"
    assert int(third.headers["Retry-After"]) > 0

    # Rejected before the body ran: no Flag row was created, and the endpoint's own
    # email queueing never happened (the two accepted reports above already sent to
    # the same recording sender, so the count staying flat over the third call is the
    # meaningful assertion here).
    assert len(session.scalars(select(Flag)).all()) == before_flag_count
    assert len(recording_sender.calls) == 2


def test_flag_report_and_photo_upload_have_independent_counters(
    flag_client: TestClient, session
) -> None:
    restaurant, certificate = make_cert_chain(session)

    for _ in range(2):
        assert report_flag(flag_client, restaurant.id).status_code == 201

    # The flag-report limit (2/hour) is now exhausted, but the upload endpoint's own
    # counter (a much higher default in this fixture's settings) is untouched.
    upload_response = upload(flag_client, restaurant.id, certificate.id)
    assert upload_response.status_code == 201

    over_limit = report_flag(flag_client, restaurant.id)
    assert over_limit.status_code == 429
