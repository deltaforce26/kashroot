"""Constants and messages for reading the seed corpus CSV."""

CSV_ENCODING = "utf-8-sig"
ROW_WIDTH_ERROR_TEMPLATE = (
    "Seed corpus row at line {line} ({name!r}) has {actual} fields; "
    "the header declares {expected}. A missing or extra comma shifts values into "
    "the wrong columns."
)
EMPTY_NAME_PLACEHOLDER = ""
