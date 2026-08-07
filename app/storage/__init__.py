"""Media storage abstraction (S3-compatible).

Certificate evidence photos are the product's ground truth (PRD §13) — they live in
S3-compatible object storage (MinIO locally, any S3 API in production), never on disk
and never as public URLs in the DB. The DB stores object *keys*; viewing goes through
short-lived presigned URLs minted per request.

The concrete backend is injected as a FastAPI dependency (``app.api.deps
.get_media_storage``) so tests substitute :class:`InMemoryMediaStorage` and never touch
the network.
"""

from app.storage.base import MediaStorage
from app.storage.memory import InMemoryMediaStorage
from app.storage.s3 import S3MediaStorage, s3_storage_from_settings

__all__ = [
    "InMemoryMediaStorage",
    "MediaStorage",
    "S3MediaStorage",
    "s3_storage_from_settings",
]
