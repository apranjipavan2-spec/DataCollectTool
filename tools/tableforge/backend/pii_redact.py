"""PII redaction for data sent to third-party LLM providers (DPDP compliance).

TableForge operates on arbitrary user-uploaded datasets (CSV/Excel exports) with
no FieldGovern form schema available, so unlike the main app's
app/services/pii_redact.py there is no is_identifier flag to key off — this is
heuristic-only: regex-based detection of identifier-shaped values (email, phone,
Aadhaar-like, GPS pairs) plus column-name matching for common PII column titles.
Structure-preserving: column names stay, cell values become "[REDACTED]".
"""
import re

REDACTED = "[REDACTED]"

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"(?<!\d)(?:\+?91[-\s]?)?[6-9]\d{9}(?!\d)")       # Indian mobile
_AADHAAR_RE = re.compile(r"(?<!\d)\d{4}\s?\d{4}\s?\d{4}(?!\d)")          # 12-digit Aadhaar-shaped
_GPS_PAIR_RE = re.compile(r"-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,}")     # "lat,lng" pairs

# Column-name hints, in case a value itself doesn't look PII-shaped (e.g. a bare
# name has no regex signature). Tokenized on snake_case/camelCase boundaries and
# matched as whole tokens — a plain \b-anchored regex misses "respondent_name"
# (underscore is a \w char, no boundary forms there), while a bare substring
# match false-positives on "relate"/"calculate"/"flat" containing "lat".
_TOKEN_SPLIT_RE = re.compile(r"[^a-zA-Z0-9]+|(?<=[a-z0-9])(?=[A-Z])")
_PII_HINT_TOKENS = {
    "name", "phone", "mobile", "email", "address", "aadhaar", "adhaar",
    "gps", "location", "lat", "lng", "latitude", "longitude", "contact",
}


def _looks_like_pii(value) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    return bool(
        _EMAIL_RE.search(value)
        or _PHONE_RE.search(value)
        or _AADHAAR_RE.search(value)
        or _GPS_PAIR_RE.search(value)
    )


def is_pii_column(column_name) -> bool:
    if not column_name:
        return False
    # Split on the camelCase boundary BEFORE lowering — lowering first destroys
    # the uppercase signal the boundary lookahead needs (e.g. "phoneNumber").
    tokens = [t.lower() for t in _TOKEN_SPLIT_RE.split(str(column_name)) if t]
    return any(t in _PII_HINT_TOKENS for t in tokens)


def redact_row(row: dict) -> dict:
    """Copy of `row` with PII-shaped values, or values in a PII-named column,
    replaced by REDACTED."""
    if not isinstance(row, dict):
        return row
    out = {}
    for k, v in row.items():
        if is_pii_column(k):
            out[k] = REDACTED
        elif isinstance(v, list):
            out[k] = [REDACTED if _looks_like_pii(x) else x for x in v]
        elif _looks_like_pii(v):
            out[k] = REDACTED
        else:
            out[k] = v
    return out


def redact_rows(rows: list) -> list:
    return [redact_row(r) for r in rows]


def redact_values(values, column_name=None) -> list:
    """Redact a list of sample/unique values for one column."""
    if column_name is not None and is_pii_column(column_name):
        return [REDACTED for _ in values]
    return [REDACTED if _looks_like_pii(v) else v for v in values]
