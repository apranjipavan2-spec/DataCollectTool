"""Survey-aware suggestions — uses Phase-0 column roles to propose crosstabs.

#14 of the /analyzer roadmap. Given a dataset, returns a ranked list of suggested
table configs (Likert × Demographic, Binary × Demographic, Pre/Post, MR × Group, etc.)
that the user can promote with one click.

The frontend opens the SurveyInsightsPanel, gets these suggestions, and on Apply
pushes the chosen configs as new entries in the project's tables[].
"""

from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import pandas as pd

from ..shared import datasets, column_roles, study_designs, add_audit_log
from .metadata import _detect_role_for_column, _resolve_pairs

router = APIRouter()


class SuggestRequest(BaseModel):
    dataset_id: str
    max_suggestions: int = 20


def _ensure_roles(dataset_id: str) -> dict:
    """Return the persisted roles for the dataset; if empty, run the heuristic auto-detect once."""
    roles = column_roles.get(dataset_id, {})
    if roles:
        return roles
    df = datasets[dataset_id]["df"]
    inferred: dict = {}
    for col in df.columns:
        try:
            inferred[str(col)] = _detect_role_for_column(str(col), df[col])
        except Exception:
            inferred[str(col)] = {}
    return _resolve_pairs(inferred)


def _make_table(
    title: str,
    description: str,
    rationale: str,
    kind: str,
    rows: list[str],
    columns: list[str],
    value_field: Optional[str],
    agg: str,
    show_as: Optional[str] = None,
) -> dict:
    return {
        "title": title,
        "description": description,
        "rationale": rationale,
        "kind": kind,
        "rows": rows,
        "columns": columns,
        "value_field": value_field if value_field else "*",
        "aggregation": agg,
        "show_as": show_as,
    }


@router.post("/api/survey/suggest_crosstabs")
async def suggest_crosstabs(req: SuggestRequest):
    """Propose ranked crosstabs from auto-detected column roles."""
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df: pd.DataFrame = datasets[req.dataset_id]["df"]
    roles = _ensure_roles(req.dataset_id)
    design = study_designs.get(req.dataset_id, {}) or {}

    # Bucket columns by detected scale/role.
    likert_cols = [c for c, r in roles.items() if r.get("scale") == "likert"]
    binary_cols = [c for c, r in roles.items() if r.get("scale") == "binary"]
    mr_cols = [c for c, r in roles.items() if r.get("scale") == "multi_response"]
    geo_cols = [c for c, r in roles.items() if r.get("role") == "geographic"]
    weight_col = next((c for c, r in roles.items() if r.get("role") == "weight"), design.get("weight_col"))

    # Demographic candidates = small-cardinality nominal/binary that aren't outcomes/ids/geo/weight.
    demographics: list[str] = []
    for c in df.columns:
        c = str(c)
        r = roles.get(c, {})
        if r.get("role") in {"id", "weight", "qualitative"}:
            continue
        if r.get("scale") in {"likert", "multi_response"}:
            continue
        if c in geo_cols:
            continue
        try:
            nu = df[c].nunique(dropna=True)
        except Exception:
            continue
        if 2 <= nu <= 8:
            demographics.append(c)

    suggestions: list[dict] = []

    # ── 1. Likert × Geographic (highest value: program targeting) ──
    for L in likert_cols:
        for G in geo_cols[:2]:
            suggestions.append(_make_table(
                title=f"Mean {L} by {G}",
                description=f"Average Likert rating of '{L}' across each '{G}'.",
                rationale="Likert × Geographic reveals spatial variation in attitudes — key for targeting interventions.",
                kind="likert_by_geo",
                rows=[G], columns=[], value_field=L, agg="mean",
            ))

    # ── 2. Likert × Demographic ──
    for L in likert_cols:
        for D in demographics[:3]:
            if D == L:
                continue
            suggestions.append(_make_table(
                title=f"Mean {L} by {D}",
                description=f"Average Likert rating of '{L}' segmented by '{D}'.",
                rationale="Likert × demographic shows which subgroups feel differently — common for equity analyses.",
                kind="likert_by_demo",
                rows=[D], columns=[], value_field=L, agg="mean",
            ))

    # ── 3. Binary outcome × Demographic (row %) ──
    for B in binary_cols:
        if roles.get(B, {}).get("role") == "id":
            continue
        for D in demographics[:3]:
            if D == B:
                continue
            suggestions.append(_make_table(
                title=f"{B} rate by {D}",
                description=f"Share of each '{D}' group that has '{B}' = 1.",
                rationale="Binary × demographic with row-% reveals disparities in a yes/no outcome.",
                kind="binary_by_demo",
                rows=[D], columns=[B], value_field="*", agg="count", show_as="row_pct",
            ))

    # ── 4. Pre/Post pairs — explicit comparison table ──
    pre_post_pairs = design.get("pre_post_pairs") or []
    if not pre_post_pairs:
        # Recover from roles if design wasn't saved
        seen_pairs = set()
        for c, r in roles.items():
            partner = r.get("paired_with")
            if not partner or partner not in df.columns:
                continue
            key = tuple(sorted([c, partner]))
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            pre, post = c, partner
            if "post" in partner.lower() or "after" in partner.lower() or "endline" in partner.lower():
                pre, post = c, partner
            elif "post" in c.lower() or "after" in c.lower() or "endline" in c.lower():
                pre, post = partner, c
            pre_post_pairs.append({"pre": pre, "post": post})
    for pair in pre_post_pairs[:5]:
        pre, post = pair.get("pre"), pair.get("post")
        if not pre or not post:
            continue
        suggestions.append(_make_table(
            title=f"Pre vs Post: {pre} → {post}",
            description=f"Side-by-side change from '{pre}' to '{post}'.",
            rationale="Pre/Post pair detected — eligible for paired t-test or Wilcoxon (see Statistics tab).",
            kind="pre_post",
            rows=[], columns=[], value_field=pre, agg="mean",
        ))

    # ── 5. Multi-Response × Demographic ──
    for M in mr_cols[:3]:
        for D in demographics[:2]:
            suggestions.append(_make_table(
                title=f"{M} responses by {D}",
                description=f"Frequency of multi-select '{M}' broken out by '{D}'.",
                rationale="Multi-response columns work best when summarized — see Multi-Response panel for full options.",
                kind="mr_by_demo",
                rows=[D], columns=[M], value_field="*", agg="count",
            ))

    # ── 6. Geographic pair (if 2+ geo cols and design is cross-sectional) ──
    if len(geo_cols) >= 2:
        suggestions.append(_make_table(
            title=f"Counts: {geo_cols[0]} × {geo_cols[1]}",
            description=f"Sample sizes per geographic hierarchy.",
            rationale="Two geographic levels detected — useful for verifying sampling coverage.",
            kind="geo_pair",
            rows=[geo_cols[0]], columns=[geo_cols[1]], value_field="*", agg="count",
        ))

    # Deduplicate by (rows, columns, value_field, agg)
    seen = set()
    deduped: list[dict] = []
    for s in suggestions:
        key = (tuple(s["rows"]), tuple(s["columns"]), s["value_field"], s["aggregation"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(s)

    # Cap and audit
    deduped = deduped[: max(1, req.max_suggestions)]
    add_audit_log(req.dataset_id, "survey_suggest", f"returned {len(deduped)} suggestion(s)")

    return {
        "suggestions": deduped,
        "detected": {
            "likert": likert_cols,
            "binary": binary_cols,
            "multi_response": mr_cols,
            "geographic": geo_cols,
            "demographics": demographics,
            "pre_post_pairs": pre_post_pairs,
            "weight_col": weight_col,
        },
        "roles_count": len(roles),
    }
