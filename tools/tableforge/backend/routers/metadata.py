"""Variable Metadata layer — column roles + study design.

Phase 0 of the Survey Analysis Studio roadmap. Every later phase consumes this
metadata to choose tests, build composites, and triangulate.
"""

import re
from typing import Optional, Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import pandas as pd

from ..shared import (
    datasets,
    column_roles,
    study_designs,
    add_audit_log,
)

router = APIRouter()


# ───────────────────────────── Models ─────────────────────────────

# Known vocab — frontend can render these as suggestions but free strings are accepted too.
RoleVocab = Literal[
    "treatment", "outcome", "demographic", "mediator", "moderator",
    "geographic", "panel_wave", "observer_rated", "qualitative", "weight",
    "id", "other",
]
ScaleVocab = Literal[
    "nominal", "ordinal", "interval", "ratio",
    "likert", "binary", "count", "multi_response",
]
DesignType = Literal[
    "cross_sectional", "pre_post", "quasi_experimental", "panel", "rcs",
]


class ColumnRole(BaseModel):
    role: Optional[str] = None              # see RoleVocab; free string allowed
    scale: Optional[str] = None             # see ScaleVocab; free string allowed
    value_labels: dict = Field(default_factory=dict)  # {raw_value: human_label}
    units: Optional[str] = None
    paired_with: Optional[str] = None       # name of the other column in pre/post pair
    mr_set_id: Optional[str] = None         # group id for dummy-column MR sets
    benchmark_link: Optional[str] = None    # indicator_id in benchmarks library
    notes: Optional[str] = None


class StudyDesign(BaseModel):
    design_type: Optional[str] = None       # see DesignType
    treatment_col: Optional[str] = None
    treatment_value: Optional[str] = None   # e.g. "Beneficiary" — what counts as treated
    weight_col: Optional[str] = None
    cluster_col: Optional[str] = None       # design-based SE
    panel_id_col: Optional[str] = None      # respondent id across waves
    panel_wave_col: Optional[str] = None    # wave indicator
    pre_post_pairs: list[dict] = Field(default_factory=list)  # [{"pre": col, "post": col}]
    strata: list[str] = Field(default_factory=list)
    notes: Optional[str] = None


# ───────────────────────────── Request bodies ─────────────────────────────

class ColumnRoleSet(BaseModel):
    dataset_id: str
    column: str
    role: ColumnRole


class ColumnRoleBulkSet(BaseModel):
    dataset_id: str
    roles: dict[str, ColumnRole]            # {column_name: ColumnRole}


class StudyDesignSave(BaseModel):
    dataset_id: str
    design: StudyDesign


class AutoDetectRequest(BaseModel):
    dataset_id: str


# ───────────────────────────── Endpoints ─────────────────────────────

@router.post("/api/metadata/column/set")
async def set_column_role(req: ColumnRoleSet):
    """Write/update a single column's role metadata."""
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    if req.column not in datasets[req.dataset_id]["df"].columns:
        raise HTTPException(404, f"Column not found: {req.column}")
    column_roles.setdefault(req.dataset_id, {})[req.column] = req.role.model_dump()
    add_audit_log(req.dataset_id, "metadata_column_set", f"{req.column} → role={req.role.role}, scale={req.role.scale}")
    return {"status": "ok", "column": req.column, "role": req.role.model_dump()}


@router.post("/api/metadata/column/bulk_set")
async def bulk_set_column_roles(req: ColumnRoleBulkSet):
    """Write multiple column roles at once (used after auto-detect confirmation)."""
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df_cols = set(datasets[req.dataset_id]["df"].columns)
    bucket = column_roles.setdefault(req.dataset_id, {})
    written = 0
    for col, role in req.roles.items():
        if col not in df_cols:
            continue
        bucket[col] = role.model_dump()
        written += 1
    add_audit_log(req.dataset_id, "metadata_column_bulk_set", f"wrote {written} role(s)")
    return {"status": "ok", "count": written}


@router.get("/api/metadata/column/{dataset_id}")
async def get_column_roles(dataset_id: str):
    """Return all column roles for a dataset."""
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    return {"roles": column_roles.get(dataset_id, {})}


@router.delete("/api/metadata/column/{dataset_id}/{column}")
async def delete_column_role(dataset_id: str, column: str):
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    column_roles.get(dataset_id, {}).pop(column, None)
    return {"status": "ok"}


@router.post("/api/metadata/study_design/save")
async def save_study_design(req: StudyDesignSave):
    """Persist a project's study design profile."""
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    study_designs[req.dataset_id] = req.design.model_dump()
    add_audit_log(req.dataset_id, "study_design_save", f"design_type={req.design.design_type}")
    return {"status": "ok", "design": req.design.model_dump()}


@router.get("/api/metadata/study_design/{dataset_id}")
async def get_study_design(dataset_id: str):
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    return {"design": study_designs.get(dataset_id, {})}


# ───────────────────────────── Auto-detect ─────────────────────────────

# Regex helpers used by the heuristic prefill.
_GEO_NAMES = re.compile(r"\b(district|state|tehsil|taluk|taluka|block|village|panchayat|ward|pincode|zip|country|region)\b", re.IGNORECASE)
_PAIR_SUFFIX = re.compile(r"^(?P<base>.+?)[\s_\-]*(?P<tag>pre|post|before|after|baseline|endline|t1|t2|w1|w2|wave1|wave2|round1|round2)$", re.IGNORECASE)
_WEIGHT_NAMES = re.compile(r"\b(weight|wt|pweight|sampling_weight|fweight|hh_weight)\b", re.IGNORECASE)
_ID_NAMES = re.compile(r"^(id|respondent_id|hh_id|household_id|farmer_id|uid|case_id)$", re.IGNORECASE)
_LIKERT_HINT = re.compile(r"\b(agree|disagree|satisfaction|frequency|importance|rating|likert)\b", re.IGNORECASE)


def _detect_role_for_column(col_name: str, series: pd.Series) -> dict:
    """Return a suggested ColumnRole dict for a single column. Best-effort, no false certainty."""
    out: dict = {}
    name = str(col_name)
    non_null = series.dropna()
    n_unique = int(non_null.nunique()) if len(non_null) else 0

    # ID columns
    if _ID_NAMES.match(name) or (n_unique == len(non_null) and len(non_null) > 50 and not pd.api.types.is_numeric_dtype(series)):
        out["role"] = "id"
        out["scale"] = "nominal"
        return out

    # Weight columns
    if _WEIGHT_NAMES.search(name) and pd.api.types.is_numeric_dtype(series):
        out["role"] = "weight"
        out["scale"] = "ratio"
        return out

    # Geographic
    if _GEO_NAMES.search(name):
        out["role"] = "geographic"
        out["scale"] = "nominal"
        return out

    # Pre/post pair detection — set paired_with later in the second pass
    m = _PAIR_SUFFIX.match(name)
    if m:
        out["_pair_base"] = m.group("base").strip(" _-").lower()
        out["_pair_tag"] = m.group("tag").lower()

    # Scale detection
    if pd.api.types.is_numeric_dtype(series):
        # Binary
        uniq = set(non_null.unique().tolist())
        if n_unique == 2 and uniq.issubset({0, 1, 0.0, 1.0, True, False}):
            out["scale"] = "binary"
        # Likert candidate: 3–7 distinct integers spanning a small range
        elif 3 <= n_unique <= 7 and non_null.apply(lambda v: float(v).is_integer() if pd.notna(v) else True).all():
            mn, mx = float(non_null.min()), float(non_null.max())
            if mx - mn <= 6 and mn >= 0 and mx <= 10:
                out["scale"] = "likert"
                if _LIKERT_HINT.search(name):
                    out.setdefault("role", "outcome")
        else:
            out["scale"] = "ratio" if non_null.min() >= 0 else "interval"
    else:
        # Categorical text
        # Check for comma-separated multi-response
        sample = non_null.astype(str).head(200)
        comma_share = (sample.str.contains(",")).mean() if len(sample) else 0.0
        if comma_share >= 0.05 and sample.head(50).apply(lambda s: all(len(p.strip()) <= 25 for p in s.split(",")) if "," in s else True).all():
            out["scale"] = "multi_response"
        elif n_unique == 2:
            out["scale"] = "binary"
        else:
            out["scale"] = "nominal"

    return out


def _resolve_pairs(suggestions: dict[str, dict]) -> dict[str, dict]:
    """Second pass: link _pair_base groups into paired_with relations."""
    by_base: dict[str, list[tuple[str, str]]] = {}
    for col, sug in suggestions.items():
        base = sug.pop("_pair_base", None)
        tag = sug.pop("_pair_tag", None)
        if base:
            by_base.setdefault(base, []).append((col, tag))
    for base, members in by_base.items():
        if len(members) < 2:
            continue
        # Pick the most canonical "pre" and "post"
        pre_tags = {"pre", "before", "baseline", "t1", "w1", "wave1", "round1"}
        post_tags = {"post", "after", "endline", "t2", "w2", "wave2", "round2"}
        pre = next((c for c, t in members if t in pre_tags), None)
        post = next((c for c, t in members if t in post_tags), None)
        if pre and post:
            suggestions[pre]["paired_with"] = post
            suggestions[post]["paired_with"] = pre
    return suggestions


@router.post("/api/metadata/auto_detect_roles")
async def auto_detect_roles(req: AutoDetectRequest):
    """Heuristic prefill. Returns suggested roles — the frontend confirms before persisting."""
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[req.dataset_id]["df"]
    suggestions: dict[str, dict] = {}
    for col in df.columns:
        try:
            suggestions[str(col)] = _detect_role_for_column(str(col), df[col])
        except Exception:
            suggestions[str(col)] = {}
    suggestions = _resolve_pairs(suggestions)
    # Also propose a study design skeleton based on the suggestions
    pairs = []
    seen = set()
    for col, sug in suggestions.items():
        partner = sug.get("paired_with")
        if partner and (col, partner) not in seen and (partner, col) not in seen:
            # Try to guess which is pre — by name
            pre, post = (col, partner)
            if re.search(r"(post|after|endline|t2|w2)", post, re.IGNORECASE):
                pass  # already correct
            elif re.search(r"(post|after|endline|t2|w2)", pre, re.IGNORECASE):
                pre, post = post, pre
            pairs.append({"pre": pre, "post": post})
            seen.add((col, partner))
    weight_col = next((c for c, s in suggestions.items() if s.get("role") == "weight"), None)
    geo_cols = [c for c, s in suggestions.items() if s.get("role") == "geographic"]
    design_skeleton: dict = {
        "design_type": "pre_post" if pairs else "cross_sectional",
        "weight_col": weight_col,
        "pre_post_pairs": pairs,
        "strata": geo_cols[:1],
    }
    return {
        "suggested_roles": suggestions,
        "suggested_design": design_skeleton,
        "column_count": len(df.columns),
    }
