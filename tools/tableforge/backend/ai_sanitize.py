"""Replace real dataset values with dtype-matched placeholders before AI calls
that only need to reason about data SHAPE (table-design suggestion, title/label
polishing) — not the actual content.

Column category labels are a deliberate partial exception: an uploaded
spreadsheet has no separate form-schema layer declaring "valid options" the way
a FieldGovern form does (see app/services/ai_sanitize.py in the main backend),
so a genuinely small, stable set of distinct values IS effectively that
column's schema (e.g. "North"/"South"/"East"). This never applies to a
PII-named column (see pii_redact.is_pii_column) or a high-cardinality column
(free text/numeric), which always get a generic placeholder instead — and full
ROW samples (combining many columns' real values together, the actual raw-row
risk) are always 100% synthetic, never real category values either.
"""
from .pii_redact import is_pii_column

_TAXONOMY_MAX_UNIQUE = 15


def dummy_value(shape_type: str, seed: int = 0):
    """shape_type = the normalized 'type' field from column_shape() ('numeric'
    /'datetime'/'text') — NOT a raw pandas dtype string."""
    if shape_type == "numeric":
        return 10 * (seed + 1)
    if shape_type == "datetime":
        return "2026-01-01"
    return f"Sample text {seed + 1}"


def column_shape(df, col: str) -> dict:
    """{'type', 'unique', 'categories'?}. `categories` (real distinct values)
    is populated ONLY for a non-PII, low-cardinality, non-numeric column that
    also has repeated values — a genuine taxonomy ("North"/"South" reused
    across many rows), not free text that merely happens to be short in a
    small sample (which is typically all-unique, no repeats)."""
    dtype = str(df[col].dtype)
    is_numeric = "int" in dtype or "float" in dtype
    non_null = df[col].dropna()
    uniq = int(non_null.nunique())
    entry = {
        "type": "numeric" if is_numeric else ("datetime" if "datetime" in dtype else "text"),
        "unique": uniq,
    }
    has_repeats = len(non_null) > 0 and uniq < len(non_null)
    if not is_pii_column(col) and not is_numeric and has_repeats and 0 < uniq <= _TAXONOMY_MAX_UNIQUE:
        entry["categories"] = [str(v)[:50] for v in non_null.unique()[:_TAXONOMY_MAX_UNIQUE]]
    return entry


def dummy_row(columns: list, shapes: dict, seed: int = 0) -> dict:
    row = {}
    for col in columns:
        shape = shapes.get(col) or {"type": "text"}
        cats = shape.get("categories")
        row[col] = cats[seed % len(cats)] if cats else dummy_value(shape.get("type", "text"), seed)
    return row


def dummy_rows(columns: list, shapes: dict, n: int = 3) -> list:
    return [dummy_row(columns, shapes, seed=i) for i in range(n)]
