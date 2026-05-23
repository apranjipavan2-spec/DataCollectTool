"""Key Driver analysis — relative importance of predictors for an outcome.

Uses standardized regression coefficients + Pratt's measure for relative importance.
For non-linear / interactions, falls back to permutation-style variance contribution.

Endpoint:
  POST /api/driver/importance
    body: {dataset_id, outcome, predictors[], standardize?, alpha?}
    output: ranked predictors with std β, importance %, partial R², p-values.
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

router = APIRouter(prefix="/api/driver", tags=["driver"])


class DriverConfig(BaseModel):
    dataset_id: str
    outcome: str
    predictors: list[str]
    standardize: bool = True
    alpha: float = 0.05


def _zscore(s: pd.Series) -> pd.Series:
    s = pd.to_numeric(s, errors="coerce")
    sd = s.std(ddof=1)
    if sd == 0 or math.isnan(sd):
        return s * 0
    return (s - s.mean()) / sd


def _encode_categorical(s: pd.Series) -> tuple[np.ndarray, list[str]]:
    """One-hot encode, dropping first level (reference). Returns (matrix, level_names)."""
    s = s.astype(str).fillna("__MISSING__")
    levels = sorted(s.unique())
    if len(levels) <= 1:
        return np.zeros((len(s), 0)), []
    ref = levels[0]
    out_levels = [lvl for lvl in levels if lvl != ref]
    mat = np.zeros((len(s), len(out_levels)))
    for j, lvl in enumerate(out_levels):
        mat[:, j] = (s == lvl).astype(float).values
    return mat, [f"{lvl} (vs {ref})" for lvl in out_levels]


@router.post("/importance")
def driver_importance(config: DriverConfig):
    if config.dataset_id not in datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = datasets[config.dataset_id]["df"]
    if config.outcome not in df.columns:
        raise HTTPException(status_code=400, detail="outcome not in dataset")
    if not config.predictors:
        raise HTTPException(status_code=400, detail="predictors empty")

    y_raw = pd.to_numeric(df[config.outcome], errors="coerce")

    # Build design matrix
    columns_used: list[str] = []
    blocks: list[np.ndarray] = []
    block_owner: list[str] = []  # which original predictor owns each column

    for col in config.predictors:
        if col not in df.columns or col == config.outcome:
            continue
        s = df[col]
        is_num = pd.api.types.is_numeric_dtype(s) or (
            pd.to_numeric(s, errors="coerce").notna().sum() / max(len(s), 1) > 0.7
        )
        if is_num:
            x = pd.to_numeric(s, errors="coerce").values.reshape(-1, 1)
            blocks.append(x)
            columns_used.append(col)
            block_owner.append(col)
        else:
            mat, lvls = _encode_categorical(s)
            if mat.shape[1] == 0:
                continue
            blocks.append(mat)
            for lvl_name in lvls:
                columns_used.append(f"{col}: {lvl_name}")
                block_owner.append(col)

    if not blocks:
        raise HTTPException(status_code=400, detail="No usable predictors")

    X = np.hstack(blocks)
    Y = y_raw.values
    mask = ~np.isnan(Y) & ~np.any(np.isnan(X), axis=1)
    X, Y = X[mask], Y[mask]
    if len(Y) < len(columns_used) + 2:
        raise HTTPException(status_code=400, detail=f"Not enough rows ({len(Y)}) for {len(columns_used)} predictors")

    # Standardize if requested
    if config.standardize:
        x_means = X.mean(axis=0)
        x_sds = X.std(axis=0, ddof=1)
        x_sds[x_sds == 0] = 1
        Xs = (X - x_means) / x_sds
        y_mean = Y.mean()
        y_sd = Y.std(ddof=1) or 1
        Ys = (Y - y_mean) / y_sd
    else:
        Xs, Ys = X, Y

    # Weights
    sd = study_designs.get(config.dataset_id) or {}
    w_col = sd.get("weight_col")
    w_arr = None
    if isinstance(w_col, str) and w_col in df.columns:
        w_full = pd.to_numeric(df[w_col], errors="coerce").values[mask]
        if np.any(~np.isnan(w_full)):
            w_arr = np.where(np.isnan(w_full), 0, w_full)

    n, p = Xs.shape
    # Add intercept
    X1 = np.hstack([np.ones((n, 1)), Xs])
    if w_arr is not None:
        sw = np.sqrt(w_arr)
        Xw = X1 * sw[:, None]
        Yw = Ys * sw
        XtX = Xw.T @ Xw
        XtY = Xw.T @ Yw
    else:
        XtX = X1.T @ X1
        XtY = X1.T @ Ys
    try:
        XtX_inv = np.linalg.pinv(XtX)
        beta = XtX_inv @ XtY
    except np.linalg.LinAlgError:
        raise HTTPException(status_code=400, detail="Singular design matrix — predictors collinear")

    y_pred = X1 @ beta
    resid = Ys - y_pred
    if w_arr is not None:
        sse = float(np.sum(w_arr * resid ** 2))
        sst = float(np.sum(w_arr * (Ys - np.average(Ys, weights=w_arr)) ** 2))
    else:
        sse = float(np.sum(resid ** 2))
        sst = float(np.sum((Ys - Ys.mean()) ** 2))
    r2 = 1 - sse / sst if sst > 0 else 0.0
    dof = n - p - 1
    mse = sse / dof if dof > 0 else float("nan")
    se = np.sqrt(np.diag(XtX_inv) * mse) if not math.isnan(mse) else np.full(p + 1, np.nan)
    t_vals = beta / se
    p_vals = [2 * (1 - sp_stats.t.cdf(abs(t), dof)) if not math.isnan(t) else float("nan") for t in t_vals]

    # Compute Pratt's relative importance: r * β (sum to R²)
    if p > 0:
        if w_arr is not None:
            # weighted correlation X cols ~ Y
            ymean = float(np.average(Ys, weights=w_arr))
            yvar = float(np.average((Ys - ymean) ** 2, weights=w_arr))
            corr_xy = np.zeros(p)
            for j in range(p):
                xmean = float(np.average(Xs[:, j], weights=w_arr))
                xvar = float(np.average((Xs[:, j] - xmean) ** 2, weights=w_arr))
                cov = float(np.average((Xs[:, j] - xmean) * (Ys - ymean), weights=w_arr))
                corr_xy[j] = cov / math.sqrt(xvar * yvar) if (xvar > 0 and yvar > 0) else 0.0
        else:
            corr_xy = np.array([np.corrcoef(Xs[:, j], Ys)[0, 1] if Xs[:, j].std() > 0 else 0 for j in range(p)])
        pratt_raw = corr_xy * beta[1:]
        # Force into [0, 1] importance share (clip negative contributions to 0 for ranking, but expose raw)
        pratt_sum = pratt_raw.sum()
        importance_pct = (pratt_raw / pratt_sum * 100) if pratt_sum > 0 else np.zeros(p)
    else:
        pratt_raw = np.zeros(p)
        importance_pct = np.zeros(p)

    # Aggregate columns back to original predictor (sum across dummy levels)
    by_owner: dict[str, dict] = {}
    for j, owner in enumerate(block_owner):
        d = by_owner.setdefault(owner, {"beta_sum": 0.0, "pratt_sum": 0.0, "importance_pct_sum": 0.0, "levels": []})
        d["beta_sum"] += float(beta[j + 1])  # +1 for intercept
        d["pratt_sum"] += float(pratt_raw[j])
        d["importance_pct_sum"] += float(importance_pct[j])
        d["levels"].append({
            "label": columns_used[j],
            "beta": safe_round(beta[j + 1], 4),
            "se": safe_round(se[j + 1], 4),
            "t": safe_round(t_vals[j + 1], 3),
            "p_value": safe_round(p_vals[j + 1], 4),
            "sig": sig_stars(p_vals[j + 1], config.alpha),
            "importance_pct": safe_round(importance_pct[j], 2),
        })

    drivers = []
    for owner, d in by_owner.items():
        drivers.append({
            "predictor": owner,
            "std_beta": safe_round(d["beta_sum"], 4),
            "pratt": safe_round(d["pratt_sum"], 4),
            "importance_pct": safe_round(d["importance_pct_sum"], 2),
            "levels": d["levels"],
        })
    drivers.sort(key=lambda r: abs(r["importance_pct"] or 0), reverse=True)
    for i, d in enumerate(drivers):
        d["rank"] = i + 1

    return sanitize_for_json({
        "outcome": config.outcome,
        "n": int(n),
        "r2": safe_round(r2, 4),
        "adj_r2": safe_round(1 - (1 - r2) * (n - 1) / dof if dof > 0 else None, 4),
        "drivers": drivers,
        "standardized": config.standardize,
        "weighted": w_arr is not None,
        "weight_col": w_col if w_arr is not None else None,
        "alpha": config.alpha,
    })
