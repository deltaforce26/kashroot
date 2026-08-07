"""Application settings. Everything env-driven; no secrets in code."""

import json
from functools import lru_cache
from typing import Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="KASHROOT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: str = "local"
    debug: bool = False

    database_url: str = "postgresql+psycopg://kashroot:kashroot@localhost:5432/kashroot"
    db_echo: bool = False
    redis_url: str = "redis://localhost:6379/0"

    s3_endpoint_url: str | None = None
    s3_bucket: str = "kashroot-evidence"
    s3_access_key: str | None = None
    s3_secret_key: str | None = None

    # Google Geocoding API (geocoding pipeline). No key → the pipeline can still run
    # against its response cache; it just cannot make new API calls.
    google_maps_api_key: str | None = None
    # Politeness delay between paid geocoding calls.
    geocode_delay_ms: int = 50

    # Certifier list snapshots carry no validity window (see data/README.md); a certificate
    # sourced from a published list goes stale this many days after its list date unless the
    # certifier overrides it. Staleness degrades to UNKNOWN — never to MATCH.
    default_freshness_days: int = 90

    # TEMPORARY moderator auth for the admin/moderation API, until real moderator
    # accounts exist (PRD FR8). Maps bearer token -> moderator actor name; the actor
    # name flows into every AuditLog entry the moderator writes. Configure via
    # KASHROOT_ADMIN_API_TOKENS='{"some-long-token": "alice"}' (JSON). Empty = the
    # admin API rejects everything. Tokens are secrets: never log them.
    admin_api_tokens: dict[str, str] | str = {}

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
