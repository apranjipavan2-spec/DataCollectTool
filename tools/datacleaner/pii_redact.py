"""PII redaction for data sent to third-party LLM providers (DPDP compliance).

DataCleaner operates on arbitrary user-uploaded datasets with no FieldGovern form
schema available, so this is heuristic-only: regex-based detection of identifier-
shaped values (email, phone, Aadhaar-like, GPS pairs) plus column-name matching
for common PII column titles. Structure-preserving where possible: column names
stay, cell values become "[REDACTED]".

Note: ai_correct's whole purpose is suggesting fixes for messy column values, so
redacting a column an operator explicitly selected for cleaning trades away that
feature for PII-named columns — that trade is intentional: DPDP data-minimisation
means personal data must not reach a third-party model, even at the cost of that
one feature not working on name/phone/email columns.
"""
import re

REDACTED = "[REDACTED]"

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"(?<!\d)(?:\+?91[-\s]?)?[6-9]\d{9}(?!\d)")       # Indian mobile
_AADHAAR_RE = re.compile(r"(?<!\d)\d{4}\s?\d{4}\s?\d{4}(?!\d)")          # 12-digit Aadhaar-shaped
_GPS_PAIR_RE = re.compile(r"-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,}")     # "lat,lng" pairs

# Tokenized on snake_case/camelCase boundaries and matched as whole tokens — a
# plain \b-anchored regex misses "respondent_name" (underscore is a \w char, no
# boundary forms there), while a bare substring match false-positives on
# "relate"/"calculate"/"flat" containing "lat".
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


def redact_unique_counts(column_name: str, items: dict) -> dict:
    """items = {value_str: count}. Redact keys, keep counts (aggregate, no
    row linkage, but the distinct values themselves may be identifiers)."""
    if is_pii_column(column_name):
        total = sum(items.values())
        return {REDACTED: total} if total else {}
    out = {}
    for key, cnt in items.items():
        out[REDACTED if _looks_like_pii(key) else key] = cnt
    return out
