"""Observer-vs-Respondent concordance (Phase 2 — Survey Analysis Studio).

Two endpoints:
  - /api/observer/concordance: % agreement, Cohen's κ (and weighted κ for Likert),
    McNemar (paired binary), Bland-Altman summary (continuous).
  - /api/observer/discrepancies: raw rows where the two sources disagree, ordered
    by magnitude of disagreement.
"""

from __future__ import annotations

import traceback
import math
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from scipy import stats as sp_stats

from ..shared import datasets, sanitize_for_json, apply_metrics_and_bins
from . import inferential_utils as iu

router = APIRouter()


class PairSpec(BaseModel):
    self_col: str
    observer_col: str
    kind: str | None = None  # 'binary' | 'ordinal' | 'continuous' (auto if None)
    label: str | None = None


class ConcordanceConfig(BaseModel):
    dataset_id: str
    pairs: list[PairSpec]
    filters: dict = {}


class DiscrepancyConfig(BaseModel):
    dataset_id: str
    self_col: str
    observer_col: str
    id_cols: list[str] = []  # extra columns to include in the drill-down (district, ID, etc.)
    max_rows: int = 200
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


def _detect_kind(s1: pd.Series, s2: pd.Series) -> str:
    """Detect whether the paired data is binary / ordinal / continuous."""
    try:
        a = pd.to_numeric(s1, errors="coerce").dropna()
        b = pd.to_numeric(s2, errors="coerce").dropna()
        uniq = sorted(set(a.unique()) | set(b.unique()))
        if len(uniq) == 2:
            return "binary"
        if len(uniq) <= 10 and all(float(u).is_integer() for u in uniq):
            return "ordinal"
        return "continuous"
    except Exception:
        return "binary"


def _cohens_kappa(a: np.ndarray, b: np.ndarray, weights: str | None = None) -> tuple[float, float]:
    """Cohen's κ (and weighted κ when weights='linear' or 'quadratic')."""
    cats = sorted(set(a) | set(b))
    n = len(a)
    if n == 0:
        return float("nan"), float("nan")
    obs = np.zeros((len(cats), len(cats)))
    for x, y in zip(a, b):
        obs[cats.index(x), cats.index(y)] += 1
    obs = obs / n
    p_a = obs.sum(axis=1)
    p_b = obs.sum(axis=0)
    if weights == "linear":
        w = np.array([[1 - abs(i - j) / (len(cats) - 1) for j in range(len(cats))] for i in range(len(cats))])
    elif weights == "quadratic":
        w = np.array([[1 - ((i - j) / (len(cats) - 1)) ** 2 for j in range(len(cats))] for i in range(len(cats))])
    else:
        w = np.eye(len(cats))
    p_o = (w * obs).sum()
    p_e = (w * np.outer(p_a, p_b)).sum()
    if 1 - p_e == 0:
        return float("nan"), float("nan")
    kappa = (p_o - p_e) / (1 - p_e)
    # SE under H0 (Fleiss approx for unweighted)
    var = (p_e + p_e ** 2 - sum(p_a * p_b * (p_a + p_b))) / (n * (1 - p_e) ** 2) if weights is None else float("nan")
    se = math.sqrt(var) if var > 0 else float("nan")
    return float(kappa), float(se)


def _interpret_kappa(k: float) -> str:
    if k is None or math.isnan(k):
        return ""
    if k < 0:
        return "less than chance"
    if k < 0.2:
        return "slight"
    if k < 0.4:
        return "fair"
    if k < 0.6:
        return "moderate"
    if k < 0.8:
        return "substantial"
    return "almost perfect"


@router.post("/api/observer/concordance")
async def observer_concordance(config: ConcordanceConfig):
    try:
        from statsmodels.stats.contingency_tables import mcnemar
        df = _prepare(config.dataset_id, config.filters)
        if not config.pairs:
            raise HTTPException(400, "Provide at least one pair")

        headers = ["Pair", "N", "Kind", "% Agreement", "Cohen's κ", "κ Interpretation",
                   "Weighted κ", "McNemar p", "Mean Diff (BA)", "BA Limits"]
        rows = []
        pair_results = []

        for pair in config.pairs:
            if pair.self_col not in df.columns or pair.observer_col not in df.columns:
                continue
            s1 = df[pair.self_col]
            s2 = df[pair.observer_col]
            mask = s1.notna() & s2.notna()
            s1, s2 = s1[mask], s2[mask]
            n = len(s1)
            if n < 5:
                continue
            kind = pair.kind or _detect_kind(s1, s2)

            label = pair.label or f"{pair.self_col} ↔ {pair.observer_col}"
            agree_pct = (s1.astype(str) == s2.astype(str)).mean() * 100

            kappa = w_kappa = mcnemar_p = bland_mean = bland_lo = bland_hi = None

            if kind in ("binary", "ordinal"):
                # Numeric encode if possible
                try:
                    a = pd.to_numeric(s1, errors="coerce").astype(int).to_numpy()
                    b = pd.to_numeric(s2, errors="coerce").astype(int).to_numpy()
                except Exception:
                    a = s1.astype(str).to_numpy()
                    b = s2.astype(str).to_numpy()
                kappa, _ = _cohens_kappa(a, b)
                if kind == "ordinal":
                    w_kappa, _ = _cohens_kappa(a, b, weights="linear")
                if kind == "binary":
                    ct = pd.crosstab(s1.astype(str), s2.astype(str))
                    if ct.shape == (2, 2):
                        try:
                            res = mcnemar(ct.values, exact=ct.values.sum() < 25, correction=True)
                            mcnemar_p = float(res.pvalue)
                        except Exception:
                            mcnemar_p = None
            else:  # continuous → Bland-Altman
                a = pd.to_numeric(s1, errors="coerce").to_numpy()
                b = pd.to_numeric(s2, errors="coerce").to_numpy()
                diffs = a - b
                bland_mean = float(np.mean(diffs))
                sd_d = float(np.std(diffs, ddof=1))
                bland_lo = bland_mean - 1.96 * sd_d
                bland_hi = bland_mean + 1.96 * sd_d

            rows.append([
                label, int(n), kind,
                iu.safe_round(agree_pct, 2),
                iu.safe_round(kappa), _interpret_kappa(kappa) if kappa is not None else "",
                iu.safe_round(w_kappa),
                iu.safe_round(mcnemar_p, 6) if mcnemar_p is not None else "",
                iu.safe_round(bland_mean),
                f"[{iu.safe_round(bland_lo)}, {iu.safe_round(bland_hi)}]" if bland_lo is not None else "",
            ])
            pair_results.append({
                "pair": label, "n": int(n), "kind": kind,
                "agreement_pct": iu.safe_round(agree_pct, 2),
                "kappa": iu.safe_round(kappa),
                "weighted_kappa": iu.safe_round(w_kappa),
                "mcnemar_p": iu.safe_round(mcnemar_p, 6) if mcnemar_p is not None else None,
                "bland_mean": iu.safe_round(bland_mean),
                "bland_limits": [iu.safe_round(bland_lo), iu.safe_round(bland_hi)] if bland_lo is not None else None,
            })

        return {"headers": headers, "rows": sanitize_for_json(rows),
                "row_count": len(rows), "col_count": len(headers),
                "table_type": "observer_concordance",
                "results": sanitize_for_json(pair_results),
                "interpretation": "κ: <0.2 slight, 0.2-0.4 fair, 0.4-0.6 moderate, 0.6-0.8 substantial, >0.8 almost perfect. McNemar p < 0.05 indicates systematic shift between observer and self-report."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Concordance error: {e}")


@router.post("/api/observer/discrepancies")
async def observer_discrepancies(config: DiscrepancyConfig):
    try:
        df = _prepare(config.dataset_id, config.filters)
        if config.self_col not in df.columns or config.observer_col not in df.columns:
            raise HTTPException(400, "Column not found")
        s1 = df[config.self_col]
        s2 = df[config.observer_col]

        # Try numeric magnitude; else string disagreement
        try:
            a = pd.to_numeric(s1, errors="coerce")
            b = pd.to_numeric(s2, errors="coerce")
            mask = a.notna() & b.notna()
            mag = (a - b).abs()
            disagree_mask = mask & (mag > 0)
            sub = df.loc[disagree_mask].copy()
            sub["__magnitude__"] = mag[disagree_mask]
            sub = sub.sort_values("__magnitude__", ascending=False)
            magnitude_available = True
        except Exception:
            mask = s1.notna() & s2.notna()
            disagree_mask = mask & (s1.astype(str) != s2.astype(str))
            sub = df.loc[disagree_mask].copy()
            sub["__magnitude__"] = 1
            magnitude_available = False

        id_cols = [c for c in config.id_cols if c in df.columns]
        show_cols = id_cols + [config.self_col, config.observer_col]
        if magnitude_available:
            show_cols += ["__magnitude__"]

        result = sub[show_cols].head(config.max_rows)
        headers = ["Row #"] + show_cols
        rows = []
        for orig_idx, r in result.iterrows():
            rows.append([int(orig_idx)] + [r[c] for c in show_cols])

        return {"headers": headers, "rows": sanitize_for_json(rows),
                "row_count": len(rows), "col_count": len(headers),
                "table_type": "observer_discrepancies",
                "total_disagreements": int(disagree_mask.sum()),
                "total_compared": int(mask.sum()),
                "disagreement_rate": iu.safe_round(disagree_mask.sum() / mask.sum() * 100 if mask.sum() else 0, 2),
                "showing": len(rows),
                "interpretation": f"{int(disagree_mask.sum())} of {int(mask.sum())} compared rows disagree ({iu.safe_round(disagree_mask.sum() / mask.sum() * 100 if mask.sum() else 0, 1)}%). Top rows have the largest magnitude gap — investigate these first."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Discrepancies error: {e}")
