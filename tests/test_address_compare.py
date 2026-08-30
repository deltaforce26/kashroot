"""Unit tests for the address comparison used by the address-verification report.

The verdicts these tests pin are what decides whether a row is put in front of a human
as a suspected relocation. A false CHANGED wastes review time; a false SAME leaves a
wrong address serving users. Both directions are covered here, with the real corpus
spellings that motivated each rule.
"""

import pytest

from app.ingestion.address_compare import (
    VERDICT_CHANGED_BOTH,
    VERDICT_CHANGED_NUMBER,
    VERDICT_CHANGED_STREET,
    VERDICT_NO_COMPARISON,
    VERDICT_SAME,
    compare_addresses,
    parse_address,
)


class TestParseAddress:
    def test_splits_street_number_and_trailing_neighbourhood(self):
        parsed = parse_address("דרך חברון 101 תלפיות", "ירושלים")
        assert parsed.street == "דרך חברון"
        assert parsed.house_number == "101"
        assert parsed.trailing_context == "תלפיות"

    def test_keeps_mall_name_out_of_the_street(self):
        parsed = parse_address("שמגר 16 קניון רב שפע בעלז", "ירושלים")
        assert parsed.street == "שמגר"
        assert parsed.house_number == "16"
        assert parsed.trailing_context == "קניון רב שפע בעלז"

    def test_drops_city_and_country_from_a_listing_address(self):
        parsed = parse_address("בניין בית הנציב, דרך חברון 101, ירושלים, ישראל", "ירושלים")
        assert parsed.street == "דרך חברון"
        assert parsed.house_number == "101"

    def test_prefers_the_segment_carrying_a_house_number(self):
        parsed = parse_address("מרכז מסחרי, כנפי נשרים 13", "ירושלים")
        assert parsed.street == "כנפי נשרים"
        assert parsed.house_number == "13"

    def test_reduces_a_multi_branch_cell_to_its_first_branch(self):
        parsed = parse_address('רשב"י 15 / קק"ל 13', "צפת")
        assert parsed.house_number == "15"

    def test_does_not_split_an_apartment_number(self):
        parsed = parse_address("שבזי 33/2", "תל אביב")
        assert parsed.street == "שבזי"
        assert parsed.house_number == "33/2"

    @pytest.mark.parametrize("raw", ["12א", "12-14", "12 - 14"])
    def test_recognizes_house_number_variants(self, raw):
        parsed = parse_address(f"מלצר {raw}", "בני ברק")
        assert parsed.street == "מלצר"
        assert parsed.house_number

    def test_address_without_a_number_still_yields_a_street(self):
        parsed = parse_address("א.ת. דלתון", "דלתון")
        assert parsed.street
        assert parsed.house_number == ""

    def test_street_named_after_its_own_city_survives_stripping(self):
        """``ירושלים 36`` in Jerusalem must not collapse to an empty street."""
        parsed = parse_address("ירושלים 36", "ירושלים")
        assert parsed.street == "ירושלים"
        assert parsed.house_number == "36"

    def test_settlement_that_is_its_own_address_survives_stripping(self):
        parsed = parse_address("חפץ חיים", "חפץ חיים")
        assert parsed.street == "חפץ חיים"

    def test_empty_address_is_not_comparable(self):
        assert parse_address("", "ירושלים").is_comparable is False
        assert parse_address(None, "ירושלים").is_comparable is False


class TestCompareAddresses:
    def test_trailing_neighbourhood_is_not_a_change(self):
        """The calibration case: corpus carries תלפיות, the listing does not."""
        verdict, _ = compare_addresses("דרך חברון 101 תלפיות", "דרך חברון 101, ירושלים", "ירושלים")
        assert verdict == VERDICT_SAME

    def test_boulevard_abbreviation_is_not_a_change(self):
        verdict, _ = compare_addresses(
            "שד' הרצל 102 בית הכרם", "שדרות הרצל 102, ירושלים", "ירושלים"
        )
        assert verdict == VERDICT_SAME

    def test_definite_article_on_the_street_is_not_a_change(self):
        verdict, _ = compare_addresses("הירקון 8", "ירקון 8, בני ברק", "בני ברק")
        assert verdict == VERDICT_SAME

    def test_rabbi_abbreviation_is_not_a_change(self):
        verdict, _ = compare_addresses("ר' נחמן מברסלב 12", "רבי נחמן מברסלב 12", "בני ברק")
        assert verdict == VERDICT_SAME

    def test_dash_spacing_in_a_range_is_not_a_change(self):
        verdict, _ = compare_addresses("מלצר 32-34", "מלצר 32 - 34", "בני ברק")
        assert verdict == VERDICT_SAME

    def test_quote_mark_variants_are_not_a_change(self):
        verdict, _ = compare_addresses('רשב"י 15', "רשב׳י 15", "צפת")
        assert verdict == VERDICT_SAME

    def test_different_house_number_is_a_number_change(self):
        verdict, _ = compare_addresses(
            "כנפי נשרים 13 גבעת שאול", "כנפי נשרים 66, ירושלים", "ירושלים"
        )
        assert verdict == VERDICT_CHANGED_NUMBER

    def test_different_street_same_number_is_a_street_change(self):
        verdict, _ = compare_addresses("עוזיאל 28", "הפסגה 28", "ירושלים")
        assert verdict == VERDICT_CHANGED_STREET

    def test_different_street_and_number_is_a_both_change(self):
        verdict, _ = compare_addresses("ירושלים 36", "הירקון 8, בני ברק", "בני ברק")
        assert verdict == VERDICT_CHANGED_BOTH

    def test_house_number_suffix_difference_is_flagged_but_noted(self):
        verdict, note = compare_addresses("מצדה 9", "מצדה 9א", "בני ברק")
        assert verdict == VERDICT_CHANGED_NUMBER
        assert "suffix" in note

    def test_missing_number_on_one_side_compares_street_only(self):
        verdict, note = compare_addresses("עזרא 20", "עזרא", "בני ברק")
        assert verdict == VERDICT_SAME
        assert "house number missing" in note

    def test_missing_number_still_reports_a_street_change(self):
        verdict, _ = compare_addresses("מושב מירון", "צומת שילת", "מירון")
        assert verdict == VERDICT_CHANGED_STREET

    @pytest.mark.parametrize("found", ["", None, "ירושלים"])
    def test_unusable_found_address_yields_no_comparison(self, found):
        verdict, _ = compare_addresses("דרך חברון 101", found, "ירושלים")
        assert verdict == VERDICT_NO_COMPARISON

    def test_comparison_is_symmetric_for_equality(self):
        left = "דרך חברון 101 תלפיות"
        right = "דרך חברון 101, ירושלים"
        assert compare_addresses(left, right, "ירושלים")[0] == VERDICT_SAME
        assert compare_addresses(right, left, "ירושלים")[0] == VERDICT_SAME
