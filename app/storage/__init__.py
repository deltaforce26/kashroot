"""Media storage abstraction.

Certificate evidence photos are the product's ground truth (PRD §13) — they live in
private object storage (Supabase Storage in cloud environments, MinIO or any S3 API
locally), never on disk and never as public URLs in the DB. The DB stores object
*keys*; viewing goes through short-lived signed URLs minted per request.

The concrete backend is chosen by :func:`app.storage.factory.media_storage_from_settings`
and injected as a FastAPI dependency (``app.api.deps.get_media_storage``) so tests
substitute :class:`InMemoryMediaStorage` and never touch the network.
"""

from app.storage.base import MediaStorage
from app.storage.factory import media_storage_from_settings, resolve_storage_backend
from app.storage.memory import InMemoryMediaStorage
from app.storage.s3 import S3MediaStorage, s3_storage_from_settings
from app.storage.supabase import (
    SupabaseMediaStorage,
    SupabaseStorageError,
    supabase_storage_from_settings,
)

__all__ = [
    "InMemoryMediaStorage",
    "MediaStorage",
    "S3MediaStorage",
    "SupabaseMediaStorage",
    "SupabaseStorageError",
    "media_storage_from_settings",
    "resolve_storage_backend",
    "s3_storage_from_settings",
    "supabase_storage_from_settings",
]
