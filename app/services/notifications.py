"""Instant email notification for public community reports.

``POST /v1/restaurants/{id}/flags`` (``app.api.public_photos.create_public_flag``)
sends one transactional email through Resend (https://resend.com) after the flag is
committed, via ``BackgroundTasks`` — a send failure or slow network call must never
fail or delay the report response (PRD §13 fail-safe: the report itself already
succeeded once the flag row exists).

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
    DEFAULT_RESEND_TIMEOUT_SECONDS,
    EMAIL_NO_CERTIFICATE_PLACEHOLDER,
    EMAIL_NO_MESSAGE_PLACEHOLDER,
    EMAIL_SUBJECT_TEMPLATE,
    EMAIL_UNKNOWN_CERTIFIER_PLACEHOLDER,
    LOG_EMAIL_SEND_FAILED,
    LOG_EMAIL_SEND_SKIPPED_NO_RECIPIENTS,
    LOG_EMAIL_SENDER_UNCONFIGURED,
    RESEND_API_URL,
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
    if not admin_base_url:
        return None

    return f"{admin_base_url.rstrip('/')}{ADMIN_FLAGS_QUEUE_PATH}?flag_id={flag_id}"


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
    if not to:
        logger.debug(LOG_EMAIL_SEND_SKIPPED_NO_RECIPIENTS, flag_id)

        return

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
    try:
        sender.send(to=to, subject=subject, html_body=html_body, text_body=text_body)
    except Exception:
        logger.exception(LOG_EMAIL_SEND_FAILED, flag_id)
