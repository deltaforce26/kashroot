"""Tests for ``app.ingestion.places_match`` — pure address and candidate matching."""

from __future__ import annotations

import unittest
from typing import Any

from app.ingestion.places_match import address_matches, classify_candidates, haversine_m
from app.ingestion.places_resolve_consts import (
    REASON_ACCEPTED,
    REASON_ACCEPTED_STREET_MATCH,
    REASON_TOO_FAR,
)

ORIGIN_LAT = 31.7600
ORIGIN_LNG = 35.2100
OUR_ADDRESS = 'הפלמ"ח 42 עמק רפאים'
CANDIDATE_ADDRESS = 'הפלמ"ח 42, ירושלים, ישראל'


def place(
    place_id: str, lat: float, lng: float, formatted_address: str | None = None
) -> dict[str, Any]:
    """Build one Text Search candidate."""
    return {
        "id": place_id,
        "displayName": {"text": place_id},
        "location": {"latitude": lat, "longitude": lng},
        "formattedAddress": formatted_address,
    }


class TestAddressMatches(unittest.TestCase):
    def test_neighbourhood_suffix_matches(self) -> None:
        self.assertTrue(address_matches(OUR_ADDRESS, CANDIDATE_ADDRESS))

    def test_abbreviation_quotes_and_prefix_are_normalised(self) -> None:
        self.assertTrue(address_matches("פלמח 42", "רחוב הפלמ״ח 42, ירושלים"))

    def test_different_number_does_not_match(self) -> None:
        self.assertFalse(address_matches(OUR_ADDRESS, 'הפלמ"ח 4, ירושלים'))
        self.assertFalse(address_matches(OUR_ADDRESS, 'הפלמ"ח 420, ירושלים'))

    def test_no_number_in_ours_never_matches(self) -> None:
        self.assertFalse(address_matches('הפלמ"ח', CANDIDATE_ADDRESS))

    def test_mall_never_matches(self) -> None:
        self.assertFalse(address_matches("קניון רמות", "קניון רמות, ירושלים, ישראל"))

    def test_different_street_does_not_match(self) -> None:
        self.assertFalse(address_matches(OUR_ADDRESS, "יפו 42, ירושלים"))

    def test_missing_inputs_do_not_match(self) -> None:
        self.assertFalse(address_matches(None, CANDIDATE_ADDRESS))
        self.assertFalse(address_matches(OUR_ADDRESS, None))


class TestClassifyCandidates(unittest.TestCase):
    def test_far_candidate_with_matching_address_is_street_match_accept(self) -> None:
        response = {"places": [place("far", ORIGIN_LAT + 0.025, ORIGIN_LNG, CANDIDATE_ADDRESS)]}
        decision = classify_candidates(
            response, ORIGIN_LAT, ORIGIN_LNG, OUR_ADDRESS, max_distance_m=150.0
        )
        self.assertTrue(decision.accept)
        self.assertEqual(decision.reason, REASON_ACCEPTED_STREET_MATCH)
        self.assertEqual(decision.place_id, "far")
        self.assertGreater(decision.distance_m, 2000.0)

    def test_far_non_matching_candidate_is_too_far(self) -> None:
        response = {"places": [place("far", ORIGIN_LAT + 0.025, ORIGIN_LNG, "יפו 7, ירושלים")]}
        decision = classify_candidates(
            response, ORIGIN_LAT, ORIGIN_LNG, OUR_ADDRESS, max_distance_m=150.0
        )
        self.assertFalse(decision.accept)
        self.assertEqual(decision.reason, REASON_TOO_FAR)
        self.assertIsNone(decision.place_id)

    def test_radius_match_wins_first(self) -> None:
        response = {
            "places": [
                place("near", ORIGIN_LAT + 0.0009, ORIGIN_LNG, "יפו 7, ירושלים"),
                place("far", ORIGIN_LAT + 0.025, ORIGIN_LNG, CANDIDATE_ADDRESS),
            ]
        }
        decision = classify_candidates(
            response, ORIGIN_LAT, ORIGIN_LNG, OUR_ADDRESS, max_distance_m=150.0
        )
        self.assertEqual(decision.reason, REASON_ACCEPTED)
        self.assertEqual(decision.place_id, "near")

    def test_rejection_reports_nearest_candidate(self) -> None:
        response = {
            "places": [
                place("farther", ORIGIN_LAT + 0.03, ORIGIN_LNG),
                place("nearest", ORIGIN_LAT + 0.02, ORIGIN_LNG),
            ]
        }
        decision = classify_candidates(response, ORIGIN_LAT, ORIGIN_LNG, OUR_ADDRESS)
        self.assertEqual(decision.display_name, "nearest")
        self.assertAlmostEqual(
            decision.distance_m, haversine_m(ORIGIN_LAT, ORIGIN_LNG, ORIGIN_LAT + 0.02, ORIGIN_LNG)
        )
