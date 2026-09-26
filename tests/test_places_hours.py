"""Tests for ``app.services.places_hours`` — pure opening-hours logic, no I/O."""

from __future__ import annotations

import datetime as dt
import unittest

from app.services.places_hours import (
    day_rows,
    open_state,
    parse_periods,
    today_index,
)

ISRAEL_TZ = dt.timezone(dt.timedelta(hours=3))  # Israel Summer Time, fixed for tests


def israel_dt(year: int, month: int, day: int, hour: int, minute: int) -> dt.datetime:
    return dt.datetime(year, month, day, hour, minute, tzinfo=ISRAEL_TZ)


def period(
    open_day: int,
    open_hour: int,
    open_minute: int,
    close_day=None,
    close_hour=None,
    close_minute=None,
):
    raw: dict = {"open": {"day": open_day, "hour": open_hour, "minute": open_minute}}
    if close_day is not None:
        raw["close"] = {"day": close_day, "hour": close_hour, "minute": close_minute}
    return raw


class ParsePeriodsTests(unittest.TestCase):
    def test_always_open_sentinel_yields_single_close_none_period(self) -> None:
        raw = [period(0, 0, 0)]
        periods = parse_periods(raw)
        self.assertEqual(len(periods), 1)
        self.assertIsNone(periods[0].close_minute_of_week)
        self.assertEqual(periods[0].open_minute_of_week, 0)

    def test_ordinary_period_same_day(self) -> None:
        raw = [period(1, 9, 0, 1, 17, 30)]
        periods = parse_periods(raw)
        self.assertEqual(len(periods), 1)
        self.assertEqual(periods[0].open_minute_of_week, 1 * 1440 + 9 * 60)
        self.assertEqual(periods[0].close_minute_of_week, 1 * 1440 + 17 * 60 + 30)

    def test_cross_midnight_period_adds_full_week_when_close_before_open(self) -> None:
        raw = [period(4, 19, 0, 5, 2, 0)]
        periods = parse_periods(raw)
        self.assertEqual(periods[0].open_minute_of_week, 4 * 1440 + 19 * 60)
        self.assertEqual(periods[0].close_minute_of_week, 5 * 1440 + 2 * 60)

    def test_week_wraparound_when_close_is_earlier_in_week_than_open(self) -> None:
        raw = [period(6, 23, 0, 0, 2, 0)]
        periods = parse_periods(raw)
        expected_close = 7 * 1440 + 0 * 1440 + 2 * 60
        self.assertEqual(periods[0].close_minute_of_week, expected_close)

    def test_empty_periods(self) -> None:
        self.assertEqual(parse_periods([]), [])


class DayRowsTests(unittest.TestCase):
    def test_seven_rows_sunday_first(self) -> None:
        rows = day_rows(parse_periods([period(0, 9, 0, 0, 17, 0)]))
        self.assertEqual(len(rows), 7)
        self.assertEqual([row.day for row in rows], [0, 1, 2, 3, 4, 5, 6])

    def test_closed_day_has_no_ranges(self) -> None:
        rows = day_rows(parse_periods([period(1, 9, 0, 1, 17, 0)]))
        sunday = rows[0]
        self.assertTrue(sunday.closed)
        self.assertEqual(sunday.ranges, [])
        self.assertFalse(sunday.always_open)

    def test_open_day_has_range(self) -> None:
        rows = day_rows(parse_periods([period(1, 9, 0, 1, 17, 30)]))
        monday = rows[1]
        self.assertFalse(monday.closed)
        self.assertEqual(len(monday.ranges), 1)
        self.assertEqual(monday.ranges[0].open, "09:00")
        self.assertEqual(monday.ranges[0].close, "17:30")

    def test_cross_midnight_shown_on_opening_day_with_next_day_clock_time(self) -> None:
        rows = day_rows(parse_periods([period(4, 19, 0, 5, 2, 0)]))
        thursday = rows[4]
        self.assertFalse(thursday.closed)
        self.assertEqual(thursday.ranges[0].open, "19:00")
        self.assertEqual(thursday.ranges[0].close, "02:00")
        friday = rows[5]
        self.assertTrue(friday.closed)

    def test_always_open_marks_every_day_with_no_ranges(self) -> None:
        rows = day_rows(parse_periods([period(0, 0, 0)]))
        for row in rows:
            self.assertTrue(row.always_open)
            self.assertFalse(row.closed)
            self.assertEqual(row.ranges, [])

    def test_no_periods_means_every_day_closed(self) -> None:
        rows = day_rows([])
        for row in rows:
            self.assertTrue(row.closed)
            self.assertFalse(row.always_open)


class TodayIndexTests(unittest.TestCase):
    def test_sunday_is_zero(self) -> None:
        sunday = israel_dt(2026, 9, 27, 12, 0)  # a Sunday
        self.assertEqual(today_index(sunday), 0)

    def test_saturday_is_six(self) -> None:
        saturday = israel_dt(2026, 9, 26, 12, 0)  # a Saturday
        self.assertEqual(today_index(saturday), 6)

    def test_naive_datetime_treated_as_utc(self) -> None:
        naive_sunday_utc = dt.datetime(2026, 9, 27, 22, 0)  # 01:00 Monday in Israel
        self.assertEqual(today_index(naive_sunday_utc), 1)


class OpenStateTests(unittest.TestCase):
    def test_friday_afternoon_closes_at_14_30(self) -> None:
        periods = parse_periods([period(5, 8, 0, 5, 14, 30)])
        now = israel_dt(2026, 9, 25, 13, 0)  # a Friday
        state = open_state(periods, now)
        self.assertTrue(state.open_now)
        self.assertEqual(state.closes_at, "14:30")
        self.assertIsNone(state.opens_at)

    def test_shabbat_closed_opens_saturday_night(self) -> None:
        periods = parse_periods(
            [
                period(5, 8, 0, 5, 14, 30),  # Friday morning only
                period(6, 20, 0, 0, 1, 0),  # Saturday night into Sunday
            ]
        )
        now = israel_dt(2026, 9, 26, 15, 0)  # Saturday afternoon, closed
        state = open_state(periods, now)
        self.assertFalse(state.open_now)
        self.assertIsNone(state.closes_at)
        self.assertEqual(state.opens_at, "20:00")

    def test_thursday_late_night_inside_cross_midnight_period(self) -> None:
        periods = parse_periods([period(4, 19, 0, 5, 2, 0)])
        now = israel_dt(2026, 10, 1, 23, 30)  # a Thursday
        state = open_state(periods, now)
        self.assertTrue(state.open_now)
        self.assertEqual(state.closes_at, "02:00")

    def test_always_open_is_always_open_now_with_no_closes_or_opens(self) -> None:
        periods = parse_periods([period(0, 0, 0)])
        now = israel_dt(2026, 9, 26, 3, 0)
        state = open_state(periods, now)
        self.assertTrue(state.open_now)
        self.assertIsNone(state.closes_at)
        self.assertIsNone(state.opens_at)

    def test_no_periods_never_open_and_never_reopens(self) -> None:
        state = open_state([], israel_dt(2026, 9, 26, 12, 0))
        self.assertFalse(state.open_now)
        self.assertIsNone(state.closes_at)
        self.assertIsNone(state.opens_at)

    def test_utc_input_is_converted_to_israel_time(self) -> None:
        periods = parse_periods([period(5, 8, 0, 5, 14, 30)])
        # 2026-09-25 10:00 UTC is 13:00 in Israel (UTC+3 in September).
        now_utc = dt.datetime(2026, 9, 25, 10, 0, tzinfo=dt.UTC)
        state = open_state(periods, now_utc)
        self.assertTrue(state.open_now)
        self.assertEqual(state.closes_at, "14:30")


if __name__ == "__main__":
    unittest.main()
