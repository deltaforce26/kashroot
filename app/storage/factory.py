"""Backend selection for media storage.

One place decides which :class:`~app.storage.base.MediaStorage` implementation the
process uses, so no caller has to know whether evidence photos live in Supabase
Storage, an S3-compatible bucket, or memory.

``KASHROOT_STORAGE_BACKEND`` defaults to ``auto``, which resolves to Supabase when a
project URL and service-role key are configured and to S3 otherwise. That keeps
``docker compose up`` (Postgres + MinIO) working with no environment changes while a
configured Supabase project takes over without a code change.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.consts import StorageBackend
from app.storage.base import MediaStorage
from app.storage.consts import (
    MISSING_S3_CONFIG_ERROR,
    PARTIAL_SUPABASE_CONFIG_ERROR,
    SUPABASE_SERVICE_KEY_SETTING,
    SUPABASE_URL_SETTING,
)

if TYPE_CHECKING:
    from app.core.config import Settings


def resolve_storage_backend(settings: Settings) -> StorageBackend:
    """
    Resolve the configured backend selection to a concrete backend.

    Half-configured Supabase raises rather than falling back. Setting only one of the
    two values is always a mistake, and silently serving evidence photos from S3/MinIO
    instead presents as a storage outage — a missing bucket, a dead endpoint — which is
    a much longer walk back to the actual cause.

    Parameters:
        settings (Settings): Application settings.

    Return:
        StorageBackend: A concrete backend; never ``StorageBackend.AUTO``.
    """
    backend = StorageBackend(settings.storage_backend)
    if backend is not StorageBackend.AUTO:
        return backend

    if settings.supabase_url and settings.supabase_service_key:
        return StorageBackend.SUPABASE

    if settings.supabase_url:
        raise ValueError(
            PARTIAL_SUPABASE_CONFIG_ERROR.format(
                present=SUPABASE_URL_SETTING, missing=SUPABASE_SERVICE_KEY_SETTING
            )
        )

    if settings.supabase_service_key:
        raise ValueError(
            PARTIAL_SUPABASE_CONFIG_ERROR.format(
                present=SUPABASE_SERVICE_KEY_SETTING, missing=SUPABASE_URL_SETTING
            )
        )

    return StorageBackend.S3


def media_storage_from_settings(settings: Settings) -> MediaStorage:
    """
    Build the media-storage backend the current configuration selects.

    Backend modules are imported lazily so that selecting Supabase never pays boto3's
    import cost, and selecting S3 never requires Supabase configuration.

    Parameters:
        settings (Settings): Application settings.

    Return:
        MediaStorage: A ready-to-use storage backend.
    """
    backend = resolve_storage_backend(settings)

    if backend is StorageBackend.SUPABASE:
        from app.storage.supabase import supabase_storage_from_settings

        return supabase_storage_from_settings(settings)

    if backend is StorageBackend.MEMORY:
        from app.storage.memory import InMemoryMediaStorage

        return InMemoryMediaStorage()

    from app.storage.s3 import s3_storage_from_settings

    if not settings.s3_bucket:
        raise ValueError(MISSING_S3_CONFIG_ERROR)

    return s3_storage_from_settings(settings)
