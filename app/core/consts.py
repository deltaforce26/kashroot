"""Constants for application-wide configuration.

STANDARDS.md: selectable-backend names and connection defaults are config values,
not literals scattered through the modules that consume them.
"""

from __future__ import annotations

from enum import StrEnum


class StorageBackend(StrEnum):
    """Media-storage backends selectable via ``KASHROOT_STORAGE_BACKEND``.

    ``AUTO`` resolves to :attr:`SUPABASE` when Supabase credentials are configured
    and to :attr:`S3` otherwise, so a plain ``docker compose up`` keeps working with
    no environment changes while a configured Supabase project takes over silently.
    """

    AUTO = "auto"
    SUPABASE = "supabase"
    S3 = "s3"
    MEMORY = "memory"


#: Pool sizing defaults. Deliberately small: a Supabase project has a bounded
#: connection budget shared with every other client, and this service is not
#: connection-hungry.
DEFAULT_DB_POOL_SIZE = 5
DEFAULT_DB_MAX_OVERFLOW = 5

DEFAULT_SUPABASE_STORAGE_BUCKET = "kashroot-evidence"
DEFAULT_SUPABASE_TIMEOUT_SECONDS = 30.0

UNKNOWN_STORAGE_BACKEND_ERROR = (
    "KASHROOT_STORAGE_BACKEND={backend!r} is not a valid backend; expected one of: {allowed}."
)
