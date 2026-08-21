"""Kashroot admin CLI.

    kashroot seed-import --dry-run     # diff review, writes nothing
    kashroot seed-import               # apply
    kashroot geocode                   # dry run: free, no API calls
    kashroot geocode --apply           # geocode + write, cache-first
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from app.ingestion.geocode import GeocodeError, GoogleGeocoder, geocode_restaurants
from app.ingestion.seed_import import DEFAULT_CSV_PATH, SeedImportError, import_seed

app = typer.Typer(help="Kashroot backend admin commands.", no_args_is_help=True)


@app.command("seed-import")
def seed_import(
    csv_path: Annotated[
        Path,
        typer.Option("--csv", help="Seed corpus CSV (UTF-8 with BOM)."),
    ] = DEFAULT_CSV_PATH,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run/--apply", help="Report the diff and roll back (default)."),
    ] = True,
    actor: Annotated[
        str, typer.Option("--actor", help="Who is running this, for the audit log.")
    ] = "cli",
) -> None:
    """Import `data/seed/kashroot_seed_corpus.csv` into the database.

    Establishes certifier + status only — no attributes, no expiry dates (data/README.md).
    Defaults to --dry-run; pass --apply to write.
    """
    from app.db.session import session_scope

    try:
        with session_scope() as session:
            stats = import_seed(session, csv_path, dry_run=dry_run, actor=actor)
    except SeedImportError as exc:
        typer.secho(f"seed import failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    mode = "DRY RUN (rolled back)" if dry_run else "APPLIED"
    typer.secho(f"\nseed-import — {mode}", fg=typer.colors.CYAN, bold=True)
    typer.echo(f"  rows read              {stats.rows_read}")
    typer.echo(f"  branch rows split      {stats.branch_rows_split}")
    typer.echo(f"  certifiers created     {stats.certifiers_created}")
    typer.echo(f"  source docs created    {stats.source_documents_created}")
    typer.echo(
        f"  restaurants            +{stats.restaurants_created} "
        f"~{stats.restaurants_updated} ={stats.restaurants_unchanged}"
    )
    typer.echo(
        f"  certificates           +{stats.certificates_created} "
        f"~{stats.certificates_updated} ={stats.certificates_unchanged}"
    )
    typer.echo(f"  needs_review records   {stats.needs_review}")
    typer.echo(f"  pending certificates   {stats.pending_certificates}")
    if stats.changed_fields:
        typer.echo("  changed fields:")
        for name, count in sorted(stats.changed_fields.items(), key=lambda kv: -kv[1]):
            typer.echo(f"    {name:<34} {count}")
    if dry_run:
        typer.secho("\n  nothing written — re-run with --apply to commit", fg=typer.colors.YELLOW)


@app.command("geocode")
def geocode(
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run/--apply", help="Report the diff and roll back (default)."),
    ] = True,
    actor: Annotated[
        str, typer.Option("--actor", help="Who is running this, for the audit log.")
    ] = "cli",
    limit: Annotated[
        int | None,
        typer.Option("--limit", help="Geocode at most N restaurants (incremental runs)."),
    ] = None,
    city: Annotated[
        str | None,
        typer.Option("--city", help="Only this city_slug (e.g. bnei-brak)."),
    ] = None,
    allow_api_calls: Annotated[
        bool,
        typer.Option(
            "--allow-api-calls",
            help="Let a dry run call the paid API for uncached entries. "
            "--apply always allows API calls; a plain dry run is free.",
        ),
    ] = False,
) -> None:
    """Populate restaurant geo points via Google Geocoding (cache-first, fail-safe).

    Precise, city-confirmed results are written with provenance + audit; anything
    ambiguous is flagged needs_review with no point. Defaults to --dry-run, which is
    free: uncached entries are reported as "would call API".
    """
    from app.core.config import settings
    from app.db.session import session_scope

    use_api = allow_api_calls or not dry_run
    geocoder = None
    if use_api:
        if not settings.google_maps_api_key:
            typer.secho(
                "no Google API key — set KASHROOT_GOOGLE_MAPS_API_KEY (or run a plain "
                "dry run, which needs no key)",
                fg=typer.colors.RED,
                err=True,
            )
            raise typer.Exit(code=1)
        geocoder = GoogleGeocoder(
            settings.google_maps_api_key, delay_ms=settings.geocode_delay_ms
        )

    try:
        with session_scope() as session:
            stats = geocode_restaurants(
                session,
                geocoder,
                dry_run=dry_run,
                allow_api_calls=use_api,
                actor=actor,
                limit=limit,
                city=city,
            )
    except GeocodeError as exc:
        typer.secho(f"geocode failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    mode = "DRY RUN (rolled back)" if dry_run else "APPLIED"
    typer.secho(f"\ngeocode — {mode}", fg=typer.colors.CYAN, bold=True)
    typer.echo(f"  candidates (geo missing)   {stats.candidates}")
    typer.echo(f"  already geocoded           {stats.already_geocoded}")
    typer.echo(f"  excluded (needs_review)    {stats.excluded_needs_review}")
    typer.echo(f"  cache hits                 {stats.cache_hits}")
    typer.echo(f"  API calls made             {stats.api_calls}")
    typer.echo(f"  would call API (uncached)  {stats.would_call_api}")
    typer.echo(f"  accepted points            {stats.accepted}")
    typer.echo(f"  flagged needs_review       {stats.flagged_needs_review}")
    typer.echo(f"  skipped (changed mid-run)  {stats.skipped_concurrent}")
    if stats.review_reasons:
        typer.echo("  review reasons:")
        for reason, n in sorted(stats.review_reasons.items(), key=lambda kv: -kv[1]):
            typer.echo(f"    {reason:<26} {n}")
    if dry_run:
        typer.secho("\n  nothing written — re-run with --apply to commit", fg=typer.colors.YELLOW)


@app.command("db-check")
def db_check() -> None:
    """Verify the configured database is reachable and correctly provisioned.

    Reports how the connection was tuned (Supabase TLS, transaction-pooler prepared
    statement handling), whether PostGIS is installed and reachable on the current
    search_path, and which Alembic revision the database is at.
    """
    from sqlalchemy import text

    from app.core.config import settings as app_settings
    from app.db.connection import profile_for_url
    from app.db.consts import (
        ALEMBIC_REVISION_QUERY,
        DIRECT_HOST_HINT,
        POSTGIS_VERSION_QUERY,
        SERVER_VERSION_QUERY,
    )
    from app.db.session import engine

    profile = profile_for_url(app_settings.database_url)
    typer.secho("\ndb-check", fg=typer.colors.CYAN, bold=True)
    typer.echo(f"  host                   {engine.url.host}:{engine.url.port}")
    typer.echo(f"  supabase-hosted        {profile.is_supabase}")
    typer.echo(f"  transaction pooler     {profile.is_transaction_pooler}")
    typer.echo(f"  prepared statements    {not profile.is_transaction_pooler}")
    if profile.is_direct_host:
        typer.secho(
            f"  WARNING: {DIRECT_HOST_HINT.format(host=engine.url.host)}",
            fg=typer.colors.YELLOW,
        )

    try:
        with engine.connect() as connection:
            server = connection.execute(text(SERVER_VERSION_QUERY)).scalar_one()
            postgis = connection.execute(text(POSTGIS_VERSION_QUERY)).scalar_one_or_none()
            revision = connection.execute(text(ALEMBIC_REVISION_QUERY)).scalar_one_or_none()
    except Exception as exc:
        typer.secho(f"  connection FAILED: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    typer.secho(f"  server                 {server.split(',')[0]}", fg=typer.colors.GREEN)
    if postgis:
        typer.secho(f"  postgis                {postgis}", fg=typer.colors.GREEN)
    else:
        typer.secho(
            "  postgis                NOT INSTALLED — run `alembic upgrade head`",
            fg=typer.colors.RED,
        )
    typer.echo(f"  alembic revision       {revision or 'none — run `alembic upgrade head`'}")

    if postgis is None or revision is None:
        raise typer.Exit(code=1)


@app.command("storage-check")
def storage_check(
    create_bucket: Annotated[
        bool,
        typer.Option("--create-bucket", help="Create the bucket (private) if missing."),
    ] = False,
) -> None:
    """Round-trip a probe object through the configured media-storage backend.

    Writes a throwaway object under a dedicated `_healthcheck/` prefix, signs it,
    confirms it exists and deletes it again — so a green run proves the credentials,
    the bucket and the signing endpoint all work before any evidence photo depends
    on them. `--create-bucket` provisions a fresh Supabase project's bucket first.
    """
    import uuid as uuid_module

    from app.core.config import settings as app_settings
    from app.storage import (
        SupabaseMediaStorage,
        media_storage_from_settings,
        resolve_storage_backend,
    )
    from app.storage.consts import (
        HEALTHCHECK_BODY,
        HEALTHCHECK_CONTENT_TYPE,
        HEALTHCHECK_KEY_TEMPLATE,
    )

    backend = resolve_storage_backend(app_settings)
    typer.secho("\nstorage-check", fg=typer.colors.CYAN, bold=True)
    typer.echo(f"  backend                {backend.value}")

    try:
        storage = media_storage_from_settings(app_settings)
    except Exception as exc:
        typer.secho(f"  configuration FAILED: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    key = HEALTHCHECK_KEY_TEMPLATE.format(token=uuid_module.uuid4())
    try:
        if create_bucket and isinstance(storage, SupabaseMediaStorage):
            created = storage.ensure_bucket()
            typer.echo(f"  bucket                 {'created' if created else 'already existed'}")

        storage.put(key, HEALTHCHECK_BODY, HEALTHCHECK_CONTENT_TYPE)
        url = storage.get_url(key)
        present = storage.exists(key)
        storage.delete(key)
    except Exception as exc:
        typer.secho(f"  round-trip FAILED: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    typer.secho(f"  put/sign/stat/delete   OK (signed URL {len(url)} chars)", fg=typer.colors.GREEN)
    if not present:
        typer.secho("  exists() returned False after put", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1)


if __name__ == "__main__":  # pragma: no cover
    app()
