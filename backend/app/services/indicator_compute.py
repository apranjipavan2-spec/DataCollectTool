"""Compute indicator_values from submission data_json for the M&E results framework.

Reuses the same "group by field(s) in data_json" idea as
app.api.routes.field_govern._execute_config_rows, but shaped for indicators:
one row per disaggregation bucket, with count/sum/mean/percent aggregation.
"""
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from app.models.results_framework import Indicator, IndicatorValue, LogframeLevel


def _matches(data: dict, filt: Optional[dict]) -> bool:
    """filt = {"field": "...", "equals": "..."} — None filter always matches."""
    if not filt:
        return True
    field = filt.get("field")
    if not field:
        return True
    return str(data.get(field)) == str(filt.get("equals"))


def _bucket_key(data: dict, disaggregate_by: list) -> tuple:
    return tuple(str(data.get(f, "__missing__")) for f in disaggregate_by)


def compute_indicator_values(indicator: Indicator, subs: list) -> list[dict]:
    """Return a list of {disaggregation, actual_value, numerator, denominator} dicts,
    one per disaggregation bucket found in `subs` (plus a total bucket when disaggregate_by is set)."""
    disaggregate_by = indicator.disaggregate_by or []
    agg = indicator.aggregation or "count"
    field = indicator.source_form_field

    buckets: dict[tuple, list] = defaultdict(list)
    for s in subs:
        data = s.data_json if isinstance(s.data_json, dict) else {}
        buckets[()].append(data)  # total row always computed
        if disaggregate_by:
            buckets[_bucket_key(data, disaggregate_by)].append(data)

    results = []
    for key, rows in buckets.items():
        disagg = dict(zip(disaggregate_by, key)) if key else {}
        if agg == "percent":
            denom_rows = [r for r in rows if _matches(r, indicator.denominator_filter)]
            num_rows = [r for r in denom_rows if _matches(r, indicator.numerator_filter)]
            denom = len(denom_rows)
            num = len(num_rows)
            actual = round(num / denom * 100, 2) if denom else None
            results.append({"disaggregation": disagg, "actual_value": actual,
                             "numerator": float(num), "denominator": float(denom)})
        elif agg == "sum" or agg == "mean":
            vals = []
            for r in rows:
                try:
                    vals.append(float(r.get(field)))
                except (TypeError, ValueError):
                    continue
            if agg == "sum":
                actual = sum(vals) if vals else None
            else:
                actual = round(sum(vals) / len(vals), 2) if vals else None
            results.append({"disaggregation": disagg, "actual_value": actual,
                             "numerator": None, "denominator": None})
        else:  # count
            results.append({"disaggregation": disagg, "actual_value": float(len(rows)),
                             "numerator": None, "denominator": None})
    return results


def compute_indicator(indicator: Indicator, questionnaire_id, subs: list, db) -> list[IndicatorValue]:
    """Compute + upsert indicator_values for one indicator x one wave (questionnaire_id).
    Skips manual indicators. Caller commits."""
    if indicator.value_source == "manual":
        return []

    computed = compute_indicator_values(indicator, subs)
    now = datetime.now(timezone.utc)
    written = []
    for row in computed:
        existing = db.query(IndicatorValue).filter(
            IndicatorValue.indicator_id == indicator.id,
            IndicatorValue.questionnaire_id == questionnaire_id,
            IndicatorValue.disaggregation == row["disaggregation"],
        ).first()
        if existing and existing.value_source == "manual":
            continue  # a manually-overridden cell is never clobbered by auto-compute
        target = existing
        if not target:
            target = IndicatorValue(
                tenant_id=indicator.tenant_id,
                indicator_id=indicator.id,
                questionnaire_id=questionnaire_id,
                disaggregation=row["disaggregation"],
            )
            db.add(target)
        target.actual_value = row["actual_value"]
        target.numerator = row["numerator"]
        target.denominator = row["denominator"]
        target.value_source = "auto"
        target.computed_at = now
        written.append(target)
    return written


def rollup_tree(program_id, tenant_id, db) -> list[dict]:
    """Bottom-up: build the logframe tree and roll each indicator's latest-wave actual_value
    up into its parent level as an average of child-level values (the 'cascade')."""
    levels = db.query(LogframeLevel).filter(
        LogframeLevel.program_id == program_id, LogframeLevel.tenant_id == tenant_id,
    ).order_by(LogframeLevel.sort_order).all()
    indicators = db.query(Indicator).filter(
        Indicator.program_id == program_id, Indicator.tenant_id == tenant_id,
    ).all()
    ind_by_level: dict = defaultdict(list)
    for ind in indicators:
        ind_by_level[str(ind.logframe_level_id)].append(ind)

    by_id = {str(l.id): {"level": l, "children": [], "own_score": None, "rollup_score": None} for l in levels}
    roots = []
    for l in levels:
        node = by_id[str(l.id)]
        parent = by_id.get(str(l.parent_id)) if l.parent_id else None
        if parent:
            parent["children"].append(node)
        else:
            roots.append(node)

    def score(node) -> Optional[float]:
        if node["rollup_score"] is not None:
            return node["rollup_score"]
        own_indicators = ind_by_level.get(str(node["level"].id), [])
        latest_vals = []
        for ind in own_indicators:
            latest = db.query(IndicatorValue).filter(
                IndicatorValue.indicator_id == ind.id, IndicatorValue.disaggregation == {},
            ).order_by(IndicatorValue.computed_at.desc().nullslast()).first()
            if latest and latest.actual_value is not None:
                latest_vals.append(latest.actual_value)
        child_scores = [s for c in node["children"] if (s := score(c)) is not None]
        pool = latest_vals + child_scores
        node["rollup_score"] = round(sum(pool) / len(pool), 2) if pool else None
        return node["rollup_score"]

    for root in roots:
        score(root)

    def serialize(node) -> dict:
        return {
            "id": str(node["level"].id), "title": node["level"].title,
            "level_type": node["level"].level_type, "rollup_score": node["rollup_score"],
            "children": [serialize(c) for c in node["children"]],
        }
    return [serialize(r) for r in roots]


def _demo():
    """ponytail: smallest runnable check for the aggregation logic — no DB, no fixtures."""
    class FakeInd:
        disaggregate_by = ["sex"]
        aggregation = "percent"
        source_form_field = None
        numerator_filter = {"field": "status", "equals": "normal"}
        denominator_filter = None

    subs = [
        type("S", (), {"data_json": {"sex": "F", "status": "normal"}}),
        type("S", (), {"data_json": {"sex": "F", "status": "at_risk"}}),
        type("S", (), {"data_json": {"sex": "M", "status": "normal"}}),
        type("S", (), {"data_json": {"sex": "M", "status": "normal"}}),
    ]
    rows = compute_indicator_values(FakeInd(), subs)
    total = next(r for r in rows if r["disaggregation"] == {})
    female = next(r for r in rows if r["disaggregation"] == {"sex": "F"})
    male = next(r for r in rows if r["disaggregation"] == {"sex": "M"})
    assert total["actual_value"] == 75.0, total
    assert female["actual_value"] == 50.0, female
    assert male["actual_value"] == 100.0, male
    print("indicator_compute self-check: OK")


if __name__ == "__main__":
    _demo()
