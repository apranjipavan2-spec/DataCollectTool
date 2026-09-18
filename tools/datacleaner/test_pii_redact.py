"""Crux check for DataCleaner's AI-call PII redaction. If this breaks, raw
uploaded-dataset PII can reach a third-party LLM provider via /api/ai_correct.
Run directly: python test_pii_redact.py"""
from pii_redact import redact_row, redact_rows, redact_unique_counts, is_pii_column, REDACTED


def demo():
    assert redact_row({"name": "Priya Sharma", "age": "34"}) == {"name": REDACTED, "age": "34"}

    row = {"notes": "contact priya@example.com or 9876543210", "count": "5"}
    out = redact_row(row)
    assert out["notes"] == REDACTED and out["count"] == "5"

    row2 = {"id_number": "1234 5678 9012", "location": "12.9716,77.5946", "village": "Rampur"}
    out2 = redact_row(row2)
    assert out2["id_number"] == REDACTED and out2["location"] == REDACTED and out2["village"] == "Rampur"

    assert redact_rows([{"name": "A"}, {"name": "B"}]) == [{"name": REDACTED}, {"name": REDACTED}]
    assert redact_row(None) is None

    # Unique-value-counts path: PII column collapses to one REDACTED bucket
    # (aggregate total preserved), non-PII column passes through unchanged.
    assert redact_unique_counts("phone_number", {"9876543210": 3, "9123456789": 2}) == {REDACTED: 5}
    assert redact_unique_counts("age_group", {"18-25": 3, "26-35": 2}) == {"18-25": 3, "26-35": 2}
    # Even in a non-PII-named column, an identifier-shaped key gets redacted.
    assert redact_unique_counts("notes", {"priya@example.com": 1, "ok": 4}) == {REDACTED: 1, "ok": 4}

    assert is_pii_column("Phone Number") and not is_pii_column("age_group")
    assert is_pii_column("respondent_name") and is_pii_column("phoneNumber")
    assert not is_pii_column("population") and not is_pii_column("flat_rate")

    print("pii_redact self-check: OK")


if __name__ == "__main__":
    demo()
