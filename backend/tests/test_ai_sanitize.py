"""Crux check for the metadata-and-dummy-only AI path (report writing +
tabulation suggestion): synthetic rows must never leak a real value, and
aggregates must summarize the whole group, never expose one respondent's raw
answer. If this breaks, real submission content can reach a third-party model
via features that never needed it."""
from app.services.ai_sanitize import synthesize_rows, dummy_unique_values, summarize_fields


def test_synthesize_rows_uses_declared_options_not_real_answers():
    cols = [{"id": "gender", "type": "single_choice", "options": [{"label": "Male"}, {"label": "Female"}]}]
    rows = synthesize_rows(cols, n=2)
    assert all(r["gender"] in ("Male", "Female") for r in rows)


def test_synthesize_rows_numeric_and_text_are_placeholders():
    cols = [{"id": "age", "type": "number"}, {"id": "notes", "type": "text"}]
    rows = synthesize_rows(cols, n=1)
    assert rows[0]["age"] == 10
    assert rows[0]["notes"].startswith("Sample text")


def test_synthesize_rows_skips_media_gps_to_placeholder_marker():
    cols = [{"id": "photo", "type": "photo"}, {"id": "loc", "type": "gps"}]
    rows = synthesize_rows(cols, n=1)
    assert rows[0]["photo"] == "[MEDIA]" and rows[0]["loc"] == "[MEDIA]"


def test_dummy_unique_values_prefers_declared_options():
    col = {"type": "single_choice", "options": [{"label": "North"}, {"label": "South"}]}
    assert dummy_unique_values(col) == ["North", "South"]


def test_summarize_fields_value_counts_are_aggregate_not_row_level():
    schema = [{"id": "gender", "label": "Gender", "type": "single_choice"}]
    submissions = [{"gender": "Male"}, {"gender": "Male"}, {"gender": "Female"}]
    summary = summarize_fields(schema, submissions)
    assert summary[0]["value_counts"] == {"Male": 2, "Female": 1}
    assert summary[0]["answered"] == 3 and summary[0]["total"] == 3


def test_summarize_fields_numeric_min_max_mean():
    schema = [{"id": "age", "label": "Age", "type": "number"}]
    submissions = [{"age": "20"}, {"age": "30"}, {"age": "40"}]
    summary = summarize_fields(schema, submissions)
    assert summary[0]["min"] == 20 and summary[0]["max"] == 40 and summary[0]["mean"] == 30


def test_summarize_fields_free_text_has_no_content_only_counts():
    schema = [{"id": "notes", "label": "Notes", "type": "text"}]
    submissions = [{"notes": "some private detail"}, {"notes": ""}, {}]
    summary = summarize_fields(schema, submissions)
    assert summary[0]["answered"] == 1 and summary[0]["total"] == 3
    assert "value_counts" not in summary[0] and "private" not in str(summary[0])


def test_summarize_fields_skips_media_and_gps_entirely():
    schema = [{"id": "loc", "label": "Location", "type": "gps"}]
    submissions = [{"loc": {"lat": 12.9, "lng": 77.5}}]
    summary = summarize_fields(schema, submissions)
    assert summary == []
