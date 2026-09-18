"""DPDP children's-data protection: detect a minor respondent and whether
guardian consent was captured, from a form schema + one submission's answers.

Pure function, no DB access — called from both write paths (POST /submissions/
and POST /sync/push) right after data_json is assembled, before the row is
committed. A form only participates if its builder explicitly marked a date
field `is_dob_for_screening` — forms that never touch this feature are
completely unaffected (is_minor stays False, guardian_consent_given stays None).
"""
from datetime import date, datetime, timezone

from app.api.routes.export import _field_key

_AFFIRMATIVE = {"yes", "y", "true", "1", "consent given", "consented", "i consent", "agree"}


def _field_age_years(dob_str, as_of: date) -> int | None:
    """Parse a date-field answer (ISO 'YYYY-MM-DD', possibly with a time part)
    and return whole years of age as_of the given date. None if unparseable."""
    if not dob_str or not isinstance(dob_str, str):
        return None
    try:
        dob = date.fromisoformat(dob_str[:10])
    except ValueError:
        return None
    years = as_of.year - dob.year - ((as_of.month, as_of.day) < (dob.month, dob.day))
    return years if years >= 0 else None


def _is_affirmative(value) -> bool:
    """Handle the common answer shapes a consent question can take: a plain
    string, a single_choice value, or a multiple_choice list."""
    if isinstance(value, list):
        return any(_is_affirmative(v) for v in value)
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in _AFFIRMATIVE


def compute_child_protection_status(form_schema: dict, data_json: dict, as_of: date = None) -> dict:
    """Returns {"is_minor": bool, "guardian_consent_given": bool | None}.

    guardian_consent_given is None (not False) when the form has no
    is_guardian_consent field at all — "not applicable" is distinct from
    "asked and refused"."""
    as_of = as_of or datetime.now(timezone.utc).date()
    data_json = data_json or {}

    is_minor = False
    for section in (form_schema or {}).get("sections", []):
        for field in section.get("fields", []):
            if not field.get("is_dob_for_screening"):
                continue
            age = _field_age_years(data_json.get(_field_key(field)), as_of)
            if age is not None and age < 18:
                is_minor = True

    # Only meaningful once a minor is actually detected — an adult respondent's
    # form typically never shows/answers this field (skip logic hides it), but
    # even if the key happened to be present, "not applicable" (None) is the
    # correct value for an adult, not a spurious False from an unset answer.
    guardian_consent_given = None
    if is_minor:
        for section in (form_schema or {}).get("sections", []):
            for field in section.get("fields", []):
                if not field.get("is_guardian_consent"):
                    continue
                guardian_consent_given = _is_affirmative(data_json.get(_field_key(field)))

    return {"is_minor": is_minor, "guardian_consent_given": guardian_consent_given}


if __name__ == "__main__":
    schema = {
        "sections": [{
            "fields": [
                {"id": "f1", "name": "dob", "type": "date", "is_dob_for_screening": True},
                {"id": "f2", "name": "guardian_ok", "type": "single_choice", "is_guardian_consent": True},
                {"id": "f3", "name": "name", "type": "text"},
            ]
        }]
    }
    ref = date(2026, 9, 18)

    # Adult respondent — not flagged, consent field irrelevant.
    r = compute_child_protection_status(schema, {"dob": "2000-01-01", "name": "Asha"}, as_of=ref)
    assert r == {"is_minor": False, "guardian_consent_given": None}, r

    # Minor, guardian consented.
    r = compute_child_protection_status(schema, {"dob": "2015-01-01", "guardian_ok": "Yes"}, as_of=ref)
    assert r == {"is_minor": True, "guardian_consent_given": True}, r

    # Minor, guardian consent field present but refused/empty.
    r = compute_child_protection_status(schema, {"dob": "2015-01-01", "guardian_ok": "No"}, as_of=ref)
    assert r == {"is_minor": True, "guardian_consent_given": False}, r

    # Exactly turning 18 today is NOT a minor.
    r = compute_child_protection_status(schema, {"dob": "2008-09-18"}, as_of=ref)
    assert r["is_minor"] is False, r

    # One day before turning 18 IS still a minor.
    r = compute_child_protection_status(schema, {"dob": "2008-09-19"}, as_of=ref)
    assert r["is_minor"] is True, r

    # Missing/garbage DOB never crashes, never flags.
    r = compute_child_protection_status(schema, {"dob": "not-a-date"}, as_of=ref)
    assert r["is_minor"] is False, r
    r = compute_child_protection_status(schema, {}, as_of=ref)
    assert r["is_minor"] is False, r

    # Multiple-choice consent answer (list form).
    schema_mc = {"sections": [{"fields": [
        {"id": "f1", "name": "dob", "type": "date", "is_dob_for_screening": True},
        {"id": "f2", "name": "gc", "type": "multiple_choice", "is_guardian_consent": True},
    ]}]}
    r = compute_child_protection_status(schema_mc, {"dob": "2015-01-01", "gc": ["Consent given"]}, as_of=ref)
    assert r == {"is_minor": True, "guardian_consent_given": True}, r

    # No is_dob_for_screening field anywhere -> form untouched by this feature.
    plain_schema = {"sections": [{"fields": [{"id": "f1", "name": "age", "type": "number"}]}]}
    r = compute_child_protection_status(plain_schema, {"age": "12"}, as_of=ref)
    assert r == {"is_minor": False, "guardian_consent_given": None}, r

    print("child_protection self-check: OK")
