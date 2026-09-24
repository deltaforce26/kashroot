"""Instant email notifications for public community activity.

Two ``app.api.public_photos`` endpoints each send one transactional email through
Resend (https://resend.com) after their row is committed, via ``BackgroundTasks`` —
a send failure or slow network call must never fail or delay the response (PRD §13
fail-safe: the request itself already succeeded once its row exists):
``POST /v1/restaurants/{id}/flags`` (``create_public_flag``) and
``POST /v1/restaurants/{id}/certificate-photo`` (``upload_public_certificate_photo``,
success only — a rate-limited, rejected or failed upload sends nothing). Admin/
moderator uploads (``app.api.admin.photos``) send no email.

Sender abstraction: :class:`EmailSender` is the interface the router depends on
(:func:`get_email_sender`, overridable in tests); :class:`ResendEmailSender` is the
real implementation and :class:`NullSender` is the silent no-op used whenever Resend
is not configured, so dev/tests run unconfigured with no code branching in the
router. The unconfigured-vs-configured choice is made once, at sender construction
(:func:`_default_email_sender` is process-lifetime cached), and logged once there —
never per request.
"""

from __future__ import annotations

import datetime as dt
import html
import logging
import uuid
from collections.abc import Sequence
from functools import lru_cache
from typing import Protocol

import httpx

from app.core.config import Settings, settings
from app.services.notifications_consts import (
    ADMIN_FLAGS_QUEUE_PATH,
    ADMIN_PHOTOS_QUEUE_PATH,
    APP_LOGGER_NAME,
    DEFAULT_RESEND_TIMEOUT_SECONDS,
    EMAIL_NO_CERTIFICATE_PLACEHOLDER,
    EMAIL_NO_MESSAGE_PLACEHOLDER,
    EMAIL_PHOTO_SUBJECT_TEMPLATE,
    EMAIL_SUBJECT_TEMPLATE,
    EMAIL_UNKNOWN_CERTIFIER_PLACEHOLDER,
    ENV_VAR_REPORT_EMAIL_FROM,
    ENV_VAR_REPORT_EMAIL_TO,
    ENV_VAR_RESEND_API_KEY,
    LOG_EMAIL_CONFIGURED_AT_STARTUP,
    LOG_EMAIL_NOT_CONFIGURED_AT_STARTUP,
    LOG_EMAIL_SEND_FAILED,
    LOG_EMAIL_SEND_FAILED_WITH_RESEND_DETAIL,
    LOG_EMAIL_SEND_SKIPPED_NO_RECIPIENTS,
    LOG_EMAIL_SENDER_UNCONFIGURED,
    LOG_LABEL_CERTIFICATE_PHOTO,
    LOG_LABEL_FLAG_REPORT,
    RESEND_API_URL,
    RESEND_ERROR_BODY_TRUNCATE_LENGTH,
)

logger = logging.getLogger(__name__)


class EmailSender(Protocol):
    """Anything that can deliver one HTML+text email to a fixed set of recipients."""

    def send(self, *, to: Sequence[str], subject: str, html_body: str, text_body: str) -> None:
        """
        Deliver one email.

        Parameters:
            to (Sequence[str]): Recipient addresses.
            subject (str): The email subject line.
            html_body (str): The HTML body part.
            text_body (str): The plain-text body part.

        Return:
            None
        """
        ...


class NullSender:
    """No-op sender used whenever Resend is not configured (missing API key or
    recipients) — dev environments and the test suite run unconfigured by default.
    """

    def send(self, *, to: Sequence[str], subject: str, html_body: str, text_body: str) -> None:
        """
        Do nothing.

        Parameters:
            to (Sequence[str]): Ignored.
            subject (str): Ignored.
            html_body (str): Ignored.
            text_body (str): Ignored.

        Return:
            None
        """

        return


class ResendEmailSender:
    """Sends one transactional email through the Resend REST API
    (``POST https://api.resend.com/emails``).
    """

    def __init__(
        self,
        api_key: str,
        from_address: str,
        client: httpx.Client | None = None,
        timeout: float = DEFAULT_RESEND_TIMEOUT_SECONDS,
    ) -> None:
        """
        Build a Resend-backed sender.

        Parameters:
            api_key (str): The Resend API key (``KASHROOT_RESEND_API_KEY``), sent as
                a bearer token.
            from_address (str): The verified Resend "from" address
                (``KASHROOT_REPORT_EMAIL_FROM``).
            client (httpx.Client | None): An HTTP client to reuse; a caller-supplied
                fake in tests avoids any real network call. Defaults to a private
                client with ``timeout`` applied.
            timeout (float): Request timeout in seconds, used only when ``client`` is
                not supplied.

        Return:
            None
        """
        self._api_key = api_key
        self._from_address = from_address
        self._client = client if client is not None else httpx.Client(timeout=timeout)

    def send(self, *, to: Sequence[str], subject: str, html_body: str, text_body: str) -> None:
        """
        POST the email to Resend and raise on a non-2xx response.

        Parameters:
            to (Sequence[str]): Recipient addresses.
            subject (str): The email subject line.
            html_body (str): The HTML body part.
            text_body (str): The plain-text body part.

        Return:
            None
        """
        response = self._client.post(
            RESEND_API_URL,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            json={
                "from": self._from_address,
                "to": list(to),
                "subject": subject,
                "html": html_body,
                "text": text_body,
            },
        )
        response.raise_for_status()


def parse_recipients(raw: str | None) -> list[str]:
    """
    Parse ``KASHROOT_REPORT_EMAIL_TO`` into a clean recipient list.

    Parameters:
        raw (str | None): The comma-separated setting value, e.g.
            ``"a@example.com, b@example.com"``.

    Return:
        list[str]: Trimmed, non-empty addresses in the given order.
    """
    if not raw:
        return []

    return [address.strip() for address in raw.split(",") if address.strip()]


def _resend_is_configured(config: Settings) -> bool:
    """
    Judge whether enough is configured to attempt a real send.

    Parameters:
        config (Settings): The settings to read.

    Return:
        bool: True when an API key, a from-address and at least one recipient are
            all present.
    """
    return bool(
        config.resend_api_key
        and config.report_email_from
        and parse_recipients(config.report_email_to)
    )


def _missing_email_env_vars(config: Settings) -> list[str]:
    """
    List which of the three required Resend env vars are missing or empty.

    Parameters:
        config (Settings): The settings to read.

    Return:
        list[str]: The env var names (``KASHROOT_RESEND_API_KEY``,
            ``KASHROOT_REPORT_EMAIL_FROM``, ``KASHROOT_REPORT_EMAIL_TO``) that are
            missing or empty, in that fixed order; empty when all are present.
    """
    missing: list[str] = []

    if not config.resend_api_key:
        missing.append(ENV_VAR_RESEND_API_KEY)

    if not config.report_email_from:
        missing.append(ENV_VAR_REPORT_EMAIL_FROM)

    if not parse_recipients(config.report_email_to):
        missing.append(ENV_VAR_REPORT_EMAIL_TO)

    return missing


def ensure_app_logger_visible() -> None:
    """
    Attach a ``StreamHandler`` to the ``app`` logger, once, so WARNING+ records from
    every ``app.*`` module reach the process's stderr under uvicorn on Render.

    Idempotent and safe to call repeatedly (tests build the FastAPI app many times):
    it is a no-op once the ``app`` logger already has a handler, so output is never
    duplicated. Does not disable propagation, so ``caplog``/``pytest`` handlers on
    the root logger keep seeing the same records.

    Return:
        None
    """
    app_logger = logging.getLogger(APP_LOGGER_NAME)

    if app_logger.handlers:
        return

    app_logger.addHandler(logging.StreamHandler())
    app_logger.setLevel(logging.WARNING)


def log_email_configuration_status() -> None:
    """
    Log, once at application startup, whether report-flag email is configured —
    at WARNING, since Render's default uvicorn output does not show INFO. Never
    logs the Resend API key itself.

    Meant to be called from ``app.main``'s startup/lifespan hook.

    Return:
        None
    """
    ensure_app_logger_visible()
    missing = _missing_email_env_vars(settings)

    if missing:
        logger.warning(LOG_EMAIL_NOT_CONFIGURED_AT_STARTUP, ", ".join(missing))

        return

    recipient_count = len(parse_recipients(settings.report_email_to))
    logger.warning(LOG_EMAIL_CONFIGURED_AT_STARTUP, settings.report_email_from, recipient_count)


@lru_cache
def _default_email_sender() -> EmailSender:
    """
    Build the process-lifetime default sender from the global settings, logging the
    unconfigured state exactly once.

    Return:
        EmailSender: A :class:`ResendEmailSender` when configured, else
            :class:`NullSender`.
    """
    if _resend_is_configured(settings):
        return ResendEmailSender(
            api_key=settings.resend_api_key or "",
            from_address=settings.report_email_from or "",
        )

    logger.info(LOG_EMAIL_SENDER_UNCONFIGURED)

    return NullSender()


def get_email_sender() -> EmailSender:
    """FastAPI dependency for the report-notification email sender. Tests override
    this with a fake (``app.dependency_overrides[get_email_sender]``) to assert on
    calls with no network access.

    Return:
        EmailSender: The process-lifetime default sender.
    """
    return _default_email_sender()


def _admin_console_link(
    admin_base_url: str | None, queue_path: str, query_param: str, entity_id: uuid.UUID
) -> str | None:
    """
    Build a link to one moderation-console queue for one entity, when a base URL is
    configured.

    Parameters:
        admin_base_url (str | None): ``KASHROOT_ADMIN_BASE_URL``, or None.
        queue_path (str): The queue's path, e.g. ``ADMIN_FLAGS_QUEUE_PATH``.
        query_param (str): The query-string key identifying the entity, e.g.
            ``"flag_id"``.
        entity_id (uuid.UUID): The entity to deep-link to.

    Return:
        str | None: The link, or None when no base URL is configured.
    """
    if not admin_base_url:
        return None

    return f"{admin_base_url.rstrip('/')}{queue_path}?{query_param}={entity_id}"


def _admin_flags_link(admin_base_url: str | None, flag_id: uuid.UUID) -> str | None:
    """
    Build a link to the moderation console's flag queue for one flag, when a base
    URL is configured.

    Parameters:
        admin_base_url (str | None): ``KASHROOT_ADMIN_BASE_URL``, or None.
        flag_id (uuid.UUID): The flag to deep-link to.

    Return:
        str | None: The link, or None when no base URL is configured.
    """
    return _admin_console_link(admin_base_url, ADMIN_FLAGS_QUEUE_PATH, "flag_id", flag_id)


def _admin_photos_link(admin_base_url: str | None, photo_id: uuid.UUID) -> str | None:
    """
    Build a link to the moderation console's photo queue for one photo, when a base
    URL is configured.

    Parameters:
        admin_base_url (str | None): ``KASHROOT_ADMIN_BASE_URL``, or None.
        photo_id (uuid.UUID): The evidence photo to deep-link to.

    Return:
        str | None: The link, or None when no base URL is configured.
    """
    return _admin_console_link(admin_base_url, ADMIN_PHOTOS_QUEUE_PATH, "photo_id", photo_id)


def build_flag_report_email(
    *,
    restaurant_id: uuid.UUID,
    restaurant_name: str,
    flag_id: uuid.UUID,
    flag_type: str,
    message: str | None,
    certificate_id: uuid.UUID | None,
    certifier_name: str | None,
    created_at: dt.datetime,
    admin_base_url: str | None,
) -> tuple[str, str, str]:
    """
    Render the subject, HTML body and plain-text body for one flag-report email.

    All user-supplied text (``message``, ``restaurant_name``, ``certifier_name``) is
    HTML-escaped before it reaches the HTML body — ``message`` in particular is
    free-text from an anonymous, unauthenticated caller (PRD §13: the app never
    trusts a community report on its own).

    Parameters:
        restaurant_id (uuid.UUID): The reported restaurant.
        restaurant_name (str): The restaurant's display name (Hebrew or English).
        flag_id (uuid.UUID): The newly created flag's id.
        flag_type (str): The ``FlagType`` value the reporter selected.
        message (str | None): The reporter's free-text message, if any.
        certificate_id (uuid.UUID | None): The certificate card being viewed, if any.
        certifier_name (str | None): That certificate's certifier name, if any.
        created_at (dt.datetime): When the flag was created.
        admin_base_url (str | None): ``KASHROOT_ADMIN_BASE_URL``, or None.

    Return:
        tuple[str, str, str]: ``(subject, html_body, text_body)``.
    """
    safe_restaurant_name = html.escape(restaurant_name)
    safe_message = html.escape(message) if message else EMAIL_NO_MESSAGE_PLACEHOLDER
    safe_certifier_name = html.escape(certifier_name) if certifier_name else None

    subject = EMAIL_SUBJECT_TEMPLATE.format(flag_type=flag_type, restaurant_name=restaurant_name)
    admin_link = _admin_flags_link(admin_base_url, flag_id)
    created_at_str = created_at.isoformat()

    if certificate_id is not None:
        certificate_line_html = (
            f"<li>Certificate: {certificate_id} "
            f"({safe_certifier_name or EMAIL_UNKNOWN_CERTIFIER_PLACEHOLDER})</li>"
        )
        certificate_line_text = (
            f"Certificate: {certificate_id} "
            f"({certifier_name or EMAIL_UNKNOWN_CERTIFIER_PLACEHOLDER})"
        )
    else:
        certificate_line_html = f"<li>{EMAIL_NO_CERTIFICATE_PLACEHOLDER}</li>"
        certificate_line_text = EMAIL_NO_CERTIFICATE_PLACEHOLDER

    admin_link_html = (
        f'<p><a href="{admin_link}">Open in moderation console</a></p>' if admin_link else ""
    )
    admin_link_text = f"\nAdmin link: {admin_link}" if admin_link else ""

    html_body = (
        "<div>"
        f"<h2>New report: {flag_type}</h2>"
        "<ul>"
        f"<li>Restaurant: {safe_restaurant_name} ({restaurant_id})</li>"
        f"{certificate_line_html}"
        f"<li>Flag id: {flag_id}</li>"
        f"<li>Reported at: {created_at_str}</li>"
        "</ul>"
        f"<p><strong>Message:</strong> {safe_message}</p>"
        f"{admin_link_html}"
        "</div>"
    )
    text_body = (
        f"New report: {flag_type}\n\n"
        f"Restaurant: {restaurant_name} ({restaurant_id})\n"
        f"{certificate_line_text}\n"
        f"Flag id: {flag_id}\n"
        f"Reported at: {created_at_str}\n\n"
        f"Message: {message or EMAIL_NO_MESSAGE_PLACEHOLDER}"
        f"{admin_link_text}"
    )

    return subject, html_body, text_body


def _deliver_notification_email(
    sender: EmailSender,
    *,
    label: str,
    entity_id: uuid.UUID,
    to: Sequence[str],
    subject: str,
    html_body: str,
    text_body: str,
) -> None:
    """
    Send one already-rendered notification email, swallowing every error.

    Shared by every notification kind (flag reports, certificate-photo uploads):
    each one is a ``BackgroundTasks`` callback that runs strictly after its own row
    is committed, so this never raises — a Resend outage or a network timeout can
    never turn an already-successful request into a failed one (PRD §13 fail-safe).

    Parameters:
        sender (EmailSender): The sender to use (from ``get_email_sender``).
        label (str): A short, human-readable notification kind for the log line
            (e.g. ``LOG_LABEL_FLAG_REPORT``, ``LOG_LABEL_CERTIFICATE_PHOTO``).
        entity_id (uuid.UUID): The flag, photo, etc. this email is about, logged for
            correlation.
        to (Sequence[str]): Recipient addresses (``KASHROOT_REPORT_EMAIL_TO``,
            already parsed).
        subject (str): The email subject line.
        html_body (str): The HTML body part.
        text_body (str): The plain-text body part.

    Return:
        None
    """
    if not to:
        logger.debug(LOG_EMAIL_SEND_SKIPPED_NO_RECIPIENTS, label, entity_id)

        return

    try:
        sender.send(to=to, subject=subject, html_body=html_body, text_body=text_body)
    except httpx.HTTPStatusError as exc:
        body = exc.response.text[:RESEND_ERROR_BODY_TRUNCATE_LENGTH]
        logger.error(
            LOG_EMAIL_SEND_FAILED_WITH_RESEND_DETAIL,
            label,
            entity_id,
            exc.response.status_code,
            body,
        )
    except Exception:
        logger.exception(LOG_EMAIL_SEND_FAILED, label, entity_id)


def notify_flag_created(
    sender: EmailSender,
    *,
    to: Sequence[str],
    restaurant_id: uuid.UUID,
    restaurant_name: str,
    flag_id: uuid.UUID,
    flag_type: str,
    message: str | None,
    certificate_id: uuid.UUID | None,
    certifier_name: str | None,
    created_at: dt.datetime,
    admin_base_url: str | None,
) -> None:
    """
    Send the flag-report notification email, swallowing every error.

    Meant to run as a ``BackgroundTasks`` callback, strictly after the flag row is
    committed — this function never raises, so a Resend outage or a network timeout
    can never turn a successful report into a failed request (PRD §13 fail-safe:
    the report has already succeeded once the flag exists).

    Parameters:
        sender (EmailSender): The sender to use (from ``get_email_sender``).
        to (Sequence[str]): Recipient addresses (``KASHROOT_REPORT_EMAIL_TO``,
            already parsed).
        restaurant_id (uuid.UUID): The reported restaurant.
        restaurant_name (str): The restaurant's display name.
        flag_id (uuid.UUID): The newly created flag's id.
        flag_type (str): The ``FlagType`` value the reporter selected.
        message (str | None): The reporter's free-text message, if any.
        certificate_id (uuid.UUID | None): The certificate card being viewed, if any.
        certifier_name (str | None): That certificate's certifier name, if any.
        created_at (dt.datetime): When the flag was created.
        admin_base_url (str | None): ``KASHROOT_ADMIN_BASE_URL``, or None.

    Return:
        None
    """
    subject, html_body, text_body = build_flag_report_email(
        restaurant_id=restaurant_id,
        restaurant_name=restaurant_name,
        flag_id=flag_id,
        flag_type=flag_type,
        message=message,
        certificate_id=certificate_id,
        certifier_name=certifier_name,
        created_at=created_at,
        admin_base_url=admin_base_url,
    )
    _deliver_notification_email(
        sender,
        label=LOG_LABEL_FLAG_REPORT,
        entity_id=flag_id,
        to=to,
        subject=subject,
        html_body=html_body,
        text_body=text_body,
    )


def build_photo_uploaded_email(
    *,
    restaurant_id: uuid.UUID,
    restaurant_name: str,
    certificate_id: uuid.UUID,
    certifier_name: str | None,
    photo_id: uuid.UUID,
    content_type: str,
    size_bytes: int,
    uploaded_at: dt.datetime,
    admin_base_url: str | None,
) -> tuple[str, str, str]:
    """
    Render the subject, HTML body and plain-text body for one certificate-photo-
    upload notification email.

    ``restaurant_name`` and ``certifier_name`` are HTML-escaped before they reach the
    HTML body, matching :func:`build_flag_report_email` — the restaurant/certifier
    names originate from moderator-entered data, not the anonymous uploader, but the
    same discipline is cheap and keeps the two builders consistent.

    Parameters:
        restaurant_id (uuid.UUID): The restaurant whose certificate was photographed.
        restaurant_name (str): The restaurant's display name (Hebrew or English).
        certificate_id (uuid.UUID): The certificate the photo is evidence for.
        certifier_name (str | None): That certificate's certifier name, if any.
        photo_id (uuid.UUID): The newly created evidence-photo row's id.
        content_type (str): The photo's normalized Content-Type (e.g.
            ``"image/jpeg"``).
        size_bytes (int): The uploaded file's size in bytes.
        uploaded_at (dt.datetime): When the photo was uploaded.
        admin_base_url (str | None): ``KASHROOT_ADMIN_BASE_URL``, or None.

    Return:
        tuple[str, str, str]: ``(subject, html_body, text_body)``. Never includes the
            image itself or a presigned URL — the admin opens it from the queue.
    """
    safe_restaurant_name = html.escape(restaurant_name)
    safe_certifier_name = html.escape(certifier_name) if certifier_name else None
    certifier_display = certifier_name or EMAIL_UNKNOWN_CERTIFIER_PLACEHOLDER
    safe_certifier_display = safe_certifier_name or EMAIL_UNKNOWN_CERTIFIER_PLACEHOLDER

    subject = EMAIL_PHOTO_SUBJECT_TEMPLATE.format(restaurant_name=restaurant_name)
    admin_link = _admin_photos_link(admin_base_url, photo_id)
    uploaded_at_str = uploaded_at.isoformat()

    admin_link_html = (
        f'<p><a href="{admin_link}">Open in moderation console</a></p>' if admin_link else ""
    )
    admin_link_text = f"\nAdmin link: {admin_link}" if admin_link else ""

    html_body = (
        "<div>"
        "<h2>New certificate photo pending review</h2>"
        "<ul>"
        f"<li>Restaurant: {safe_restaurant_name} ({restaurant_id})</li>"
        f"<li>Certificate: {certificate_id} ({safe_certifier_display})</li>"
        f"<li>Photo id: {photo_id}</li>"
        f"<li>Content type: {content_type}</li>"
        f"<li>Size: {size_bytes} bytes</li>"
        f"<li>Uploaded at: {uploaded_at_str}</li>"
        "</ul>"
        f"{admin_link_html}"
        "</div>"
    )
    text_body = (
        "New certificate photo pending review\n\n"
        f"Restaurant: {restaurant_name} ({restaurant_id})\n"
        f"Certificate: {certificate_id} ({certifier_display})\n"
        f"Photo id: {photo_id}\n"
        f"Content type: {content_type}\n"
        f"Size: {size_bytes} bytes\n"
        f"Uploaded at: {uploaded_at_str}"
        f"{admin_link_text}"
    )

    return subject, html_body, text_body


def notify_photo_uploaded(
    sender: EmailSender,
    *,
    to: Sequence[str],
    restaurant_id: uuid.UUID,
    restaurant_name: str,
    certificate_id: uuid.UUID,
    certifier_name: str | None,
    photo_id: uuid.UUID,
    content_type: str,
    size_bytes: int,
    uploaded_at: dt.datetime,
    admin_base_url: str | None,
) -> None:
    """
    Send the certificate-photo-upload notification email, swallowing every error.

    Meant to run as a ``BackgroundTasks`` callback, strictly after the photo row is
    committed, for a successful anonymous public upload only — a rate-limited,
    rejected (409/413/415) or otherwise failed upload never reaches here and sends no
    email (PRD §13 fail-safe: the upload has already succeeded once the photo row
    exists PENDING_REVIEW).

    Parameters:
        sender (EmailSender): The sender to use (from ``get_email_sender``).
        to (Sequence[str]): Recipient addresses (``KASHROOT_REPORT_EMAIL_TO``,
            already parsed).
        restaurant_id (uuid.UUID): The restaurant whose certificate was photographed.
        restaurant_name (str): The restaurant's display name.
        certificate_id (uuid.UUID): The certificate the photo is evidence for.
        certifier_name (str | None): That certificate's certifier name, if any.
        photo_id (uuid.UUID): The newly created evidence-photo row's id.
        content_type (str): The photo's normalized Content-Type.
        size_bytes (int): The uploaded file's size in bytes.
        uploaded_at (dt.datetime): When the photo was uploaded.
        admin_base_url (str | None): ``KASHROOT_ADMIN_BASE_URL``, or None.

    Return:
        None
    """
    subject, html_body, text_body = build_photo_uploaded_email(
        restaurant_id=restaurant_id,
        restaurant_name=restaurant_name,
        certificate_id=certificate_id,
        certifier_name=certifier_name,
        photo_id=photo_id,
        content_type=content_type,
        size_bytes=size_bytes,
        uploaded_at=uploaded_at,
        admin_base_url=admin_base_url,
    )
    _deliver_notification_email(
        sender,
        label=LOG_LABEL_CERTIFICATE_PHOTO,
        entity_id=photo_id,
        to=to,
        subject=subject,
        html_body=html_body,
        text_body=text_body,
    )
