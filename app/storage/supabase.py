"""Supabase Storage backend for certificate evidence photos.

Evidence photos are the product's ground truth (PRD §13). They live in a *private*
Supabase Storage bucket, never on disk and never as public URLs in the DB: the DB
stores object keys, and viewing goes through a signed URL minted per request with a
short lifetime.

Supabase's signing API takes a ``download`` query parameter rather than a full
Content-Disposition header, so the PDF-polyglot defence from ``app.storage.base`` is
applied by appending that parameter for PDFs. Images carry no parameter and render
inline, matching the S3 backend's behaviour.

httpx is used directly rather than ``supabase-py``: the operations below are the
entire surface we need, the project already depends on httpx, and a plain client is
injectable, which keeps the test suite off the network entirely.
"""

from __future__ import annotations

import base64
import binascii
import json
from typing import TYPE_CHECKING
from urllib.parse import quote, urlencode, urlsplit

import httpx

from app.storage.base import DEFAULT_URL_EXPIRY_SECONDS, download_filename_for_key
from app.storage.consts import (
    ANON_KEY_ERROR,
    APIKEY_HEADER,
    AUTHORIZATION_HEADER,
    BASE64_BLOCK_SIZE,
    BASE64_PADDING,
    BEARER_PREFIX,
    BUCKET_COLLECTION_PATH_TEMPLATE,
    BUCKET_ID_FIELD,
    BUCKET_IS_PUBLIC,
    BUCKET_NAME_FIELD,
    BUCKET_PUBLIC_FIELD,
    BUCKET_REQUEST_FAILED_ERROR,
    CACHE_CONTROL_HEADER,
    CONTENT_TYPE_HEADER,
    CREATE_BUCKET_OPERATION,
    DEFAULT_CACHE_CONTROL,
    DEFAULT_CONNECT_TIMEOUT_SECONDS,
    DEFAULT_REQUEST_TIMEOUT_SECONDS,
    DELETE_OPERATION,
    DOWNLOAD_QUERY_PARAM,
    HTTP_CONFLICT,
    INFO_OPERATION,
    JWT_PAYLOAD_SEGMENT_INDEX,
    JWT_ROLE_CLAIM,
    JWT_SEGMENT_SEPARATOR,
    KEY_PATH_SAFE_CHARACTERS,
    MAX_ERROR_BODY_CHARS,
    MISSING_CONFIG_ERROR,
    MISSING_OBJECT_STATUS_CODES,
    MISSING_SIGNED_URL_ERROR,
    OBJECT_INFO_PATH_TEMPLATE,
    OBJECT_PATH_TEMPLATE,
    PUBLISHABLE_KEY_ERROR,
    PUBLISHABLE_KEY_PREFIX,
    PUT_OPERATION,
    REQUEST_FAILED_ERROR,
    SERVICE_ROLE_JWT_ROLE,
    SIGN_EXPIRES_IN_FIELD,
    SIGN_OBJECT_PATH_TEMPLATE,
    SIGN_OPERATION,
    SIGNED_URL_FIELD,
    STORAGE_API_PREFIX,
)

if TYPE_CHECKING:
    from app.core.config import Settings

_PATH_SEPARATOR = "/"
_QUERY_START = "?"
_QUERY_APPEND = "&"


class SupabaseStorageError(RuntimeError):
    """Raised when the Supabase Storage API rejects a request.

    Carries the operation, status and a truncated response body. The service-role key
    is never included — it is a secret and must not reach logs or error surfaces.
    """


class SupabaseMediaStorage:
    """MediaStorage over the Supabase Storage REST API.

    All configuration is passed at construction — this class never reads settings, so
    a test (or a second bucket) can build one against any project.
    """

    def __init__(
        self,
        *,
        url: str,
        service_key: str,
        bucket: str,
        timeout_seconds: float = DEFAULT_REQUEST_TIMEOUT_SECONDS,
        client: httpx.Client | None = None,
    ) -> None:
        """
        Build a backend bound to one Supabase project and bucket.

        Parameters:
            url (str): Project URL, e.g. ``https://<ref>.supabase.co``.
            service_key (str): Service-role key. A secret; never logged.
            bucket (str): Storage bucket name holding evidence objects.
            timeout_seconds (float): Read timeout for storage requests.
            client (httpx.Client | None): Pre-built client, for tests. When omitted a
                client is constructed with the auth headers already applied.

        Return:
            None
        """
        self.base_url = url.rstrip(_PATH_SEPARATOR)
        self.bucket = bucket
        if client is None:
            client = self._build_client(service_key, timeout_seconds)
        self._client = client

    @staticmethod
    def _build_client(service_key: str, timeout_seconds: float) -> httpx.Client:
        """
        Construct the HTTP client used for every storage call.

        Supabase authenticates storage requests with the service-role key in both the
        bearer header and the ``apikey`` header; the gateway requires the latter.

        Parameters:
            service_key (str): Service-role key.
            timeout_seconds (float): Read timeout in seconds.

        Return:
            httpx.Client: Client carrying the auth headers and timeouts.
        """
        return httpx.Client(
            headers={
                AUTHORIZATION_HEADER: f"{BEARER_PREFIX}{service_key}",
                APIKEY_HEADER: service_key,
            },
            timeout=httpx.Timeout(timeout_seconds, connect=DEFAULT_CONNECT_TIMEOUT_SECONDS),
        )

    def _url_for(self, template: str, *, key: str | None = None) -> str:
        """
        Render an absolute Storage API URL from a path template.

        Parameters:
            template (str): One of the path templates in ``app.storage.consts``.
            key (str | None): Object key, percent-encoded with ``/`` preserved so
                Supabase still reads it as a folder path.

        Return:
            str: Absolute URL against the configured project.
        """
        path = template.format(
            prefix=STORAGE_API_PREFIX,
            bucket=quote(self.bucket, safe=""),
            key=quote(key or "", safe=KEY_PATH_SAFE_CHARACTERS),
        )

        return f"{self.base_url}{path}"

    @staticmethod
    def _truncated_body(response: httpx.Response) -> str:
        """
        Response body trimmed to a length that is useful in an exception message.

        Parameters:
            response (httpx.Response): The failed response.

        Return:
            str: At most ``MAX_ERROR_BODY_CHARS`` characters of the body.
        """
        return response.text[:MAX_ERROR_BODY_CHARS]

    def _raise_for_object(self, response: httpx.Response, *, operation: str, key: str) -> None:
        """
        Convert a failed object-level response into ``SupabaseStorageError``.

        Parameters:
            response (httpx.Response): Response to inspect.
            operation (str): Operation name for the error message.
            key (str): Object key the operation targeted.

        Return:
            None
        """
        if response.is_success:
            return

        raise SupabaseStorageError(
            REQUEST_FAILED_ERROR.format(
                operation=operation,
                key=key,
                status=response.status_code,
                body=self._truncated_body(response),
            )
        )

    def put(self, key: str, data: bytes, content_type: str) -> None:
        """
        Store ``data`` under ``key``, overwriting any existing object.

        Parameters:
            key (str): Object key.
            data (bytes): Object body.
            content_type (str): MIME type recorded on the object.

        Return:
            None
        """
        response = self._client.post(
            self._url_for(OBJECT_PATH_TEMPLATE, key=key),
            content=data,
            headers={
                CONTENT_TYPE_HEADER: content_type,
                CACHE_CONTROL_HEADER: DEFAULT_CACHE_CONTROL,
            },
        )
        self._raise_for_object(response, operation=PUT_OPERATION, key=key)

    def get_url(self, key: str, *, expires_in: int = DEFAULT_URL_EXPIRY_SECONDS) -> str:
        """
        Signed GET URL for viewing; expires after ``expires_in`` seconds.

        Supabase returns a project-relative signed path, which is joined onto the
        project URL here. PDFs gain a ``download`` parameter so the response carries
        Content-Disposition: attachment rather than rendering in the browser viewer.

        Parameters:
            key (str): Object key.
            expires_in (int): Lifetime of the URL in seconds.

        Return:
            str: Absolute, time-limited URL.
        """
        response = self._client.post(
            self._url_for(SIGN_OBJECT_PATH_TEMPLATE, key=key),
            json={SIGN_EXPIRES_IN_FIELD: expires_in},
        )
        self._raise_for_object(response, operation=SIGN_OPERATION, key=key)

        signed_path = response.json().get(SIGNED_URL_FIELD)
        if not signed_path:
            raise SupabaseStorageError(
                MISSING_SIGNED_URL_ERROR.format(key=key, field=SIGNED_URL_FIELD)
            )

        return self._absolute_signed_url(signed_path, key=key)

    def _absolute_signed_url(self, signed_path: str, *, key: str) -> str:
        """
        Join a signed path onto the project URL and apply the forced-download rule.

        Parameters:
            signed_path (str): Path returned by the signing endpoint. Supabase has
                returned this both with and without the ``/storage/v1`` prefix across
                versions, so the prefix is added only when it is absent.
            key (str): Object key, which decides whether download is forced.

        Return:
            str: Absolute signed URL.
        """
        path = signed_path
        if not path.startswith(_PATH_SEPARATOR):
            path = f"{_PATH_SEPARATOR}{path}"
        if not path.startswith(f"{STORAGE_API_PREFIX}{_PATH_SEPARATOR}"):
            path = f"{STORAGE_API_PREFIX}{path}"

        url = f"{self.base_url}{path}"
        download_as = download_filename_for_key(key)
        if download_as is None:
            return url

        separator = _QUERY_APPEND if urlsplit(url).query else _QUERY_START
        query = urlencode({DOWNLOAD_QUERY_PARAM: download_as})

        return f"{url}{separator}{query}"

    def delete(self, key: str) -> None:
        """
        Delete the object. Deleting a missing key is a no-op (S3 semantics).

        Parameters:
            key (str): Object key.

        Return:
            None
        """
        response = self._client.delete(self._url_for(OBJECT_PATH_TEMPLATE, key=key))
        if response.status_code in MISSING_OBJECT_STATUS_CODES:
            return

        self._raise_for_object(response, operation=DELETE_OPERATION, key=key)

    def exists(self, key: str) -> bool:
        """
        Whether an object is stored under ``key``.

        Parameters:
            key (str): Object key.

        Return:
            bool: True when the object exists.
        """
        response = self._client.get(self._url_for(OBJECT_INFO_PATH_TEMPLATE, key=key))
        if response.status_code in MISSING_OBJECT_STATUS_CODES:
            return False

        self._raise_for_object(response, operation=INFO_OPERATION, key=key)

        return True

    def ensure_bucket(self) -> bool:
        """
        Create the configured bucket as private if it does not already exist.

        Bootstrap helper for a fresh project (``kashroot storage-check --create-bucket``);
        never called on the request path. An existing bucket is left untouched, so this
        can never flip a bucket's visibility to public.

        Parameters:
            None

        Return:
            bool: True when the bucket was created, False when it already existed.
        """
        response = self._client.post(
            self._url_for(BUCKET_COLLECTION_PATH_TEMPLATE),
            json={
                BUCKET_ID_FIELD: self.bucket,
                BUCKET_NAME_FIELD: self.bucket,
                BUCKET_PUBLIC_FIELD: BUCKET_IS_PUBLIC,
            },
        )
        if response.status_code == HTTP_CONFLICT:
            return False

        if not response.is_success:
            raise SupabaseStorageError(
                BUCKET_REQUEST_FAILED_ERROR.format(
                    operation=CREATE_BUCKET_OPERATION,
                    bucket=self.bucket,
                    status=response.status_code,
                    body=self._truncated_body(response),
                )
            )

        return True

    def close(self) -> None:
        """
        Release the underlying HTTP connection pool.

        Parameters:
            None

        Return:
            None
        """
        self._client.close()


def _jwt_role(key: str) -> str | None:
    """
    Role claim of a legacy Supabase JWT key, without verifying its signature.

    Only the ``role`` claim is wanted, and only to tell an anon key from a
    service_role one before it fails as an opaque 403 on the first upload. A key that
    is not a JWT at all yields None rather than raising.

    Parameters:
        key (str): The configured Supabase key.

    Return:
        str | None: The role claim, or None when the key is not a readable JWT.
    """
    segments = key.split(JWT_SEGMENT_SEPARATOR)
    if len(segments) <= JWT_PAYLOAD_SEGMENT_INDEX:
        return None

    payload = segments[JWT_PAYLOAD_SEGMENT_INDEX]
    padding = BASE64_PADDING * (-len(payload) % BASE64_BLOCK_SIZE)
    try:
        claims = json.loads(base64.urlsafe_b64decode(payload + padding))
    except (ValueError, binascii.Error):
        return None

    role = claims.get(JWT_ROLE_CLAIM)

    return role if isinstance(role, str) else None


def assert_server_side_key(key: str) -> None:
    """
    Reject a Supabase key that cannot write evidence photos.

    Supabase's publishable key (and the legacy anon key it replaced) is Row Level
    Security-bound and holds no privileges of its own. Configured here it produces a
    403 on the first upload, several steps after the actual mistake, so it is caught
    at construction where the message can name the right key.

    Parameters:
        key (str): The configured Supabase key.

    Return:
        None
    """
    if key.startswith(PUBLISHABLE_KEY_PREFIX):
        raise SupabaseStorageError(PUBLISHABLE_KEY_ERROR)

    role = _jwt_role(key)
    if role is not None and role != SERVICE_ROLE_JWT_ROLE:
        raise SupabaseStorageError(ANON_KEY_ERROR.format(role=role))


def supabase_storage_from_settings(settings: Settings) -> SupabaseMediaStorage:
    """
    Build a Supabase storage backend from application settings.

    The only place Supabase storage settings are read, and only at construction time.

    Parameters:
        settings (Settings): Application settings carrying the project URL, the
            service-role key and the bucket name.

    Return:
        SupabaseMediaStorage: Backend bound to the configured project and bucket.
    """
    if not settings.supabase_url or not settings.supabase_service_key:
        raise SupabaseStorageError(MISSING_CONFIG_ERROR)

    assert_server_side_key(settings.supabase_service_key)

    return SupabaseMediaStorage(
        url=settings.supabase_url,
        service_key=settings.supabase_service_key,
        bucket=settings.supabase_storage_bucket,
        timeout_seconds=settings.supabase_timeout_seconds,
    )
