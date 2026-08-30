"""Structural comparison of two Hebrew street addresses.

Certifier lists and business listings write the same address differently. The corpus
carries what a certifier published — often street, number *and* a neighbourhood or mall
("דרך חברון 101 תלפיות") — while a listing publishes street, number, city and country
("דרך חברון 101, ירושלים"). Comparing those as strings calls the same address a change;
118 of the 370 corpus addresses carry trailing context, so a naive diff would falsely
flag roughly a third of the corpus.

This module reduces both sides to a ``(street, house_number)`` pair and compares only
that. Trailing context is preserved for the report but never enters the comparison.
The functions are pure so the verdict for a row is reproducible from its recorded
inputs, independent of when the search that produced it ran.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.ingestion.normalize import normalize_for_key, normalize_text, split_branch_addresses

#: Verdicts over a (corpus, found) address pair.
VERDICT_SAME = "SAME"
VERDICT_CHANGED_NUMBER = "CHANGED_NUMBER"
VERDICT_CHANGED_STREET = "CHANGED_STREET"
VERDICT_CHANGED_BOTH = "CHANGED_BOTH"
VERDICT_NO_COMPARISON = "NO_COMPARISON"

#: Verdicts that mean the two sources disagree about where the business is.
CHANGED_VERDICTS = frozenset({VERDICT_CHANGED_NUMBER, VERDICT_CHANGED_STREET, VERDICT_CHANGED_BOTH})

#: Dropped wherever they appear — they identify the locale, not the street.
_COUNTRY_TOKENS = frozenset({"ישראל", "israel"})

#: Street-type words. One source writes "שד' יגאל אלון", the other "יגאל אלון"; the
#: word identifies the kind of thoroughfare, not which one, so it is dropped.
_PREFIX_DROP = (
    "רחוב ",
    "רח' ",
    "רח ",
    "שדרות ",
    "שדרו' ",
    "שד' ",
    "שד ",
    "מדרחוב ",
)

#: Honorific abbreviations that expand to a single canonical spelling.
_TOKEN_ALIASES = {
    "ר'": "רבי",
    "הר'": "הרב",
    "פנת": "פינת",
}

#: Geresh and gershayim sit *inside* Hebrew words (ז'בוטינסקי, ש"ך). They must be
#: deleted rather than replaced by a space, or one token becomes two.
_INWORD_MARKS = str.maketrans({"'": "", '"': "", ".": ""})

#: A one-character difference between two street names is a spelling variant
#: (האצטדיון/האיצטדיון, בנין/בניין), not a different street. Applied only to names
#: long enough that a single character cannot change which street is meant.
_SPELLING_DISTANCE = 1
_MIN_LENGTH_FOR_SPELLING_VARIANT = 5

#: A lone token shorter than this is too generic to carry a street's identity on its
#: own, so it never licenses a subset match.
_MIN_SINGLE_TOKEN_LENGTH = 3

#: A house number: ``101``, ``12א``, ``12-14``, ``33/2``. Anchored to token
#: boundaries so a number inside a street name ("שמונה עשרה") is never taken.
_HOUSE_NUMBER = re.compile(r"(?<![\w֐-׿])(\d+(?:\s*[-–/]\s*\d+)?[א-ת]?)(?![\w])")

#: Israeli postal codes are 5 or 7 digits with no street context around them.
_POSTAL_CODE = re.compile(r"(?<!\S)\d{5}(?:\d{2})?(?!\S)")

_WHITESPACE = re.compile(r"\s+")

#: Any Hebrew or Latin letter — a leftover of digits alone is not a street name.
_HAS_LETTER = re.compile(r"[^\W\d_]")


@dataclass(frozen=True)
class ParsedAddress:
    """One address reduced to its comparable parts.

    Attributes:
        street (str): Street name, prefix-stripped and normalized for comparison.
        house_number (str): House number as written, or "" when the address has none.
        trailing_context (str): Neighbourhood or mall text following the number.
            Reported, never compared.
        raw (str): The input, normalized only for whitespace and quote marks.
        is_city_only (bool): The input named the city and nothing else. A listing that
            returns only "ירושלים" carries no street claim, so it must not be diffed
            against a real street address.
    """

    street: str
    house_number: str
    trailing_context: str
    raw: str
    is_city_only: bool = False

    @property
    def is_comparable(self) -> bool:
        """Whether this address carries enough structure to diff against another.

        Return:
            bool: True when a street name was recovered.
        """
        return bool(self.street)


def _canonical_street(value: str) -> str:
    """Reduce a street name to the form two spellings of it share.

    Drops a leading street-type word (``רחוב``, ``שד'``, ``מדרחוב``), expands honorific
    abbreviations, deletes in-word geresh and gershayim so ``ז'בוטינסקי`` stays one
    token, strips remaining punctuation and case, and drops the definite ``ה`` from each
    token so ``הירקון`` and ``ירקון`` compare equal.

    Parameters:
        value (str): Street name, already separated from its house number.

    Return:
        str: Canonical form for equality comparison.
    """
    text = (normalize_text(value) or "").strip()
    for prefix in _PREFIX_DROP:
        if text.startswith(prefix):
            text = text[len(prefix) :]
            break

    tokens = [_TOKEN_ALIASES.get(token, token) for token in text.split()]
    text = " ".join(token for token in tokens if token).translate(_INWORD_MARKS)
    text = normalize_for_key(text)

    tokens = [
        token[1:] if len(token) > 2 and token.startswith("ה") else token for token in text.split()
    ]

    return " ".join(tokens)


def _edit_distance(left: str, right: str) -> int:
    """Levenshtein distance between two strings.

    Parameters:
        left (str): First string.
        right (str): Second string.

    Return:
        int: Minimum single-character edits turning one into the other.
    """
    if left == right:
        return 0
    previous = list(range(len(right) + 1))
    for i, left_char in enumerate(left, start=1):
        current = [i]
        for j, right_char in enumerate(right, start=1):
            current.append(
                min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + (left_char != right_char),
                )
            )
        previous = current

    return previous[-1]


def streets_match(left: str, right: str) -> tuple[bool, str]:
    """Whether two canonical street names denote the same street.

    Sources name the same street at different lengths ("ז'בוטינסקי" vs
    "זאב ז'בוטינסקי", "הרב קוק" vs "הרב אברהם יצחק הכהן קוק") and spell it plene or
    defective ("האצטדיון" vs "האיצטדיון"). Neither is a relocation, and treating them as
    one would bury the genuine moves under false positives. Matching therefore accepts a
    token subset in either direction, and a one-character spelling difference.

    Parameters:
        left (str): Canonical street name.
        right (str): Canonical street name.

    Return:
        tuple[bool, str]: Whether they match, and why when the match was not exact.
    """
    if left == right:
        return True, ""

    left_tokens = set(left.split())
    right_tokens = set(right.split())
    smaller, larger = sorted((left_tokens, right_tokens), key=len)
    if smaller and smaller < larger:
        lone = next(iter(smaller)) if len(smaller) == 1 else None
        if lone is None or len(lone) >= _MIN_SINGLE_TOKEN_LENGTH:
            return True, "one source names the street more fully than the other"

    if (
        min(len(left), len(right)) >= _MIN_LENGTH_FOR_SPELLING_VARIANT
        and _edit_distance(left, right) <= _SPELLING_DISTANCE
    ):
        return True, "street spelling variant"

    return False, ""


def _canonical_number(value: str) -> str:
    """Normalize a house number so spacing and dash style do not read as a change.

    Parameters:
        value (str): House number as written.

    Return:
        str: Canonical form, e.g. ``"12 - 14"`` → ``"12-14"``.
    """
    text = _WHITESPACE.sub("", normalize_text(value) or "")

    return text.replace("–", "-")


def _strip_locale(text: str, city_he: str | None) -> str:
    """Remove the city, country and postal code from an address string.

    A listing repeats the city the corpus already stores in its own column; leaving it
    in would make the found address structurally different from the corpus one for
    every single row.

    Some places *are* their own address — a street named after the city ("ירושלים 36"
    in Bnei Brak) or a village where the settlement name is all there is ("מושב מירון"
    in Merón). Stripping is therefore abandoned whenever it would leave nothing behind,
    so those rows stay comparable instead of collapsing to an empty street.

    Parameters:
        text (str): Normalized address text.
        city_he (str | None): The row's city, removed wherever it appears.

    Return:
        str: The address with locale tokens removed.
    """
    segments = [segment.strip() for segment in text.split(",")]
    city = (normalize_text(city_he) or "").strip()

    kept = []
    for segment in segments:
        if not segment:
            continue
        bare = _POSTAL_CODE.sub("", segment).strip()
        if not bare:
            continue
        if city and normalize_for_key(bare) == normalize_for_key(city):
            continue
        if normalize_for_key(bare) in _COUNTRY_TOKENS:
            continue
        kept.append(bare)

    if not kept:
        return _WHITESPACE.sub(" ", _POSTAL_CODE.sub("", text)).strip(" ,")

    joined = ", ".join(kept)
    if city:
        without_city = re.sub(rf"(?<![\w֐-׿]){re.escape(city)}(?![\w֐-׿])", " ", joined)
        if _HAS_LETTER.search(without_city):
            joined = without_city

    return _WHITESPACE.sub(" ", joined).strip(" ,")


def parse_address(value: str | None, city_he: str | None = None) -> ParsedAddress:
    """Split an address into street, house number and trailing context.

    Handles both corpus shapes ("שדרות האמוראים 59", "דרך חברון 101 תלפיות") and
    listing shapes ("דרך חברון 101, ירושלים", "בית הנציב, דרך חברון 101, ישראל").
    Multi-branch cells are reduced to their first branch, matching how
    ``split_branch_addresses`` treats them elsewhere in ingestion.

    Parameters:
        value (str | None): The address to parse.
        city_he (str | None): Row city, stripped out before parsing.

    Return:
        ParsedAddress: The parsed parts; an empty street when nothing was recoverable.
    """
    text = normalize_text(value)
    if not text:
        return ParsedAddress(street="", house_number="", trailing_context="", raw="")

    raw = text
    first_branch = split_branch_addresses(text)[0] or text
    city_only = bool(city_he) and normalize_for_key(first_branch) == normalize_for_key(city_he)
    stripped = _strip_locale(first_branch, city_he)
    if not stripped:
        return ParsedAddress(street="", house_number="", trailing_context="", raw=raw)

    candidates = [segment.strip() for segment in stripped.split(",") if segment.strip()]
    numbered = [segment for segment in candidates if _HOUSE_NUMBER.search(segment)]
    segment = numbered[0] if numbered else candidates[0]

    match = _HOUSE_NUMBER.search(segment)
    if not match:
        return ParsedAddress(
            street=_canonical_street(segment),
            house_number="",
            trailing_context="",
            raw=raw,
            is_city_only=city_only,
        )

    street = segment[: match.start()].strip(" ,-")
    trailing = segment[match.end() :].strip(" ,-")
    if not street:
        street = segment[match.end() :].strip(" ,-")
        trailing = ""

    return ParsedAddress(
        street=_canonical_street(street),
        house_number=_canonical_number(match.group(1)),
        trailing_context=trailing,
        raw=raw,
        is_city_only=city_only,
    )


def compare_addresses(
    corpus_address: str | None, found_address: str | None, city_he: str | None = None
) -> tuple[str, str]:
    """Decide whether a found address contradicts the corpus address.

    Compares ``(street, house_number)`` only. A trailing neighbourhood or mall name on
    either side is ignored, and a house number missing from one side is reported rather
    than treated as a difference — absence is not evidence of a move.

    Parameters:
        corpus_address (str | None): ``address_he`` from the seed corpus.
        found_address (str | None): Address as published by a listing.
        city_he (str | None): Row city, excluded from both sides before comparison.

    Return:
        tuple[str, str]: The verdict, and a short note explaining any nuance behind it.
    """
    corpus = parse_address(corpus_address, city_he)
    found = parse_address(found_address, city_he)

    if not corpus.is_comparable or not found.is_comparable:
        return VERDICT_NO_COMPARISON, "no street name recoverable from one side"

    if corpus.is_city_only != found.is_city_only:
        return (
            VERDICT_NO_COMPARISON,
            "one side names only the city; no street detail to compare",
        )

    matched, match_reason = streets_match(corpus.street, found.street)
    street_differs = not matched
    have_both_numbers = bool(corpus.house_number) and bool(found.house_number)

    notes = [match_reason] if match_reason else []
    number_differs = False
    if have_both_numbers and corpus.house_number != found.house_number:
        number_differs = True
        corpus_base = re.match(r"\d+", corpus.house_number)
        found_base = re.match(r"\d+", found.house_number)
        if corpus_base and found_base and corpus_base.group() == found_base.group():
            notes.append("house-number suffix or range only")
    elif not have_both_numbers:
        notes.append("house number missing on one side; compared on street name only")

    note = "; ".join(notes)
    if street_differs and number_differs:
        return VERDICT_CHANGED_BOTH, note
    if street_differs:
        return VERDICT_CHANGED_STREET, note
    if number_differs:
        return VERDICT_CHANGED_NUMBER, note

    return VERDICT_SAME, note
