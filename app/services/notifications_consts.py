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

LOG_EMAIL_SEND_SKIPPED_NO_RECIPIENTS = (
    "Skipping flag report email for flag %s: no recipients configured."
)
LOG_EMAIL_SEND_FAILED = "Failed to send flag report notification email for flag %s."

EMAIL_SUBJECT_TEMPLATE = "[Kashroot] New report: {flag_type} — {restaurant_name}"

EMAIL_NO_MESSAGE_PLACEHOLDER = "(no message provided)"
EMAIL_NO_CERTIFICATE_PLACEHOLDER = "(restaurant-level report — no certificate selected)"
EMAIL_UNKNOWN_CERTIFIER_PLACEHOLDER = "(certifier unknown)"

#: ``KASHROOT_ADMIN_BASE_URL`` + this path names the moderation console's flag queue
#: (``app.api.admin.queues.flag_queue``) the email links to.
ADMIN_FLAGS_QUEUE_PATH = "/flags"
