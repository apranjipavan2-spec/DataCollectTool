"""Verbatim viewer + open-end coding + inter-rater Cohen's kappa.

Endpoints:
  POST /api/verbatim/list      — paginated text rows with optional filter
  POST /api/verbatim/codes/set — assign code(s) to a row range
  GET  /api/verbatim/codes/{dataset_id}  — current code state
  POST /api/verbatim/kappa     — Cohen's κ between two coder columns
"""

from __future__ import annotations

import math
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..shared import datasets, sanitize_for_json
from .inferential_utils import safe_round

router = APIRouter(prefix="/api/verbatim", tags=["verbatim"])

# In-memory verbatim code store: {dataset_id: {col_name: {row_idx: [code1, code2, ...]}}}
verbatim_codes: dict[str, dict[str, dict[int, list[str]]]] = {}
# Code palette per dataset: {dataset_id: [{name, color, description}]}
code_palettes: dict[str, list[dict]] = {}


class VerbatimListConfig(BaseModel):
    dataset_id: str
    column: str
    search: str | None = None
    has_code: str | None = None
    min_length: int = 1
    page: int = 0
    page_size: int = 50


class CodeAssignConfig(BaseModel):
    dataset_id: str
    column: str
    row_idx: int
    codes: list[str]   # full replacement — empty list clears


class CodePaletteConfig(BaseModel):
    dataset_id: str
    codes: list[dict]   # [{name, color?, description?}]


class KappaConfig(BaseModel):
    dataset_id: str
    coder_a_col: str
    coder_b_col: str
    weighted: bool = False  # weighted κ for ordinal


@router.post("/list")
def verbatim_list(config: VerbatimListConfig):
    if config.dataset_id not in datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = datasets[config.dataset_id]["df"]
    if config.column not in df.columns:
        raise HTTPException(status_code=400, detail="column not in dataset")

    series = df[config.column].astype(str)
    mask = series.notna() & (series.str.strip() != "") & (series.str.lower() != "nan")
    mask &= series.str.len() >= config.min_length
    if config.search:
        mask &= series.str.contains(config.search, case=False, regex=False, na=False)

    code_map = verbatim_codes.get(config.dataset_id, {}).get(config.column, {})
    if config.has_code:
        mask &= series.index.map(lambda i: config.has_code in (code_map.get(int(i), []) or [])).to_series(index=series.index).fillna(False)

    filtered = series[mask]
    total = int(len(filtered))
    start = config.page * config.page_size
    end = start + config.page_size
    chunk = filtered.iloc[start:end]

    rows = [
        {
            "row_idx": int(i),
            "text": str(chunk.loc[i]),
            "codes": code_map.get(int(i), []),
        }
        for i in chunk.index
    ]

    return sanitize_for_json({
        "column": config.column,
        "rows": rows,
        "total": total,
        "page": config.page,
        "page_size": config.page_size,
        "has_more": end < total,
    })


@router.post("/codes/set")
def codes_set(config: CodeAssignConfig):
    if config.dataset_id not in datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ds_codes = verbatim_codes.setdefault(config.dataset_id, {})
    col_codes = ds_codes.setdefault(config.column, {})
    if config.codes:
        col_codes[config.row_idx] = list(dict.fromkeys(config.codes))  # dedupe preserve order
    else:
        col_codes.pop(config.row_idx, None)
    return {"ok": True, "row_idx": config.row_idx, "codes": config.codes}


@router.get("/codes/{dataset_id}")
def codes_get(dataset_id: str):
    palette = code_palettes.get(dataset_id, [])
    by_col = verbatim_codes.get(dataset_id, {})
    counts: dict[str, dict[str, int]] = {}
    for col, rows in by_col.items():
        col_counts: dict[str, int] = {}
        for codes in rows.values():
            for c in codes:
                col_counts[c] = col_counts.get(c, 0) + 1
        counts[col] = col_counts
    return {"palette": palette, "counts": counts, "columns_with_codes": list(by_col.keys())}


@router.post("/palette/save")
def palette_save(config: CodePaletteConfig):
    code_palettes[config.dataset_id] = config.codes
    return {"ok": True, "n_codes": len(config.codes)}


@router.post("/kappa")
def cohens_kappa(config: KappaConfig):
    """Cohen's κ between two coder columns. Cells must be aligned (same rows)."""
    if config.dataset_id not in datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = datasets[config.dataset_id]["df"]
    a_col, b_col = config.coder_a_col, config.coder_b_col
    if a_col not in df.columns or b_col not in df.columns:
        raise HTTPException(status_code=400, detail="Coder columns not in dataset")

    a = df[a_col].astype(str).str.strip()
    b = df[b_col].astype(str).str.strip()
    mask = a.notna() & b.notna() & (a != "") & (b != "") & (a.str.lower() != "nan") & (b.str.lower() != "nan")
    a, b = a[mask], b[mask]
    if len(a) < 2:
        raise HTTPException(status_code=400, detail="Not enough paired rows")

    categories = sorted(set(a) | set(b))
    cat_to_i = {c: i for i, c in enumerate(categories)}
    K = len(categories)
    mat = np.zeros((K, K), dtype=float)
    for av, bv in zip(a, b):
        mat[cat_to_i[av], cat_to_i[bv]] += 1
    n = mat.sum()
    if n == 0:
        raise HTTPException(status_code=400, detail="Empty contingency")

    # Build weight matrix
    if config.weighted:
        w = np.zeros((K, K))
        for i in range(K):
            for j in range(K):
                w[i, j] = ((i - j) ** 2) / ((K - 1) ** 2) if K > 1 else 0
    else:
        w = 1 - np.eye(K)

    po = 1 - (w * mat).sum() / n
    row_marg = mat.sum(axis=1) / n
    col_marg = mat.sum(axis=0) / n
    pe = 1 - (w * np.outer(row_marg, col_marg)).sum()
    kappa = (po - pe) / (1 - pe) if pe != 1 else float("nan")

    # Simple agreement
    diag_sum = float(np.trace(mat))
    pct_agree = diag_sum / n * 100

    # κ interpretation (Landis & Koch)
    def interpret(k: float) -> str:
        if math.isnan(k):
            return "n/a"
        if k < 0:
            return "poor (worse than chance)"
        if k < 0.20:
            return "slight"
        if k < 0.40:
            return "fair"
        if k < 0.60:
            return "moderate"
        if k < 0.80:
            return "substantial"
        return "almost perfect"

    # Standard error (approximate, asymptotic for unweighted)
    se = math.sqrt(po * (1 - po) / (n * (1 - pe) ** 2)) if (1 - pe) > 0 else float("nan")
    ci_lo = kappa - 1.96 * se if not math.isnan(se) else float("nan")
    ci_hi = kappa + 1.96 * se if not math.isnan(se) else float("nan")

    return sanitize_for_json({
        "n_paired": int(n),
        "categories": categories,
        "kappa": safe_round(kappa, 3),
        "kappa_type": "weighted (quadratic)" if config.weighted else "unweighted",
        "pct_agreement": safe_round(pct_agree, 2),
        "se": safe_round(se, 3),
        "ci_95": [safe_round(ci_lo, 3), safe_round(ci_hi, 3)],
        "interpretation": interpret(kappa),
        "contingency": mat.astype(int).tolist(),
    })
