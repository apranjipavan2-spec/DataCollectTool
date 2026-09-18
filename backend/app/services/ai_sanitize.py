"""Replace real submission data with type-matched placeholders or population-level
aggregates before AI calls that don't need real respondent content — report
writing and table-design suggestion only reason about *shape and pattern*, not
individual answers, so no real value needs to leave the app for these paths at
all (stronger than pii_redact.py, which strips identifiers from values that
still ARE sent — used only where a feature's whole purpose requires seeing real,
non-identifying content, e.g. data-cleaning suggestions).

Known limitation: `summarize_fields`' value_counts can still show a category
with a count of 1 in a small survey, which is a (much narrower) disclosure risk
than raw rows but not zero — proper k-anonymity/cell-suppression is a follow-up,
tracked in tasks/dpdp_master_plan.md, not solved here.
"""

_CHOICE_TYPES = {"single_choice", "multiple_choice", "select", "radio", "checkbox"}
_NUMERIC_TYPES = {"number", "decimal", "rating"}
_DATE_TYPES = {"date", "time", "datetime"}
_NO_CONTENT_TYPES = {"photo", "audio", "signature", "gps", "barcode"}  # nothing summarizable/dummy-able as text


def dummy_value(field_type: str, options: list = None, seed: int = 0):
    if field_type in _CHOICE_TYPES:
        if options:
            return options[seed % len(options)]
        return ["Option A", "Option B", "Option C"][seed % 3]
    if field_type in _NUMERIC_TYPES:
        return 10 * (seed + 1)
    if field_type in _DATE_TYPES:
        return "2026-01-01"
    if field_type in _NO_CONTENT_TYPES:
        return "[MEDIA]"
    return f"Sample text {seed + 1}"


def _field_options(col: dict) -> list:
    opts = col.get("values_seen") or col.get("options") or []
    return [o.get("label", o) if isinstance(o, dict) else str(o) for o in opts]


def synthesize_rows(column_headers: list, n: int = 3) -> list:
    """N fully-synthetic rows built only from field type/declared options —
    zero real respondent content, just enough variation for the model to see
    the data's shape (a numeric column looks numeric, a choice column cycles
    through its real option labels)."""
    rows = []
    for i in range(n):
        row = {}
        for col in column_headers:
            col_id = col.get("id")
            if not col_id:
                continue
            row[col_id] = dummy_value(col.get("type", "text"), _field_options(col), seed=i)
        rows.append(row)
    return rows


def dummy_unique_values(col: dict, n: int = 5) -> list:
    opts = _field_options(col)
    if opts:
        return opts[:n]
    ftype = col.get("type", "text")
    if ftype in _CHOICE_TYPES:
        return ["Option A", "Option B", "Option C"][:n]
    return [dummy_value(ftype)]


def summarize_fields(field_schema: list, submissions: list, max_fields: int = 40) -> list:
    """Population-level aggregate per field — value counts for choice fields,
    min/max/mean for numeric fields, answered/total counts only for free text.
    Safe to send to a model: every number here describes the whole group, never
    one respondent's raw answer."""
    out = []
    for f in field_schema[:max_fields]:
        fid = f.get("id") or f.get("name")
        ftype = f.get("type", "text")
        if not fid or ftype in _NO_CONTENT_TYPES:
            continue
        label = f.get("label", fid)
        values = [s.get(fid) for s in submissions if s and s.get(fid) not in (None, "")]
        entry = {"label": label, "type": ftype, "answered": len(values), "total": len(submissions)}
        if ftype in _CHOICE_TYPES:
            counts: dict = {}
            for v in values:
                for item in (v if isinstance(v, list) else [v]):
                    key = str(item)
                    counts[key] = counts.get(key, 0) + 1
            entry["value_counts"] = dict(sorted(counts.items(), key=lambda kv: -kv[1])[:15])
        elif ftype in _NUMERIC_TYPES:
            nums = []
            for v in values:
                try:
                    nums.append(float(v))
                except (TypeError, ValueError):
                    pass
            if nums:
                entry["min"] = min(nums)
                entry["max"] = max(nums)
                entry["mean"] = round(sum(nums) / len(nums), 2)
        out.append(entry)
    return out
