"""Constants for the Twilio WhatsApp sender (`app.services.twilio_whatsapp`)."""

from __future__ import annotations

TWILIO_MESSAGES_URL_TEMPLATE = "https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
DEFAULT_HTTP_TIMEOUT_SECONDS = 15.0

#: Twilio's own hard limit on a WhatsApp/SMS message Body.
TWILIO_BODY_MAX_CHARS = 1600
TRUNCATION_SUFFIX = "\n… (truncated)"

CONTENT_VARIABLE_SUMMARY = "1"
CONTENT_VARIABLE_LINK = "2"

TWILIO_SEND_ERROR = "Twilio send failed ({status}): {body}"
TWILIO_NOT_CONFIGURED_LOG = (
    "Twilio WhatsApp sender not configured (missing account SID, auth token, "
    "from-number or recipient) — message not sent: %s"
)
