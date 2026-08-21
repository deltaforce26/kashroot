"""Application settings. Everything env-driven; no secrets in code."""

import json
from functools import lru_cache
from typing import Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.consts import (
    DEFAULT_DB_MAX_OVERFLOW,
    DEFAULT_DB_POOL_SIZE,
    DEFAULT_SUPABASE_STORAGE_BUCKET,
    DEFAULT_SUPABASE_TIMEOUT_SECONDS,
    UNKNOWN_STORAGE_BACKEND_ERROR,
    StorageBackend,
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="KASHROOT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: str = "local"
    debug: bool = False

    # Point this at Supabase to run on hosted Postgres — the driver, models and
    # Alembic migrations are unchanged, since Supabase *is* Postgres. Use the
    # transaction pooler (port 6543) for the app and the session pooler / direct
    # connection (5432) for `alembic upgrade`. app.db.connection applies the
    # Supabase-specific connection rules automatically; see .env.example.
    database_url: str = "postgresql+psycopg://kashroot:kashroot@localhost:5432/kashroot"
    db_echo: bool = False
    # None = auto: disabled on Supabase's transaction pooler (which cannot support
    # server-side prepared statements), enabled everywhere else.
    db_prepared_statements: bool | None = None
    # Set to "public,extensions" only if PostGIS was enabled from the Supabase
    # dashboard rather than created by Alembic migration 0001.
    db_search_path: str | None = None
    db_pool_size: int = DEFAULT_DB_POOL_SIZE
    db_max_overflow: int = DEFAULT_DB_MAX_OVERFLOW
    redis_url: str = "redis://localhost:6379/0"

    # Which MediaStorage backend serves certificate evidence photos. "auto" resolves
    # to Supabase when the credentials below are set and to S3/MinIO otherwise, so
    # `docker compose up` keeps working untouched.
    storage_backend: StorageBackend = StorageBackend.AUTO

    # Supabase project. The service-role key bypasses RLS and is a server-only
    # secret — it must never be logged, returned by an endpoint, or shipped to a client.
    supabase_url: str | None = None
    supabase_service_key: str | None = None
    supabase_storage_bucket: str = DEFAULT_SUPABASE_STORAGE_BUCKET
    supabase_timeout_seconds: float = DEFAULT_SUPABASE_TIMEOUT_SECONDS

    s3_endpoint_url: str | None = None
    s3_bucket: str = "kashroot-evidence"
    s3_access_key: str | None = None
    s3_secret_key: str | None = None
    # Pinned explicitly (presigned URLs embed the region; MinIO ignores it but boto3
    # requires one). Override for a real AWS bucket outside us-east-1.
    s3_region: str = "us-east-1"

    # Google Geocoding API (geocoding pipeline). No key → the pipeline can still run
    # against its response cache; it just cannot make new API calls.
    google_maps_api_key: str | None = None
    # Politeness delay between paid geocoding calls.
    geocode_delay_ms: int = 50

    # Certifier list snapshots carry no validity window (see data/README.md); a certificate
    # sourced from a published list goes stale this many days after its list date unless the
    # certifier overrides it. Staleness degrades to UNKNOWN — never to MATCH.
    default_freshness_days: int = 365

    # TEMPORARY moderator auth for the admin/moderation API, until real moderator
    # accounts exist (PRD FR8). Maps bearer token -> moderator actor name; the actor
    # name flows into every AuditLog entry the moderator writes. Configure via
    # KASHROOT_ADMIN_API_TOKENS='{"some-long-token": "alice"}' (JSON). Empty = the
    # admin API rejects everything. Tokens are secrets: never log them.
    admin_api_tokens: dict[str, str] | str = {}

    @field_validator("storage_backend", mode="before")
    @classmethod
    def _parse_storage_backend(cls, value: Any) -> Any:
        """Accept any case, and fail loudly on a typo rather than silently defaulting."""
        if not isinstance(value, str):
            return value
        candidate = value.strip().lower()
        try:
            return StorageBackend(candidate)
        except ValueError as exc:
            allowed = ", ".join(sorted(StorageBackend))
            raise ValueError(
                UNKNOWN_STORAGE_BACKEND_ERROR.format(backend=value, allowed=allowed)
            ) from exc

    @field_validator("admin_api_tokens", mode="before")
    @classmethod
    def _parse_admin_api_tokens(cls, value: Any) -> Any:
        """Accept either a dict or a JSON string (the env-var form)."""
        if isinstance(value, str):
            value = value.strip()
            return json.loads(value) if value else {}
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
