"""Constants for the media-storage layer.

STANDARDS.md: Supabase Storage endpoint templates, header names, timeouts and error
message formats live here rather than inline in the backend implementations, so the
shape of the remote API is readable in one place.
"""

from __future__ import annotations

#: Every Supabase Storage route hangs off this prefix on the project URL.
STORAGE_API_PREFIX = "/storage/v1"

OBJECT_PATH_TEMPLATE = "{prefix}/object/{bucket}/{key}"
SIGN_OBJECT_PATH_TEMPLATE = "{prefix}/object/sign/{bucket}/{key}"
OBJECT_INFO_PATH_TEMPLATE = "{prefix}/object/info/authenticated/{bucket}/{key}"
BUCKET_COLLECTION_PATH_TEMPLATE = "{prefix}/bucket"

AUTHORIZATION_HEADER = "Authorization"
BEARER_PREFIX = "Bearer "
APIKEY_HEADER = "apikey"
UPSERT_HEADER = "x-upsert"
UPSERT_ENABLED = "true"
CACHE_CONTROL_HEADER = "cache-control"
CONTENT_TYPE_HEADER = "Content-Type"

#: Evidence photos are internal moderation material, never CDN-cached public assets.
DEFAULT_CACHE_CONTROL = "no-store"

SIGN_EXPIRES_IN_FIELD = "expiresIn"
SIGNED_URL_FIELD = "signedURL"
DOWNLOAD_QUERY_PARAM = "download"

BUCKET_ID_FIELD = "id"
BUCKET_NAME_FIELD = "name"
BUCKET_PUBLIC_FIELD = "public"

#: The evidence bucket is private without exception — objects are reachable only
#: through a short-lived signed URL minted per request.
BUCKET_IS_PUBLIC = False

#: Storage keys carry ``/`` as a folder separator; it must survive percent-encoding.
KEY_PATH_SAFE_CHARACTERS = "/"

DEFAULT_REQUEST_TIMEOUT_SECONDS = 30.0
DEFAULT_CONNECT_TIMEOUT_SECONDS = 5.0

HTTP_BAD_REQUEST = 400
HTTP_NOT_FOUND = 404
HTTP_CONFLICT = 409

#: storage-api answers a missing object with either status depending on the route,
#: so both must read as "absent" rather than as a transport failure.
MISSING_OBJECT_STATUS_CODES = frozenset({HTTP_BAD_REQUEST, HTTP_NOT_FOUND})

#: Error bodies are truncated before they reach an exception message: they can be
#: multi-kilobyte HTML, and nothing past the first line aids diagnosis.
MAX_ERROR_BODY_CHARS = 300

PUT_OPERATION = "upload"
SIGN_OPERATION = "sign"
DELETE_OPERATION = "delete"
INFO_OPERATION = "stat"
CREATE_BUCKET_OPERATION = "create-bucket"

MISSING_CONFIG_ERROR = (
    "Supabase storage is selected but not configured — set KASHROOT_SUPABASE_URL and "
    "KASHROOT_SUPABASE_SERVICE_KEY (see .env.example)."
)
MISSING_S3_CONFIG_ERROR = (
    "S3 storage is selected but KASHROOT_S3_BUCKET is empty — set it, or configure "
    "Supabase and leave KASHROOT_STORAGE_BACKEND unset (see .env.example)."
)
REQUEST_FAILED_ERROR = "Supabase Storage {operation} failed for {key!r}: HTTP {status} {body}"
BUCKET_REQUEST_FAILED_ERROR = (
    "Supabase Storage {operation} failed for bucket {bucket!r}: HTTP {status} {body}"
)
MISSING_SIGNED_URL_ERROR = (
    "Supabase Storage signed a URL for {key!r} but returned no {field!r} field."
)

#: Evidence-object naming and the Content-Disposition rules derived from it.
#: A fixed download filename keeps opaque storage keys out of download names.
PDF_EXTENSION = "pdf"
FALLBACK_EXTENSION = "bin"
EVIDENCE_FILENAME_TEMPLATE = "evidence.{extension}"
EXTENSION_SEPARATOR = "."
ATTACHMENT_DISPOSITION_TEMPLATE = 'attachment; filename="{filename}"'
INLINE_DISPOSITION_TEMPLATE = 'inline; filename="{filename}"'

#: Round-trip probe used by ``kashroot storage-check``. Written under a dedicated
#: prefix so a probe object can never be mistaken for evidence, and deleted again
#: immediately.
HEALTHCHECK_KEY_TEMPLATE = "_healthcheck/{token}.txt"
HEALTHCHECK_CONTENT_TYPE = "text/plain"
HEALTHCHECK_BODY = b"kashroot storage-check"

#: Supabase's current key names. The publishable key (formerly ``anon``) is the
#: client-side key: it is RLS-bound and holds no privileges of its own, so it can
#: neither create a bucket nor write to a private one. The backend needs the secret
#: key (formerly ``service_role``), which bypasses RLS and is server-only.
PUBLISHABLE_KEY_PREFIX = "sb_publishable_"
SECRET_KEY_PREFIX = "sb_secret_"
SERVICE_ROLE_JWT_ROLE = "service_role"
JWT_SEGMENT_SEPARATOR = "."
JWT_PAYLOAD_SEGMENT_INDEX = 1
JWT_ROLE_CLAIM = "role"
BASE64_PADDING = "="
BASE64_BLOCK_SIZE = 4

PUBLISHABLE_KEY_ERROR = (
    "KASHROOT_SUPABASE_SERVICE_KEY holds a PUBLISHABLE key (sb_publishable_...). That is "
    "the client-side key: it is bound by Row Level Security and cannot create a bucket or "
    "write evidence photos. Use the SECRET key instead — dashboard -> Project Settings -> "
    "API Keys -> Secret keys -> reveal or create one (sb_secret_...). It is server-only: "
    "never put it in web/, a mobile bundle, or a commit."
)
ANON_KEY_ERROR = (
    "KASHROOT_SUPABASE_SERVICE_KEY holds a legacy key whose role is {role!r}, not "
    "'service_role'. The anon key is Row Level Security-bound and cannot write evidence "
    "photos. Use the service_role key (dashboard -> Project Settings -> API Keys), or the "
    "newer secret key (sb_secret_...)."
)

PARTIAL_SUPABASE_CONFIG_ERROR = (
    "Supabase is half-configured: {present} is set but {missing} is not. Auto-detection "
    "needs both, and falling back to S3/MinIO here would look like a storage outage "
    "rather than a missing setting. Set {missing}, or remove {present} to stay on S3."
)
SUPABASE_URL_SETTING = "KASHROOT_SUPABASE_URL"
SUPABASE_SERVICE_KEY_SETTING = "KASHROOT_SUPABASE_SERVICE_KEY"
