"""Balance tables — iebaltab-style covariate balance for treatment vs control.

Endpoint:
  POST /api/balance/table
    body: {dataset_id, treatment_col, treatment_value?, covariates[]}
    output: per-covariate row with N, mean/SD for T and C, raw diff,
            standardized mean diff (SMD / Cohen's d), t-test p, flag if |SMD|>0.25.
            Categorical covariates: cell proportions + Cohen's h + χ² p.

Honors survey weights from StudyDesign if present.
"""

from __future__ import annotations

import math
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from scipy import stats as sp_stats

from ..shared import datasets, study_designs, sanitize_for_json
from .inferential_utils import sig_stars, safe_round

router = APIRouter(prefix="/api/balance", tags=["balance"])


class BalanceConfig(BaseModel):
    dataset_id: str
    treatment_col: str
    treatment_value: str | int | float | None = None  # which value = "treated"; else binarize 0/1
    covariates: list[str]
    alpha: float = 0.05


def _wstats(x: pd.Series, w: pd.Series | None) -> tuple[float, float, float]:
    """(n_eff, mean, sd) — NaN-safe, weighted or unweighted."""
    x = pd.to_numeric(x, errors="coerce")
    if w is None:
        x = x.dropna()
        if len(x) < 1:
            return 0.0, float("nan"), float("nan")
        return float(len(x)), float(x.mean()), float(x.std(ddof=1)) if len(x) > 1 else float("nan")
    w = pd.to_numeric(w.reindex(x.index), errors="coerce")
    mask = x.notna() & w.notna() & (w > 0)
    x, w = x[mask], w[mask]
    if len(x) < 1:
        return 0.0, float("nan"), float("nan")
    sw, sw2 = float(w.sum()), float((w ** 2).sum())
    n_eff = (sw ** 2) / sw2 if sw2 > 0 else 0.0
    mean = float(np.average(x, weights=w))
    var = float(np.average((x - mean) ** 2, weights=w))
    return n_eff, mean, math.sqrt(var) if var > 0 else float("nan")


def _smd(m1: float, s1: float, m2: float, s2: float) -> float:
    """Standardized mean difference (Cohen's d) using pooled SD."""
    if any(map(lambda v: v is None or (isinstance(v, float) and math.isnan(v)), [m1, s1, m2, s2])):
        return float("nan")
    sp = math.sqrt((s1 ** 2 + s2 ** 2) / 2.0)
    if sp == 0:
        return 0.0
    return (m1 - m2) / sp


def _cohens_h(p1: float, p2: float) -> float:
    """Cohen's h for difference of two proportions."""
    if any(map(lambda v: v is None or (isinstance(v, float) and math.isnan(v)), [p1, p2])):
        return float("nan")
    p1c = min(max(p1, 1e-6), 1 - 1e-6)
    p2c = min(max(p2, 1e-6), 1 - 1e-6)
    return 2 * math.asin(math.sqrt(p1c)) - 2 * math.asin(math.sqrt(p2c))


@router.post("/table")
def balance_table(config: BalanceConfig):
    if config.dataset_id not in datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = datasets[config.dataset_id]["df"].copy()
    if config.treatment_col not in df.columns:
        raise HTTPException(status_code=400, detail="treatment_col not in dataset")

    # Build treatment binary mask
    tv = config.treatment_value
    if tv is None:
        # auto: most-common non-null is "treated"
        vc = df[config.treatment_col].value_counts(dropna=True)
        if len(vc) == 0:
            raise HTTPException(status_code=400, detail="treatment_col is empty")
        tv = vc.index[0]
    t_mask = df[config.treatment_col].astype(str) == str(tv)

    # Resolve weights
    sd = study_designs.get(config.dataset_id) or {}
    w_col = sd.get("weight_col")
    weights = None
    if isinstance(w_col, str) and w_col in df.columns:
        w_series = pd.to_numeric(df[w_col], errors="coerce")
        if w_series.notna().sum() > 0:
            weights = w_series

    rows: list[dict] = []
    for col in config.covariates:
        if col not in df.columns or col == config.treatment_col:
            continue

        is_numeric = pd.api.types.is_numeric_dtype(df[col]) or (
            pd.to_numeric(df[col], errors="coerce").notna().sum() / max(len(df), 1) > 0.7
        )

        s_all = df[col]
        s_t = s_all[t_mask]
        s_c = s_all[~t_mask]
        w_t = weights[t_mask] if weights is not None else None
        w_c = weights[~t_mask] if weights is not None else None

        if is_numeric:
            n_t, m_t, sd_t = _wstats(s_t, w_t)
            n_c, m_c, sd_c = _wstats(s_c, w_c)
            diff = m_t - m_c if not (math.isnan(m_t) or math.isnan(m_c)) else float("nan")
            smd = _smd(m_t, sd_t, m_c, sd_c)
            # t-test (unweighted Welch) for p-value
            try:
                x1 = pd.to_numeric(s_t, errors="coerce").dropna().values
                x2 = pd.to_numeric(s_c, errors="coerce").dropna().values
                if len(x1) >= 2 and len(x2) >= 2:
                    t_stat, p = sp_stats.ttest_ind(x1, x2, equal_var=False, nan_policy="omit")
                    p = float(p)
                else:
                    p = float("nan")
            except Exception:
                p = float("nan")
            rows.append({
                "covariate": col,
                "type": "numeric",
                "n_treatment": safe_round(n_t, 1),
                "n_control": safe_round(n_c, 1),
                "mean_treatment": safe_round(m_t, 4),
                "sd_treatment": safe_round(sd_t, 4),
                "mean_control": safe_round(m_c, 4),
                "sd_control": safe_round(sd_c, 4),
                "diff": safe_round(diff, 4),
                "smd": safe_round(smd, 3),
                "p_value": safe_round(p, 4),
                "sig": sig_stars(p, config.alpha),
                "imbalanced": (abs(smd) > 0.25) if not math.isnan(smd) else False,
            })
        else:
            # Categorical: compare proportion-by-level via χ², report largest |h|
            ct = pd.crosstab(s_all, t_mask)
            if ct.shape[0] < 2 or ct.shape[1] < 2:
                continue
            try:
                chi2, p, _, _ = sp_stats.chi2_contingency(ct.values, correction=False)
                p = float(p)
            except Exception:
                p = float("nan")
            # Cohen's h for each level
            sums = ct.sum(axis=0)
            props = ct.div(sums, axis=1)  # proportion within group
            max_h = 0.0
            max_level = None
            level_breakdown = []
            for level in ct.index:
                p1 = float(props.loc[level, True]) if True in props.columns else float("nan")
                p2 = float(props.loc[level, False]) if False in props.columns else float("nan")
                h = _cohens_h(p1, p2)
                level_breakdown.append({
                    "level": str(level),
                    "pct_treatment": safe_round(p1 * 100, 2) if not math.isnan(p1) else None,
                    "pct_control": safe_round(p2 * 100, 2) if not math.isnan(p2) else None,
                    "cohens_h": safe_round(h, 3),
                })
                if not math.isnan(h) and abs(h) > abs(max_h):
                    max_h, max_level = h, str(level)
            rows.append({
                "covariate": col,
                "type": "categorical",
                "n_treatment": int(ct.get(True, pd.Series([0])).sum()) if True in ct.columns else 0,
                "n_control": int(ct.get(False, pd.Series([0])).sum()) if False in ct.columns else 0,
                "levels": level_breakdown,
                "max_h": safe_round(max_h, 3),
                "max_h_level": max_level,
                "p_value": safe_round(p, 4),
                "sig": sig_stars(p, config.alpha),
                "imbalanced": abs(max_h) > 0.20 if not math.isnan(max_h) else False,
            })

    imbalanced = sum(1 for r in rows if r.get("imbalanced"))
    return sanitize_for_json({
        "treatment_col": config.treatment_col,
        "treatment_value": str(tv),
        "rows": rows,
        "n_covariates": len(rows),
        "n_imbalanced": imbalanced,
        "weighted": weights is not None,
        "weight_col": w_col if weights is not None else None,
        "alpha": config.alpha,
    })
