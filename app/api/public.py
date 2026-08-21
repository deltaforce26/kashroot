"""Public (consumer-facing) API — ``/v1/*``.

No auth, no accounts, no sessions: the kashrut profile travels in the request body on
every call (POC_PLAN.md B3 — a deliberate shortcut around the still-open PRD §21.4
user-auth decision). Every handler here only reads; nothing on this router writes to
the database.

Layer 1 (kashrut verdict) and Layer 2 (fit score) are computed by the pure functions
in ``app.match``, via the adapter in ``app.services.matching`` — this module never
evaluates kashrut logic itself, only fetches rows and serializes engine output.
"""

from __future__ import annotations

import datetime as dt
import math
import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import Select, func, literal, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.consts import (
    EARTH_RADIUS_KM,
    ERROR_RESTAURANT_NOT_FOUND,
    LIKE_ESCAPE_CHAR,
    MAX_QUERY_ROWS,
    METERS_PER_KM,
)
from app.api.schemas_public import (
    CertificateEvidenceOut,
    CertifierChip,
    CertifierListItem,
    DecidingCertificateOut,
    FitComponentOut,
    FitScoreOut,
    FreshnessOut,
    GeoPoint,
    GeoPointOut,
    KashrutVerdictOut,
    ProvenanceOut,
    ReasonOut,
    RestaurantDetailRequest,
    RestaurantDetailResponse,
    SearchRequest,
    SearchResponse,
    SearchResultItem,
)
from app.db.session import get_session
from app.match import (
    CertificateEvaluation,
    FitScoreResult,
    FreshnessInfo,
    MatchResult,
    Reason,
    Verdict,
    compute_fit_score,
)
from app.models import (
    CERTIFICATION_LEVEL_ORDER,
    Certificate,
    CertificationLevel,
    Certifier,
    Restaurant,
    RestaurantStatus,
)
from app.services.matching import (
    evaluate_restaurant_kashrut,
    fit_candidate_from_restaurant,
    fit_preferences_from_profile,
    profile_input_from_request,
)

router = APIRouter(prefix="/v1", tags=["public"])

#: Matches the ``"SRID=4326;POINT(lon lat)"`` / ``"POINT(lon lat)"`` text this project
#: writes for geo points (see ``app.ingestion.geocode``) and that SQLite tests store
#: verbatim — ``tests/conftest.py`` compiles the Geography column down to TEXT, so no
#: PostGIS function ever runs against it.
_POINT_TEXT_PATTERN = re.compile(r"POINT\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)", re.IGNORECASE)

#: Display-order precedence for ``/v1/search`` results: PRD FR3 requires the Layer 1
#: verdict to be the PRIMARY sort key across restaurants in a list response (MATCH
#: before UNKNOWN before NO_MATCH), with the Layer 2 fit score only breaking ties
#: *within* a verdict class — a NO_MATCH restaurant must never outrank a MATCH one no
#: matter its fit score. This is a display-ordering concern for one list response and
#: is deliberately a separate constant from ``app.match.engine._VERDICT_PRECEDENCE``,
#: which resolves several certificates on a single restaurant into one verdict — a
#: different concern with (coincidentally) the same ordering. Do not import one for
#: the other; do not fold them into a shared constant.
_SEARCH_RESULT_VERDICT_ORDER: dict[Verdict, int] = {
    Verdict.MATCH: 0,
    Verdict.UNKNOWN: 1,
    Verdict.NO_MATCH: 2,
}


def _point_ewkt(point: GeoPoint) -> str:
    """WKT longitude-latitude point text for PostGIS, SRID 4326.

    Parameters:
        point (GeoPoint): the coordinate.

    Return:
        str: EWKT text (``"SRID=4326;POINT(lon lat)"``) for ``ST_GeogFromText``.
    """

    return f"SRID=4326;POINT({point.lon} {point.lat})"


def _geo_point_out(geo: Any) -> GeoPointOut | None:
    """Extract lat/lon from a ``Restaurant.geo`` value.

    Handles both the real driver's value (a geoalchemy2 ``WKBElement`` against real
    PostGIS) and the raw EWKT/WKT string SQLite tests store (``tests/conftest.py``
    compiles the Geography column down to TEXT, so no PostGIS function ever runs
    there).

    Parameters:
        geo (Any): the raw ``Restaurant.geo`` attribute value, or None.

    Return:
        GeoPointOut | None: the coordinate, or None when the restaurant has no geo.
    """
    if geo is None:
        return None
    if isinstance(geo, str):
        match = _POINT_TEXT_PATTERN.search(geo)
        if match is None:
            return None
        lon, lat = float(match.group(1)), float(match.group(2))

        return GeoPointOut(lat=lat, lon=lon)

    from geoalchemy2.shape import to_shape

    shapely_point = to_shape(geo)

    return GeoPointOut(lat=shapely_point.y, lon=shapely_point.x)


def _haversine_km(center: GeoPoint, point: GeoPointOut) -> float:
    """Great-circle distance between two WGS-84 points, in kilometres.

    Pure and approximate (spherical Earth). This is a **fallback only**: it exists
    because ``tests/conftest.py`` compiles ``Restaurant.geo`` down to a plain SQLite
    TEXT column for the test suite, so ``ST_Distance`` cannot run there. Production
    (PostgreSQL/PostGIS) never reaches this function — see ``_restaurant_distance_km``,
    which is the single source of truth both ``/v1/search`` and the detail endpoint
    share, and which only falls back to this approximation when the session is not
    bound to PostgreSQL.

    Parameters:
        center (GeoPoint): the request's reference point.
        point (GeoPointOut): the restaurant's geo point.

    Return:
        float: distance in kilometres.
    """
    lat1, lon1 = math.radians(center.lat), math.radians(center.lon)
    lat2, lon2 = math.radians(point.lat), math.radians(point.lon)
    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1
    haversine = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )

    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(haversine))


def _restaurant_distance_km(
    session: Session, restaurant: Restaurant, center: GeoPoint | None
) -> float | None:
    """Distance from ``center`` to ``restaurant.geo``, in kilometres.

    The single source of truth for restaurant distance: both ``/v1/search`` (via
    ``build_search_statement``'s ``ST_Distance`` column) and this function measure the
    same PostGIS geography distance, so the same restaurant/center pair can never
    report two different ``distance_km`` values between the list and detail views
    (the bug this function replaces — the detail endpoint used to compute a separate
    Python haversine approximation).

    Falls back to ``_haversine_km`` only when the session is not bound to PostgreSQL —
    guarded explicitly by dialect name, never silently — because
    ``tests/conftest.py`` compiles ``Restaurant.geo`` to plain SQLite TEXT for the test
    suite, where ``ST_Distance`` cannot execute (see ``tests/test_search_geo_query.py``
    for the equivalent, deliberate gap on the search path).

    Parameters:
        session (Session): the active DB session; used to detect the SQL dialect and,
            on PostgreSQL, to run the scalar ``ST_Distance`` query.
        restaurant (Restaurant): the restaurant to measure distance to.
        center (GeoPoint | None): the request's reference point, or None.

    Return:
        float | None: distance in kilometres, or None when there is no center or the
            restaurant has no geo point.
    """
    if center is None or restaurant.geo is None:
        return None

    bind = session.get_bind()
    if bind.dialect.name == "postgresql":
        point = func.ST_GeogFromText(_point_ewkt(center))
        distance_m = session.execute(
            select(func.ST_Distance(Restaurant.geo, point)).where(Restaurant.id == restaurant.id)
        ).scalar_one()

        return distance_m / METERS_PER_KM

    geo_point = _geo_point_out(restaurant.geo)
    if geo_point is None:
        return None

    return _haversine_km(center, geo_point)


def _escape_like_value(value: str) -> str:
    """Escape SQL LIKE/ILIKE wildcards in user-supplied search text.

    Guarantees the literal characters ``%`` and ``_`` in ``value`` are matched
    literally rather than as wildcards, and that a literal backslash does not itself
    become an unintended escape — so ``request.query`` can never widen the intended
    substring match into something the user did not type.

    Parameters:
        value (str): the raw, already-trimmed query text.

    Return:
        str: the same text with ``\\``, ``%`` and ``_`` escaped for use with
            ``escape=LIKE_ESCAPE_CHAR``.
    """
    escaped = value.replace(LIKE_ESCAPE_CHAR, LIKE_ESCAPE_CHAR * 2)
    escaped = escaped.replace("%", f"{LIKE_ESCAPE_CHAR}%")
    escaped = escaped.replace("_", f"{LIKE_ESCAPE_CHAR}_")

    return escaped


def build_search_statement(request: SearchRequest) -> Select[Any]:
    """Build the restaurant search SELECT: hard filters, radius filter, distance
    column and ordering (POC_PLAN.md B6 — the first real PostGIS geography query in
    the project). Layer 1/Layer 2 evaluation and pagination happen afterward, in
    Python, over the fetched rows.

    Every row is a ``(Restaurant, distance_m)`` pair; ``distance_m`` is a SQL NULL
    literal when the request has no ``center`` — a plain city/filters search has no
    reference point to measure distance from. When a ``center`` is supplied, the
    radius filter (``ST_DWithin``) and the ordering both use the geography index on
    ``Restaurant.geo`` (``ix_restaurant_geo``, migration 0001) — no new index is
    needed for this query shape.

    Built with ``func.ST_Distance``/``func.ST_DWithin`` rather than the geoalchemy2
    comparator methods (e.g. ``Restaurant.geo.ST_Distance(...)``): both generate
    identical SQL, but the ``func.*`` form does not depend on ``Restaurant.geo``'s
    live SQLAlchemy column type still being ``Geography`` — ``tests/conftest.py``
    swaps that type to plain TEXT for SQLite, in place, process-wide, the first time
    any test uses the ``session`` fixture, which would otherwise make this
    statement's shape depend on test execution order.

    ``request.query`` (Change 3), when present, narrows the candidate set with an
    ``ILIKE`` (case-insensitive on PostgreSQL; SQLAlchemy compiles ``ilike()`` to
    ``lower(x) LIKE lower(y)`` on SQLite, so the same code path runs against both) OR
    across ``name_he`` / ``name_en`` / ``address_he``. This is an exact substring
    match on the stored text — no fuzzy matching, no niqqud stripping, no
    plene/defective spelling normalization — and it only ever adds a WHERE clause; it
    never touches this function's ORDER BY.

    Parameters:
        request (SearchRequest): the validated search request.

    Return:
        Select[Any]: the statement, ready to execute; each row is
            ``(Restaurant, distance_m: float | None)``.
    """
    stmt = select(Restaurant).where(Restaurant.status == RestaurantStatus.OPEN)
    if request.city:
        stmt = stmt.where(Restaurant.city_slug == request.city)
    if request.filters.diet_type is not None:
        stmt = stmt.where(Restaurant.diet_type == request.filters.diet_type)
    if request.filters.price_level is not None:
        stmt = stmt.where(Restaurant.price_level == request.filters.price_level)
    if request.query:
        pattern = f"%{_escape_like_value(request.query)}%"
        stmt = stmt.where(
            or_(
                Restaurant.name_he.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                Restaurant.name_en.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                Restaurant.address_he.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
            )
        )

    if request.center is not None:
        point = func.ST_GeogFromText(_point_ewkt(request.center))
        distance_m = func.ST_Distance(Restaurant.geo, point).label("distance_m")
        stmt = stmt.where(
            Restaurant.geo.is_not(None),
            func.ST_DWithin(Restaurant.geo, point, request.radius_km * METERS_PER_KM),
        )
        stmt = stmt.add_columns(distance_m).order_by(distance_m.asc())
    else:
        stmt = stmt.add_columns(literal(None).label("distance_m")).order_by(
            Restaurant.name_he.asc()
        )

    stmt = stmt.options(
        selectinload(Restaurant.certificates).joinedload(Certificate.certifier)
    ).limit(MAX_QUERY_ROWS)

    return stmt


def _restaurant_amenities_satisfy(restaurant: Restaurant, wanted: list[Any]) -> bool:
    """True when every wanted amenity is explicitly present on the restaurant.

    Parameters:
        restaurant (Restaurant): the restaurant.
        wanted (list[Any]): ``AmenityKey`` values the search filter requires.

    Return:
        bool: whether the restaurant satisfies every wanted amenity.
    """

    return all(restaurant.amenities.get(amenity.value) is True for amenity in wanted)


def _reason_list(reasons: tuple[Reason, ...]) -> list[ReasonOut]:
    """Serialize the engine's reason codes as-is, preserving order.

    Guarantees the output list has exactly one ``ReasonOut`` per input ``Reason``, in
    the same order, with no filtering or deduplication — the engine already decides
    which reasons are worth reporting.

    Parameters:
        reasons (tuple[Reason, ...]): reason codes from a ``MatchResult`` or
            ``CertificateEvaluation``.

    Return:
        list[ReasonOut]: the same reasons as API output models.
    """

    return [ReasonOut(code=reason.code, attribute=reason.attribute) for reason in reasons]


def _freshness_out(freshness: FreshnessInfo | None) -> FreshnessOut | None:
    """Serialize the engine's freshness info, if any was computed.

    Guarantees None in, None out — a verdict with no freshness info (e.g. no
    certificate at all) never fabricates one on the way out.

    Parameters:
        freshness (FreshnessInfo | None): freshness info from the engine, or None.

    Return:
        FreshnessOut | None: the same data as an API output model, or None.
    """
    if freshness is None:
        return None

    return FreshnessOut(
        verified_at=freshness.verified_at,
        evidence_age_days=freshness.evidence_age_days,
        valid_until=freshness.valid_until,
        days_until_expiry=freshness.days_until_expiry,
        is_stale=freshness.is_stale,
        expires_soon=freshness.expires_soon,
    )


def _kashrut_verdict_out(result: MatchResult) -> KashrutVerdictOut:
    """Serialize a Layer 1 ``MatchResult`` for the API response.

    Guarantees the verdict, reasons, confidence and freshness travel unchanged from
    the engine's output — this function performs no kashrut logic of its own, only
    field mapping (including the deciding certificate id's string-to-UUID conversion).

    Parameters:
        result (MatchResult): the engine's Layer 1 output for one restaurant.

    Return:
        KashrutVerdictOut: the same verdict as an API output model.
    """

    return KashrutVerdictOut(
        verdict=result.verdict,
        reasons=_reason_list(result.reasons),
        confidence=result.confidence,
        freshness=_freshness_out(result.freshness),
        deciding_certificate_id=(
            uuid.UUID(result.deciding_certificate_id)
            if result.deciding_certificate_id is not None
            else None
        ),
    )


def _fit_score_out(result: FitScoreResult) -> FitScoreOut:
    """Serialize a Layer 2 ``FitScoreResult`` for the API response.

    Guarantees the 0-100 score and every component travel unchanged from the engine's
    output, in a schema with no verdict field alongside it — Layer 1 and Layer 2 are
    never blended into one object.

    Parameters:
        result (FitScoreResult): the engine's Layer 2 output for one restaurant.

    Return:
        FitScoreOut: the same fit score as an API output model.
    """

    return FitScoreOut(
        score=result.score,
        components=[
            FitComponentOut(name=component.name, value=component.value, weight=component.weight)
            for component in result.components
        ],
    )


def _certifier_chip(certifier: Certifier) -> CertifierChip:
    """Serialize a certifier's display identity only — no attributes.

    Guarantees only id/name/type are exposed, never certificate-level facts (level,
    attributes) — those live on ``Certificate`` per AGENTS.md, not ``Certifier``.

    Parameters:
        certifier (Certifier): the certifier row.

    Return:
        CertifierChip: the certifier's display identity as an API output model.
    """

    return CertifierChip(
        id=certifier.id,
        name_he=certifier.name_he,
        name_en=certifier.name_en,
        type=certifier.type,
    )


def _certifier_chips(restaurant: Restaurant) -> list[CertifierChip]:
    """Every distinct certifier that has certified this restaurant, deduplicated.

    Guarantees at most one chip per ``certifier_id`` even when the restaurant has
    multiple certificates from the same certifier, in first-seen order.

    Parameters:
        restaurant (Restaurant): the restaurant, with ``certificates`` loaded.

    Return:
        list[CertifierChip]: one chip per distinct certifier.
    """
    seen: dict[uuid.UUID, CertifierChip] = {}
    for certificate in restaurant.certificates:
        if certificate.certifier_id not in seen:
            seen[certificate.certifier_id] = _certifier_chip(certificate.certifier)

    return list(seen.values())


def _deciding_certificate_out(
    restaurant: Restaurant, kashrut: MatchResult
) -> DecidingCertificateOut | None:
    """Identify which certificate the Layer 1 gate resolved on (Change 2).

    Reads ``kashrut.deciding_certificate_id`` — already computed by
    ``app.match.engine.evaluate_kashrut`` via ``app.services.matching`` — and looks up
    the matching row in ``restaurant.certificates`` to expose its certifier identity
    and published level. Performs no kashrut evaluation of its own: the gate's
    decision travels through unchanged, this function only resolves the id to a
    display object.

    Parameters:
        restaurant (Restaurant): the restaurant, with ``certificates`` eager-loaded.
        kashrut (MatchResult): the already-computed Layer 1 verdict.

    Return:
        DecidingCertificateOut | None: the deciding certificate's identity, or None
            when the gate had no certificate to decide on (e.g. NO_CERTIFICATE).
    """
    if kashrut.deciding_certificate_id is None:
        return None

    for certificate in restaurant.certificates:
        if str(certificate.id) == kashrut.deciding_certificate_id:
            return DecidingCertificateOut(
                certificate_id=certificate.id,
                certifier=_certifier_chip(certificate.certifier),
                level=certificate.level,
            )

    return None


def _search_result_item(
    restaurant: Restaurant,
    distance_km: float | None,
    kashrut: MatchResult,
    fit: FitScoreResult,
) -> SearchResultItem:
    """Assemble one ``/v1/search`` result row from a restaurant and its evaluations.

    Guarantees a pure field-mapping step: this function never re-derives or overrides
    the ``kashrut``/``fit`` values it is given, and never orders or filters — that is
    the caller's job (``search_restaurants``).

    Parameters:
        restaurant (Restaurant): the restaurant row.
        distance_km (float | None): distance from the search center, or None.
        kashrut (MatchResult): the already-computed Layer 1 verdict.
        fit (FitScoreResult): the already-computed Layer 2 fit score.

    Return:
        SearchResultItem: one row of the search response.
    """

    return SearchResultItem(
        restaurant_id=restaurant.id,
        name_he=restaurant.name_he,
        name_en=restaurant.name_en,
        city_he=restaurant.city_he,
        address_he=restaurant.address_he,
        geo=_geo_point_out(restaurant.geo),
        distance_km=distance_km,
        diet_type=restaurant.diet_type,
        kashrut=_kashrut_verdict_out(kashrut),
        fit=_fit_score_out(fit),
        certifiers=_certifier_chips(restaurant),
        deciding_certificate=_deciding_certificate_out(restaurant, kashrut),
    )


@router.get("/certifiers", response_model=list[CertifierListItem])
def list_certifiers(session: Session = Depends(get_session)) -> list[CertifierListItem]:
    """All active certifiers, for the client's whitelist picker (POC_PLAN.md B2).

    ``levels`` is computed from what certificates actually carry (not a static list on
    ``Certifier``, per AGENTS.md — attributes and published levels live on
    ``Certificate``), excluding UNKNOWN since that means "not published" rather than a
    selectable level.
    """
    certifiers = session.scalars(
        select(Certifier).where(Certifier.is_active.is_(True)).order_by(Certifier.name_he.asc())
    ).all()

    level_rows = session.execute(
        select(Certificate.certifier_id, Certificate.level)
        .where(Certificate.level != CertificationLevel.UNKNOWN)
        .distinct()
    ).all()
    levels_by_certifier: dict[uuid.UUID, list[CertificationLevel]] = {}
    for certifier_id, level in level_rows:
        levels_by_certifier.setdefault(certifier_id, []).append(level)

    return [
        CertifierListItem(
            id=certifier.id,
            name_he=certifier.name_he,
            name_en=certifier.name_en,
            type=certifier.type,
            levels=sorted(
                levels_by_certifier.get(certifier.id, []),
                key=lambda level: CERTIFICATION_LEVEL_ORDER[level],
            ),
        )
        for certifier in certifiers
    ]


@router.post("/search", response_model=SearchResponse)
def search_restaurants(
    body: SearchRequest, session: Session = Depends(get_session)
) -> SearchResponse:
    """Layer 1 verdict + Layer 2 fit score for every open restaurant matching the hard
    filters (POC_PLAN.md B3, B6). Ranked by the Layer 1 verdict first (MATCH, then
    UNKNOWN, then NO_MATCH — PRD FR3), and only within a verdict class by fit score
    descending, then distance ascending, then name, as tiebreaks. The distance-ordered
    SQL query itself demonstrates the real PostGIS radius filter, but that ordering is
    superseded by this verdict-then-fit-score ranking before the response is built —
    kashrut and fit score are never blended into one number, only used as sequential
    sort keys (see ``_SEARCH_RESULT_VERDICT_ORDER``). ``body.query`` (Change 3) only
    narrows the candidate set fetched by ``build_search_statement`` before any of this
    ranking runs — it never changes ordering.
    """
    profile_input = profile_input_from_request(body.profile)
    fit_preferences = fit_preferences_from_profile(body.profile)
    now = dt.datetime.now(dt.UTC)

    stmt = build_search_statement(body)
    rows = session.execute(stmt).all()

    evaluated: list[tuple[Restaurant, float | None, MatchResult, FitScoreResult]] = []
    for restaurant, distance_m in rows:
        if body.filters.amenities and not _restaurant_amenities_satisfy(
            restaurant, body.filters.amenities
        ):
            continue
        distance_km = distance_m / METERS_PER_KM if distance_m is not None else None
        kashrut = evaluate_restaurant_kashrut(restaurant, profile_input, now=now)
        fit = compute_fit_score(
            fit_candidate_from_restaurant(restaurant, distance_km=distance_km),
            fit_preferences,
        )
        evaluated.append((restaurant, distance_km, kashrut, fit))

    evaluated.sort(
        key=lambda item: (
            _SEARCH_RESULT_VERDICT_ORDER[item[2].verdict],
            -item[3].score,
            item[1] if item[1] is not None else float("inf"),
            item[0].name_he,
        )
    )

    total = len(evaluated)
    start = (body.page - 1) * body.page_size
    page_items = evaluated[start : start + body.page_size]

    return SearchResponse(
        total=total,
        page=body.page,
        page_size=body.page_size,
        items=[
            _search_result_item(restaurant, distance_km, kashrut, fit)
            for restaurant, distance_km, kashrut, fit in page_items
        ],
    )


def _certificate_evidence_out(
    certificate: Certificate, evaluation: CertificateEvaluation
) -> CertificateEvidenceOut:
    """Assemble one certificate's full evidence row for the restaurant detail response.

    Guarantees every certificate-level fact the product's "why am I seeing this
    answer" claim depends on is present in one object: the certifier chip, level,
    attributes, state, validity window, provenance, and this specific certificate's
    own outcome/reasons/confidence/freshness (as opposed to the restaurant's combined
    verdict) — the client needs no further request to explain the verdict.

    Parameters:
        certificate (Certificate): the certificate row, with ``certifier`` loaded.
        evaluation (CertificateEvaluation): this certificate's own Layer 1 evaluation,
            matched to it by certificate id.

    Return:
        CertificateEvidenceOut: one certificate's evidence as an API output model.
    """

    return CertificateEvidenceOut(
        certificate_id=uuid.UUID(evaluation.certificate_id),
        certifier=_certifier_chip(certificate.certifier),
        level=certificate.level,
        attributes=dict(certificate.attributes),
        state=certificate.state,
        valid_from=certificate.valid_from,
        valid_until=certificate.valid_until,
        provenance=ProvenanceOut(
            source=certificate.source,
            verified_by_label=certificate.verified_by_label,
            verified_at=certificate.verified_at,
            corroboration_count=certificate.corroboration_count,
            is_demo_seed=certificate.is_demo_seed,
        ),
        outcome=evaluation.outcome,
        reasons=_reason_list(evaluation.reasons),
        confidence=evaluation.confidence,
        freshness=_freshness_out(evaluation.freshness),
    )


@router.post("/restaurants/{restaurant_id}", response_model=RestaurantDetailResponse)
def get_restaurant_detail(
    restaurant_id: uuid.UUID,
    body: RestaurantDetailRequest,
    session: Session = Depends(get_session),
) -> RestaurantDetailResponse:
    """Full evidence for one restaurant against the request profile (POC_PLAN.md B4):
    every certificate, its certifier, its attributes with provenance, and the verdict
    reason codes behind them — enough for the client to render "why am I seeing this
    answer" from this response alone, with no further requests.

    POST (not GET) because, exactly like ``/v1/search``, the profile travels in the
    request body — there is no server-side session to evaluate against.
    """
    restaurant = session.get(
        Restaurant,
        restaurant_id,
        options=[selectinload(Restaurant.certificates).joinedload(Certificate.certifier)],
    )
    if restaurant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=ERROR_RESTAURANT_NOT_FOUND)

    profile_input = profile_input_from_request(body.profile)
    now = dt.datetime.now(dt.UTC)
    kashrut = evaluate_restaurant_kashrut(restaurant, profile_input, now=now)

    distance_km = _restaurant_distance_km(session, restaurant, body.center)

    fit = compute_fit_score(
        fit_candidate_from_restaurant(restaurant, distance_km=distance_km),
        fit_preferences_from_profile(body.profile),
    )

    evaluations_by_certificate_id = {
        evaluation.certificate_id: evaluation for evaluation in kashrut.evaluations
    }

    return RestaurantDetailResponse(
        restaurant_id=restaurant.id,
        name_he=restaurant.name_he,
        name_en=restaurant.name_en,
        address_he=restaurant.address_he,
        city_he=restaurant.city_he,
        phone=restaurant.phone,
        website=restaurant.website,
        diet_type=restaurant.diet_type,
        price_level=restaurant.price_level,
        amenities=dict(restaurant.amenities),
        geo=_geo_point_out(restaurant.geo),
        distance_km=distance_km,
        kashrut=_kashrut_verdict_out(kashrut),
        fit=_fit_score_out(fit),
        certificates=[
            _certificate_evidence_out(
                certificate, evaluations_by_certificate_id[str(certificate.id)]
            )
            for certificate in restaurant.certificates
        ],
    )
