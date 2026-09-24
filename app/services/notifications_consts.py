"""Constants for report-flag email notifications (``app.services.notifications``).

STANDARDS.md: no plain strings/magic values in code — the Resend endpoint, log
messages and email copy templates live here with informative names.
"""

from __future__ import annotations

#: Resend's transactional-email REST endpoint (https://resend.com/docs/api-reference/emails/send-email).
RESEND_API_URL = "https://api.resend.com/emails"

#: Matches the feature request's "~10s" budget — this is a fire-and-forget background
#: send, never on the request's own critical path.
DEFAULT_RESEND_TIMEOUT_SECONDS = 10.0

#: Logged once, at sender construction (the sender is a process-lifetime singleton —
#: see ``app.services.notifications.get_email_sender``), when Resend is not configured.
#: Unconfigured is a supported state (dev/tests run with no email credentials at all).
LOG_EMAIL_SENDER_UNCONFIGURED = (
    "Report email notifications are not configured "
    "(KASHROOT_RESEND_API_KEY and/or KASHROOT_REPORT_EMAIL_TO are unset); "
    "flag reports will not send email."
)

#: Shared by every notification kind (flag reports, certificate-photo uploads); the
#: first ``%s`` is a short label (``"flag report"``, ``"certificate photo"``) and the
#: second is that notification's own id.
LOG_EMAIL_SEND_SKIPPED_NO_RECIPIENTS = (
    "Skipping %s notification email for %s: no recipients configured."
)
LOG_EMAIL_SEND_FAILED = "Failed to send %s notification email for %s."

LOG_LABEL_FLAG_REPORT = "flag report"
LOG_LABEL_CERTIFICATE_PHOTO = "certificate photo"

#: The env var names surfaced when reporting an unconfigured state, so a Render log
#: line can be resolved without reading the code (see app.core.config.Settings).
ENV_VAR_RESEND_API_KEY = "KASHROOT_RESEND_API_KEY"
ENV_VAR_REPORT_EMAIL_FROM = "KASHROOT_REPORT_EMAIL_FROM"
ENV_VAR_REPORT_EMAIL_TO = "KASHROOT_REPORT_EMAIL_TO"

#: Logged once at application startup (``app.main``'s lifespan hook calls
#: ``app.services.notifications.log_email_configuration_status``), at WARNING so it
#: is visible in Render's default uvicorn output — INFO is not.
LOG_EMAIL_CONFIGURED_AT_STARTUP = "Report email configured: from %s to %d recipient(s)."
LOG_EMAIL_NOT_CONFIGURED_AT_STARTUP = "Report email not configured — missing: %s."

#: The name of the logger every ``app.*`` module logs under (``app.services.notifications``,
#: ``app.services.rate_limit``, ...), used to attach a defensive ``StreamHandler`` at
#: startup so WARNING+ records are never lost to a host's handling of Python's
#: logging "last resort" fallback.
APP_LOGGER_NAME = "app"

#: A Resend error response body is arbitrary (and can be large); this bounds what a
#: failure log line includes.
RESEND_ERROR_BODY_TRUNCATE_LENGTH = 500

LOG_EMAIL_SEND_FAILED_WITH_RESEND_DETAIL = (
    "Failed to send %s notification email for %s: Resend returned %s %s."
)

EMAIL_SUBJECT_TEMPLATE = "[Kashroot] New report: {flag_type} — {restaurant_name}"

EMAIL_NO_MESSAGE_PLACEHOLDER = "(no message provided)"
EMAIL_NO_CERTIFICATE_PLACEHOLDER = "(restaurant-level report — no certificate selected)"
EMAIL_UNKNOWN_CERTIFIER_PLACEHOLDER = "(certifier unknown)"

#: ``KASHROOT_ADMIN_BASE_URL`` + this path names the moderation console's flag queue
#: (``app.api.admin.queues.flag_queue``) the email links to.
ADMIN_FLAGS_QUEUE_PATH = "/flags"

#: ``KASHROOT_ADMIN_BASE_URL`` + this path names the moderation console's evidence-
#: photo queue the certificate-photo-upload email links to.
ADMIN_PHOTOS_QUEUE_PATH = "/photos"

EMAIL_PHOTO_SUBJECT_TEMPLATE = "[Kashroot] New certificate photo pending review — {restaurant_name}"
