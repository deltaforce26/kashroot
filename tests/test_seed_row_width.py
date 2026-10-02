"""Row-width guard for the seed corpus reader."""

import tempfile
import unittest
from pathlib import Path

from app.ingestion.seed_import import (
    DEFAULT_CSV_PATH,
    SeedCorpusRowWidthError,
    read_rows,
)

HEADER = "name,city,place_id"
GOOD_ROW = "Cafe,Jerusalem,ID1"
SHORT_ROW = "Cafe Short,Jerusalem"
LONG_ROW = "Cafe Long,Jerusalem,ID1,extra"


def _write_csv(directory: str, lines: list[str]) -> Path:
    """
    Write lines to a UTF-8 BOM CSV in a directory.

    Parameters:
        directory (str): Target directory.
        lines (list[str]): CSV lines, header first.

    Return:
        Path: The written file.
    """
    path = Path(directory) / "corpus.csv"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8-sig")

    return path


class RealCorpusWidthTest(unittest.TestCase):
    """The committed corpus must have every row as wide as its header."""

    @unittest.skipUnless(DEFAULT_CSV_PATH.exists(), "seed corpus not present")
    def test_every_row_matches_header_width(self) -> None:
        """Regression: a 17-field row once shifted a place ID into opening_hours_he."""
        rows = list(read_rows(DEFAULT_CSV_PATH))

        self.assertGreater(len(rows), 0)
        self.assertTrue(all(None not in row for row in rows))


class ReaderWidthGuardTest(unittest.TestCase):
    """read_rows rejects malformed widths and accepts well-formed rows."""

    def test_accepts_well_formed_row(self) -> None:
        """A row matching the header is returned keyed by header."""
        with tempfile.TemporaryDirectory() as tmp:
            rows = list(read_rows(_write_csv(tmp, [HEADER, GOOD_ROW])))

        self.assertEqual(rows, [{"name": "Cafe", "city": "Jerusalem", "place_id": "ID1"}])

    def test_rejects_short_row(self) -> None:
        """A short row fails, naming line, restaurant and both counts."""
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_csv(tmp, [HEADER, GOOD_ROW, SHORT_ROW])
            with self.assertRaises(SeedCorpusRowWidthError) as ctx:
                list(read_rows(path))

        message = str(ctx.exception)
        self.assertIn("line 3", message)
        self.assertIn("Cafe Short", message)
        self.assertIn("2 fields", message)
        self.assertIn("declares 3", message)

    def test_rejects_long_row(self) -> None:
        """A long row fails the same way."""
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_csv(tmp, [HEADER, LONG_ROW])
            with self.assertRaises(SeedCorpusRowWidthError) as ctx:
                list(read_rows(path))

        self.assertIn("4 fields", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
