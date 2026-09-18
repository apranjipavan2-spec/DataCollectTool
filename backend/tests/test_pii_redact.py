"""Crux check for AI-call PII redaction: fields marked is_identifier=True must be
stripped regardless of content, and identifier-shaped values (email/phone/Aadhaar/
GPS pair) in untagged fields must be caught by the heuristic layer. If this breaks,
raw respondent data can reach a third-party LLM provider."""
from app.services.pii_redact import redact_row, redact_rows, redact_value, REDACTED


def test_identifier_field_always_redacted():
    row = {"name": "Priya Sharma", "age": "34"}
    out = redact_row(row, identifier_fields={"name"})
    assert out == {"name": REDACTED, "age": "34"}


def test_heuristic_catches_untagged_email_and_phone():
    row = {"notes": "contact priya@example.com or 9876543210", "count": "5"}
    out = redact_row(row)
    assert out["notes"] == REDACTED
    assert out["count"] == "5"  # non-PII-shaped values pass through unchanged


def test_heuristic_catches_aadhaar_and_gps_pair():
    row = {"id_number": "1234 5678 9012", "location": "12.9716,77.5946", "village": "Rampur"}
    out = redact_row(row)
    assert out["id_number"] == REDACTED
    assert out["location"] == REDACTED
    assert out["village"] == "Rampur"


def test_list_values_scanned_per_item():
    row = {"contacts": ["priya@example.com", "no PII here"]}
    out = redact_row(row)
    assert out["contacts"] == [REDACTED, "no PII here"]


def test_redact_rows_batch_and_non_dict_passthrough():
    rows = [{"name": "A"}, {"name": "B"}]
    out = redact_rows(rows, identifier_fields={"name"})
    assert out == [{"name": REDACTED}, {"name": REDACTED}]
    assert redact_row(None) is None  # defensive: never crash on malformed input


def test_redact_value_scalar():
    assert redact_value("9876543210") == REDACTED
    assert redact_value("Rampur") == "Rampur"
    assert redact_value("Rampur", is_identifier_field=True) == REDACTED
