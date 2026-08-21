"""The storage protocol every media backend implements."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.storage.consts import (
    ATTACHMENT_DISPOSITION_TEMPLATE,
    EVIDENCE_FILENAME_TEMPLATE,
    EXTENSION_SEPARATOR,
    FALLBACK_EXTENSION,
    INLINE_DISPOSITION_TEMPLATE,
    PDF_EXTENSION,
)

#: Default lifetime of a presigned view URL. Short on purpose: evidence photos are
#: internal moderation material, not public assets.
DEFAULT_URL_EXPIRY_SECONDS = 15 * 60


def extension_for_key(key: str) -> str:
    """
    Lower-cased file extension of a storage key.

    Parameters:
        key (str): Opaque storage key, e.g. ``cert-evidence/<id>/<uuid>.jpg``.

    Return:
        str: The extension without its separator, or a generic fallback when the
            key carries none.
    """
    if EXTENSION_SEPARATOR not in key:
        return FALLBACK_EXTENSION

    return key.rsplit(EXTENSION_SEPARATOR, 1)[-1].lower()


def is_forced_download(key: str) -> bool:
    """
    Whether a key must be served as an attachment rather than rendered inline.

    PDFs are forced to download because a PDF-polyglot rendered inline could execute
    script in the browser's viewer under our origin. Every backend enforces this, by
    whichever mechanism its signing API offers.

    Parameters:
        key (str): Opaque storage key.

    Return:
        bool: True when the object must never render inline.
    """
    return extension_for_key(key) == PDF_EXTENSION


def download_filename_for_key(key: str) -> str | None:
    """
    Filename to force a download under, for backends that sign with a download flag.

    Supabase Storage takes a ``download`` query parameter rather than a full
    Content-Disposition header, so it needs the filename alone; ``None`` means the
    object may render inline.

    Parameters:
        key (str): Opaque storage key.

    Return:
        str | None: Fixed download filename, or None when inline rendering is allowed.
    """
    if not is_forced_download(key):
        return None

    return EVIDENCE_FILENAME_TEMPLATE.format(extension=PDF_EXTENSION)


def content_disposition_for_key(key: str) -> str:
    """
    Content-Disposition every presigned view URL must force on the response.

    Images render ``inline`` (the console shows them in place); PDFs are forced to
    ``attachment`` so a PDF-polyglot can never execute script in the browser's viewer
    under our origin. The fixed ``evidence.<ext>`` filename avoids leaking storage
    keys into download names.

    Parameters:
        key (str): Opaque storage key.

    Return:
        str: A complete Content-Disposition header value.
    """
    extension = extension_for_key(key)
    filename = EVIDENCE_FILENAME_TEMPLATE.format(extension=extension)
    if is_forced_download(key):
        return ATTACHMENT_DISPOSITION_TEMPLATE.format(filename=filename)

    return INLINE_DISPOSITION_TEMPLATE.format(filename=filename)


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
