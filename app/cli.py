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


if __name__ == "__main__":  # pragma: no cover
    app()
