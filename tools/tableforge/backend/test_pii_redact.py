"""Crux check for TableForge's AI-call PII redaction (no FieldGovern form schema
available here, so this is heuristic + column-name-hint only). If this breaks,
raw uploaded-dataset PII can reach a third-party LLM provider.
Run directly: python backend/test_pii_redact.py"""
from pii_redact import redact_row, redact_rows, redact_values, is_pii_column, REDACTED


def demo():
    # Column-name hint catches a bare name with no regex signature.
    assert redact_row({"name": "Priya Sharma", "age": "34"}) == {"name": REDACTED, "age": "34"}

    # Heuristic catches identifier-shaped values in untagged columns.
    row = {"notes": "contact priya@example.com or 9876543210", "count": "5"}
    out = redact_row(row)
    assert out["notes"] == REDACTED and out["count"] == "5"

    # Aadhaar-shaped + GPS-pair values.
    row2 = {"id_number": "1234 5678 9012", "location": "12.9716,77.5946", "village": "Rampur"}
    out2 = redact_row(row2)
    assert out2["id_number"] == REDACTED and out2["location"] == REDACTED and out2["village"] == "Rampur"

    # Column-name-driven redaction for value lists (unique-value / sample building).
    assert redact_values(["Priya", "Anita"], column_name="respondent_name") == [REDACTED, REDACTED]
    assert redact_values(["5", "12"], column_name="age_group") == ["5", "12"]

    # Batch + non-dict passthrough never crashes.
    assert redact_rows([{"name": "A"}, {"name": "B"}]) == [{"name": REDACTED}, {"name": REDACTED}]
    assert redact_row(None) is None

    assert is_pii_column("Phone Number") and not is_pii_column("age_group")

    # Regression: snake_case/camelCase column names must still match on their
    # PII-hint token, without bare-substring false positives on unrelated words.
    assert is_pii_column("respondent_name") and is_pii_column("phoneNumber")
    assert not is_pii_column("population") and not is_pii_column("flat_rate")

    print("pii_redact self-check: OK")


if __name__ == "__main__":
    demo()
