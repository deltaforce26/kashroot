"""Text normalization shared by every ingestion pipeline.

Hebrew source data is messy in predictable ways: nikud, geresh/gershayim typed four
different ways, doubled spaces from OCR, multi-branch addresses crammed into one cell.
Normalize once, here, so dedupe keys are stable across pipelines and re-runs.
"""

from __future__ import annotations

import re
import unicodedata

#: Hebrew points, cantillation marks and the like — dropped before comparison.
_NIKUD = re.compile("[֑-ׇ]")
_WHITESPACE = re.compile(r"\s+")
#: Punctuation that carries no identity information in a business name.
_KEY_NOISE = re.compile(r"[\"'`.,()\[\]{}\-–—_/\\|:;!?*]")
_NON_SLUG = re.compile(r"[^a-z0-9]+")

#: Hebrew geresh/gershayim and lookalikes → plain ASCII quotes.
_QUOTE_MAP = str.maketrans(
    {
        "׳": "'",  # HEBREW PUNCTUATION GERESH
        "״": '"',  # HEBREW PUNCTUATION GERSHAYIM
        "‘": "'",
        "’": "'",
        "“": '"',
        "”": '"',
        "´": "'",
        "′": "'",
        "″": '"',
    }
)

#: Separator used when one published row covers several branches
#: ("רשב\"י 15 / קק\"ל 13"). Requires surrounding spaces so apartment numbers
#: ("שבזי 33/2") are never split.
_BRANCH_SEPARATOR = re.compile(r"\s+/\s+")


def normalize_text(value: str | None) -> str | None:
    """NFC, drop nikud, unify quotes, collapse whitespace. ``None`` for empty input."""
    if value is None:
        return None
    text = unicodedata.normalize("NFC", value)
    text = _NIKUD.sub("", text)
    text = text.translate(_QUOTE_MAP)
    text = _WHITESPACE.sub(" ", text).strip()
    return text or None


def normalize_for_key(value: str | None) -> str:
    """Aggressive normalization for dedupe keys — punctuation and case are dropped."""
    text = normalize_text(value) or ""
    text = _KEY_NOISE.sub(" ", text)
    text = _WHITESPACE.sub(" ", text).strip().lower()
    return text


def normalize_phone(value: str | None) -> str | None:
    """Keep digits, ``*`` short codes and a leading ``+``. Everything else is noise."""
    text = normalize_text(value)
    if not text:
        return None
    cleaned = re.sub(r"[^\d*+]", "", text)
    return cleaned or None


def slugify_city(city_en: str | None, city_he: str | None) -> str | None:
    """Stable city key for filters and coverage reporting.

    Prefers the English name (ASCII slug). Falls back to the normalized Hebrew name
    when a source gave no English — better a Hebrew key than no key at all.
    """
    if city_en:
        slug = _NON_SLUG.sub("-", (normalize_text(city_en) or "").lower()).strip("-")
        if slug:
            return slug
    if city_he:
        text = normalize_for_key(city_he).replace(" ", "-")
        return text or None
    return None


def split_branch_addresses(address: str | None) -> list[str | None]:
    """Split a multi-branch address cell into one address per branch.

    ``"לבוש מרדכי 2 / בריינדס 3"`` → two addresses; ``"שבזי 33/2"`` → unchanged.
    Always returns at least one element (``[None]`` for an empty address).
    """
    text = normalize_text(address)
    if not text:
        return [None]
    parts = [p.strip() for p in _BRANCH_SEPARATOR.split(text)]
    parts = [p for p in parts if p]
    return list(parts) if len(parts) > 1 else [text]


def restaurant_dedupe_key(
    name_he: str | None, city_he: str | None, address_he: str | None
) -> str:
    """Natural key for a restaurant record. Pipelines upsert on this."""
    return "|".join(
        (
            normalize_for_key(name_he),
            normalize_for_key(city_he),
            normalize_for_key(address_he),
        )
    )


def parse_csv_bool(value: str | None) -> bool:
    return (value or "").strip().upper() in {"TRUE", "1", "YES", "Y"}
