"""Kashroot admin CLI.

    kashroot seed-import --dry-run     # diff review, writes nothing
    kashroot seed-import               # apply
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

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


if __name__ == "__main__":  # pragma: no cover
    app()
