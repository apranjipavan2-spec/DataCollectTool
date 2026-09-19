"""Crux check for AI-call PII redaction: fields marked is_identifier=True must be
stripped regardless of content, and identifier-shaped values (email/phone/Aadhaar/
GPS pair) in untagged fields must be caught by the heuristic layer. If this breaks,
raw respondent data can reach a third-party LLM provider."""
from app.services.pii_redact import redact_row, redact_rows, redact_value, REDACTED, mask_aadhaar, mask_aadhaar_in_data


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


# ── Aadhaar minimisation at write time (encryption-at-rest item) ────────────

def test_mask_aadhaar_keeps_last_4_digits_only():
    assert mask_aadhaar("1234 5678 9012") == "XXXX-XXXX-9012"


def test_mask_aadhaar_handles_no_spaces():
    assert mask_aadhaar("123456789012") == "XXXX-XXXX-9012"


def test_mask_aadhaar_masks_within_a_longer_string():
    out = mask_aadhaar("My Aadhaar is 1234 5678 9012, call me")
    assert "1234" not in out and "5678" not in out
    assert out.endswith("9012, call me") or "XXXX-XXXX-9012" in out


def test_mask_aadhaar_non_aadhaar_string_untouched():
    assert mask_aadhaar("Rampur village") == "Rampur village"


def test_mask_aadhaar_handles_lists():
    assert mask_aadhaar(["1234 5678 9012", "no id here"]) == ["XXXX-XXXX-9012", "no id here"]


def test_mask_aadhaar_non_string_passthrough():
    assert mask_aadhaar(42) == 42
    assert mask_aadhaar(None) is None


def test_mask_aadhaar_in_data_full_submission():
    data = {"name": "Priya", "aadhaar": "1234 5678 9012", "age": 34}
    out = mask_aadhaar_in_data(data)
    assert out == {"name": "Priya", "aadhaar": "XXXX-XXXX-9012", "age": 34}
    assert data["aadhaar"] == "1234 5678 9012"  # original dict untouched


def test_mask_aadhaar_in_data_non_dict_passthrough():
    assert mask_aadhaar_in_data(None) is None


# ── Regression: Aadhaar masking must never touch media data (found in
# production 2026-09-19 — a guardian-consent audio recording was corrupted
# because its base64 content happened to contain a 12-digit run) ──────────

def test_mask_aadhaar_never_touches_data_uri_even_with_embedded_digit_run():
    # A realistic base64 audio payload that happens to contain 12 consecutive
    # digits — exactly the accidental-collision scenario that broke a real
    # recording. Must pass through completely unchanged.
    audio_value = "data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQI" \
                  "123456789012xyzABCdefGHIjklMNOpqrSTUvwxYZ0987654321=="
    assert mask_aadhaar(audio_value) == audio_value


def test_mask_aadhaar_never_touches_photo_data_uri():
    photo_value = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/111122223333/2Q=="
    assert mask_aadhaar(photo_value) == photo_value


def test_mask_aadhaar_never_touches_media_reference():
    # media:// references are also excluded, even though a 12-hex-digit UUID
    # segment made entirely of 0-9 (no a-f) is a rarer but real possibility.
    ref = "media://123456789012"
    assert mask_aadhaar(ref) == ref


def test_mask_aadhaar_still_masks_a_real_aadhaar_typed_as_text():
    # The actual feature must still work for genuine free-text answers —
    # only data: and media:// values are exempted.
    assert mask_aadhaar("My Aadhaar is 1234 5678 9012") != "My Aadhaar is 1234 5678 9012"
    assert "1234" not in mask_aadhaar("1234 5678 9012")


def test_mask_aadhaar_in_data_full_submission_with_audio_field():
    data = {
        "name": "Priya",
        "aadhaar": "1234 5678 9012",
        "consent_audio": "data:audio/webm;base64,AAAA123456789012BBBB",
    }
    out = mask_aadhaar_in_data(data)
    assert out["aadhaar"] == "XXXX-XXXX-9012"
    assert out["consent_audio"] == data["consent_audio"]  # untouched
