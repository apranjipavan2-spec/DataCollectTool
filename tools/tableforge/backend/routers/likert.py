"""Likert scale analysis endpoints (Phase 2 — Survey Analysis Studio).

Produces summary tables, composite scores, group comparisons, and factor analysis
for sets of Likert-scale items. All endpoints share the standard response shape.
"""

from __future__ import annotations

import math
import traceback
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from scipy import stats as sp_stats

from ..shared import datasets, sanitize_for_json, apply_metrics_and_bins
from . import inferential_utils as iu

router = APIRouter()


class LikertConfig(BaseModel):
    dataset_id: str
    item_cols: list[str] = []
    scale_min: int = 1
    scale_max: int = 5
    scale_labels: dict[str, str] | None = None  # {"1": "Strongly Disagree", ...}
    filters: dict = {}


class CompositeConfig(BaseModel):
    dataset_id: str
    item_cols: list[str]
    composite_name: str = "Composite"
    method: str = "mean"  # 'mean' | 'sum' | 'z'
    reverse_code: list[str] | None = None  # column names to reverse
    scale_min: int = 1
    scale_max: int = 5
    filters: dict = {}


class CompareConfig(BaseModel):
    dataset_id: str
    item_cols: list[str]
    group_col: str
    correction: str = "fdr_bh"  # 'bonferroni' | 'fdr_bh' | 'holm'
    filters: dict = {}


class FactorConfig(BaseModel):
    dataset_id: str
    item_cols: list[str]
    n_factors: int = 0  # 0 = auto via Kaiser (eigenvalue > 1)
    rotation: str = "varimax"  # 'varimax' | 'none'
    filters: dict = {}


def _prepare(dataset_id: str, filters: dict | None) -> pd.DataFrame:
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[dataset_id]["df"].copy()
    df = apply_metrics_and_bins(df, dataset_id)
    for col, vals in (filters or {}).items():
        if vals and col in df.columns:
            df = df[df[col].astype(str).isin([str(v) for v in vals])]
    return df


# ═══════════════════════════════════════════════════════════════════════════
# Summary: per-item N/Mean/SD/Top-2/Bottom-2/Net-Agree
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/api/likert/summary")
async def likert_summary(config: LikertConfig):
    try:
        df = _prepare(config.dataset_id, config.filters)
        if not config.item_cols:
            raise HTTPException(400, "Specify item_cols")
        smin, smax = config.scale_min, config.scale_max
        top2_threshold = smax - 1  # top 2 categories
        bot2_threshold = smin + 1  # bottom 2 categories

        headers = ["Item", "N", "Mean", "SD", "Median", "Mode", "Top-2 %", "Bottom-2 %", "Net Agree %"]
        # Add columns for each scale point
        levels = list(range(smin, smax + 1))
        for lv in levels:
            label = (config.scale_labels or {}).get(str(lv), str(lv))
            headers.append(f"{lv}: {label}")

        rows = []
        item_distributions = []
        for col in config.item_cols:
            if col not in df.columns:
                continue
            series = pd.to_numeric(df[col], errors="coerce").dropna()
            if len(series) == 0:
                continue
            n = len(series)
            mean = series.mean()
            sd = series.std(ddof=1)
            median = series.median()
            try:
                mode = sp_stats.mode(series, keepdims=False).mode
            except Exception:
                mode = series.mode().iloc[0] if not series.mode().empty else None
            top2 = (series >= top2_threshold).sum()
            bot2 = (series <= bot2_threshold).sum()
            top2_pct = top2 / n * 100
            bot2_pct = bot2 / n * 100
            net_agree = top2_pct - bot2_pct
            level_counts = []
            for lv in levels:
                pct = (series == lv).sum() / n * 100
                level_counts.append(pct)
            rows.append([
                str(col), int(n),
                iu.safe_round(mean), iu.safe_round(sd),
                iu.safe_round(median), iu.safe_round(mode),
                iu.safe_round(top2_pct, 2), iu.safe_round(bot2_pct, 2),
                iu.safe_round(net_agree, 2),
                *[iu.safe_round(p, 2) for p in level_counts],
            ])
            item_distributions.append({
                "item": col, "n": int(n),
                "mean": iu.safe_round(mean), "sd": iu.safe_round(sd),
                "top2_pct": iu.safe_round(top2_pct, 2),
                "bottom2_pct": iu.safe_round(bot2_pct, 2),
                "net_agree": iu.safe_round(net_agree, 2),
                "distribution": [iu.safe_round(p, 2) for p in level_counts],
                "levels": levels,
            })

        return {"headers": headers, "rows": sanitize_for_json(rows),
                "row_count": len(rows), "col_count": len(headers),
                "table_type": "likert_summary",
                "distributions": sanitize_for_json(item_distributions),
                "interpretation": "Top-2 = % choosing the two highest scale points; Net Agree = Top-2 − Bottom-2. Net Agree ≥ 30 indicates broad agreement."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Likert summary error: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# Composite: build a new column (mean/sum/z) with reliability
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/api/likert/composite")
async def likert_composite(config: CompositeConfig):
    try:
        df = _prepare(config.dataset_id, config.filters)
        if len(config.item_cols) < 2:
            raise HTTPException(400, "Need ≥2 items to build a composite")
        # Build numeric matrix (with reverse-coding)
        items = df[config.item_cols].apply(pd.to_numeric, errors="coerce")
        if config.reverse_code:
            for col in config.reverse_code:
                if col in items.columns:
                    items[col] = (config.scale_min + config.scale_max) - items[col]

        # Reliability of the (possibly reverse-coded) item set
        alpha, item_rest = iu.cronbach_alpha(items)

        # Compute composite (drop rows with any NA)
        cleaned = items.dropna(how="any")
        method = (config.method or "mean").lower()
        if method == "sum":
            composite_vals = cleaned.sum(axis=1)
        elif method == "z":
            standardised = (cleaned - cleaned.mean()) / cleaned.std(ddof=1).replace(0, np.nan)
            composite_vals = standardised.mean(axis=1)
        else:  # mean
            composite_vals = cleaned.mean(axis=1)

        # Persist the composite into the dataset (so it shows up in column lists)
        composite_name = config.composite_name.strip() or "Composite"
        # Find a unique name
        target_name = composite_name
        i = 2
        while target_name in datasets[config.dataset_id]["df"].columns:
            target_name = f"{composite_name} ({i})"
            i += 1
        # Align by index back into the full dataframe (NaN where any item was missing)
        full = pd.Series(np.nan, index=df.index)
        full.loc[composite_vals.index] = composite_vals.values
        datasets[config.dataset_id]["df"][target_name] = full.values

        quality = "excellent" if alpha is not None and not math.isnan(alpha) and alpha >= 0.9 else \
                  "good" if alpha and alpha >= 0.8 else \
                  "acceptable" if alpha and alpha >= 0.7 else \
                  "questionable" if alpha and alpha >= 0.6 else "poor"

        headers = ["Item", "Mean", "SD", "Item-Rest r", "Reverse-coded?"]
        rows = []
        for c, ir in zip(config.item_cols, item_rest):
            reversed_flag = "Yes" if config.reverse_code and c in config.reverse_code else "No"
            rows.append([str(c), iu.safe_round(cleaned[c].mean()),
                         iu.safe_round(cleaned[c].std(ddof=1)),
                         iu.safe_round(ir), reversed_flag])
        rows.append([""] * len(headers))
        rows.append(["Composite name", target_name, "", "", ""])
        rows.append(["Method", method, "", "", ""])
        rows.append(["N (complete)", len(cleaned), "", "", ""])
        rows.append(["Composite Mean", iu.safe_round(composite_vals.mean()), "", "", ""])
        rows.append(["Composite SD", iu.safe_round(composite_vals.std(ddof=1)), "", "", ""])
        rows.append(["Cronbach's α", iu.safe_round(alpha), f"({quality})", "", ""])

        return {"headers": headers, "rows": sanitize_for_json(rows),
                "row_count": len(rows), "col_count": len(headers),
                "table_type": "likert_composite",
                "composite_name": target_name,
                "alpha": iu.safe_round(alpha), "method": method,
                "n": int(len(cleaned)),
                "interpretation": f"Composite '{target_name}' added to dataset. Cronbach's α = {iu.safe_round(alpha)} ({quality})."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Composite error: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# Compare items across groups (per-item Mann-Whitney / Kruskal-Wallis)
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/api/likert/compare")
async def likert_compare(config: CompareConfig):
    try:
        df = _prepare(config.dataset_id, config.filters)
        if not config.item_cols:
            raise HTTPException(400, "Specify item_cols")
        if config.group_col not in df.columns:
            raise HTTPException(400, f"Group column '{config.group_col}' not found")

        groups = df[config.group_col].dropna().unique()
        if len(groups) < 2:
            raise HTTPException(400, "Need ≥2 groups")

        is_two = len(groups) == 2
        headers = ["Item"]
        for g in groups:
            headers.append(f"Median {g}")
        headers += ["Test", "Statistic", "Raw p", "Adj p", "Effect", "Sig (adj)"]

        rows = []
        pvals = []
        details = []
        for col in config.item_cols:
            if col not in df.columns:
                continue
            series = pd.to_numeric(df[col], errors="coerce")
            sub = df.assign(_v=series)[[config.group_col, "_v"]].dropna()
            if len(sub) < 3:
                continue
            data_by_g = {g: sub.loc[sub[config.group_col] == g, "_v"].to_numpy() for g in groups}
            sizes = [len(data_by_g[g]) for g in groups]
            if min(sizes) < 2:
                continue
            if is_two:
                stat, p = sp_stats.mannwhitneyu(data_by_g[groups[0]], data_by_g[groups[1]], alternative="two-sided")
                test_name = "Mann-Whitney"
                effect = iu.rank_biserial(stat, sizes[0], sizes[1])
                effect_str = f"r={iu.safe_round(effect)}"
            else:
                stat, p = sp_stats.kruskal(*[data_by_g[g] for g in groups])
                test_name = "Kruskal-Wallis"
                n_total = sum(sizes)
                eta2 = (stat - len(groups) + 1) / (n_total - len(groups)) if n_total > len(groups) else float("nan")
                effect_str = f"η²={iu.safe_round(eta2)}"
            pvals.append(float(p))
            details.append((col, [iu.safe_round(np.median(data_by_g[g])) for g in groups],
                            test_name, iu.safe_round(stat), iu.safe_round(p, 6), effect_str))

        adj = iu.correct_pvalues(pvals, config.correction) if pvals else []
        for (col, medians, test_name, stat, raw_p, effect), adj_p in zip(details, adj):
            rows.append([str(col), *medians, test_name, stat, raw_p,
                         iu.safe_round(adj_p, 6), effect, iu.sig_stars(adj_p)])

        return {"headers": headers, "rows": sanitize_for_json(rows),
                "row_count": len(rows), "col_count": len(headers),
                "table_type": "likert_compare",
                "correction": config.correction,
                "interpretation": f"Per-item group comparison with {config.correction} multi-test correction. Adj p < 0.05 survives correction across {len(pvals)} tests."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Likert compare error: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# Factor analysis (PCA via SVD — works without factor_analyzer dep)
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/api/likert/factor")
async def likert_factor(config: FactorConfig):
    try:
        df = _prepare(config.dataset_id, config.filters)
        if len(config.item_cols) < 3:
            raise HTTPException(400, "Need ≥3 items for factor analysis")
        items = df[config.item_cols].apply(pd.to_numeric, errors="coerce").dropna()
        if len(items) < len(config.item_cols) * 5:
            raise HTTPException(400, f"Recommend ≥{len(config.item_cols) * 5} cases; have {len(items)}")

        # Standardise
        X = (items - items.mean()) / items.std(ddof=1).replace(0, np.nan)
        X = X.dropna(axis=1, how="any").to_numpy()
        if X.shape[1] < 3:
            raise HTTPException(400, "Too few items after dropping zero-variance columns")

        # Correlation matrix + eigendecomposition
        R = np.corrcoef(X, rowvar=False)
        eigvals, eigvecs = np.linalg.eigh(R)
        # eigh returns ascending → reverse to descending
        order = np.argsort(eigvals)[::-1]
        eigvals = eigvals[order]
        eigvecs = eigvecs[:, order]

        # Determine #factors
        n_factors = config.n_factors
        if n_factors <= 0:
            n_factors = int((eigvals > 1.0).sum())
            n_factors = max(1, min(n_factors, X.shape[1] - 1))

        # Unrotated loadings = eigenvectors * sqrt(eigenvalues), first n_factors
        loadings = eigvecs[:, :n_factors] * np.sqrt(np.clip(eigvals[:n_factors], 0, None))

        # Varimax rotation (Kaiser normalisation, iterative)
        if config.rotation == "varimax" and n_factors > 1:
            loadings = _varimax(loadings)

        total_var = float(eigvals.sum())
        var_explained = [float(e) / total_var * 100 for e in eigvals[:n_factors]]
        cum_var = float(sum(var_explained))

        # KMO (overall) — simplified
        try:
            kmo = _kmo(R)
        except Exception:
            kmo = None
        # Bartlett's test of sphericity
        try:
            n_cases = X.shape[0]
            p = X.shape[1]
            det_R = np.linalg.det(R)
            if det_R > 0:
                bartlett_chi2 = -((n_cases - 1) - (2 * p + 5) / 6) * math.log(det_R)
                bartlett_df = p * (p - 1) / 2
                bartlett_p = 1 - sp_stats.chi2.cdf(bartlett_chi2, bartlett_df)
            else:
                bartlett_chi2 = bartlett_df = bartlett_p = None
        except Exception:
            bartlett_chi2 = bartlett_df = bartlett_p = None

        # Build loadings table
        headers = ["Item"] + [f"F{i+1}" for i in range(n_factors)] + ["Communality"]
        rows = []
        communalities = (loadings ** 2).sum(axis=1)
        for i, col in enumerate(config.item_cols[:loadings.shape[0]]):
            rows.append([str(col), *[iu.safe_round(loadings[i, j], 3) for j in range(n_factors)],
                         iu.safe_round(communalities[i], 3)])
        rows.append([""] * len(headers))
        rows.append(["Eigenvalue"] + [iu.safe_round(eigvals[j], 3) for j in range(n_factors)] + [""])
        rows.append(["% Var"] + [iu.safe_round(v, 2) for v in var_explained] + [""])
        rows.append(["Cumulative %"] + [iu.safe_round(sum(var_explained[:j+1]), 2) for j in range(n_factors)] + [""])
        if kmo is not None:
            rows.append([""] * len(headers))
            rows.append(["KMO (sampling adequacy)", iu.safe_round(kmo, 3), *([""] * (len(headers) - 2))])
        if bartlett_chi2 is not None:
            rows.append(["Bartlett's χ²", iu.safe_round(bartlett_chi2), iu.safe_round(bartlett_p, 6),
                         *([""] * (len(headers) - 3))])

        scree = [iu.safe_round(float(v), 4) for v in eigvals]
        return {"headers": headers, "rows": sanitize_for_json(rows),
                "row_count": len(rows), "col_count": len(headers),
                "table_type": "likert_factor",
                "n_factors": n_factors, "rotation": config.rotation,
                "variance_explained": [iu.safe_round(v, 2) for v in var_explained],
                "cumulative_variance": iu.safe_round(cum_var, 2),
                "kmo": iu.safe_round(kmo, 3) if kmo is not None else None,
                "scree": scree,
                "interpretation": f"Extracted {n_factors} factor(s) explaining {iu.safe_round(cum_var, 1)}% of variance. Loadings ≥ |0.4| are typically interpretable. KMO ≥ 0.6 indicates adequate sampling."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Factor analysis error: {e}")


def _varimax(loadings: np.ndarray, max_iter: int = 100, tol: float = 1e-6) -> np.ndarray:
    """Kaiser-normalised varimax rotation."""
    p, k = loadings.shape
    if k < 2:
        return loadings
    # Kaiser normalisation
    h = np.sqrt((loadings ** 2).sum(axis=1, keepdims=True))
    h[h == 0] = 1
    L = loadings / h
    R_rot = np.eye(k)
    d_old = 0
    for _ in range(max_iter):
        Lambda = L @ R_rot
        u, s, vh = np.linalg.svd(
            L.T @ (Lambda ** 3 - (Lambda @ np.diag((Lambda ** 2).sum(axis=0))) / p),
            full_matrices=False,
        )
        R_rot = u @ vh
        d_new = float(s.sum())
        if d_old != 0 and (d_new - d_old) / d_old < tol:
            break
        d_old = d_new
    rotated = L @ R_rot
    return rotated * h


def _kmo(R: np.ndarray) -> float:
    """KMO measure of sampling adequacy (overall)."""
    R_inv = np.linalg.inv(R)
    D = np.diag(1 / np.sqrt(np.diag(R_inv)))
    partial = -D @ R_inv @ D
    np.fill_diagonal(partial, 1)
    R_sq = (R ** 2).sum() - np.trace(R ** 2)
    P_sq = (partial ** 2).sum() - np.trace(partial ** 2)
    if R_sq + P_sq == 0:
        return float("nan")
    return R_sq / (R_sq + P_sq)
