"""PII redaction for data sent to third-party LLM providers (DPDP compliance —
personal data must be stripped/pseudonymised before any Claude/GPT/Gemini/DeepSeek call).

Two layers, applied together:
  1. Schema-driven: fields the org's Form Builder marked `is_identifier=True`
     (FieldEditor.tsx) are always stripped, regardless of content.
  2. Heuristic: regex-based defense-in-depth for identifier-shaped values that
     slipped through an untagged field (free text, notes, an un-tagged phone/email).

Structure-preserving: keys/columns stay, values become "[REDACTED]" — so the
model still sees field labels, counts and shape, just not the PII content.
"""
import re

REDACTED = "[REDACTED]"

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"(?<!\d)(?:\+?91[-\s]?)?[6-9]\d{9}(?!\d)")       # Indian mobile
_AADHAAR_RE = re.compile(r"(?<!\d)\d{4}\s?\d{4}\s?\d{4}(?!\d)")          # 12-digit Aadhaar-shaped
_GPS_PAIR_RE = re.compile(r"-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,}")     # "lat,lng" pairs


def _looks_like_pii(value) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    return bool(
        _EMAIL_RE.search(value)
        or _PHONE_RE.search(value)
        or _AADHAAR_RE.search(value)
        or _GPS_PAIR_RE.search(value)
    )


def redact_row(data: dict, identifier_fields: set = None) -> dict:
    """Copy of `data` with PII fields/values replaced by REDACTED.
    `identifier_fields` = field ids the form schema marked is_identifier=True —
    always stripped. Every other field is still scanned heuristically."""
    if not isinstance(data, dict):
        return data
    identifier_fields = identifier_fields or set()
    out = {}
    for k, v in data.items():
        if k in identifier_fields:
            out[k] = REDACTED
        elif isinstance(v, list):
            out[k] = [REDACTED if _looks_like_pii(x) else x for x in v]
        elif _looks_like_pii(v):
            out[k] = REDACTED
        else:
            out[k] = v
    return out


def redact_rows(rows: list, identifier_fields: set = None) -> list:
    return [redact_row(r, identifier_fields) for r in rows]


def redact_value(value, is_identifier_field: bool = False):
    """Redact a single scalar/list value (for unique-value buckets, not full rows)."""
    if is_identifier_field:
        return REDACTED
    if isinstance(value, list):
        return [REDACTED if _looks_like_pii(x) else x for x in value]
    return REDACTED if _looks_like_pii(value) else value


def _mask_aadhaar_match(m: "re.Match") -> str:
    digits = re.sub(r"\s", "", m.group(0))
    return f"XXXX-XXXX-{digits[-4:]}"


def mask_aadhaar(value):
    """Replace any Aadhaar-shaped digit sequence in `value` with a masked
    last-4-only form (e.g. "1234 5678 9012" -> "XXXX-XXXX-9012"). This is
    minimisation, not encryption — DPDP's "never store full Aadhaar" is best
    satisfied by not holding a reversible full copy at all, so there's
    nothing to decrypt or leak later, and no read-path changes are needed
    anywhere the value is later displayed or exported."""
    if isinstance(value, str):
        return _AADHAAR_RE.sub(_mask_aadhaar_match, value)
    if isinstance(value, list):
        return [mask_aadhaar(v) for v in value]
    return value


def mask_aadhaar_in_data(data: dict) -> dict:
    """Apply mask_aadhaar() to every value in a submission's data_json, at
    write time, before it's ever persisted. Call this at every point a
    submission's answers are stored or replaced — see submissions.py,
    sync.py, public_survey.py."""
    if not isinstance(data, dict):
        return data
    return {k: mask_aadhaar(v) for k, v in data.items()}


def identifier_field_ids(form_schema: dict) -> set:
    """Field ids marked is_identifier=True in a Form.json_schema. Mirrors
    submissions.py:_identifier_fields but returns a set for O(1) lookups."""
    from app.api.routes.export import _field_key
    ids = set()
    for section in (form_schema or {}).get("sections", []):
        for f in section.get("fields", []):
            if f.get("is_identifier"):
                fid = _field_key(f)
                if fid:
                    ids.add(fid)
    return ids
