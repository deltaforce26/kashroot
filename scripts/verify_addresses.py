"""Turn recorded address-search findings into a reviewable diff against the corpus.

Stage 2 of the address verification pass. Stage 1 searched each restaurant and recorded
what its public listings say, one JSON object per corpus row, with the evidence URL that
backs it. This script joins those findings back onto
``data/seed/kashroot_seed_corpus.csv`` and asks ``app.ingestion.address_compare`` whether
each pair actually disagrees.

The split matters: the search stage reports observations, this stage decides verdicts.
Because the decision is a pure function of the recorded inputs, re-running this script
over the committed findings reproduces the CSVs byte for byte — the report can be
re-derived and audited without re-searching anything.

Nothing here writes to the seed corpus. A row landing in the changes CSV is a candidate
for human review, not an established fact: a listing site can be as stale as a certifier
list, and only a person can tell a relocation from a bad transcription.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import dataclass
from pathlib import Path

from app.ingestion.address_compare import (
    CHANGED_VERDICTS,
    VERDICT_NO_COMPARISON,
    compare_addresses,
    parse_address,
)

CORPUS_PATH = Path("data/seed/kashroot_seed_corpus.csv")
REVIEW_DIR = Path("data/review")
FINDINGS_FILENAME = "address_search_findings.jsonl"
CHANGES_FILENAME = "address_changes.csv"
FULL_FILENAME = "address_verification_full.csv"

#: Excel opens Hebrew CSVs correctly only with a BOM; the corpus uses the same encoding.
CSV_ENCODING = "utf-8-sig"
CSV_LINE_TERMINATOR = "\n"

#: Search-stage outcomes that carry no single address to compare against.
STATUS_FOUND = "FOUND"
STATUS_NOT_FOUND = "NOT_FOUND"
STATUS_AMBIGUOUS = "AMBIGUOUS"

#: A row the search stage never reached. Distinct from NOT_FOUND on purpose: one says
#: the listings were checked and had nothing, the other says nobody looked. Collapsing
#: them would overstate how much of the corpus this pass actually covers.
STATUS_NOT_CHECKED = "NOT_CHECKED"

CHANGES_HEADER = [
    "row_number",
    "restaurant_name_he",
    "city_he",
    "city_en",
    "current_address_he",
    "google_address_he",
    "change_type",
    "current_trailing_context",
    "evidence_url",
    "needs_review",
    "notes",
]

FULL_HEADER = [
    "row_number",
    "restaurant_name_he",
    "city_he",
    "city_en",
    "current_address_he",
    "google_address_he",
    "verdict",
    "verdict_note",
    "evidence_url",
    "corroborating_urls",
    "candidates",
    "needs_review",
    "search_note",
]


@dataclass
class ReportRow:
    """One corpus row joined to its search finding and the resulting verdict."""

    row_number: int
    name_he: str
    city_he: str
    city_en: str
    current_address: str
    found_address: str
    verdict: str
    verdict_note: str
    evidence_url: str
    corroborating_urls: list[str]
    candidates: list[dict[str, str]]
    needs_review: str
    search_note: str
    trailing_context: str


def load_corpus(path: Path) -> dict[int, dict[str, str]]:
    """Index the seed corpus by CSV line number.

    Parameters:
        path (Path): Path to the seed corpus CSV.

    Return:
        dict[int, dict[str, str]]: Row number (header is line 1) → row.
    """
    with path.open(encoding=CSV_ENCODING, newline="") as handle:
        rows = list(csv.DictReader(handle))

    return {index: row for index, row in enumerate(rows, start=2)}


def load_findings(paths: list[Path]) -> list[dict]:
    """Read and merge the search shards, newest-listed shard last.

    Parameters:
        paths (list[Path]): JSONL shard files to merge.

    Return:
        list[dict]: Findings sorted by ``row_number``.

    Raises:
        ValueError: If two findings claim the same corpus row.
    """
    findings: dict[int, dict] = {}
    for path in paths:
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"{path}:{line_number} is not valid JSON") from error
            row_number = int(record["row_number"])
            if row_number in findings:
                raise ValueError(f"{path}:{line_number} duplicates row_number {row_number}")
            findings[row_number] = record

    return [findings[key] for key in sorted(findings)]


def build_report_row(corpus_row: dict[str, str], finding: dict) -> ReportRow:
    """Join one corpus row to its finding and decide the verdict.

    Parameters:
        corpus_row (dict[str, str]): The row as stored in the seed corpus.
        finding (dict): The search-stage record for that row.

    Return:
        ReportRow: The joined row, ready to write to either output CSV.
    """
    city_he = corpus_row["city_he"].strip()
    current = corpus_row["address_he"].strip()
    status = finding.get("found_status", STATUS_NOT_FOUND)
    found = (finding.get("found_address_raw") or "").strip()

    if status == STATUS_FOUND and found:
        verdict, note = compare_addresses(current, found, city_he)
    else:
        verdict, note = status, ""

    return ReportRow(
        row_number=int(finding["row_number"]),
        name_he=corpus_row["restaurant_name_he"].strip(),
        city_he=city_he,
        city_en=corpus_row["city_en"].strip(),
        current_address=current,
        found_address=found,
        verdict=verdict,
        verdict_note=note,
        evidence_url=(finding.get("evidence_url") or "").strip(),
        corroborating_urls=finding.get("corroborating_urls") or [],
        candidates=finding.get("candidates") or [],
        needs_review=corpus_row["needs_review"].strip(),
        search_note=(finding.get("agent_note") or "").strip(),
        trailing_context=parse_address(current, city_he).trailing_context,
    )


def _format_candidates(candidates: list[dict[str, str]]) -> str:
    """Flatten candidate addresses into one reviewable cell.

    Parameters:
        candidates (list[dict[str, str]]): Address/url pairs seen for an ambiguous row.

    Return:
        str: Semicolon-separated ``address (url)`` entries.
    """
    parts = []
    for candidate in candidates:
        address = (candidate.get("address") or "").strip()
        url = (candidate.get("url") or "").strip()
        if not address:
            continue
        parts.append(f"{address} ({url})" if url else address)

    return "; ".join(parts)


def write_changes_csv(rows: list[ReportRow], path: Path) -> int:
    """Write the rows whose corpus and listing addresses disagree.

    Parameters:
        rows (list[ReportRow]): All report rows.
        path (Path): Destination CSV.

    Return:
        int: Number of rows written.
    """
    changed = [row for row in rows if row.verdict in CHANGED_VERDICTS]
    with path.open("w", encoding=CSV_ENCODING, newline="") as handle:
        writer = csv.writer(handle, lineterminator=CSV_LINE_TERMINATOR)
        writer.writerow(CHANGES_HEADER)
        for row in changed:
            notes = "; ".join(part for part in (row.verdict_note, row.search_note) if part)
            writer.writerow(
                [
                    row.row_number,
                    row.name_he,
                    row.city_he,
                    row.city_en,
                    row.current_address,
                    row.found_address,
                    row.verdict,
                    row.trailing_context,
                    row.evidence_url,
                    row.needs_review,
                    notes,
                ]
            )

    return len(changed)


def write_full_csv(rows: list[ReportRow], path: Path) -> None:
    """Write every verified row with its verdict, so no outcome is silently dropped.

    Parameters:
        rows (list[ReportRow]): All report rows.
        path (Path): Destination CSV.

    Return:
        None
    """
    with path.open("w", encoding=CSV_ENCODING, newline="") as handle:
        writer = csv.writer(handle, lineterminator=CSV_LINE_TERMINATOR)
        writer.writerow(FULL_HEADER)
        for row in rows:
            writer.writerow(
                [
                    row.row_number,
                    row.name_he,
                    row.city_he,
                    row.city_en,
                    row.current_address,
                    row.found_address,
                    row.verdict,
                    row.verdict_note,
                    row.evidence_url,
                    "; ".join(row.corroborating_urls),
                    _format_candidates(row.candidates),
                    row.needs_review,
                    row.search_note,
                ]
            )


def write_findings(findings: list[dict], path: Path) -> None:
    """Persist the merged search findings so the report can be re-derived.

    Parameters:
        findings (list[dict]): Merged, row-sorted findings.
        path (Path): Destination JSONL.

    Return:
        None
    """
    with path.open("w", encoding="utf-8", newline="") as handle:
        for finding in findings:
            handle.write(json.dumps(finding, ensure_ascii=False, sort_keys=True) + "\n")


def unchecked_rows(corpus: dict[int, dict[str, str]], findings: list[dict]) -> list[ReportRow]:
    """Build placeholder rows for corpus entries the search stage never reached.

    Every row with an address belongs in the full report, whether or not it was
    searched. Omitting the unsearched ones would make the report look complete.

    Parameters:
        corpus (dict[int, dict[str, str]]): Corpus indexed by row number.
        findings (list[dict]): Findings recorded by the search stage.

    Return:
        list[ReportRow]: One NOT_CHECKED row per unsearched corpus row.
    """
    seen = {int(finding["row_number"]) for finding in findings}

    return [
        build_report_row(row, {"row_number": number, "found_status": STATUS_NOT_CHECKED})
        for number, row in corpus.items()
        if number not in seen and row["address_he"].strip()
    ]


def summarize(rows: list[ReportRow]) -> dict[str, int]:
    """Count rows per verdict.

    Parameters:
        rows (list[ReportRow]): All report rows.

    Return:
        dict[str, int]: Verdict → row count, most common first.
    """
    counts: dict[str, int] = {}
    for row in rows:
        counts[row.verdict] = counts.get(row.verdict, 0) + 1

    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))


def main(argv: list[str] | None = None) -> int:
    """Build the address verification report from recorded search findings.

    Parameters:
        argv (list[str] | None): Command-line arguments; ``None`` uses ``sys.argv``.

    Return:
        int: Process exit status; non-zero when a finding names an unknown corpus row.
    """
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--shards",
        type=Path,
        nargs="+",
        required=True,
        help="JSONL shard files produced by the search stage",
    )
    parser.add_argument("--corpus", type=Path, default=CORPUS_PATH)
    parser.add_argument("--out-dir", type=Path, default=REVIEW_DIR)
    args = parser.parse_args(argv)

    corpus = load_corpus(args.corpus)
    findings = load_findings(sorted(args.shards))

    unknown = [f["row_number"] for f in findings if int(f["row_number"]) not in corpus]
    if unknown:
        print(f"findings name {len(unknown)} rows absent from the corpus: {unknown[:10]}")

        return 1

    rows = [build_report_row(corpus[int(f["row_number"])], f) for f in findings]
    rows.extend(unchecked_rows(corpus, findings))
    rows.sort(key=lambda row: row.row_number)

    expected = sum(1 for row in corpus.values() if row["address_he"].strip())
    args.out_dir.mkdir(parents=True, exist_ok=True)
    write_findings(findings, args.out_dir / FINDINGS_FILENAME)
    changed = write_changes_csv(rows, args.out_dir / CHANGES_FILENAME)
    write_full_csv(rows, args.out_dir / FULL_FILENAME)

    searched = sum(1 for row in rows if row.verdict != STATUS_NOT_CHECKED)
    print(f"corpus rows with an address: {expected}")
    print(f"rows searched:               {searched}")
    if searched != expected:
        print(f"COVERAGE GAP: {expected - searched} row(s) were never searched")
    print(f"address changes written:     {changed}")
    for verdict, count in summarize(rows).items():
        print(f"  {verdict:16} {count}")
    if any(row.verdict == VERDICT_NO_COMPARISON for row in rows):
        print("NO_COMPARISON rows carry no street claim on one side; review by hand.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
