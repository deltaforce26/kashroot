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
import math
import re
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Protocol

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.ingestion.places_resolve_consts import (
    LANGUAGE_CODE,
    LOCATION_BIAS_RADIUS_M,
    MAX_DISTANCE_M,
    MAX_RESULT_COUNT,
    PIPELINE,
    PIPELINE_VERSION,
    REASON_ACCEPTED,
    REASON_MISSING_LOCATION,
    REASON_NO_CANDIDATES,
    REASON_NO_GEO,
    REASON_TOO_FAR,
    REGION_CODE,
    SOURCE,
)
from app.models import AuditAction, AuditLog, IngestionRun, IngestionRunState, Restaurant

#: Matches app.api.public._POINT_TEXT_PATTERN — the raw EWKT/WKT text
#: tests/conftest.py stores Restaurant.geo as (Geography is compiled to TEXT for
#: SQLite there; real PostGIS returns a geoalchemy2 WKBElement instead).
_POINT_TEXT_PATTERN = re.compile(r"POINT\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)", re.IGNORECASE)

#: Mean Earth radius (m), for the haversine distance used to score candidates.
_EARTH_RADIUS_M = 6_371_000.0


class PlacesResolveError(RuntimeError):
    """Raised on conditions this pipeline refuses to work around."""


class TextSearcher(Protocol):
    """Anything that answers a Places (New) Text Search request body with the raw
    response. :class:`app.services.places.GooglePlacesClient` is the real
    implementation; tests supply a fake.
    """

    def search_text(self, body: dict[str, Any]) -> dict[str, Any]:  # pragma: no cover
        ...


def extract_lat_lng(geo: Any) -> tuple[float, float] | None:
    """
    Extract (lat, lng) from a ``Restaurant.geo`` value.

    Handles both the real driver's value (a geoalchemy2 ``WKBElement`` against real
    PostGIS) and the raw EWKT/WKT string SQLite tests store, matching
    ``app.api.public._geo_point_out``.

    Parameters:
        geo (Any): The raw ``Restaurant.geo`` attribute value, or ``None``.

    Return:
        tuple[float, float] | None: ``(lat, lng)``, or ``None`` when there is no
            point.
    """
    if geo is None:
        return None
    if isinstance(geo, str):
        match = _POINT_TEXT_PATTERN.search(geo)
        if match is None:
            return None
        lon, lat = float(match.group(1)), float(match.group(2))

        return lat, lon

    from geoalchemy2.shape import to_shape

    shapely_point = to_shape(geo)

    return shapely_point.y, shapely_point.x


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Great-circle distance between two WGS-84 points, in meters.

    Parameters:
        lat1 (float): First point's latitude, degrees.
        lon1 (float): First point's longitude, degrees.
        lat2 (float): Second point's latitude, degrees.
        lon2 (float): Second point's longitude, degrees.

    Return:
        float: Distance in meters (spherical-Earth approximation).
    """
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = phi2 - phi1
    delta_lambda = math.radians(lon2 - lon1)
    haversine = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )

    return 2 * _EARTH_RADIUS_M * math.asin(math.sqrt(haversine))


def build_text_query(name_he: str | None, address_he: str | None, city_he: str | None) -> str:
    """
    Build the Text Search ``textQuery`` (and its logging key): business name,
    street address, city — whichever parts exist.

    Parameters:
        name_he (str | None): The restaurant's Hebrew name.
        address_he (str | None): The restaurant's Hebrew street address.
        city_he (str | None): The restaurant's Hebrew city name.

    Return:
        str: The space-joined query text.
    """
    parts = [p for p in (name_he, address_he, city_he) if p]

    return " ".join(parts)


def build_search_text_body(query: str, origin_lat: float, origin_lon: float) -> dict[str, Any]:
    """
    Build the Places (New) Text Search request body.

    Parameters:
        query (str): ``build_text_query``'s result.
        origin_lat (float): The restaurant's own geocoded latitude (location bias
            center).
        origin_lon (float): The restaurant's own geocoded longitude.

    Return:
        dict[str, Any]: The JSON request body.
    """
    return {
        "textQuery": query,
        "languageCode": LANGUAGE_CODE,
        "regionCode": REGION_CODE,
        "locationBias": {
            "circle": {
                "center": {"latitude": origin_lat, "longitude": origin_lon},
                "radius": LOCATION_BIAS_RADIUS_M,
            }
        },
        "maxResultCount": MAX_RESULT_COUNT,
    }


@dataclass(frozen=True)
class ResolveDecision:
    """What one raw Text Search response means for one restaurant. Pure — no I/O."""

    accept: bool
    reason: str
    place_id: str | None = None
    display_name: str | None = None
    distance_m: float | None = None
    business_status: str | None = None


def classify_candidates(
    response: dict[str, Any], origin_lat: float, origin_lon: float
) -> ResolveDecision:
    """
    Accept the first candidate within ``MAX_DISTANCE_M`` of the restaurant's own
    geocoded point; reject (and write nothing) otherwise. Pure function over
    (raw response x origin point).

    Parameters:
        response (dict[str, Any]): The raw Text Search JSON.
        origin_lat (float): The restaurant's own geocoded latitude.
        origin_lon (float): The restaurant's own geocoded longitude.

    Return:
        ResolveDecision: The accept/reject decision, with evidence either way.
    """
    places = response.get("places") or []
    if not places:
        return ResolveDecision(accept=False, reason=REASON_NO_CANDIDATES)

    nearest_distance: float | None = None
    nearest_name: str | None = None
    for place in places:
        location = place.get("location") or {}
        lat, lng = location.get("latitude"), location.get("longitude")
        display_name = ((place.get("displayName") or {}).get("text")) or None
        if lat is None or lng is None:
            continue
        distance = haversine_m(origin_lat, origin_lon, float(lat), float(lng))
        if nearest_distance is None or distance < nearest_distance:
            nearest_distance = distance
            nearest_name = display_name
        if distance <= MAX_DISTANCE_M:
            return ResolveDecision(
                accept=True,
                reason=REASON_ACCEPTED,
                place_id=place.get("id"),
                display_name=display_name,
                distance_m=distance,
                business_status=place.get("businessStatus"),
            )

    if nearest_distance is None:
        return ResolveDecision(accept=False, reason=REASON_MISSING_LOCATION)

    return ResolveDecision(
        accept=False,
        reason=REASON_TOO_FAR,
        display_name=nearest_name,
        distance_m=nearest_distance,
    )


@dataclass
class ResolveRow:
    """One restaurant's outcome — what the CLI's dry-run table prints."""

    restaurant_id: str
    name_he: str
    candidate_name: str | None
    distance_m: float | None
    decision: str


@dataclass
class ResolveStats:
    candidates: int = 0
    already_resolved: int = 0
    excluded_no_geo: int = 0
    api_calls: int = 0
    accepted: int = 0
    rejected: int = 0
    skipped_concurrent: int = 0
    reasons: dict[str, int] = field(default_factory=dict)
    rows: list[ResolveRow] = field(default_factory=list)

    def note_reason(self, reason: str) -> None:
        self.reasons[reason] = self.reasons.get(reason, 0) + 1

    def as_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result.pop("rows")

        return result


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
        query = query.where(Restaurant.google_business_place_id.is_(None))
    if city:
        query = query.where(Restaurant.city_slug == city)
    query = query.order_by(Restaurant.city_slug, Restaurant.name_he, Restaurant.dedupe_key)
    if limit is not None:
        query = query.limit(limit)
    targets = list(session.scalars(query))
    stats.candidates = len(targets)

    already_q = select(Restaurant).where(
        Restaurant.geo.is_not(None), Restaurant.google_business_place_id.is_not(None)
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
            _note(stats, restaurant, None, None, REASON_NO_GEO)
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

        decision = classify_candidates(response, origin[0], origin[1])
        _note(stats, restaurant, decision.display_name, decision.distance_m, decision.reason)

        if not decision.accept:
            stats.rejected += 1
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
) -> None:
    stats.note_reason(reason)
    stats.rows.append(
        ResolveRow(
            restaurant_id=str(restaurant.id),
            name_he=restaurant.name_he,
            candidate_name=candidate_name,
            distance_m=distance_m,
            decision=reason,
        )
    )


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
