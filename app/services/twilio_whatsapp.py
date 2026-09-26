"""WhatsApp sender for the sheet-sync workflow, via plain Twilio REST (no SDK).

Two send modes, chosen once at construction:

* **Freeform body** — used when no Content Template is configured. Only works inside
  Twilio's 24-hour customer-service window (i.e. the recipient messaged the sandbox/
  number recently); fine for development.
* **Approved Content Template** — used when ``KASHROOT_TWILIO_CONTENT_SID`` is set.
  Required for business-initiated messages (a cron firing at 08:50 with nobody having
  messaged first) outside that window; Twilio requires the template be pre-approved,
  with two variables ``{"1": summary, "2": link}``.

Mirrors the shape of :mod:`app.services.notifications` (Protocol + Null sender +
process-lifetime cached default), so the sheet-sync CLI never branches on whether
Twilio is configured.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from typing import Protocol

import httpx

from app.core.config import Settings, settings
from app.services.twilio_consts import (
    CONTENT_VARIABLE_LINK,
    CONTENT_VARIABLE_SUMMARY,
    DEFAULT_HTTP_TIMEOUT_SECONDS,
    TRUNCATION_SUFFIX,
    TWILIO_BODY_MAX_CHARS,
    TWILIO_MESSAGES_URL_TEMPLATE,
    TWILIO_NOT_CONFIGURED_LOG,
    TWILIO_SEND_ERROR,
)

logger = logging.getLogger(__name__)


class WhatsAppSender(Protocol):
    """Anything that can deliver one WhatsApp message to the configured recipient."""

    def send(self, *, summary: str, link: str | None) -> None:
        """
        Deliver one WhatsApp message.

        Parameters:
            summary (str): The message body (or Content Template variable 1).
            link (str | None): A confirm-page link to include, if any (variable 2 in
                Content Template mode; appended to the body otherwise).

        Return:
            None
        """
        ...


class NullWhatsAppSender:
    """No-op sender used whenever Twilio is not configured."""

    def send(self, *, summary: str, link: str | None) -> None:
        """
        Log and do nothing.

        Parameters:
            summary (str): Logged for visibility; never sent.
            link (str | None): Ignored.

        Return:
            None
        """
        logger.info(TWILIO_NOT_CONFIGURED_LOG, summary)

        return


def truncate_body(text: str, *, max_chars: int = TWILIO_BODY_MAX_CHARS) -> str:
    """
    Truncate freeform message text to fit Twilio's per-message character limit.

    Parameters:
        text (str): The full message body.
        max_chars (int): Twilio's limit (1600 for WhatsApp/SMS).

    Return:
        str: ``text`` unchanged if it already fits, else cut to leave room for
            :data:`app.services.twilio_consts.TRUNCATION_SUFFIX`.
    """
    if len(text) <= max_chars:
        return text

    keep = max_chars - len(TRUNCATION_SUFFIX)

    return text[:keep] + TRUNCATION_SUFFIX


class TwilioWhatsAppSender:
    """Sends one WhatsApp message through the plain Twilio REST API."""

    def __init__(
        self,
        account_sid: str,
        auth_token: str,
        from_number: str,
        to_number: str,
        content_sid: str | None = None,
        client: httpx.Client | None = None,
        timeout: float = DEFAULT_HTTP_TIMEOUT_SECONDS,
    ) -> None:
        """
        Build a Twilio-backed WhatsApp sender.

        Parameters:
            account_sid (str): ``KASHROOT_TWILIO_ACCOUNT_SID``.
            auth_token (str): ``KASHROOT_TWILIO_AUTH_TOKEN``, used for HTTP Basic
                auth against the Twilio API.
            from_number (str): ``KASHROOT_TWILIO_WHATSAPP_FROM``, e.g.
                ``whatsapp:+14155238886``.
            to_number (str): ``KASHROOT_WHATSAPP_TO``, e.g. ``whatsapp:+972...``.
            content_sid (str | None): ``KASHROOT_TWILIO_CONTENT_SID``. When set, every
                send uses this approved Content Template instead of a freeform body.
            client (httpx.Client | None): HTTP client to reuse; tests supply a fake.
            timeout (float): Request timeout, used only when ``client`` is not given.

        Return:
            None
        """
        self._account_sid = account_sid
        self._auth_token = auth_token
        self._from_number = from_number
        self._to_number = to_number
        self._content_sid = content_sid
        self._client = client if client is not None else httpx.Client(timeout=timeout)

    def send(self, *, summary: str, link: str | None) -> None:
        """
        POST the message to Twilio and raise on a non-2xx response.

        Parameters:
            summary (str): The message body (or Content Template variable 1).
            link (str | None): A confirm-page link (variable 2 in Content Template
                mode; appended to the freeform body otherwise).

        Return:
            None
        """
        url = TWILIO_MESSAGES_URL_TEMPLATE.format(account_sid=self._account_sid)
        data = {"From": self._from_number, "To": self._to_number}
        if self._content_sid:
            data["ContentSid"] = self._content_sid
            data["ContentVariables"] = json.dumps(
                {CONTENT_VARIABLE_SUMMARY: summary, CONTENT_VARIABLE_LINK: link or ""}
            )
        else:
            body = f"{summary}\n\n{link}" if link else summary
            data["Body"] = truncate_body(body)

        response = self._client.post(
            url, data=data, auth=(self._account_sid, self._auth_token)
        )
        if response.status_code >= 300:
            raise RuntimeError(
                TWILIO_SEND_ERROR.format(status=response.status_code, body=response.text)
            )


def _twilio_is_configured(config: Settings) -> bool:
    """
    Judge whether enough is configured to attempt a real send.

    Parameters:
        config (Settings): The settings to read.

    Return:
        bool: True when account SID, auth token, from-number and recipient are set.
    """
    return bool(
        config.twilio_account_sid
        and config.twilio_auth_token
        and config.twilio_whatsapp_from
        and config.whatsapp_to
    )


@lru_cache
def _default_whatsapp_sender() -> WhatsAppSender:
    """
    Build the process-lifetime default sender from the global settings.

    Return:
        WhatsAppSender: A :class:`TwilioWhatsAppSender` when configured, else
            :class:`NullWhatsAppSender`.
    """
    if _twilio_is_configured(settings):
        return TwilioWhatsAppSender(
            account_sid=settings.twilio_account_sid or "",
            auth_token=settings.twilio_auth_token or "",
            from_number=settings.twilio_whatsapp_from or "",
            to_number=settings.whatsapp_to or "",
            content_sid=settings.twilio_content_sid,
        )

    return NullWhatsAppSender()


def get_whatsapp_sender() -> WhatsAppSender:
    """
    The process-lifetime default WhatsApp sender. Tests should construct a
    :class:`TwilioWhatsAppSender` or a fake directly rather than relying on the
    cached default, which reads real settings.

    Return:
        WhatsAppSender: The default sender.
    """
    return _default_whatsapp_sender()
