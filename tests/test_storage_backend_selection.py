"""Storage backend selection.

`docker compose up` must keep working untouched, and configuring a Supabase project
must be enough to move evidence photos there. Nothing here constructs a network
client for a backend it is not asserting on.
"""

from __future__ import annotations

import unittest

from app.core.config import Settings
from app.core.consts import StorageBackend
from app.storage import InMemoryMediaStorage, media_storage_from_settings, resolve_storage_backend
from app.storage.supabase import SupabaseMediaStorage, SupabaseStorageError

SUPABASE_URL = "https://abcdefghijklm.supabase.co"
SERVICE_KEY = "service-role-key-not-a-real-one"


def settings_for(**overrides: object) -> Settings:
    """
    Build settings without reading the developer's .env file.

    Parameters:
        overrides (object): Field values to set on the settings object.

    Return:
        Settings: Settings carrying only the given overrides and field defaults.
    """
    return Settings(_env_file=None, **overrides)


class AutoSelectionTests(unittest.TestCase):
    def test_auto_falls_back_to_s3_without_supabase_credentials(self) -> None:
        """The docker compose + MinIO path must survive with no config changes."""
        backend = resolve_storage_backend(settings_for())

        self.assertIs(backend, StorageBackend.S3)

    def test_auto_selects_supabase_once_both_credentials_are_present(self) -> None:
        backend = resolve_storage_backend(
            settings_for(supabase_url=SUPABASE_URL, supabase_service_key=SERVICE_KEY)
        )

        self.assertIs(backend, StorageBackend.SUPABASE)

    def test_a_url_without_a_key_is_a_loud_error(self) -> None:
        """Falling back to MinIO here presents as a storage outage, not a config gap."""
        with self.assertRaises(ValueError) as caught:
            resolve_storage_backend(settings_for(supabase_url=SUPABASE_URL))

        self.assertIn("KASHROOT_SUPABASE_SERVICE_KEY", str(caught.exception))

    def test_a_key_without_a_url_is_a_loud_error(self) -> None:
        """The exact shape of the .env that silently served MinIO on 19 Aug 2026."""
        with self.assertRaises(ValueError) as caught:
            resolve_storage_backend(settings_for(supabase_service_key=SERVICE_KEY))

        self.assertIn("KASHROOT_SUPABASE_URL", str(caught.exception))

    def test_an_explicit_s3_choice_silences_the_partial_config_error(self) -> None:
        backend = resolve_storage_backend(
            settings_for(storage_backend="s3", supabase_service_key=SERVICE_KEY)
        )

        self.assertIs(backend, StorageBackend.S3)


class ExplicitSelectionTests(unittest.TestCase):
    def test_an_explicit_backend_overrides_auto_detection(self) -> None:
        backend = resolve_storage_backend(
            settings_for(
                storage_backend="s3",
                supabase_url=SUPABASE_URL,
                supabase_service_key=SERVICE_KEY,
            )
        )

        self.assertIs(backend, StorageBackend.S3)

    def test_the_backend_name_is_case_insensitive(self) -> None:
        self.assertIs(
            settings_for(storage_backend="SUPABASE").storage_backend, StorageBackend.SUPABASE
        )

    def test_an_unknown_backend_is_rejected_at_startup(self) -> None:
        with self.assertRaises(ValueError):
            settings_for(storage_backend="gcs")


class FactoryTests(unittest.TestCase):
    def test_supabase_settings_build_a_supabase_backend(self) -> None:
        storage = media_storage_from_settings(
            settings_for(
                storage_backend="supabase",
                supabase_url=SUPABASE_URL,
                supabase_service_key=SERVICE_KEY,
                supabase_storage_bucket="evidence",
            )
        )

        self.assertIsInstance(storage, SupabaseMediaStorage)
        self.assertEqual(storage.bucket, "evidence")
        self.assertEqual(storage.base_url, SUPABASE_URL)
        storage.close()

    def test_a_trailing_slash_on_the_project_url_is_stripped(self) -> None:
        storage = media_storage_from_settings(
            settings_for(
                storage_backend="supabase",
                supabase_url=f"{SUPABASE_URL}/",
                supabase_service_key=SERVICE_KEY,
            )
        )

        self.assertEqual(storage.base_url, SUPABASE_URL)
        storage.close()

    def test_selecting_supabase_without_credentials_fails_loudly(self) -> None:
        with self.assertRaises(SupabaseStorageError):
            media_storage_from_settings(settings_for(storage_backend="supabase"))

    def test_memory_backend_is_selectable(self) -> None:
        storage = media_storage_from_settings(settings_for(storage_backend="memory"))

        self.assertIsInstance(storage, InMemoryMediaStorage)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
