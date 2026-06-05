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
    # Household roster nesting — set when respondent rows belong to a parent unit
    roster_link_col: Optional[str] = None   # parent id column (e.g., household_id)
    roster_member_id_col: Optional[str] = None  # member sequence within parent (e.g., member_no)
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


# ───────────────────────────── Household roster pivot ─────────────────────────────


class RosterToWide(BaseModel):
    dataset_id: str
    parent_id_col: str                       # e.g., household_id
    member_id_col: str                       # e.g., member_no (within-parent sequence)
    member_cols: list[str]                   # columns to pivot wide (age, sex, edu, ...)
    aggregate_cols: dict[str, str] = Field(default_factory=dict)
    # e.g., {"age": "mean", "is_child": "sum"} — adds a single parent-level summary col
    max_members: int = 12                    # cap to keep wide table tractable
    new_dataset_id: Optional[str] = None     # optional new id for the wide df


class RosterToLong(BaseModel):
    dataset_id: str
    parent_id_col: str                       # e.g., household_id
    member_stubs: list[str]                  # stems like ['age', 'sex'] for 'age_1', 'age_2', ...
    new_dataset_id: Optional[str] = None


def _agg_one(s: pd.Series, fn: str):
    s = pd.to_numeric(s, errors="coerce") if fn in ("mean", "sum", "median", "min", "max", "std") else s
    s = s.dropna()
    if len(s) == 0:
        return None
    if fn == "mean":
        return float(s.mean())
    if fn == "sum":
        return float(s.sum())
    if fn == "count":
        return int(len(s))
    if fn == "median":
        return float(s.median())
    if fn == "min":
        return float(s.min())
    if fn == "max":
        return float(s.max())
    if fn == "std":
        return float(s.std(ddof=1)) if len(s) > 1 else 0.0
    if fn == "nunique":
        return int(s.nunique())
    if fn == "first":
        return s.iloc[0]
    return None


@router.post("/api/metadata/roster/to_wide")
async def roster_to_wide(req: RosterToWide):
    """Pivot a long member-level roster into one-row-per-parent (household).

    Each `member_col` becomes `{col}_1`, `{col}_2`, ... up to max_members.
    Optional `aggregate_cols` adds parent-level summary fields (e.g., mean_age, n_children).
    Returns the wide DataFrame as JSON rows; if `new_dataset_id` provided, stores it.
    """
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[req.dataset_id]["df"].copy()
    for col in [req.parent_id_col, req.member_id_col] + req.member_cols:
        if col not in df.columns:
            raise HTTPException(400, f"Column not found: {col}")

    # Sort by parent + member so the wide indices are stable
    df = df.sort_values([req.parent_id_col, req.member_id_col]).copy()
    df["__seq__"] = df.groupby(req.parent_id_col).cumcount() + 1
    df = df[df["__seq__"] <= req.max_members]

    pivoted = df.pivot_table(
        index=req.parent_id_col,
        columns="__seq__",
        values=req.member_cols,
        aggfunc="first",
    )
    # Flatten multi-index columns
    pivoted.columns = [f"{c}_{int(seq)}" for c, seq in pivoted.columns]
    pivoted = pivoted.reset_index()

    # Aggregate parent-level summary cols
    if req.aggregate_cols:
        agg_rows = []
        for pid, sub in df.groupby(req.parent_id_col):
            agg = {req.parent_id_col: pid}
            for col, fn in req.aggregate_cols.items():
                if col in sub.columns:
                    agg[f"{col}_{fn}"] = _agg_one(sub[col], fn)
            agg["n_members"] = int(len(sub))
            agg_rows.append(agg)
        agg_df = pd.DataFrame(agg_rows)
        pivoted = pivoted.merge(agg_df, on=req.parent_id_col, how="left")

    if req.new_dataset_id:
        # store as a fresh in-memory dataset
        datasets[req.new_dataset_id] = {
            "df": pivoted,
            "filename": f"{req.dataset_id}_wide.csv",
            "columns": _detect_pivot_cols(pivoted),
            "n_rows": len(pivoted),
        }
        add_audit_log(req.dataset_id, "roster_to_wide",
                      f"Pivoted {len(df)} member rows → {len(pivoted)} parent rows; "
                      f"stored as dataset {req.new_dataset_id}")

    return {
        "n_parents": int(len(pivoted)),
        "n_member_columns": len(pivoted.columns),
        "max_members_seen": int(df["__seq__"].max()) if len(df) else 0,
        "new_dataset_id": req.new_dataset_id,
        "preview": pivoted.head(20).fillna("").to_dict(orient="records"),
        "columns": list(pivoted.columns),
    }


@router.post("/api/metadata/roster/to_long")
async def roster_to_long(req: RosterToLong):
    """Reverse: split wide '{stub}_1','{stub}_2',... back into long member rows.

    Useful when a household-level dataset needs to be analyzed at member level.
    """
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[req.dataset_id]["df"].copy()

    if req.parent_id_col not in df.columns:
        raise HTTPException(400, f"parent_id_col '{req.parent_id_col}' not in dataset")

    # For each member position, find columns named '{stub}_{n}'
    seq_pattern = re.compile(r"_(\d+)$")
    pos_to_cols: dict[int, dict[str, str]] = {}
    for col in df.columns:
        m = seq_pattern.search(col)
        if not m:
            continue
        n = int(m.group(1))
        stub = col[: m.start()]
        if stub not in req.member_stubs:
            continue
        pos_to_cols.setdefault(n, {})[stub] = col

    if not pos_to_cols:
        raise HTTPException(400, "No '{stub}_N' columns found for the given member_stubs")

    long_rows = []
    for _, row in df.iterrows():
        pid = row[req.parent_id_col]
        for n in sorted(pos_to_cols.keys()):
            mapping = pos_to_cols[n]
            entry = {req.parent_id_col: pid, "member_no": n}
            empty = True
            for stub, col in mapping.items():
                v = row[col]
                entry[stub] = v
                if pd.notna(v) and str(v).strip() != "":
                    empty = False
            if not empty:
                long_rows.append(entry)

    long_df = pd.DataFrame(long_rows)
    if req.new_dataset_id:
        datasets[req.new_dataset_id] = {
            "df": long_df,
            "filename": f"{req.dataset_id}_long.csv",
            "columns": _detect_pivot_cols(long_df),
            "n_rows": len(long_df),
        }
        add_audit_log(req.dataset_id, "roster_to_long",
                      f"Unstacked {len(df)} parent rows → {len(long_df)} member rows; "
                      f"stored as dataset {req.new_dataset_id}")

    return {
        "n_member_rows": int(len(long_df)),
        "n_parents": int(long_df[req.parent_id_col].nunique()) if len(long_df) else 0,
        "new_dataset_id": req.new_dataset_id,
        "preview": long_df.head(30).fillna("").to_dict(orient="records"),
        "columns": list(long_df.columns),
    }


def _detect_pivot_cols(df: pd.DataFrame) -> list[dict]:
    out = []
    for c in df.columns:
        if pd.api.types.is_numeric_dtype(df[c]):
            t = "numeric"
        elif pd.api.types.is_datetime64_any_dtype(df[c]):
            t = "date"
        else:
            t = "text"
        out.append({"name": c, "type": t})
    return out
