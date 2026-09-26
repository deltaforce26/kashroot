"""Pure opening-hours logic over Google Places (New) ``regularOpeningHours`` periods.

No I/O, no Google client here — this module only turns the raw period shape Google
returns (``{"open": {"day": 0-6, "hour", "minute"}, "close": {...} | absent}``, where
``day`` 0 is Sunday) into the Sunday-first day rows and "open now / closes at / opens
at" the response contract needs. ``app.services.places`` is the only caller and does
all the network work; this stays exhaustively unit-tested in isolation
(``tests/test_places_hours.py``).

A single period with an ``open`` of day 0 at 00:00 and no ``close`` key is Google's
documented shape for "always open" (24/7) — every function here treats that as a
sentinel, not as a period closing at midnight.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any

from app.api.admin.consts import ISRAEL_TZ
from app.services.places_consts import DAYS_PER_WEEK, HOURS_PER_DAY, MINUTES_PER_HOUR

MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR
MINUTES_PER_WEEK = DAYS_PER_WEEK * MINUTES_PER_DAY


@dataclass(frozen=True)
class Period:
    """One opening period, in day-of-week (0=Sunday) + minute-of-day form.

    ``close_minute_of_week`` is ``None`` only for the 24/7 sentinel (no close at
    all). Otherwise it is always expressed *after* ``open_minute_of_week`` — a close
    that lands earlier in the week than its open (e.g. opens Saturday night, closes
    Sunday morning) has ``MINUTES_PER_WEEK`` added, so every period is a plain
    half-open interval ``[open, close)`` with no wraparound left to handle downstream.
    """

    open_minute_of_week: int
    close_minute_of_week: int | None


@dataclass(frozen=True)
class HoursRange:
    """One open/close pair, as clock times, for one day row."""

    open: str
    close: str


@dataclass(frozen=True)
class DayRow:
    """One Sunday-first day row (``day`` 0=Sunday..6=Saturday)."""

    day: int
    ranges: list[HoursRange]
    closed: bool
    always_open: bool


@dataclass(frozen=True)
class OpenState:
    """ "Right now" derived from the periods, in the viewer's Israel-local instant."""

    open_now: bool
    closes_at: str | None
    opens_at: str | None


def _format_clock(minute_of_day: int) -> str:
    """
    Format a minute-of-day as zero-padded ``HH:MM``.

    Parameters:
        minute_of_day (int): Minutes since local midnight (may exceed 1439 for a
            close time expressed past midnight; the result then wraps to the true
            clock time — e.g. 1560 -> "02:00").

    Return:
        str: The ``HH:MM`` clock time.
    """
    wrapped = minute_of_day % MINUTES_PER_DAY

    return f"{wrapped // MINUTES_PER_HOUR:02d}:{wrapped % MINUTES_PER_HOUR:02d}"


def _is_always_open_sentinel(raw_periods: list[dict[str, Any]]) -> bool:
    """
    Detect Google's documented 24/7 shape: exactly one period, opening Sunday at
    00:00, with no ``close`` key at all.

    Parameters:
        raw_periods (list[dict[str, Any]]): The raw ``regularOpeningHours.periods``
            (or ``currentOpeningHours.periods``) list from Place Details.

    Return:
        bool: Whether ``raw_periods`` is the 24/7 sentinel.
    """
    if len(raw_periods) != 1:
        return False

    only = raw_periods[0]
    open_point = only.get("open") or {}

    return (
        "close" not in only
        and open_point.get("day") == 0
        and open_point.get("hour") == 0
        and open_point.get("minute") == 0
    )


def parse_periods(raw_periods: list[dict[str, Any]]) -> list[Period]:
    """
    Parse Google's raw ``periods`` list into :class:`Period` values.

    Parameters:
        raw_periods (list[dict[str, Any]]): The raw periods from Place Details.

    Return:
        list[Period]: The parsed periods. Empty input yields an empty list (treated
            as "closed every day" by :func:`day_rows` and :func:`open_state`).
    """
    if _is_always_open_sentinel(raw_periods):
        return [Period(open_minute_of_week=0, close_minute_of_week=None)]

    periods: list[Period] = []
    for raw in raw_periods:
        open_point = raw.get("open")
        if open_point is None:
            continue
        open_abs = (
            open_point["day"] * MINUTES_PER_DAY
            + open_point["hour"] * MINUTES_PER_HOUR
            + open_point["minute"]
        )
        close_point = raw.get("close")
        if close_point is None:
            periods.append(Period(open_minute_of_week=open_abs, close_minute_of_week=None))
            continue
        close_abs = (
            close_point["day"] * MINUTES_PER_DAY
            + close_point["hour"] * MINUTES_PER_HOUR
            + close_point["minute"]
        )
        if close_abs <= open_abs:
            close_abs += MINUTES_PER_WEEK
        periods.append(Period(open_minute_of_week=open_abs, close_minute_of_week=close_abs))

    return periods


def day_rows(periods: list[Period]) -> list[DayRow]:
    """
    Build the 7 Sunday-first day rows from parsed periods.

    A period is shown on the row for the day it *opens* on, with its close time
    rendered as the plain clock time even when that time falls after midnight (e.g.
    "23:00" - "02:00") — matching how Google's own ``weekdayDescriptions`` reads. A
    global 24/7 place (the sentinel period from :func:`parse_periods`) marks every
    row ``always_open`` with no ranges.

    Parameters:
        periods (list[Period]): The parsed periods, as from :func:`parse_periods`.

    Return:
        list[DayRow]: Exactly 7 rows, ``day`` 0 (Sunday) through 6 (Saturday).
    """
    if len(periods) == 1 and periods[0].close_minute_of_week is None:
        return [
            DayRow(day=day, ranges=[], closed=False, always_open=True)
            for day in range(DAYS_PER_WEEK)
        ]

    rows: list[DayRow] = []
    for day in range(DAYS_PER_WEEK):
        day_start = day * MINUTES_PER_DAY
        ranges = [
            HoursRange(
                open=_format_clock(period.open_minute_of_week),
                close=_format_clock(period.close_minute_of_week or period.open_minute_of_week),
            )
            for period in periods
            if period.open_minute_of_week - day_start in range(MINUTES_PER_DAY)
        ]
        rows.append(DayRow(day=day, ranges=ranges, closed=not ranges, always_open=False))

    return rows


def today_index(now: dt.datetime) -> int:
    """
    Resolve the Sunday-first day index (0=Sunday..6=Saturday) for an instant, in
    Israel local time.

    Parameters:
        now (dt.datetime): The instant to resolve. Naive input is treated as UTC;
            aware input is converted to Israel local time regardless of its own
            timezone.

    Return:
        int: The Sunday-first day index.
    """
    israel_now = _to_israel(now)
    python_weekday = israel_now.weekday()  # Monday=0 .. Sunday=6

    return (python_weekday + 1) % DAYS_PER_WEEK


def _to_israel(now: dt.datetime) -> dt.datetime:
    """
    Normalize an instant to Israel local time.

    Parameters:
        now (dt.datetime): Naive (treated as UTC) or aware.

    Return:
        dt.datetime: The equivalent Israel-local, aware datetime.
    """
    aware = now if now.tzinfo is not None else now.replace(tzinfo=dt.UTC)

    return aware.astimezone(ISRAEL_TZ)


def _minute_of_week(now_israel: dt.datetime) -> int:
    """
    Convert an Israel-local instant to its Sunday-first minute-of-week.

    Parameters:
        now_israel (dt.datetime): An Israel-local, aware datetime.

    Return:
        int: Minutes since Sunday 00:00 Israel time, in ``[0, MINUTES_PER_WEEK)``.
    """
    python_weekday = now_israel.weekday()
    day = (python_weekday + 1) % DAYS_PER_WEEK

    return day * MINUTES_PER_DAY + now_israel.hour * MINUTES_PER_HOUR + now_israel.minute


def open_state(periods: list[Period], now: dt.datetime) -> OpenState:
    """
    Derive "open now / closes at / opens at" for one instant.

    Every period is checked at its stored position, one week earlier and one week
    later, so a period that opened last week and wraps past this week's start (or
    one that will not open until next week from ``now``'s vantage point) is still
    found — periods themselves have no notion of "which week", only day-of-week.

    Parameters:
        periods (list[Period]): The parsed periods, as from :func:`parse_periods`.
            An empty list means "closed every day".
        now (dt.datetime): The instant to evaluate. Naive input is treated as UTC.

    Return:
        OpenState: ``open_now`` plus, mutually exclusively, ``closes_at`` (when
            currently open and not 24/7) or ``opens_at`` (when currently closed).
            Both are ``None`` for a 24/7 place, and ``opens_at`` is ``None`` when
            there is no period to reopen at all.
    """
    minute_now = _minute_of_week(_to_israel(now))

    for period in periods:
        if period.close_minute_of_week is None:
            return OpenState(open_now=True, closes_at=None, opens_at=None)

    for shift in (-MINUTES_PER_WEEK, 0, MINUTES_PER_WEEK):
        for period in periods:
            open_abs = period.open_minute_of_week + shift
            close_abs = period.close_minute_of_week + shift
            if open_abs <= minute_now < close_abs:
                return OpenState(open_now=True, closes_at=_format_clock(close_abs), opens_at=None)

    soonest: int | None = None
    for shift in (0, MINUTES_PER_WEEK):
        for period in periods:
            open_abs = period.open_minute_of_week + shift
            if open_abs >= minute_now and (soonest is None or open_abs < soonest):
                soonest = open_abs

    return OpenState(
        open_now=False,
        closes_at=None,
        opens_at=_format_clock(soonest) if soonest is not None else None,
    )
