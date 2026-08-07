"""In-memory MediaStorage fake for tests. No network, ever."""

from __future__ import annotations

from app.storage.base import DEFAULT_URL_EXPIRY_SECONDS, content_disposition_for_key


class InMemoryMediaStorage:
    """Dict-backed stand-in for :class:`app.storage.base.MediaStorage`.

    ``get_url`` returns a recognizable fake URL carrying the key, expiry and forced
    Content-Disposition (mirroring the S3 backend's presign params) so tests can
    assert presigning behavior without any S3 involvement.
    """

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.content_types: dict[str, str] = {}

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.objects[key] = data
        self.content_types[key] = content_type

    def get_url(self, key: str, *, expires_in: int = DEFAULT_URL_EXPIRY_SECONDS) -> str:
        disposition = content_disposition_for_key(key)
        return f"https://fake-storage.test/{key}?expires_in={expires_in}&disposition={disposition}"

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)
        self.content_types.pop(key, None)

    def exists(self, key: str) -> bool:
        return key in self.objects
