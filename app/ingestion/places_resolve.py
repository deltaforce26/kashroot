"""Resolve each restaurant's *business* Google Places id via Places (New) Text
Search.

Sibling of :mod:`app.ingestion.geocode`, run after it: ``geocode`` fills
``Restaurant.geo`` and ``google_place_id`` from the legacy Geocoding API, queried as
``"{address}, {city}"`` — which resolves the *street address's* place id, not the
business's. A street-address place id carries no photos or opening hours, so
``app.services.places.PlacesService.enrichment`` came back empty for almost every
restaurant. This pipeline fills the separate ``google_business_place_id`` column by
searching for the business itself (name + address + city) and accepting a candidate
only when it is close enough to the restaurant's own geocoded point to be that same
business, never a same-address neighbor — doubt leaves the column null, exactly like
``geocode``'s own fail-safe rule (CLAUDE.md).

Same shape as ``geocode``: dry-run by default, idempotent (restaurants already
resolved are skipped unless ``force=True``), every acceptance audited, no plain
strings (:mod:`app.ingestion.places_resolve_consts`).
"""

from __future__ import annotations

import datetime as dt
import time
from typing import Any, Protocol

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.ingestion.places_match import (
    ResolveDecision,
    address_matches,
    classify_candidates,
    haversine_m,
)
from app.ingestion.places_resolve_consts import (
    BUSINESS_PLACE_SOURCE_SEED_CSV,
    BUSINESS_PLACE_SOURCE_TEXT_SEARCH,
    MAX_DISTANCE_M,
    MAX_DISTANCE_NO_HOUSE_NUMBER_M,
    PIPELINE,
    PIPELINE_VERSION,
    REASON_NO_GEO,
    SOURCE,
)
from app.ingestion.places_resolve_report import (
    ResolveRow,
    ResolveStats,
    _has_house_number,
    build_search_text_body,
    build_text_query,
    extract_lat_lng,
)
from app.models import AuditAction, AuditLog, IngestionRun, IngestionRunState, Restaurant

__all__ = [
    "ResolveDecision",
    "address_matches",
    "classify_candidates",
    "haversine_m",
    "PlacesResolveError",
    "TextSearcher",
    "extract_lat_lng",
    "build_text_query",
    "build_search_text_body",
    "ResolveRow",
    "ResolveStats",
    "_has_house_number",
    "resolve_places",
]


class PlacesResolveError(RuntimeError):
    """Raised on conditions this pipeline refuses to work around."""


class TextSearcher(Protocol):
    """Anything that answers a Places (New) Text Search request body with the raw
    response. :class:`app.services.places.GooglePlacesClient` is the real
    implementation; tests supply a fake.
    """

    def search_text(self, body: dict[str, Any]) -> dict[str, Any]:  # pragma: no cover
        ...


def resolve_places(
    session: Session,
    searcher: TextSearcher | None,
    *,
    dry_run: bool = True,
    actor: str = "cli",
    limit: int | None = None,
    city: str | None = None,
    force: bool = False,
    delay_ms: int = 50,
) -> ResolveStats:
    """
    Resolve ``google_business_place_id`` for restaurants with a geocoded point.

    ``dry_run=True`` (the default) calls the API and classifies candidates but rolls
    every restaurant mutation back — nothing is written; ``ResolveStats.rows`` still
    reports each restaurant's candidate/distance/decision, matching ``geocode``'s
    free-report shape. Restaurants already carrying a ``google_business_place_id``
    are skipped unless ``force=True``.

    Parameters:
        session (Session): The open session.
        searcher (TextSearcher | None): The Places Text Search client; required
            whenever there are candidates to resolve.
        dry_run (bool): Roll back restaurant writes when ``True`` (default).
        actor (str): Recorded on the ``IngestionRun`` / audit rows.
        limit (int | None): Resolve at most this many restaurants.
        city (str | None): Restrict to this ``city_slug``.
        force (bool): Re-resolve restaurants that already have a business place id.
        delay_ms (int): Politeness delay between Text Search calls.

    Return:
        ResolveStats: The run's diff summary.
    """
    run = IngestionRun(
        pipeline=PIPELINE,
        pipeline_version=PIPELINE_VERSION,
        source_label=SOURCE + (f" city={city}" if city else ""),
        actor=actor,
        dry_run=dry_run,
        state=IngestionRunState.RUNNING,
        started_at=dt.datetime.now(dt.UTC),
    )
    session.add(run)
    session.commit()
    run_id = run.id

    stats = ResolveStats()
    try:
        _run_resolve(
            session,
            searcher,
            run_id,
            stats,
            limit=limit,
            city=city,
            force=force,
            delay_ms=delay_ms,
        )
    except Exception as exc:
        session.rollback()
        _finish_run(session, run_id, IngestionRunState.FAILED, stats, error=str(exc))

        raise

    if dry_run:
        session.rollback()
    else:
        session.commit()
    _finish_run(session, run_id, IngestionRunState.COMPLETED, stats)

    return stats


def _finish_run(
    session: Session,
    run_id: Any,
    state: IngestionRunState,
    stats: ResolveStats,
    error: str | None = None,
) -> None:
    run = session.get(IngestionRun, run_id)
    if run is None:  # pragma: no cover - the run row is committed before work starts
        return
    run.state = state
    run.finished_at = dt.datetime.now(dt.UTC)
    run.stats = stats.as_dict()
    run.error = error
    session.commit()


def _run_resolve(
    session: Session,
    searcher: TextSearcher | None,
    run_id: Any,
    stats: ResolveStats,
    *,
    limit: int | None,
    city: str | None,
    force: bool,
    delay_ms: int,
) -> None:
    query = select(Restaurant).where(Restaurant.geo.is_not(None))
    if not force:
        # "Tried" is the timestamp, not the id: a rejection stamps the row too, so a
        # plain re-run never pays Google again for a restaurant it already decided.
        query = query.where(Restaurant.business_place_resolved_at.is_(None))
    else:
        # A seed-CSV id is deterministic and free — --force re-searches everything
        # *this pipeline* previously decided, never a row the CSV itself supplied.
        query = query.where(
            or_(
                Restaurant.business_place_source.is_(None),
                Restaurant.business_place_source != BUSINESS_PLACE_SOURCE_SEED_CSV,
            )
        )
    if city:
        query = query.where(Restaurant.city_slug == city)
    query = query.order_by(Restaurant.city_slug, Restaurant.name_he, Restaurant.dedupe_key)
    if limit is not None:
        query = query.limit(limit)
    targets = list(session.scalars(query))
    stats.candidates = len(targets)

    if force:
        protected_q = select(Restaurant).where(
            Restaurant.geo.is_not(None),
            Restaurant.business_place_source == BUSINESS_PLACE_SOURCE_SEED_CSV,
        )
        if city:
            protected_q = protected_q.where(Restaurant.city_slug == city)
        stats.protected_seed = len(list(session.scalars(protected_q)))

    already_q = select(Restaurant).where(
        Restaurant.geo.is_not(None), Restaurant.business_place_resolved_at.is_not(None)
    )
    if city:
        already_q = already_q.where(Restaurant.city_slug == city)
    stats.already_resolved = len(list(session.scalars(already_q)))

    no_geo_q = select(Restaurant).where(Restaurant.geo.is_(None))
    if city:
        no_geo_q = no_geo_q.where(Restaurant.city_slug == city)
    stats.excluded_no_geo = len(list(session.scalars(no_geo_q)))

    if not targets:
        return

    last_call_monotonic: float | None = None
    for restaurant in targets:
        origin = extract_lat_lng(restaurant.geo)
        if origin is None:
            stats.excluded_no_geo += 1
            _note(stats, restaurant, None, None, REASON_NO_GEO, origin=None)
            continue

        query_text = build_text_query(restaurant.name_he, restaurant.address_he, restaurant.city_he)
        body = build_search_text_body(query_text, origin[0], origin[1])

        if searcher is None:
            raise PlacesResolveError(
                "restaurants need resolving but no Places Text Search client was provided"
            )
        last_call_monotonic = _throttle(last_call_monotonic, delay_ms)
        response = searcher.search_text(body)
        stats.api_calls += 1

        radius_m = (
            MAX_DISTANCE_M
            if _has_house_number(restaurant.address_he)
            else MAX_DISTANCE_NO_HOUSE_NUMBER_M
        )
        decision = classify_candidates(
            response,
            origin[0],
            origin[1],
            restaurant.address_he,
            max_distance_m=radius_m,
        )
        _note(
            stats,
            restaurant,
            decision.display_name,
            decision.distance_m,
            decision.reason,
            radius_m,
            origin=origin,
        )

        if not decision.accept:
            stats.rejected += 1
            _mark_tried(session, restaurant)
            continue

        if _accept(session, restaurant, decision, run_id):
            stats.accepted += 1
        else:
            stats.skipped_concurrent += 1

    session.flush()


def _note(
    stats: ResolveStats,
    restaurant: Restaurant,
    candidate_name: str | None,
    distance_m: float | None,
    reason: str,
    radius_m: float | None = None,
    *,
    origin: tuple[float, float] | None = None,
) -> None:
    stats.note_reason(reason)
    stats.rows.append(
        ResolveRow(
            restaurant_id=str(restaurant.id),
            name_he=restaurant.name_he,
            candidate_name=candidate_name,
            distance_m=distance_m,
            decision=reason,
            radius_m=radius_m,
            address_he=restaurant.address_he,
            lat=origin[0] if origin else None,
            lng=origin[1] if origin else None,
        )
    )


def _mark_tried(session: Session, restaurant: Restaurant) -> None:
    """Stamp a rejected restaurant as decided, leaving its business id untouched.

    Parameters:
        session (Session): Open session; rolled back by the caller on dry runs.
        restaurant (Restaurant): The row Text Search found no acceptable match for.
    """
    session.execute(
        update(Restaurant)
        .where(Restaurant.id == restaurant.id)
        .values(business_place_resolved_at=dt.datetime.now(dt.UTC))
        .execution_options(synchronize_session=False)
    )
    session.expire(restaurant)


def _accept(
    session: Session,
    restaurant: Restaurant,
    decision: ResolveDecision,
    run_id: Any,
) -> bool:
    restaurant_id = restaurant.id
    resolved_at = dt.datetime.now(dt.UTC)
    result = session.execute(
        update(Restaurant)
        .where(Restaurant.id == restaurant_id, Restaurant.geo.is_not(None))
        .values(
            google_business_place_id=decision.place_id,
            business_place_resolved_at=resolved_at,
            business_place_source=BUSINESS_PLACE_SOURCE_TEXT_SEARCH,
        )
        .execution_options(synchronize_session=False)
    )
    session.expire(restaurant)
    if result.rowcount != 1:
        return False

    session.add(
        AuditLog(
            entity_type="restaurant",
            entity_id=restaurant_id,
            action=AuditAction.UPDATE,
            changes={
                "google_business_place_id": {"before": None, "after": decision.place_id},
                "business_place_resolved_at": {"before": None, "after": resolved_at.isoformat()},
            },
            actor=f"pipeline:{PIPELINE}@{PIPELINE_VERSION}",
            evidence={
                "source": SOURCE,
                "place_id": decision.place_id,
                "display_name": decision.display_name,
                "distance_m": decision.distance_m,
                "business_status": decision.business_status,
            },
            ingestion_run_id=run_id,
        )
    )

    return True


def _throttle(last_call_monotonic: float | None, delay_ms: int) -> float:
    """
    Sleep out the remainder of ``delay_ms`` since the previous call, matching
    ``app.ingestion.geocode.GoogleGeocoder._throttle``.

    Parameters:
        last_call_monotonic (float | None): ``time.monotonic()`` at the previous
            call, or ``None`` before the first one.
        delay_ms (int): The minimum delay between calls, in milliseconds.

    Return:
        float: ``time.monotonic()`` now, for the next call's comparison.
    """
    delay_s = delay_ms / 1000.0
    if last_call_monotonic is not None:
        elapsed = time.monotonic() - last_call_monotonic
        if elapsed < delay_s:
            time.sleep(delay_s - elapsed)

    return time.monotonic()
