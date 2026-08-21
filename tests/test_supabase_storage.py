"""Supabase Storage backend — request shape, signing, and the fail-safe rules.

Every request is served by an httpx MockTransport: no test may ever reach the
network or a real Supabase project. What is asserted here is the contract the
moderation console depends on — private objects, short-lived signed URLs, and PDFs
that can never render inline.
"""

from __future__ import annotations

import base64
import json
import unittest

import httpx

from app.core.config import Settings
from app.storage.base import DEFAULT_URL_EXPIRY_SECONDS
from app.storage.consts import (
    APIKEY_HEADER,
    AUTHORIZATION_HEADER,
    BUCKET_PUBLIC_FIELD,
    DEFAULT_CACHE_CONTROL,
    SIGN_EXPIRES_IN_FIELD,
)
from app.storage.supabase import (
    SupabaseMediaStorage,
    SupabaseStorageError,
    assert_server_side_key,
    supabase_storage_from_settings,
)

PROJECT_URL = "https://abcdefghijklm.supabase.co"
SERVICE_KEY = "service-role-key-not-a-real-one"
BUCKET = "kashroot-evidence"
JPEG_KEY = "cert-evidence/11111111-1111-1111-1111-111111111111/photo.jpg"
PDF_KEY = "cert-evidence/11111111-1111-1111-1111-111111111111/scan.pdf"
SIGNED_PATH = "/object/sign/kashroot-evidence/cert-evidence/x/photo.jpg?token=abc.def"


class _Recorder:
    """Captures every request the backend makes and replays canned responses."""

    def __init__(self, responder) -> None:
        """
        Build a recorder around a response function.

        Parameters:
            responder (Callable[[httpx.Request], httpx.Response]): Produces the
                response for each captured request.

        Return:
            None
        """
        self.requests: list[httpx.Request] = []
        self._responder = responder

    def __call__(self, request: httpx.Request) -> httpx.Response:
        """
        Record a request and return its canned response.

        Parameters:
            request (httpx.Request): The outgoing request.

        Return:
            httpx.Response: Response chosen by the responder.
        """
        self.requests.append(request)

        return self._responder(request)


def build_storage(responder) -> tuple[SupabaseMediaStorage, _Recorder]:
    """
    Build a Supabase backend wired to a mock transport.

    Parameters:
        responder (Callable[[httpx.Request], httpx.Response]): Response function.

    Return:
        tuple[SupabaseMediaStorage, _Recorder]: The backend and its request recorder.
    """
    recorder = _Recorder(responder)
    client = httpx.Client(
        transport=httpx.MockTransport(recorder),
        headers={
            AUTHORIZATION_HEADER: f"Bearer {SERVICE_KEY}",
            APIKEY_HEADER: SERVICE_KEY,
        },
    )
    storage = SupabaseMediaStorage(
        url=PROJECT_URL,
        service_key=SERVICE_KEY,
        bucket=BUCKET,
        client=client,
    )

    return storage, recorder


def ok(request: httpx.Request) -> httpx.Response:
    """
    Respond 200 with an empty JSON object.

    Parameters:
        request (httpx.Request): Ignored.

    Return:
        httpx.Response: A successful empty response.
    """
    return httpx.Response(200, json={})


def signed(request: httpx.Request) -> httpx.Response:
    """
    Respond to a signing request with a Supabase-shaped signed path.

    Parameters:
        request (httpx.Request): Ignored.

    Return:
        httpx.Response: A response carrying ``signedURL``.
    """
    return httpx.Response(200, json={"signedURL": SIGNED_PATH})


class SupabaseUploadTests(unittest.TestCase):
    def test_put_posts_object_with_content_type_and_no_store(self) -> None:
        storage, recorder = build_storage(ok)

        storage.put(JPEG_KEY, b"bytes", "image/jpeg")

        request = recorder.requests[0]
        self.assertEqual(request.method, "POST")
        self.assertEqual(
            str(request.url),
            f"{PROJECT_URL}/storage/v1/object/{BUCKET}/{JPEG_KEY}",
        )
        self.assertEqual(request.headers["content-type"], "image/jpeg")
        self.assertEqual(request.headers["cache-control"], DEFAULT_CACHE_CONTROL)
        self.assertEqual(request.content, b"bytes")

    def test_put_sends_service_key_in_both_auth_headers(self) -> None:
        storage, recorder = build_storage(ok)

        storage.put(JPEG_KEY, b"bytes", "image/jpeg")

        request = recorder.requests[0]
        self.assertEqual(request.headers[AUTHORIZATION_HEADER.lower()], f"Bearer {SERVICE_KEY}")
        self.assertEqual(request.headers[APIKEY_HEADER], SERVICE_KEY)

    def test_put_raises_with_truncated_body_and_never_leaks_the_key(self) -> None:
        storage, _ = build_storage(lambda request: httpx.Response(403, text="x" * 5000))

        with self.assertRaises(SupabaseStorageError) as caught:
            storage.put(JPEG_KEY, b"bytes", "image/jpeg")

        message = str(caught.exception)
        self.assertIn("403", message)
        self.assertNotIn(SERVICE_KEY, message)
        self.assertLess(len(message), 600)


class SupabaseSigningTests(unittest.TestCase):
    def test_get_url_requests_the_default_expiry(self) -> None:
        storage, recorder = build_storage(signed)

        storage.get_url(JPEG_KEY)

        body = json.loads(recorder.requests[0].content)
        self.assertEqual(body[SIGN_EXPIRES_IN_FIELD], DEFAULT_URL_EXPIRY_SECONDS)

    def test_get_url_forwards_a_custom_expiry(self) -> None:
        storage, recorder = build_storage(signed)

        storage.get_url(JPEG_KEY, expires_in=60)

        body = json.loads(recorder.requests[0].content)
        self.assertEqual(body[SIGN_EXPIRES_IN_FIELD], 60)

    def test_get_url_returns_an_absolute_url_under_the_project(self) -> None:
        storage, _ = build_storage(signed)

        url = storage.get_url(JPEG_KEY)

        self.assertTrue(url.startswith(f"{PROJECT_URL}/storage/v1/object/sign/"))

    def test_signed_path_already_carrying_the_prefix_is_not_doubled(self) -> None:
        storage, _ = build_storage(
            lambda request: httpx.Response(200, json={"signedURL": f"/storage/v1{SIGNED_PATH}"})
        )

        url = storage.get_url(JPEG_KEY)

        self.assertEqual(url.count("/storage/v1"), 1)

    def test_images_render_inline_with_no_download_parameter(self) -> None:
        storage, _ = build_storage(signed)

        url = storage.get_url(JPEG_KEY)

        self.assertNotIn("download=", url)

    def test_pdfs_are_forced_to_download(self) -> None:
        """A PDF-polyglot must never render inline under our origin (storage/base)."""
        storage, _ = build_storage(signed)

        url = storage.get_url(PDF_KEY)

        self.assertIn("download=evidence.pdf", url)
        self.assertIn("&download=", url)

    def test_missing_signed_url_field_is_an_error_not_a_broken_url(self) -> None:
        storage, _ = build_storage(lambda request: httpx.Response(200, json={}))

        with self.assertRaises(SupabaseStorageError):
            storage.get_url(JPEG_KEY)


class SupabaseObjectLifecycleTests(unittest.TestCase):
    def test_exists_is_true_on_200(self) -> None:
        storage, recorder = build_storage(ok)

        self.assertTrue(storage.exists(JPEG_KEY))
        self.assertIn("/object/info/authenticated/", str(recorder.requests[0].url))

    def test_exists_is_false_on_404_and_on_400(self) -> None:
        for status in (400, 404):
            with self.subTest(status=status):
                storage, _ = build_storage(lambda request, s=status: httpx.Response(s))

                self.assertFalse(storage.exists(JPEG_KEY))

    def test_exists_raises_on_a_server_error(self) -> None:
        storage, _ = build_storage(lambda request: httpx.Response(500, text="boom"))

        with self.assertRaises(SupabaseStorageError):
            storage.exists(JPEG_KEY)

    def test_delete_of_a_missing_object_is_a_no_op(self) -> None:
        storage, _ = build_storage(lambda request: httpx.Response(404, text="not found"))

        storage.delete(JPEG_KEY)

    def test_delete_raises_on_a_server_error(self) -> None:
        storage, _ = build_storage(lambda request: httpx.Response(500, text="boom"))

        with self.assertRaises(SupabaseStorageError):
            storage.delete(JPEG_KEY)


class SupabaseKeyEncodingTests(unittest.TestCase):
    def test_folder_separators_survive_encoding(self) -> None:
        storage, recorder = build_storage(ok)

        storage.put(JPEG_KEY, b"bytes", "image/jpeg")

        self.assertIn(JPEG_KEY, str(recorder.requests[0].url))

    def test_hebrew_and_spaces_in_a_key_are_percent_encoded(self) -> None:
        storage, recorder = build_storage(ok)

        storage.put("cert-evidence/מסעדה 1/photo.jpg", b"bytes", "image/jpeg")

        url = str(recorder.requests[0].url)
        self.assertNotIn(" ", url)
        self.assertIn("%20", url)


class KeyTypeGuardTests(unittest.TestCase):
    """The publishable/anon key is RLS-bound and cannot write evidence photos.

    Configured by mistake it produces a 403 on the first upload, several steps after
    the actual error, so it is rejected at construction instead.
    """

    @staticmethod
    def legacy_jwt(role: str) -> str:
        """
        Build a legacy Supabase JWT carrying a role claim.

        Parameters:
            role (str): The role claim to embed.

        Return:
            str: An unsigned JWT-shaped string.
        """
        payload = base64.urlsafe_b64encode(json.dumps({"role": role}).encode()).decode()

        return f"header.{payload.rstrip('=')}.signature"

    def test_the_publishable_key_is_rejected(self) -> None:
        with self.assertRaises(SupabaseStorageError) as caught:
            assert_server_side_key("sb_publishable_abc123")

        self.assertIn("sb_secret_", str(caught.exception))

    def test_the_legacy_anon_key_is_rejected_by_its_role_claim(self) -> None:
        with self.assertRaises(SupabaseStorageError) as caught:
            assert_server_side_key(self.legacy_jwt("anon"))

        self.assertIn("anon", str(caught.exception))

    def test_the_secret_key_is_accepted(self) -> None:
        assert_server_side_key("sb_secret_xyz789")

    def test_the_legacy_service_role_key_is_accepted(self) -> None:
        assert_server_side_key(self.legacy_jwt("service_role"))

    def test_an_opaque_non_jwt_key_is_accepted(self) -> None:
        """Unknown key shapes must not be blocked — only known-bad ones are."""
        assert_server_side_key("some-other-opaque-token")

    def test_the_factory_rejects_a_publishable_key(self) -> None:
        settings = Settings(
            _env_file=None,
            storage_backend="supabase",
            supabase_url=PROJECT_URL,
            supabase_service_key="sb_publishable_abc123",
        )

        with self.assertRaises(SupabaseStorageError):
            supabase_storage_from_settings(settings)


class SupabaseBucketTests(unittest.TestCase):
    def test_ensure_bucket_creates_a_private_bucket(self) -> None:
        storage, recorder = build_storage(ok)

        created = storage.ensure_bucket()

        self.assertTrue(created)
        body = json.loads(recorder.requests[0].content)
        self.assertIs(body[BUCKET_PUBLIC_FIELD], False)

    def test_ensure_bucket_leaves_an_existing_bucket_alone(self) -> None:
        storage, recorder = build_storage(lambda request: httpx.Response(409, text="exists"))

        created = storage.ensure_bucket()

        self.assertFalse(created)
        self.assertEqual(len(recorder.requests), 1)

    def test_ensure_bucket_raises_on_failure(self) -> None:
        storage, _ = build_storage(lambda request: httpx.Response(401, text="bad key"))

        with self.assertRaises(SupabaseStorageError):
            storage.ensure_bucket()


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
