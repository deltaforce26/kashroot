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
from app.services.rate_limit_consts import (
    DEFAULT_FLAG_REPORT_RATE_LIMIT_PER_DAY,
    DEFAULT_FLAG_REPORT_RATE_LIMIT_PER_HOUR,
    DEFAULT_PHOTO_UPLOAD_RATE_LIMIT_PER_DAY,
    DEFAULT_PHOTO_UPLOAD_RATE_LIMIT_PER_HOUR,
    DEFAULT_PLACES_PHOTO_RATE_LIMIT_PER_DAY,
    DEFAULT_PLACES_PHOTO_RATE_LIMIT_PER_HOUR,
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

    # Whether to trust a reverse proxy's X-Forwarded-For header for rate-limit
    # client identity (app.services.rate_limit.get_client_identifier). Only the
    # first hop is read, and only when this is true — otherwise a client could set
    # its own header and spoof a fresh IP on every request. Enable this only when
    # the app is actually deployed behind a proxy that sets/overwrites this header
    # itself (e.g. a load balancer); leave it false for local dev and for any
    # deployment reachable directly.
    trust_proxy_headers: bool = False

    # Per-IP fixed-window limits on the anonymous certificate-photo upload
    # (POST /v1/restaurants/{id}/certificate-photo). Both windows apply together;
    # see app.services.rate_limit and .env.example.
    photo_upload_rate_limit_per_hour: int = DEFAULT_PHOTO_UPLOAD_RATE_LIMIT_PER_HOUR
    photo_upload_rate_limit_per_day: int = DEFAULT_PHOTO_UPLOAD_RATE_LIMIT_PER_DAY

    # Per-IP fixed-window limits on the anonymous community-flag report
    # (POST /v1/restaurants/{id}/flags). Separate scope/counters from the photo
    # upload limits above; see app.services.rate_limit and .env.example.
    flag_report_rate_limit_per_hour: int = DEFAULT_FLAG_REPORT_RATE_LIMIT_PER_HOUR
    flag_report_rate_limit_per_day: int = DEFAULT_FLAG_REPORT_RATE_LIMIT_PER_DAY

    # Per-IP fixed-window limits on GET /v1/restaurants/{id}/photos/{index} (own
    # "places_photo" scope; app.services.rate_limit). Higher than the write
    # endpoints above — a normal detail-page view issues one request per gallery
    # photo, all reads.
    places_photo_rate_limit_per_hour: int = DEFAULT_PLACES_PHOTO_RATE_LIMIT_PER_HOUR
    places_photo_rate_limit_per_day: int = DEFAULT_PLACES_PHOTO_RATE_LIMIT_PER_DAY

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

    # Server-side Places API (New) key for GET /v1/restaurants/{id}/places and its
    # photo redirect (app.services.places). Falls back to google_maps_api_key via
    # the places_api_key property below, since one server-restricted key with both
    # the Geocoding API and Places API (New) enabled works for both — set this
    # separately only if the keys must differ. Unset → the endpoint degrades
    # (photos=[], hours=null) rather than erroring; see .env.example.
    google_places_api_key: str | None = None

    @property
    def places_api_key(self) -> str | None:
        """
        Resolve the key ``app.services.places`` should use.

        Parameters:
            None

        Return:
            str | None: ``google_places_api_key`` if set, else ``google_maps_api_key``
                (both are server-side keys with no client exposure), else ``None``.
        """
        return self.google_places_api_key or self.google_maps_api_key

    # Certifier list snapshots carry no validity window (see data/README.md); a certificate
    # sourced from a published list goes stale this many days after its list date unless the
    # certifier overrides it. Staleness degrades to UNKNOWN — never to MATCH.
    default_freshness_days: int = 365

    # Verification-age gate is off for the current app stage (explicit product
    # decision, overrides the engine's documented staleness fail-safe); the engine
    # logic stays in place, switchable, for later re-enabling.
    enforce_freshness: bool = False

    # TEMPORARY moderator auth for the admin/moderation API, until real moderator
    # accounts exist (PRD FR8). Maps bearer token -> moderator actor name; the actor
    # name flows into every AuditLog entry the moderator writes. Configure via
    # KASHROOT_ADMIN_API_TOKENS='{"some-long-token": "alice"}' (JSON). Empty = the
    # admin API rejects everything. Tokens are secrets: never log them.
    admin_api_tokens: dict[str, str] | str = {}

    # Resend (https://resend.com) email notifications for public community reports
    # (POST /v1/restaurants/{id}/flags). Unset key or recipients -> silent no-op, so
    # dev/tests work with no email credentials at all (app.services.notifications).
    resend_api_key: str | None = None
    report_email_from: str | None = None
    # Comma-separated recipient list, e.g. "alice@example.com,bob@example.com".
    report_email_to: str | None = None
    # Optional base URL of the admin console, for a link to its flag queue (/flags)
    # in the notification email, e.g. "https://admin.kashroot.example".
    admin_base_url: str | None = None

    # Origin of the public web app (the Vite SPA on Vercel), for absolute URLs in
    # GET /v1/sitemap.xml, e.g. "https://kashroot.example" (no trailing slash needed —
    # it is stripped). When unset, the origin is recovered from the X-Forwarded-Host /
    # X-Forwarded-Proto request headers Vercel sets on its /v1/* rewrite, and failing
    # that from the request's own base URL (app.api.public_seo.resolve_public_web_origin).
    public_web_origin: str | None = None

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
