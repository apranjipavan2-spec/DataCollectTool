"""Crux check for TableForge's metadata-and-dummy-only AI path (table-design
suggestion, title/label polishing). Real category values are only allowed
through for non-PII, low-cardinality columns — everything else, and every
PII-named column regardless of cardinality, must be a placeholder.
Run from tools/tableforge/: python -m backend.test_ai_sanitize
(ai_sanitize.py imports its sibling pii_redact.py with a relative import, same
convention as main.py/routers/ai.py, so this must run as a package module.)"""
import pandas as pd
from .ai_sanitize import dummy_value, column_shape, dummy_row, dummy_rows


def demo():
    df = pd.DataFrame({
        "district": ["North", "South", "North", "East"],
        "respondent_name": ["Priya", "Anita", "Raj", "Kiran"],
        "age": [20, 30, 40, 25],
        "notes": ["a long free text answer one", "another distinct free text two",
                   "yet another free text three", "one more free text four"],
    })

    # Non-PII, low-cardinality column → real category labels allowed through.
    dist_shape = column_shape(df, "district")
    assert set(dist_shape.get("categories", [])) == {"North", "South", "East"}

    # PII-named column, even though it's also low-cardinality-ish here → never
    # gets real values, regardless of cardinality.
    name_shape = column_shape(df, "respondent_name")
    assert "categories" not in name_shape

    # Numeric column → never treated as a categories list, dummy value only.
    age_shape = column_shape(df, "age")
    assert "categories" not in age_shape and age_shape["type"] == "numeric"
    assert dummy_value("numeric", seed=0) == 10

    # High-cardinality free text (every value distinct) → no categories either.
    notes_shape = column_shape(df, "notes")
    assert "categories" not in notes_shape

    # Row synthesis never includes a real respondent_name or notes value.
    shapes = {"district": dist_shape, "respondent_name": name_shape, "age": age_shape, "notes": notes_shape}
    rows = dummy_rows(list(df.columns), shapes, n=3)
    for r in rows:
        assert r["district"] in ("North", "South", "East")
        assert r["respondent_name"] not in ("Priya", "Anita", "Raj", "Kiran")
        assert r["notes"] not in df["notes"].tolist()
        assert isinstance(r["age"], int)

    print("ai_sanitize self-check: OK")


if __name__ == "__main__":
    demo()
