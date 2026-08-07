"""The storage protocol every media backend implements."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

#: Default lifetime of a presigned view URL. Short on purpose: evidence photos are
#: internal moderation material, not public assets.
DEFAULT_URL_EXPIRY_SECONDS = 15 * 60


def content_disposition_for_key(key: str) -> str:
    """Content-Disposition every presigned view URL must force on the response.

    Images render ``inline`` (the console shows them in place); PDFs are forced to
    ``attachment`` so a PDF-polyglot can never execute script in the browser's viewer
    under our origin. The fixed ``evidence.<ext>`` filename avoids leaking storage
    keys into download names.
    """
    extension = key.rsplit(".", 1)[-1].lower() if "." in key else "bin"
    if extension == "pdf":
        return 'attachment; filename="evidence.pdf"'
    return f'inline; filename="evidence.{extension}"'


@runtime_checkable
class MediaStorage(Protocol):
    """S3-shaped object storage. Keys are opaque strings; callers own the namespace."""

    def put(self, key: str, data: bytes, content_type: str) -> None:
        """Store ``data`` under ``key``, overwriting any existing object."""
        ...

    def get_url(self, key: str, *, expires_in: int = DEFAULT_URL_EXPIRY_SECONDS) -> str:
        """Presigned GET URL for viewing; expires after ``expires_in`` seconds."""
        ...

    def delete(self, key: str) -> None:
        """Delete the object. Deleting a missing key is a no-op (S3 semantics)."""
        ...

    def exists(self, key: str) -> bool:
        """Whether an object is stored under ``key``."""
        ...
