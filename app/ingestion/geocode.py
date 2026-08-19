"""Geocoding pipeline — populate ``Restaurant.geo`` via the Google Geocoding API.

Sibling of :mod:`app.ingestion.seed_import`: versioned, idempotent, dry-run by default,
every write audited. What it will and will not do:

* **No silent guessing** (PRD NFR). A point is written only when Google returns exactly
  one candidate with a precise fix (``ROOFTOP`` / ``RANGE_INTERPOLATED``) whose locality
  matches the city we expected. Everything else — zero results, multiple candidates,
  approximate fixes, city mismatches, partial matches — flags the restaurant
  ``needs_review`` and writes **no point**. Doubt degrades, never resolves itself.
* **Never overwrites an existing point.** Candidates are restaurants with ``geo IS
  NULL`` only; a manually placed point (or one from a previous run) is never touched.
* **Never re-bills Google.** Every raw response is cached in ``geocode_cache`` keyed by
  the normalized query; cache rows survive dry-run rollback (they are evidence, not
  guesses) and re-runs resolve from them without an API call.
* **Restaurants already flagged ``needs_review``** (ambiguous OCR — the address itself
  is untrusted) are excluded: geocoding an untrusted address would launder a guess.

A dry run is free by default: uncached entries are reported as "would call API" and the
paid API is only touched when ``allow_api_calls`` is set (which ``--apply`` implies).
"""

from __future__ import annotations

import datetime as dt
import time
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from typing import Any, Protocol

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.ingestion.normalize import normalize_for_key, normalize_text
from app.models import (
    AuditAction,
    AuditLog,
    GeocodeCache,
    IngestionRun,
    IngestionRunState,
    Restaurant,
)

PIPELINE = "geocode"
PIPELINE_VERSION = "1.0.0"
SOURCE = "google_geocoding"

GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
#: Google statuses that mean "the run is broken, not the query" — abort, never cache.
ABORT_STATUSES = frozenset({"OVER_QUERY_LIMIT", "REQUEST_DENIED"})
#: The only location_type values precise enough to accept (Google Geocoding API docs).
PRECISE_LOCATION_TYPES = frozenset({"ROOFTOP", "RANGE_INTERPOLATED"})

#: city_slug → locality spellings accepted as "the same city". Google returns official
#: plene spellings (פתח תקווה, קריית גת) and municipal names (תל אביב-יפו,
#: פרדס חנה-כרכור) where certifier lists use defective spellings or neighborhood
#: names; without this table those rows would be over-flagged as city_mismatch.
#: Matching is still **exact** (after normalize_for_key) against this curated set —
#: nothing fuzzy, so it stays fail-safe. Covers the 5 launch cities plus every
#: city_slug in the seed corpus.
#:
#: ADDITIONS GO THROUGH REVIEW. A wrong alias here silently accepts wrong points.
CITY_LOCALITY_ALIASES: dict[str, frozenset[str]] = {
    # -- launch cities -----------------------------------------------------------
    "tel-aviv": frozenset({"תל אביב", "תל אביב-יפו", "תל אביב יפו", "Tel Aviv-Yafo"}),
    "jerusalem": frozenset({"ירושלים"}),
    "bnei-brak": frozenset({"בני ברק"}),
    "haifa": frozenset({"חיפה"}),
    "beer-sheva": frozenset({"באר שבע", "Be'er Sheva", "Beersheba"}),
    # -- seed corpus cities ------------------------------------------------------
    "afula": frozenset({"עפולה"}),
    "arad": frozenset({"ערד"}),
    "ashdod": frozenset({"אשדוד"}),
    "ashkelon": frozenset({"אשקלון"}),
    "bat-yam": frozenset({"בת ים"}),
    "beit-she-an": frozenset({"בית שאן"}),
    "beit-shemesh": frozenset({"בית שמש"}),
    "beitar-illit": frozenset({"ביתר עילית"}),
    "dalton": frozenset({"דלתון"}),
    "elad": frozenset({"אלעד"}),
    "emmanuel": frozenset({"עמנואל"}),
    "gedera": frozenset({"גדרה"}),
    "givat-shmuel": frozenset({"גבעת שמואל"}),
    "givat-ze-ev": frozenset({"גבעת זאב"}),
    "hadera": frozenset({"חדרה"}),
    "hafetz-haim": frozenset({"חפץ חיים"}),
    "harish": frozenset({"חריש"}),
    "hatzor-haglilit": frozenset({"חצור הגלילית"}),
    "herzliya": frozenset({"הרצליה", "הרצלייה"}),
    "holon": frozenset({"חולון"}),
    # Pisgat Ze'ev is a Jerusalem neighborhood; Google's locality is the city.
    "jerusalem-pisgat-ze-ev": frozenset({"פסגת זאב", "ירושלים"}),
    # Karmei Gat is a Kiryat Gat neighborhood.
    "karmei-gat": frozenset({"כרמי גת", "קרית גת", "קריית גת"}),
    "kiryat-ata": frozenset({"קרית אתא", "קריית אתא"}),
    "kiryat-gat": frozenset({"קרית גת", "קריית גת"}),
    "kiryat-malakhi": frozenset({"קרית מלאכי", "קריית מלאכי"}),
    "kiryat-motzkin": frozenset({"קרית מוצקין", "קריית מוצקין"}),
    # Kiryat Shmuel is inside the Haifa municipality.
    "kiryat-shmuel": frozenset({"קרית שמואל", "קריית שמואל", "חיפה"}),
    "kiryat-yam": frozenset({"קרית ים", "קריית ים"}),
    # "Krayot" in the source lists means "one of the Krayot" — accept each of them.
    "krayot": frozenset(
        {
            "קרית ים",
            "קריית ים",
            "קרית מוצקין",
            "קריית מוצקין",
            "קרית אתא",
            "קריית אתא",
            "קרית ביאליק",
            "קריית ביאליק",
        }
    ),
    "lod": frozenset({"לוד"}),
    "meron": frozenset({"מירון"}),
    "migdal-haemek": frozenset({"מגדל העמק"}),
    # Mishor Adumim is Ma'ale Adumim's industrial zone.
    "mishor-adumim": frozenset({"מישור אדומים", "מעלה אדומים"}),
    "nesher": frozenset({"נשר"}),
    "netanya": frozenset({"נתניה"}),
    "netivot": frozenset({"נתיבות"}),
    # Renamed from Nazareth Illit in 2019; stale data may use either.
    "nof-hagalil": frozenset({"נוף הגליל", "נצרת עילית"}),
    "ofakim": frozenset({"אופקים"}),
    "or-haganuz": frozenset({"אור הגנוז"}),
    "or-yehuda": frozenset({"אור יהודה"}),
    "pardes-hanna": frozenset({"פרדס חנה", "פרדס חנה-כרכור"}),
    "petah-tikva": frozenset({"פתח תקוה", "פתח תקווה"}),
    "ra-anana": frozenset({"רעננה"}),
    "ramat-gan": frozenset({"רמת גן"}),
    "ramla": frozenset({"רמלה"}),
    "rehovot": frozenset({"רחובות"}),
    "rekhasim": frozenset({"רכסים"}),
    "rishon-lezion": frozenset({"ראשון לציון"}),
    "safed": frozenset({"צפת"}),
    "sderot": frozenset({"שדרות"}),
    "shilat": frozenset({"שילת"}),
    "tiberias": frozenset({"טבריה"}),
    "yitzhar": frozenset({"יצהר"}),
    # Google returns the plene compound "יוקנעם עילית" for this address set; the
    # defective compound "יקנעם עילית" was already covered but not its plene form.
    "yokneam": frozenset({"יוקנעם", "יקנעם", "יקנעם עילית", "יוקנעם עילית"}),
    "zikhron-ya-akov": frozenset({"זכרון יעקב", "זיכרון יעקב"}),
}


class GeocodeError(RuntimeError):
    """Raised on conditions the pipeline refuses to work around."""


class GeocodeAbort(GeocodeError):
    """Provider said stop (quota exhausted, key rejected) — end the run cleanly."""


class Geocoder(Protocol):
    """Anything that answers a query with a raw Google-geocoding-shaped response."""

    def geocode(self, query: str) -> dict[str, Any]:  # pragma: no cover - protocol
        ...


class GoogleGeocoder:
    """Google Geocoding API client. Israel-biased (``region=il``), Hebrew results
    (``language=he``), restricted to Israel (``components=country:IL``).

    Transport concerns live here — politeness delay between calls, retry with backoff
    on HTTP 429/5xx. *Semantic* statuses (ZERO_RESULTS, OVER_QUERY_LIMIT…) are returned
    raw; the pipeline interprets them.
    """

    def __init__(
        self,
        api_key: str,
        *,
        delay_ms: int = 50,
        max_retries: int = 3,
        backoff_base_s: float = 0.5,
        timeout_s: float = 10.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if not api_key:
            raise GeocodeError("GoogleGeocoder requires an API key")
        self._api_key = api_key
        self._delay_s = delay_ms / 1000.0
        self._max_retries = max_retries
        self._backoff_base_s = backoff_base_s
        self._client = httpx.Client(timeout=timeout_s, transport=transport)
        self._last_call_monotonic: float | None = None

    def geocode(self, query: str) -> dict[str, Any]:
        """Never lets an httpx exception escape: their messages embed the full request
        URL — API key included — and both the CLI and ``IngestionRun.error`` would end
        up persisting it. Everything is re-raised sanitized (status + query only).
        """
        self._throttle()
        params = {
            "address": query,
            "region": "il",
            "language": "he",
            "components": "country:IL",
            "key": self._api_key,
        }
        last_status: int | None = None
        for attempt in range(self._max_retries + 1):
            if attempt:
                time.sleep(self._backoff_base_s * 2 ** (attempt - 1))
            try:
                response = self._client.get(GOOGLE_GEOCODE_URL, params=params)
            except httpx.RequestError as exc:
                # ``from None``: the chained httpx exception would carry the URL.
                raise GeocodeError(
                    f"network error ({type(exc).__name__}) while geocoding {query!r}"
                ) from None
            last_status = response.status_code
            if response.status_code == 429 or response.status_code >= 500:
                continue  # retry with backoff
            if response.is_error:  # non-retryable 4xx — sanitized, never raise_for_status
                raise GeocodeError(
                    f"Google Geocoding API returned HTTP {response.status_code} for {query!r}"
                )
            return response.json()
        raise GeocodeAbort(
            f"Google Geocoding API kept failing (HTTP {last_status}) after "
            f"{self._max_retries} retries — aborting run"
        )

    def _throttle(self) -> None:
        if self._last_call_monotonic is not None:
            elapsed = time.monotonic() - self._last_call_monotonic
            if elapsed < self._delay_s:
                time.sleep(self._delay_s - elapsed)
        self._last_call_monotonic = time.monotonic()


# --------------------------------------------------------------------------------------
# Pure classification — no I/O, exhaustively unit-tested.
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class GeocodeDecision:
    """What one raw response means for one restaurant."""

    accept: bool
    #: ``"ok"`` when accepted; otherwise the needs_review reason code.
    reason: str
    lat: float | None = None
    lng: float | None = None
    place_id: str | None = None
    formatted_address: str | None = None
    location_type: str | None = None
    locality: str | None = None


def build_geocode_query(address_he: str | None, city_he: str | None) -> str | None:
    """The provider query *and* the cache key. ``None`` when there is no street
    address — geocoding a bare business name or city centroid would be a guess.
    """
    address = normalize_text(address_he)
    if not address:
        return None
    city = normalize_text(city_he)
    return f"{address}, {city}" if city else address


def _result_locality(result: dict[str, Any]) -> str | None:
    for component in result.get("address_components", []):
        types = component.get("types", [])
        if "locality" in types or "postal_town" in types:
            return component.get("long_name")
    return None


def classify_response(
    response: dict[str, Any],
    expected_cities: Sequence[str | None],
    *,
    city_slug: str | None = None,
) -> GeocodeDecision:
    """Accept only a single precise candidate in the expected city; everything else is
    a needs_review reason. Pure function over (raw response × expected city names).

    ``city_slug`` widens the expected set with the curated spellings in
    CITY_LOCALITY_ALIASES (plene/defective variants, municipal names) — still an
    exact-match check, never fuzzy.
    """
    status = response.get("status")
    if status in ABORT_STATUSES:  # defensive: such responses are never cached
        raise GeocodeAbort(f"provider status {status}")
    if status == "ZERO_RESULTS":
        return GeocodeDecision(accept=False, reason="zero_results")
    if status != "OK":
        return GeocodeDecision(accept=False, reason="unexpected_status")

    results = response.get("results") or []
    if not results:
        return GeocodeDecision(accept=False, reason="zero_results")
    if len(results) > 1:
        return GeocodeDecision(accept=False, reason="multiple_candidates")

    result = results[0]
    geometry = result.get("geometry", {})
    location = geometry.get("location", {})
    location_type = geometry.get("location_type")
    locality = _result_locality(result)
    place_id = result.get("place_id")
    formatted = result.get("formatted_address")

    if result.get("partial_match"):
        return GeocodeDecision(
            accept=False,
            reason="partial_match",
            location_type=location_type,
            locality=locality,
            place_id=place_id,
            formatted_address=formatted,
        )
    if location_type not in PRECISE_LOCATION_TYPES:
        return GeocodeDecision(
            accept=False,
            reason="imprecise_location",
            location_type=location_type,
            locality=locality,
            place_id=place_id,
            formatted_address=formatted,
        )
    if location.get("lat") is None or location.get("lng") is None:
        return GeocodeDecision(accept=False, reason="missing_location")

    expected = {normalize_for_key(c) for c in expected_cities if normalize_for_key(c)}
    if city_slug:
        expected |= {normalize_for_key(a) for a in CITY_LOCALITY_ALIASES.get(city_slug, ())}
    if not expected:
        # We have no trusted city to check against — accepting would be a guess.
        return GeocodeDecision(
            accept=False,
            reason="no_expected_city",
            location_type=location_type,
            locality=locality,
            place_id=place_id,
            formatted_address=formatted,
        )
    if locality is None:
        # The result names no locality at all — different failure than a wrong city.
        return GeocodeDecision(
            accept=False,
            reason="no_locality",
            location_type=location_type,
            locality=None,
            place_id=place_id,
            formatted_address=formatted,
        )
    if normalize_for_key(locality) not in expected:
        return GeocodeDecision(
            accept=False,
            reason="city_mismatch",
            location_type=location_type,
            locality=locality,
            place_id=place_id,
            formatted_address=formatted,
        )

    return GeocodeDecision(
        accept=True,
        reason="ok",
        lat=float(location["lat"]),
        lng=float(location["lng"]),
        place_id=place_id,
        formatted_address=formatted,
        location_type=location_type,
        locality=locality,
    )


# --------------------------------------------------------------------------------------
# Pipeline
# --------------------------------------------------------------------------------------


@dataclass
class GeocodeStats:
    #: Restaurants with geo IS NULL and needs_review = false (after filters).
    candidates: int = 0
    #: Restaurants that already have a point — never touched, reported for context.
    already_geocoded: int = 0
    #: Restaurants excluded because they are already flagged needs_review.
    excluded_needs_review: int = 0
    cache_hits: int = 0
    api_calls: int = 0
    #: Uncached queries not sent because API calls were not allowed (free dry run).
    would_call_api: int = 0
    accepted: int = 0
    flagged_needs_review: int = 0
    #: Rows that changed underneath us between candidate selection and write time
    #: (e.g. a moderator placed a point mid-run) — skipped, never overwritten.
    skipped_concurrent: int = 0
    #: needs_review reason code → count.
    review_reasons: dict[str, int] = field(default_factory=dict)

    def note_reason(self, reason: str) -> None:
        self.review_reasons[reason] = self.review_reasons.get(reason, 0) + 1

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def geocode_restaurants(
    session: Session,
    geocoder: Geocoder | None = None,
    *,
    dry_run: bool = True,
    allow_api_calls: bool = False,
    actor: str = "cli",
    limit: int | None = None,
    city: str | None = None,
) -> GeocodeStats:
    """Geocode restaurants missing a point. Returns the diff summary.

    ``dry_run=True`` performs the work and rolls the restaurant mutations back — with
    one deliberate exception: **cache rows are committed either way**, because a paid
    raw response is evidence worth keeping regardless of what we decide about it.
    With ``allow_api_calls=False`` (the default) a dry run makes no API calls at all;
    uncached entries are counted as ``would_call_api``.
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

    stats = GeocodeStats()
    try:
        _run_geocode(
            session,
            geocoder,
            run_id,
            stats,
            allow_api_calls=allow_api_calls,
            limit=limit,
            city=city,
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
    stats: GeocodeStats,
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


def _run_geocode(
    session: Session,
    geocoder: Geocoder | None,
    run_id: Any,
    stats: GeocodeStats,
    *,
    allow_api_calls: bool,
    limit: int | None,
    city: str | None,
) -> None:
    # Context counters are scoped like the run itself: a per-city run reports
    # per-city numbers.
    already_q = select(func.count()).select_from(Restaurant).where(Restaurant.geo.is_not(None))
    excluded_q = (
        select(func.count())
        .select_from(Restaurant)
        .where(Restaurant.geo.is_(None), Restaurant.needs_review.is_(True))
    )
    if city:
        already_q = already_q.where(Restaurant.city_slug == city)
        excluded_q = excluded_q.where(Restaurant.city_slug == city)
    stats.already_geocoded = session.scalar(already_q) or 0
    stats.excluded_needs_review = session.scalar(excluded_q) or 0

    query = (
        select(Restaurant)
        .where(Restaurant.geo.is_(None), Restaurant.needs_review.is_(False))
        .order_by(Restaurant.city_slug, Restaurant.name_he, Restaurant.dedupe_key)
    )
    if city:
        query = query.where(Restaurant.city_slug == city)
    if limit is not None:
        query = query.limit(limit)
    targets = list(session.scalars(query))
    stats.candidates = len(targets)
    if not targets:
        return

    items: list[tuple[Restaurant, str | None]] = [
        (r, build_geocode_query(r.address_he, r.city_he)) for r in targets
    ]

    # ---- Phase 1: resolve raw responses (cache first, API only if allowed). ---------
    # Cache rows are committed at the end of this phase — including on abort — so a
    # paid response is never lost, and dry-run rollback in phase 2 cannot discard them.
    wanted = sorted({q for _, q in items if q is not None})
    cached: dict[str, GeocodeCache] = {
        c.query: c
        for c in session.scalars(select(GeocodeCache).where(GeocodeCache.query.in_(wanted)))
    }
    prefetched = frozenset(cached)
    uncached_skipped: set[str] = set()
    try:
        for q in wanted:
            if q in cached:
                continue
            if not allow_api_calls:
                uncached_skipped.add(q)
                continue
            if geocoder is None:
                raise GeocodeError("API calls are allowed but no geocoder was provided")
            payload = geocoder.geocode(q)
            stats.api_calls += 1
            status = str(payload.get("status", ""))
            if status in ABORT_STATUSES:
                raise GeocodeAbort(
                    f"Google returned {status} for {q!r} — aborting run "
                    "(check quota / API key); nothing was cached for this query"
                )
            entry = GeocodeCache(query=q, provider=SOURCE, status=status, response=payload)
            try:
                # Savepoint per row (portable to the SQLite test harness): a concurrent
                # writer winning the uq_geocode_cache_query race must not discard the
                # whole batch of paid responses.
                with session.begin_nested():
                    session.add(entry)
            except IntegrityError:
                existing = session.scalar(select(GeocodeCache).where(GeocodeCache.query == q))
                if existing is None:  # pragma: no cover - conflict implies a row
                    raise
                entry = existing  # the concurrent writer's response wins
            cached[q] = entry
    finally:
        session.commit()  # persist whatever raw responses we paid for
    stats.would_call_api = len(uncached_skipped)

    # ---- Phase 2: classify + mutate (rolled back by the caller on dry runs). --------
    used_place_ids: set[str] = set(
        session.scalars(
            select(Restaurant.google_place_id).where(Restaurant.google_place_id.is_not(None))
        )
    )
    for restaurant, q in items:
        if q is None:
            _flag(session, restaurant, "missing_address", {"query": None}, run_id, stats)
            continue
        entry = cached.get(q)
        if entry is None:
            continue  # uncached and API calls not allowed — counted in would_call_api
        if q in prefetched:
            stats.cache_hits += 1

        decision = classify_response(
            entry.response,
            (restaurant.city_he, restaurant.city_en),
            city_slug=restaurant.city_slug,
        )
        evidence = {
            "source": SOURCE,
            "query": q,
            "geocode_cache_id": str(entry.id),
            "provider_status": entry.status,
            "place_id": decision.place_id,
            "formatted_address": decision.formatted_address,
            "location_type": decision.location_type,
            "locality": decision.locality,
        }
        if not decision.accept:
            _flag(session, restaurant, decision.reason, evidence, run_id, stats)
            continue
        if decision.place_id and decision.place_id in used_place_ids:
            # Two records resolving to one Google place — a dedupe question for a
            # moderator, not something to overwrite silently.
            _flag(session, restaurant, "duplicate_place_id", evidence, run_id, stats)
            continue
        if _accept(session, restaurant, decision, evidence, run_id, stats) and decision.place_id:
            used_place_ids.add(decision.place_id)

    session.flush()


#: Write-time guard: the row must still be in the state that made it a candidate.
#: Candidate selection is unlocked; a moderator can place a point or flag a row while
#: the run is in flight. Every write re-checks and skips instead of overwriting.
def _guarded_update(session: Session, restaurant: Restaurant, values: dict[str, Any]) -> bool:
    result = session.execute(
        update(Restaurant)
        .where(
            Restaurant.id == restaurant.id,
            Restaurant.geo.is_(None),
            Restaurant.needs_review.is_(False),
        )
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    session.expire(restaurant)  # the ORM instance is stale either way
    return result.rowcount == 1


def _accept(
    session: Session,
    restaurant: Restaurant,
    decision: GeocodeDecision,
    evidence: dict[str, Any],
    run_id: Any,
    stats: GeocodeStats,
) -> bool:
    restaurant_id = restaurant.id
    geocoded_at = dt.datetime.now(dt.UTC)
    written = _guarded_update(
        session,
        restaurant,
        {
            "geo": f"SRID=4326;POINT({decision.lng} {decision.lat})",
            "geocoded_at": geocoded_at,
            "google_place_id": decision.place_id,
        },
    )
    if not written:
        stats.skipped_concurrent += 1
        return False
    changes = {
        "geo": {"before": None, "after": f"POINT({decision.lng} {decision.lat})"},
        "geocoded_at": {"before": None, "after": geocoded_at.isoformat()},
        "google_place_id": {"before": None, "after": decision.place_id},
    }
    stats.accepted += 1
    _audit(session, restaurant_id, AuditAction.UPDATE, changes, evidence, run_id)
    return True


def _flag(
    session: Session,
    restaurant: Restaurant,
    reason: str,
    evidence: dict[str, Any],
    run_id: Any,
    stats: GeocodeStats,
) -> None:
    restaurant_id = restaurant.id
    if not _guarded_update(session, restaurant, {"needs_review": True}):
        stats.skipped_concurrent += 1
        return
    stats.flagged_needs_review += 1
    stats.note_reason(reason)
    _audit(
        session,
        restaurant_id,
        AuditAction.UPDATE,
        {"needs_review": {"before": False, "after": True}},
        {**evidence, "reason": reason},
        run_id,
    )


def _audit(
    session: Session,
    restaurant_id: Any,
    action: AuditAction,
    changes: dict[str, Any],
    evidence: dict[str, Any],
    run_id: Any,
) -> None:
    session.add(
        AuditLog(
            entity_type="restaurant",
            entity_id=restaurant_id,
            action=action,
            changes=changes,
            actor=f"pipeline:{PIPELINE}@{PIPELINE_VERSION}",
            evidence=evidence,
            ingestion_run_id=run_id,
        )
    )
