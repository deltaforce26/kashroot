"""Geocoding pipeline tests — fully offline (SQLite-backed session, stub geocoder,
recorded-style fake Google responses)."""

from __future__ import annotations

import datetime as dt
from typing import Any

import httpx
import pytest
from sqlalchemy import func, insert, select
from sqlalchemy import update as sa_update

from app.ingestion.geocode import (
    GeocodeAbort,
    GeocodeError,
    GoogleGeocoder,
    build_geocode_query,
    classify_response,
    geocode_restaurants,
)
from app.ingestion.normalize import restaurant_dedupe_key, slugify_city
from app.models import (
    AuditLog,
    GeocodeCache,
    IngestionRun,
    IngestionRunState,
    RecordState,
    Restaurant,
)

# --------------------------------------------------------------------------------------
# Recorded-style fake Google Geocoding responses
# --------------------------------------------------------------------------------------


def google_result(
    *,
    lat: float = 32.0868,
    lng: float = 34.8338,
    location_type: str = "ROOFTOP",
    locality: str | None = "בני ברק",
    place_id: str = "ChIJd8kRVoJHHRURn5W2jCzHIcE",
    formatted_address: str = "רבי עקיבא 15, בני ברק, ישראל",
    partial_match: bool = False,
    street: str = "רבי עקיבא",
    number: str = "15",
) -> dict[str, Any]:
    components = [
        {"long_name": number, "short_name": number, "types": ["street_number"]},
        {"long_name": street, "short_name": street, "types": ["route"]},
        {"long_name": "מחוז תל אביב", "short_name": "מחוז תל אביב",
         "types": ["administrative_area_level_1", "political"]},
        {"long_name": "ישראל", "short_name": "IL", "types": ["country", "political"]},
    ]
    if locality is not None:
        components.insert(2, {
            "long_name": locality, "short_name": locality, "types": ["locality", "political"],
        })
    result: dict[str, Any] = {
        "address_components": components,
        "formatted_address": formatted_address,
        "geometry": {
            "location": {"lat": lat, "lng": lng},
            "location_type": location_type,
            "viewport": {
                "northeast": {"lat": lat + 0.001, "lng": lng + 0.001},
                "southwest": {"lat": lat - 0.001, "lng": lng - 0.001},
            },
        },
        "place_id": place_id,
        "types": ["street_address"],
    }
    if partial_match:
        result["partial_match"] = True
    return result


def ok_response(*results: dict[str, Any]) -> dict[str, Any]:
    return {"status": "OK", "results": list(results)}


ZERO_RESULTS = {"status": "ZERO_RESULTS", "results": []}
OVER_QUERY_LIMIT = {
    "status": "OVER_QUERY_LIMIT",
    "results": [],
    "error_message": "You have exceeded your daily request quota for this API.",
}
REQUEST_DENIED = {
    "status": "REQUEST_DENIED",
    "results": [],
    "error_message": "The provided API key is invalid.",
}


class StubGeocoder:
    """Canned responses keyed by query; counts every call (the billing spy)."""

    def __init__(self, responses: dict[str, dict[str, Any]] | None = None) -> None:
        self.responses = responses or {}
        self.calls: list[str] = []

    def geocode(self, query: str) -> dict[str, Any]:
        self.calls.append(query)
        if query not in self.responses:
            raise AssertionError(f"unexpected geocode call for {query!r}")
        return self.responses[query]


# --------------------------------------------------------------------------------------
# Fixtures / helpers
# --------------------------------------------------------------------------------------


def make_restaurant(
    session,
    *,
    name_he: str = "מסעדת הבדיקה",
    address_he: str | None = "רבי עקיבא 15",
    city_he: str | None = "בני ברק",
    city_en: str | None = "Bnei Brak",
    **overrides: Any,
) -> Restaurant:
    values: dict[str, Any] = {
        "dedupe_key": restaurant_dedupe_key(name_he, city_he, address_he),
        "name_he": name_he,
        "address_he": address_he,
        "city_he": city_he,
        "city_en": city_en,
        "city_slug": slugify_city(city_en, city_he),
        "record_state": RecordState.LIST_VERIFIED,
        "needs_review": False,
        **overrides,
    }
    restaurant = Restaurant(**values)
    session.add(restaurant)
    session.commit()
    return restaurant


def count(session, model) -> int:
    return session.scalar(select(func.count()).select_from(model))


QUERY = "רבי עקיבא 15, בני ברק"


# --------------------------------------------------------------------------------------
# Pure classification
# --------------------------------------------------------------------------------------


class TestClassification:
    CITIES = ("בני ברק", "Bnei Brak")

    def test_rooftop_city_match_is_accepted(self):
        decision = classify_response(ok_response(google_result()), self.CITIES)
        assert decision.accept
        assert decision.reason == "ok"
        assert decision.lat == pytest.approx(32.0868)
        assert decision.lng == pytest.approx(34.8338)
        assert decision.place_id == "ChIJd8kRVoJHHRURn5W2jCzHIcE"
        assert decision.locality == "בני ברק"

    def test_range_interpolated_is_accepted(self):
        response = ok_response(google_result(location_type="RANGE_INTERPOLATED"))
        assert classify_response(response, self.CITIES).accept

    @pytest.mark.parametrize("location_type", ["APPROXIMATE", "GEOMETRIC_CENTER"])
    def test_imprecise_location_needs_review(self, location_type):
        decision = classify_response(
            ok_response(google_result(location_type=location_type)), self.CITIES
        )
        assert not decision.accept
        assert decision.reason == "imprecise_location"

    def test_zero_results_needs_review(self):
        decision = classify_response(ZERO_RESULTS, self.CITIES)
        assert not decision.accept
        assert decision.reason == "zero_results"

    def test_multiple_candidates_needs_review(self):
        response = ok_response(google_result(), google_result(place_id="ChIJother"))
        decision = classify_response(response, self.CITIES)
        assert not decision.accept
        assert decision.reason == "multiple_candidates"

    def test_city_mismatch_needs_review(self):
        response = ok_response(google_result(locality="תל אביב-יפו"))
        decision = classify_response(response, self.CITIES)
        assert not decision.accept
        assert decision.reason == "city_mismatch"
        assert decision.locality == "תל אביב-יפו"

    def test_missing_locality_gets_its_own_reason(self):
        decision = classify_response(ok_response(google_result(locality=None)), self.CITIES)
        assert not decision.accept
        assert decision.reason == "no_locality"

    def test_no_expected_city_needs_review(self):
        # A precise result but nothing trusted to check it against → never accept.
        decision = classify_response(ok_response(google_result()), (None, None))
        assert not decision.accept
        assert decision.reason == "no_expected_city"

    def test_partial_match_needs_review(self):
        decision = classify_response(
            ok_response(google_result(partial_match=True)), self.CITIES
        )
        assert not decision.accept
        assert decision.reason == "partial_match"

    def test_city_match_ignores_punctuation_and_hyphens(self):
        # Google says "תל אביב-יפו", the corpus says "תל אביב יפו" — same city.
        response = ok_response(google_result(locality="תל אביב-יפו"))
        decision = classify_response(response, ("תל אביב יפו",))
        assert decision.accept

    def test_plene_spelling_alias_accepted(self):
        # Corpus uses the defective spelling פתח תקוה; Google returns the plene
        # official form פתח תקווה — same city via the curated alias table.
        response = ok_response(google_result(locality="פתח תקווה"))
        no_alias = classify_response(response, ("פתח תקוה", "Petah Tikva"))
        assert not no_alias.accept  # exact match alone over-flags…
        decision = classify_response(
            response, ("פתח תקוה", "Petah Tikva"), city_slug="petah-tikva"
        )
        assert decision.accept  # …the alias table fixes exactly this

    def test_kiryat_gat_plene_alias_accepted(self):
        response = ok_response(google_result(locality="קריית גת"))
        decision = classify_response(
            response, ("קרית גת", "Kiryat Gat"), city_slug="kiryat-gat"
        )
        assert decision.accept

    def test_tel_aviv_yafo_alias_accepted(self):
        response = ok_response(google_result(locality="תל אביב-יפו"))
        decision = classify_response(
            response, ("תל אביב", "Tel Aviv"), city_slug="tel-aviv"
        )
        assert decision.accept

    def test_alias_table_never_accepts_a_different_city(self):
        # Aliases widen spellings of the same city, not the set of acceptable cities.
        response = ok_response(google_result(locality="חולון"))
        decision = classify_response(
            response, ("תל אביב", "Tel Aviv"), city_slug="tel-aviv"
        )
        assert not decision.accept
        assert decision.reason == "city_mismatch"

    def test_abort_status_raises(self):
        with pytest.raises(GeocodeAbort):
            classify_response(REQUEST_DENIED, self.CITIES)

    def test_build_query_requires_an_address(self):
        assert build_geocode_query(None, "בני ברק") is None
        assert build_geocode_query("  ", "בני ברק") is None
        assert build_geocode_query("רבי עקיבא 15", "בני ברק") == QUERY
        assert build_geocode_query("רבי עקיבא 15", None) == "רבי עקיבא 15"


# --------------------------------------------------------------------------------------
# GoogleGeocoder transport behaviour (httpx.MockTransport — still fully offline)
# --------------------------------------------------------------------------------------


class TestGoogleGeocoder:
    KEY = "SECRET-API-KEY-123"

    def _geocoder(self, handler, **kwargs) -> GoogleGeocoder:
        return GoogleGeocoder(
            self.KEY,
            delay_ms=0,
            backoff_base_s=0.0,
            transport=httpx.MockTransport(handler),
            **kwargs,
        )

    def test_sends_israel_bias_params(self):
        seen: dict[str, str] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen.update(dict(request.url.params))
            return httpx.Response(200, json=ok_response(google_result()))

        payload = self._geocoder(handler).geocode(QUERY)
        assert payload["status"] == "OK"
        assert seen["address"] == QUERY
        assert seen["region"] == "il"
        assert seen["language"] == "he"
        assert seen["components"] == "country:IL"
        assert seen["key"] == self.KEY

    def test_non_retryable_4xx_is_sanitized(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(403, json={"error": "forbidden"})

        with pytest.raises(GeocodeError) as excinfo:
            self._geocoder(handler).geocode(QUERY)
        message = str(excinfo.value)
        assert "403" in message
        assert QUERY in message
        assert self.KEY not in message, "the API key must never leak into an error"
        assert "maps.googleapis.com" not in message

    def test_retries_with_backoff_on_429_then_succeeds(self):
        attempts: list[int] = []

        def handler(request: httpx.Request) -> httpx.Response:
            attempts.append(1)
            if len(attempts) < 3:
                return httpx.Response(429)
            return httpx.Response(200, json=ok_response(google_result()))

        payload = self._geocoder(handler).geocode(QUERY)
        assert payload["status"] == "OK"
        assert len(attempts) == 3

    def test_retry_exhaustion_on_5xx_aborts_sanitized(self):
        attempts: list[int] = []

        def handler(request: httpx.Request) -> httpx.Response:
            attempts.append(1)
            return httpx.Response(500)

        with pytest.raises(GeocodeAbort) as excinfo:
            self._geocoder(handler, max_retries=2).geocode(QUERY)
        assert len(attempts) == 3  # initial call + 2 retries
        message = str(excinfo.value)
        assert "500" in message
        assert self.KEY not in message

    def test_network_error_is_sanitized_and_unchained(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused")

        with pytest.raises(GeocodeError) as excinfo:
            self._geocoder(handler).geocode(QUERY)
        assert "ConnectError" in str(excinfo.value)
        assert self.KEY not in str(excinfo.value)
        # No chained httpx exception in the traceback — it would carry the keyed URL.
        assert excinfo.value.__cause__ is None
        assert excinfo.value.__suppress_context__ is True


# --------------------------------------------------------------------------------------
# Pipeline behaviour
# --------------------------------------------------------------------------------------


def test_accepted_point_written_with_provenance_and_audit(session):
    restaurant = make_restaurant(session)
    stub = StubGeocoder({QUERY: ok_response(google_result())})

    stats = geocode_restaurants(
        session, stub, dry_run=False, allow_api_calls=True, actor="pytest"
    )

    assert stats.candidates == 1
    assert stats.accepted == 1
    assert stats.api_calls == 1
    assert stats.flagged_needs_review == 0
    assert stub.calls == [QUERY]

    session.refresh(restaurant)
    assert restaurant.geo is not None
    assert "POINT(34.8338 32.0868)" in str(restaurant.geo)
    assert restaurant.google_place_id == "ChIJd8kRVoJHHRURn5W2jCzHIcE"
    assert restaurant.geocoded_at is not None
    assert restaurant.needs_review is False

    # Raw response cached for evidence + billing.
    entry = session.scalar(select(GeocodeCache).where(GeocodeCache.query == QUERY))
    assert entry is not None
    assert entry.status == "OK"
    assert entry.response["results"][0]["place_id"] == restaurant.google_place_id

    # Audit entry with provenance.
    audit = session.scalar(select(AuditLog).where(AuditLog.entity_type == "restaurant"))
    assert audit is not None
    assert audit.actor == "pipeline:geocode@1.0.0"
    assert audit.evidence["source"] == "google_geocoding"
    assert audit.evidence["place_id"] == restaurant.google_place_id
    assert audit.evidence["formatted_address"] == "רבי עקיבא 15, בני ברק, ישראל"
    assert audit.evidence["geocode_cache_id"] == str(entry.id)
    assert audit.changes["geo"]["before"] is None
    assert audit.ingestion_run_id is not None


@pytest.mark.parametrize(
    ("response", "reason"),
    [
        (ok_response(google_result(location_type="APPROXIMATE")), "imprecise_location"),
        (ZERO_RESULTS, "zero_results"),
        (ok_response(google_result(locality="ירושלים")), "city_mismatch"),
        (ok_response(google_result(), google_result(place_id="ChIJ2")), "multiple_candidates"),
    ],
)
def test_ambiguous_results_flag_needs_review_and_write_no_point(session, response, reason):
    restaurant = make_restaurant(session)
    stub = StubGeocoder({QUERY: response})

    stats = geocode_restaurants(
        session, stub, dry_run=False, allow_api_calls=True, actor="pytest"
    )

    assert stats.accepted == 0
    assert stats.flagged_needs_review == 1
    assert stats.review_reasons == {reason: 1}

    session.refresh(restaurant)
    assert restaurant.geo is None, "an ambiguous result must never write a guessed point"
    assert restaurant.google_place_id is None
    assert restaurant.needs_review is True

    audit = session.scalar(select(AuditLog).where(AuditLog.entity_type == "restaurant"))
    assert audit.evidence["reason"] == reason
    assert audit.changes.get("needs_review") == {"before": False, "after": True}


def test_missing_address_flags_without_calling_api(session):
    make_restaurant(session, address_he=None)
    stub = StubGeocoder()

    stats = geocode_restaurants(
        session, stub, dry_run=False, allow_api_calls=True, actor="pytest"
    )

    assert stub.calls == []
    assert stats.review_reasons == {"missing_address": 1}
    assert count(session, GeocodeCache) == 0


def test_existing_point_is_never_touched(session):
    # Manually placed point (no place_id — not from this pipeline). Never a candidate.
    verified = make_restaurant(
        session, geo="SRID=4326;POINT(34.83 32.08)", geocoded_at=dt.datetime.now(dt.UTC)
    )
    original_geo = str(verified.geo)
    stub = StubGeocoder()  # any call would raise

    stats = geocode_restaurants(
        session, stub, dry_run=False, allow_api_calls=True, actor="pytest"
    )

    assert stats.candidates == 0
    assert stats.already_geocoded == 1
    assert stub.calls == []
    session.refresh(verified)
    assert str(verified.geo) == original_geo
    assert verified.needs_review is False


def test_restaurants_already_flagged_are_excluded(session):
    make_restaurant(session, needs_review=True)
    stub = StubGeocoder()

    stats = geocode_restaurants(
        session, stub, dry_run=False, allow_api_calls=True, actor="pytest"
    )

    assert stats.candidates == 0
    assert stats.excluded_needs_review == 1
    assert stub.calls == []


def test_cache_hit_skips_geocoder_entirely(session):
    restaurant = make_restaurant(session)
    session.add(
        GeocodeCache(query=QUERY, status="OK", response=ok_response(google_result()))
    )
    session.commit()
    stub = StubGeocoder()  # empty: any call would raise

    stats = geocode_restaurants(
        session, stub, dry_run=False, allow_api_calls=True, actor="pytest"
    )

    assert stub.calls == []
    assert stats.cache_hits == 1
    assert stats.api_calls == 0
    assert stats.accepted == 1
    session.refresh(restaurant)
    assert restaurant.geo is not None
    assert count(session, GeocodeCache) == 1  # no duplicate row


def test_dry_run_writes_no_restaurant_data(session):
    restaurant = make_restaurant(session)
    stub = StubGeocoder({QUERY: ok_response(google_result())})

    stats = geocode_restaurants(
        session, stub, dry_run=True, allow_api_calls=True, actor="pytest"
    )

    assert stats.accepted == 1  # it planned the work…
    session.expire_all()
    assert restaurant.geo is None  # …and wrote none of it
    assert restaurant.google_place_id is None
    assert restaurant.needs_review is False
    assert count(session, AuditLog) == 0

    # The run itself is recorded, and the paid response is kept (evidence, not a guess).
    run = session.scalar(select(IngestionRun))
    assert run.dry_run is True
    assert run.state is IngestionRunState.COMPLETED
    assert run.stats["accepted"] == 1
    assert count(session, GeocodeCache) == 1


def test_plain_dry_run_is_free(session):
    """Default dry run: uncached entries are reported, the paid API is never called."""
    make_restaurant(session)
    stub = StubGeocoder()  # any call would raise

    stats = geocode_restaurants(session, stub, dry_run=True, actor="pytest")

    assert stub.calls == []
    assert stats.would_call_api == 1
    assert stats.api_calls == 0
    assert stats.accepted == 0
    assert stats.flagged_needs_review == 0
    assert count(session, GeocodeCache) == 0


def test_rerun_is_idempotent(session):
    restaurant = make_restaurant(session)
    stub = StubGeocoder({QUERY: ok_response(google_result())})

    geocode_restaurants(session, stub, dry_run=False, allow_api_calls=True, actor="pytest")
    session.refresh(restaurant)
    first_geo, first_at = str(restaurant.geo), restaurant.geocoded_at

    second = geocode_restaurants(
        session, stub, dry_run=False, allow_api_calls=True, actor="pytest"
    )

    assert stub.calls == [QUERY], "the API is called exactly once across re-runs"
    assert second.candidates == 0
    assert second.accepted == 0
    session.refresh(restaurant)
    assert str(restaurant.geo) == first_geo
    assert restaurant.geocoded_at == first_at
    assert count(session, AuditLog) == 1


def test_duplicate_place_id_flags_instead_of_writing(session):
    make_restaurant(session, google_place_id="ChIJd8kRVoJHHRURn5W2jCzHIcE",
                    geo="SRID=4326;POINT(34.83 32.08)", name_he="הסניף הראשון")
    second = make_restaurant(session, name_he="הסניף השני")
    query = build_geocode_query(second.address_he, second.city_he)
    stub = StubGeocoder({query: ok_response(google_result())})

    stats = geocode_restaurants(
        session, stub, dry_run=False, allow_api_calls=True, actor="pytest"
    )

    assert stats.accepted == 0
    assert stats.review_reasons == {"duplicate_place_id": 1}
    session.refresh(second)
    assert second.geo is None
    assert second.needs_review is True


@pytest.mark.parametrize("response", [REQUEST_DENIED, OVER_QUERY_LIMIT])
def test_abort_statuses_fail_the_run_cleanly(session, response):
    restaurant = make_restaurant(session)
    stub = StubGeocoder({QUERY: response})

    with pytest.raises(GeocodeAbort, match=response["status"]):
        geocode_restaurants(
            session, stub, dry_run=False, allow_api_calls=True, actor="pytest"
        )

    assert stub.calls == [QUERY], "no retry spinning on a quota/key failure"
    session.expire_all()
    assert restaurant.geo is None
    assert restaurant.needs_review is False
    # Abort statuses describe the run, not the query — never cached.
    assert count(session, GeocodeCache) == 0

    run = session.scalar(select(IngestionRun))
    assert run.state is IngestionRunState.FAILED
    assert response["status"] in run.error


def test_abort_mid_run_keeps_responses_already_paid_for(session):
    ok = make_restaurant(session, name_he="א מסעדה", address_he="ז'בוטינסקי 1")
    make_restaurant(session, name_he="ב מסעדה", address_he="ז'בוטינסקי 2")
    q_ok = build_geocode_query(ok.address_he, ok.city_he)
    q_bad = build_geocode_query("ז'בוטינסקי 2", "בני ברק")
    stub = StubGeocoder({q_ok: ok_response(google_result()), q_bad: OVER_QUERY_LIMIT})

    with pytest.raises(GeocodeAbort):
        geocode_restaurants(
            session, stub, dry_run=False, allow_api_calls=True, actor="pytest"
        )

    # The first (good, paid-for) response was cached; the aborting one was not.
    session.expire_all()
    cached = list(session.scalars(select(GeocodeCache.query)))
    assert cached == [q_ok]


class MutatingGeocoder(StubGeocoder):
    """Stub that runs a side effect before answering — simulates a moderator (or a
    second pipeline) touching rows between candidate selection and write time."""

    def __init__(self, responses, side_effect):
        super().__init__(responses)
        self._side_effect = side_effect

    def geocode(self, query):
        self._side_effect()
        return super().geocode(query)


def test_point_placed_mid_run_is_never_overwritten(session):
    restaurant = make_restaurant(session)
    moderator_point = "SRID=4326;POINT(34.7999 32.0999)"

    def moderator_places_point():
        session.execute(
            sa_update(Restaurant)
            .where(Restaurant.id == restaurant.id)
            .values(geo=moderator_point)
        )

    stub = MutatingGeocoder({QUERY: ok_response(google_result())}, moderator_places_point)
    stats = geocode_restaurants(
        session, stub, dry_run=False, allow_api_calls=True, actor="pytest"
    )

    assert stats.skipped_concurrent == 1
    assert stats.accepted == 0
    session.refresh(restaurant)
    assert str(restaurant.geo) == moderator_point, "the moderator's point must survive"
    assert restaurant.google_place_id is None
    assert count(session, AuditLog) == 0


def test_flag_raced_by_moderator_is_skipped_not_doubled(session):
    restaurant = make_restaurant(session)

    def moderator_flags_row():
        session.execute(
            sa_update(Restaurant)
            .where(Restaurant.id == restaurant.id)
            .values(needs_review=True)
        )

    stub = MutatingGeocoder({QUERY: ZERO_RESULTS}, moderator_flags_row)
    stats = geocode_restaurants(
        session, stub, dry_run=False, allow_api_calls=True, actor="pytest"
    )

    assert stats.skipped_concurrent == 1
    assert stats.flagged_needs_review == 0
    assert stats.review_reasons == {}
    assert count(session, AuditLog) == 0


def test_cache_conflict_mid_run_does_not_discard_the_batch(session):
    restaurant = make_restaurant(session)
    concurrent_response = ok_response(google_result(lat=32.09, lng=34.84))

    def concurrent_writer_caches_same_query():
        session.execute(
            insert(GeocodeCache).values(
                query=QUERY,
                provider="google_geocoding",
                status="OK",
                response=concurrent_response,
            )
        )

    stub = MutatingGeocoder(
        {QUERY: ok_response(google_result())}, concurrent_writer_caches_same_query
    )
    stats = geocode_restaurants(
        session, stub, dry_run=False, allow_api_calls=True, actor="pytest"
    )

    # The unique-key conflict was contained to its savepoint: run completed, one cache
    # row, and the concurrently-written response is the one used.
    assert count(session, GeocodeCache) == 1
    assert stats.accepted == 1
    session.refresh(restaurant)
    assert "POINT(34.84 32.09)" in str(restaurant.geo)


def test_would_call_api_counts_unique_queries_not_restaurants(session):
    make_restaurant(session, name_he="סניף א")
    make_restaurant(session, name_he="סניף ב")  # same address → same query

    stats = geocode_restaurants(session, None, dry_run=True, actor="pytest")

    assert stats.candidates == 2
    assert stats.would_call_api == 1


def test_api_calls_allowed_without_geocoder_is_an_error(session):
    make_restaurant(session)
    with pytest.raises(GeocodeError, match="no geocoder"):
        geocode_restaurants(
            session, None, dry_run=False, allow_api_calls=True, actor="pytest"
        )
    run = session.scalar(select(IngestionRun))
    assert run.state is IngestionRunState.FAILED


def test_city_and_limit_filters(session):
    for i in range(3):
        make_restaurant(session, name_he=f"מסעדה {i}", address_he=f"רבי עקיבא {i}")
    make_restaurant(
        session, name_he="ירושלמית", city_he="ירושלים", city_en="Jerusalem",
        address_he="יפו 1",
    )

    stats = geocode_restaurants(session, None, dry_run=True, city="jerusalem")
    assert stats.candidates == 1

    stats = geocode_restaurants(session, None, dry_run=True, city="bnei-brak", limit=2)
    assert stats.candidates == 2
    assert stats.would_call_api == 2


def test_shared_query_between_branches_costs_one_api_call(session):
    # Same published address for two records → one query, one billable call.
    make_restaurant(session, name_he="סניף א")
    make_restaurant(session, name_he="סניף ב")
    stub = StubGeocoder({QUERY: ok_response(google_result())})

    stats = geocode_restaurants(
        session, stub, dry_run=False, allow_api_calls=True, actor="pytest"
    )

    assert stub.calls == [QUERY]
    assert stats.api_calls == 1
    # First record takes the point; the second resolves to the same place_id → review.
    assert stats.accepted == 1
    assert stats.review_reasons == {"duplicate_place_id": 1}


# --------------------------------------------------------------------------------------
# Migration consistency (offline — no live DB)
# --------------------------------------------------------------------------------------


def test_migration_chain_heads_at_0002():
    from pathlib import Path

    from alembic.config import Config
    from alembic.script import ScriptDirectory

    root = Path(__file__).resolve().parents[1]
    script = ScriptDirectory.from_config(Config(str(root / "alembic.ini")))
    assert script.get_heads() == ["0002_geocode_cache"]
    revision = script.get_revision("0002_geocode_cache")
    assert revision.down_revision == "0001_initial_schema"


def test_migration_0002_matches_model_structurally():
    """Column-by-column parity between the 0002 migration and the GeocodeCache model:
    names, order, compiled PostgreSQL types, nullability, PK and unique constraints —
    all offline, no live DB."""
    import importlib.util
    from pathlib import Path

    import sqlalchemy as sa
    from sqlalchemy.dialects import postgresql

    from app.db.base import Base

    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0002_geocode_cache.py"
    spec = importlib.util.spec_from_file_location("migration_0002", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    class CaptureOp:
        """Stands in for alembic.op — captures the Table the migration would create."""

        def __init__(self):
            self.tables = {}

        def f(self, name):
            return name

        def create_table(self, name, *args, **kwargs):
            table = sa.Table(name, sa.MetaData(), *args, **kwargs)
            self.tables[name] = table
            return table

    capture = CaptureOp()
    migration.op = capture
    migration.upgrade()

    migrated = capture.tables["geocode_cache"]
    model = Base.metadata.tables["geocode_cache"]
    dialect = postgresql.dialect()

    assert [c.name for c in migrated.columns] == [c.name for c in model.columns]
    for name in (c.name for c in model.columns):
        migrated_col, model_col = migrated.columns[name], model.columns[name]
        assert migrated_col.type.compile(dialect) == model_col.type.compile(dialect), name
        assert migrated_col.nullable == model_col.nullable, name

    def unique_sets(table):
        return {
            tuple(c.name for c in constraint.columns)
            for constraint in table.constraints
            if isinstance(constraint, sa.UniqueConstraint)
        }

    assert unique_sets(migrated) == unique_sets(model) == {("query",)}
    pk = {c.name for c in model.primary_key.columns}
    assert {c.name for c in migrated.primary_key.columns} == pk == {"id"}
    # The one dialect-agnostic server default (the PG-only ones are rewritten by the
    # SQLite test harness, so only this one is order-independent to assert on).
    assert "google_geocoding" in str(migrated.columns["provider"].server_default.arg)
    assert "google_geocoding" in str(model.columns["provider"].server_default.arg)
