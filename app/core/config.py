"""Application settings. Everything env-driven; no secrets in code."""

from functools import lru_cache

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

    # Certifier list snapshots carry no validity window (see data/README.md); a certificate
    # sourced from a published list goes stale this many days after its list date unless the
    # certifier overrides it. Staleness degrades to UNKNOWN — never to MATCH.
    default_freshness_days: int = 90


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
