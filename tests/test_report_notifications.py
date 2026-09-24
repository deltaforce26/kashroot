"""Report-flag email notifications (``app.services.notifications``).

Covers the router wiring (``POST /v1/restaurants/{id}/flags`` queues exactly one
send, via a fake sender override, with HTML-escaped user content) and the
``ResendEmailSender`` HTTP request shape in isolation (a mocked client, no network).
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

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
    RecordState,
    Restaurant,
    RestaurantStatus,
)
from app.services.notifications import (
    EmailSender,
    ResendEmailSender,
    build_flag_report_email,
    get_email_sender,
    log_email_configuration_status,
    notify_flag_created,
    notify_photo_uploaded,
    parse_recipients,
)
from app.services.notifications_consts import (
    ENV_VAR_REPORT_EMAIL_FROM,
    ENV_VAR_REPORT_EMAIL_TO,
    ENV_VAR_RESEND_API_KEY,
)
from app.services.rate_limit import InMemoryRateLimitBackend, get_rate_limit_backend
from app.storage import InMemoryMediaStorage

JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 128
PDF_BYTES = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n" + b"0" * 128

# ------------------------------------------------------------------------ fixtures


class RecordingSender:
    """A fake :class:`EmailSender` that records every call it receives."""

    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def send(self, *, to, subject, html_body, text_body) -> None:  # noqa: ANN001
        self.calls.append(
            {"to": list(to), "subject": subject, "html_body": html_body, "text_body": text_body}
        )


class RaisingSender:
    """A fake :class:`EmailSender` whose ``send`` always raises."""

    def send(self, *, to, subject, html_body, text_body) -> None:  # noqa: ANN001
        raise RuntimeError("resend is down")


@pytest.fixture
def recording_sender() -> RecordingSender:
    return RecordingSender()


@pytest.fixture
def client(session, monkeypatch, recording_sender):
    monkeypatch.setattr(settings, "admin_api_tokens", {})
    app = create_app()

    def _override_session():
        yield session
        session.commit()

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_media_storage] = lambda: InMemoryMediaStorage()
    app.dependency_overrides[get_email_sender] = lambda: recording_sender
    # A fresh, unshared backend per test — see tests/test_public_photo_flow.py's
    # client fixture for why (this module's tests share a TestClient host too and
    # would otherwise trip the real per-IP flag-report defaults across tests).
    app.dependency_overrides[get_rate_limit_backend] = lambda: InMemoryRateLimitBackend()
    with TestClient(app) as test_client:
        yield test_client


def make_certifier(session: Session) -> Certifier:
    certifier = Certifier(
        slug=f"certifier_{uuid.uuid4().hex[:8]}",
        name_he='בד"ץ בדיקה',
        name_en="Badatz Test",
        type=CertifierType.BADATZ,
        is_active=True,
    )
    session.add(certifier)
    session.flush()
    return certifier


def make_restaurant(session: Session) -> Restaurant:
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
    return restaurant


def make_certificate(session: Session, restaurant: Restaurant, certifier: Certifier) -> Certificate:
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
    return certificate


def make_cert_chain(session: Session) -> tuple[Restaurant, Certificate]:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    certificate = make_certificate(session, restaurant, certifier)
    return restaurant, certificate


# ---------------------------------------------------------------- router wiring


def test_report_sends_one_email_with_expected_fields(
    client, session, recording_sender, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "resend_api_key", "re_test_key")
    monkeypatch.setattr(settings, "report_email_from", "reports@kashroot.example")
    monkeypatch.setattr(settings, "report_email_to", "mod1@example.com, mod2@example.com")
    monkeypatch.setattr(settings, "admin_base_url", "https://admin.kashroot.example")

    restaurant, certificate = make_cert_chain(session)

    response = client.post(
        f"/v1/restaurants/{restaurant.id}/flags",
        json={
            "type": "no_certificate_displayed",
            "certificate_id": str(certificate.id),
            "message": "couldn't find the sign",
        },
    )
    assert response.status_code == 201
    flag_id = response.json()["flag_id"]

    assert len(recording_sender.calls) == 1
    call = recording_sender.calls[0]
    assert call["to"] == ["mod1@example.com", "mod2@example.com"]
    assert "no_certificate_displayed" in call["subject"]
    assert restaurant.name_he in call["subject"]
    assert flag_id in call["html_body"]
    assert certificate.id.hex in call["html_body"].replace("-", "")
    assert "couldn&#x27;t find the sign" in call["html_body"]
    assert "https://admin.kashroot.example/flags?flag_id=" in call["html_body"]
    assert "couldn't find the sign" in call["text_body"]


def test_report_html_escapes_the_message(client, session, recording_sender, monkeypatch) -> None:
    monkeypatch.setattr(settings, "resend_api_key", "re_test_key")
    monkeypatch.setattr(settings, "report_email_from", "reports@kashroot.example")
    monkeypatch.setattr(settings, "report_email_to", "mod1@example.com")

    restaurant, _ = make_cert_chain(session)

    response = client.post(
        f"/v1/restaurants/{restaurant.id}/flags",
        json={"type": "other", "message": "<script>alert('x')</script> & co"},
    )
    assert response.status_code == 201

    html_body = recording_sender.calls[0]["html_body"]
    assert "<script>alert" not in html_body
    assert "&lt;script&gt;" in html_body
    assert "&amp; co" in html_body


def test_unconfigured_settings_send_no_email_and_still_201(
    client, session, recording_sender
) -> None:
    restaurant, _ = make_cert_chain(session)

    response = client.post(
        f"/v1/restaurants/{restaurant.id}/flags",
        json={"type": "other"},
    )
    assert response.status_code == 201
    assert recording_sender.calls == []


def test_sender_raising_still_returns_201_and_persists_flag(client, session, monkeypatch) -> None:
    monkeypatch.setattr(settings, "resend_api_key", "re_test_key")
    monkeypatch.setattr(settings, "report_email_from", "reports@kashroot.example")
    monkeypatch.setattr(settings, "report_email_to", "mod1@example.com")
    client.app.dependency_overrides[get_email_sender] = lambda: RaisingSender()

    restaurant, _ = make_cert_chain(session)

    response = client.post(
        f"/v1/restaurants/{restaurant.id}/flags",
        json={"type": "other", "message": "still works"},
    )
    assert response.status_code == 201
    flag_id = uuid.UUID(response.json()["flag_id"])

    from app.models import Flag

    flag = session.get(Flag, flag_id)
    assert flag is not None
    assert flag.message == "still works"


# ---------------------------------------------------------- certificate photo upload


def test_photo_upload_sends_one_email_with_expected_fields(
    client, session, recording_sender, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "resend_api_key", "re_test_key")
    monkeypatch.setattr(settings, "report_email_from", "reports@kashroot.example")
    monkeypatch.setattr(settings, "report_email_to", "mod1@example.com")
    monkeypatch.setattr(settings, "admin_base_url", "https://admin.kashroot.example")

    restaurant, certificate = make_cert_chain(session)

    response = client.post(
        f"/v1/restaurants/{restaurant.id}/certificate-photo",
        data={"certificate_id": str(certificate.id)},
        files={"file": ("photo.jpg", JPEG_BYTES, "image/jpeg")},
    )
    assert response.status_code == 201
    photo_id = response.json()["photo_id"]

    assert len(recording_sender.calls) == 1
    call = recording_sender.calls[0]
    assert call["to"] == ["mod1@example.com"]
    assert "pending review" in call["subject"]
    assert restaurant.name_he in call["subject"]
    assert photo_id in call["html_body"]
    assert certificate.id.hex in call["html_body"].replace("-", "")
    assert "image/jpeg" in call["html_body"]
    assert "https://admin.kashroot.example/photos?photo_id=" in call["html_body"]
    assert photo_id in call["text_body"]


def test_photo_upload_conflict_sends_no_email(
    client, session, recording_sender, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "resend_api_key", "re_test_key")
    monkeypatch.setattr(settings, "report_email_from", "reports@kashroot.example")
    monkeypatch.setattr(settings, "report_email_to", "mod1@example.com")

    restaurant, certificate = make_cert_chain(session)
    certificate.evidence_photo_key = "cert-evidence/already-accepted.jpg"
    session.flush()

    response = client.post(
        f"/v1/restaurants/{restaurant.id}/certificate-photo",
        data={"certificate_id": str(certificate.id)},
        files={"file": ("photo.jpg", JPEG_BYTES, "image/jpeg")},
    )
    assert response.status_code == 409
    assert recording_sender.calls == []


def test_photo_upload_unsupported_media_type_sends_no_email(
    client, session, recording_sender, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "resend_api_key", "re_test_key")
    monkeypatch.setattr(settings, "report_email_from", "reports@kashroot.example")
    monkeypatch.setattr(settings, "report_email_to", "mod1@example.com")

    restaurant, certificate = make_cert_chain(session)

    response = client.post(
        f"/v1/restaurants/{restaurant.id}/certificate-photo",
        data={"certificate_id": str(certificate.id)},
        files={"file": ("scan.pdf", PDF_BYTES, "application/pdf")},
    )
    assert response.status_code == 415
    assert recording_sender.calls == []


def test_photo_upload_rate_limited_sends_no_email(
    client, session, recording_sender, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "resend_api_key", "re_test_key")
    monkeypatch.setattr(settings, "report_email_from", "reports@kashroot.example")
    monkeypatch.setattr(settings, "report_email_to", "mod1@example.com")
    monkeypatch.setattr(settings, "photo_upload_rate_limit_per_hour", 0)

    restaurant, certificate = make_cert_chain(session)

    response = client.post(
        f"/v1/restaurants/{restaurant.id}/certificate-photo",
        data={"certificate_id": str(certificate.id)},
        files={"file": ("photo.jpg", JPEG_BYTES, "image/jpeg")},
    )
    assert response.status_code == 429
    assert recording_sender.calls == []


def test_photo_upload_sender_raising_still_returns_201(client, session, monkeypatch) -> None:
    monkeypatch.setattr(settings, "resend_api_key", "re_test_key")
    monkeypatch.setattr(settings, "report_email_from", "reports@kashroot.example")
    monkeypatch.setattr(settings, "report_email_to", "mod1@example.com")
    client.app.dependency_overrides[get_email_sender] = lambda: RaisingSender()

    restaurant, certificate = make_cert_chain(session)

    response = client.post(
        f"/v1/restaurants/{restaurant.id}/certificate-photo",
        data={"certificate_id": str(certificate.id)},
        files={"file": ("photo.jpg", JPEG_BYTES, "image/jpeg")},
    )
    assert response.status_code == 201

    from app.models import CertificateEvidencePhoto

    photo_id = uuid.UUID(response.json()["photo_id"])
    photo = session.get(CertificateEvidencePhoto, photo_id)
    assert photo is not None


# ------------------------------------------------------------------- notify_flag_created


def test_notify_flag_created_no_recipients_is_a_noop() -> None:
    sender = RecordingSender()
    notify_flag_created(
        sender,
        to=[],
        restaurant_id=uuid.uuid4(),
        restaurant_name="Test",
        flag_id=uuid.uuid4(),
        flag_type="other",
        message=None,
        certificate_id=None,
        certifier_name=None,
        created_at=dt.datetime.now(dt.UTC),
        admin_base_url=None,
    )
    assert sender.calls == []


def test_notify_flag_created_swallows_sender_errors() -> None:
    notify_flag_created(
        RaisingSender(),
        to=["mod@example.com"],
        restaurant_id=uuid.uuid4(),
        restaurant_name="Test",
        flag_id=uuid.uuid4(),
        flag_type="other",
        message=None,
        certificate_id=None,
        certifier_name=None,
        created_at=dt.datetime.now(dt.UTC),
        admin_base_url=None,
    )


# ---------------------------------------------------------------- notify_photo_uploaded


def test_notify_photo_uploaded_no_recipients_is_a_noop() -> None:
    sender = RecordingSender()
    notify_photo_uploaded(
        sender,
        to=[],
        restaurant_id=uuid.uuid4(),
        restaurant_name="Test",
        certificate_id=uuid.uuid4(),
        certifier_name="Badatz Test",
        photo_id=uuid.uuid4(),
        content_type="image/jpeg",
        size_bytes=1024,
        uploaded_at=dt.datetime.now(dt.UTC),
        admin_base_url=None,
    )
    assert sender.calls == []


def test_notify_photo_uploaded_swallows_sender_errors() -> None:
    notify_photo_uploaded(
        RaisingSender(),
        to=["mod@example.com"],
        restaurant_id=uuid.uuid4(),
        restaurant_name="Test",
        certificate_id=uuid.uuid4(),
        certifier_name="Badatz Test",
        photo_id=uuid.uuid4(),
        content_type="image/jpeg",
        size_bytes=1024,
        uploaded_at=dt.datetime.now(dt.UTC),
        admin_base_url=None,
    )


# ------------------------------------------------------------------------ helpers


def test_parse_recipients_trims_and_drops_blanks() -> None:
    assert parse_recipients(" a@example.com ,, b@example.com,") == [
        "a@example.com",
        "b@example.com",
    ]
    assert parse_recipients(None) == []
    assert parse_recipients("") == []


def test_build_flag_report_email_without_certificate() -> None:
    subject, html_body, text_body = build_flag_report_email(
        restaurant_id=uuid.uuid4(),
        restaurant_name="Cafe X",
        flag_id=uuid.uuid4(),
        flag_type="closed",
        message=None,
        certificate_id=None,
        certifier_name=None,
        created_at=dt.datetime(2026, 1, 1, tzinfo=dt.UTC),
        admin_base_url=None,
    )
    assert "closed" in subject
    assert "Cafe X" in subject
    assert "no certificate selected" in html_body
    assert "no message provided" in text_body


# ------------------------------------------------------------------- ResendEmailSender


def test_resend_sender_builds_correct_request() -> None:
    fake_client = MagicMock()
    fake_client.post.return_value.raise_for_status.return_value = None

    sender: EmailSender = ResendEmailSender(
        api_key="re_secret",
        from_address="reports@kashroot.example",
        client=fake_client,
    )
    sender.send(
        to=["mod@example.com"],
        subject="[Kashroot] New report: other — Cafe X",
        html_body="<p>hi</p>",
        text_body="hi",
    )

    fake_client.post.assert_called_once()
    args, kwargs = fake_client.post.call_args
    assert args[0] == "https://api.resend.com/emails"
    assert kwargs["headers"]["Authorization"] == "Bearer re_secret"
    assert kwargs["json"] == {
        "from": "reports@kashroot.example",
        "to": ["mod@example.com"],
        "subject": "[Kashroot] New report: other — Cafe X",
        "html": "<p>hi</p>",
        "text": "hi",
    }
    fake_client.post.return_value.raise_for_status.assert_called_once()


def test_resend_sender_raises_on_error_response() -> None:
    fake_client = MagicMock()
    fake_client.post.return_value.raise_for_status.side_effect = RuntimeError("boom")

    sender = ResendEmailSender(api_key="k", from_address="f@example.com", client=fake_client)
    with pytest.raises(RuntimeError):
        sender.send(to=["a@example.com"], subject="s", html_body="h", text_body="t")


# ------------------------------------------------------------- startup logging


def test_log_email_configuration_status_configured_logs_one_warning(monkeypatch, caplog) -> None:
    monkeypatch.setattr(settings, "resend_api_key", "re_super_secret_key")
    monkeypatch.setattr(settings, "report_email_from", "reports@kashroot.example")
    monkeypatch.setattr(settings, "report_email_to", "mod1@example.com, mod2@example.com")

    with caplog.at_level(logging.WARNING, logger="app"):
        log_email_configuration_status()

    records = [r for r in caplog.records if r.name == "app.services.notifications"]
    assert len(records) == 1
    assert records[0].levelno == logging.WARNING
    message = records[0].getMessage()
    assert "reports@kashroot.example" in message
    assert "2" in message
    assert "re_super_secret_key" not in message


def test_log_email_configuration_status_missing_vars_names_each_one(monkeypatch, caplog) -> None:
    monkeypatch.setattr(settings, "resend_api_key", None)
    monkeypatch.setattr(settings, "report_email_from", "reports@kashroot.example")
    monkeypatch.setattr(settings, "report_email_to", "")

    with caplog.at_level(logging.WARNING, logger="app"):
        log_email_configuration_status()

    records = [r for r in caplog.records if r.name == "app.services.notifications"]
    assert len(records) == 1
    assert records[0].levelno == logging.WARNING
    message = records[0].getMessage()
    assert ENV_VAR_RESEND_API_KEY in message
    assert ENV_VAR_REPORT_EMAIL_TO in message
    assert ENV_VAR_REPORT_EMAIL_FROM not in message


def test_send_failure_logs_resend_status_and_truncated_body(caplog) -> None:
    request = httpx.Request("POST", "https://api.resend.com/emails")
    response = httpx.Response(
        403,
        text='{"message": "domain not verified"}',
        request=request,
    )
    fake_client = MagicMock()
    fake_client.post.return_value = response

    sender = ResendEmailSender(
        api_key="re_super_secret_key",
        from_address="reports@kashroot.example",
        client=fake_client,
    )

    with caplog.at_level(logging.WARNING, logger="app"):
        notify_flag_created(
            sender,
            to=["mod@example.com"],
            restaurant_id=uuid.uuid4(),
            restaurant_name="Test",
            flag_id=uuid.uuid4(),
            flag_type="other",
            message=None,
            certificate_id=None,
            certifier_name=None,
            created_at=dt.datetime.now(dt.UTC),
            admin_base_url=None,
        )

    records = [r for r in caplog.records if r.name == "app.services.notifications"]
    assert len(records) == 1
    message = records[0].getMessage()
    assert "403" in message
    assert "domain not verified" in message
    assert "re_super_secret_key" not in message


def test_api_key_never_appears_in_any_log_record(monkeypatch, caplog) -> None:
    secret_key = "re_never_leak_this_key"
    monkeypatch.setattr(settings, "resend_api_key", secret_key)
    monkeypatch.setattr(settings, "report_email_from", "reports@kashroot.example")
    monkeypatch.setattr(settings, "report_email_to", "mod1@example.com")

    request = httpx.Request("POST", "https://api.resend.com/emails")
    response = httpx.Response(403, text="domain not verified", request=request)
    fake_client = MagicMock()
    fake_client.post.return_value = response
    sender = ResendEmailSender(
        api_key=secret_key,
        from_address="reports@kashroot.example",
        client=fake_client,
    )

    with caplog.at_level(logging.DEBUG):
        log_email_configuration_status()
        notify_flag_created(
            sender,
            to=["mod1@example.com"],
            restaurant_id=uuid.uuid4(),
            restaurant_name="Test",
            flag_id=uuid.uuid4(),
            flag_type="other",
            message=None,
            certificate_id=None,
            certifier_name=None,
            created_at=dt.datetime.now(dt.UTC),
            admin_base_url=None,
        )

    for record in caplog.records:
        assert secret_key not in record.getMessage()
