"""Unit tests for ingestion normalization — pure functions, no database."""

from app.ingestion.normalize import (
    normalize_for_key,
    normalize_phone,
    normalize_text,
    parse_csv_bool,
    restaurant_dedupe_key,
    slugify_city,
    split_branch_addresses,
)


def test_normalize_text_strips_nikud_and_collapses_whitespace():
    assert normalize_text("בֵּית  הַתַּבְשִׁיל ") == "בית התבשיל"


def test_normalize_text_unifies_hebrew_quotes():
    assert normalize_text('רשב״י') == 'רשב"י'
    assert normalize_text("ר׳ נחמן") == "ר' נחמן"


def test_normalize_text_returns_none_for_blank():
    assert normalize_text("") is None
    assert normalize_text("   ") is None
    assert normalize_text(None) is None


def test_normalize_for_key_drops_punctuation_and_case():
    assert normalize_for_key('רשב"י 15') == "רשב י 15"
    assert normalize_for_key("Pizza-Time!") == "pizza time"


def test_branch_split_only_on_spaced_slash():
    assert split_branch_addresses("לבוש מרדכי 2 / בריינדס 3") == ["לבוש מרדכי 2", "בריינדס 3"]
    # Apartment / entrance numbers must survive intact.
    assert split_branch_addresses("שבזי 33/2") == ["שבזי 33/2"]
    assert split_branch_addresses("קרית חב\"ד 220/05") == ['קרית חב"ד 220/05']


def test_branch_split_handles_three_branches_and_empty():
    assert len(split_branch_addresses("א 1 / ב 2 / ג 3")) == 3
    assert split_branch_addresses("") == [None]
    assert split_branch_addresses(None) == [None]


def test_normalize_phone_keeps_short_codes():
    assert normalize_phone("*5113") == "*5113"
    assert normalize_phone("03-579 2552") == "035792552"
    assert normalize_phone("") is None


def test_slugify_city_prefers_english_falls_back_to_hebrew():
    assert slugify_city("Bnei Brak", "בני ברק") == "bnei-brak"
    assert slugify_city("Beer Sheva", None) == "beer-sheva"
    assert slugify_city(None, "בני ברק") == "בני-ברק"
    assert slugify_city(None, None) is None


def test_dedupe_key_is_stable_across_cosmetic_differences():
    a = restaurant_dedupe_key('מסעדת רשב״י', "בני  ברק", "יגאל אלון 6")
    b = restaurant_dedupe_key('מסעדת רשב"י ', "בני ברק", "יגאל אלון 6")
    assert a == b


def test_dedupe_key_separates_branches():
    first = restaurant_dedupe_key("פיצה", "ירושלים", "רשבי 15")
    second = restaurant_dedupe_key("פיצה", "ירושלים", "קקל 13")
    assert first != second


def test_parse_csv_bool():
    assert parse_csv_bool("TRUE") is True
    assert parse_csv_bool("true") is True
    assert parse_csv_bool("FALSE") is False
    assert parse_csv_bool("") is False
    assert parse_csv_bool(None) is False
