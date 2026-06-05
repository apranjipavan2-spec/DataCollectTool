"""Multi-Response (MR) set analysis (Phase 2 — Survey Analysis Studio).

Supports two MR encodings:
  (a) Single column with comma-separated values  (e.g., "Banking, Telecom, Health")
  (b) Multiple dummy columns sharing an mr_set_id  (one column per option, 0/1 or Yes/No)

`mr_col` (single) takes precedence; otherwise `mr_cols` (list of dummies) is used.
"""

from __future__ import annotations

import traceback
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..shared import datasets, sanitize_for_json, apply_metrics_and_bins
from . import inferential_utils as iu

router = APIRouter()


class MRConfig(BaseModel):
    dataset_id: str
    mr_col: str | None = None        # single column with comma-separated values
    mr_cols: list[str] | None = None  # list of dummy columns
    separator: str = ","
    truthy: list[str] = ["1", "true", "yes", "y", "t"]
    group_col: str | None = None
    correction: str = "fdr_bh"
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


def _mr_to_dummies(df: pd.DataFrame, config: MRConfig) -> tuple[pd.DataFrame, list[str]]:
    """Return (dummies_df, option_labels). dummies_df: rows = respondents, cols = options (0/1)."""
    if config.mr_col:
        if config.mr_col not in df.columns:
            raise HTTPException(400, f"Column '{config.mr_col}' not found")
        sep = config.separator or ","
        series = df[config.mr_col].dropna().astype(str)
        all_options: list[str] = []
        seen = set()
        for val in series:
            for part in val.split(sep):
                p = part.strip()
                if p and p.lower() not in ("nan", "none", "") and p not in seen:
                    seen.add(p)
                    all_options.append(p)
        dummies = pd.DataFrame(0, index=df.index, columns=all_options, dtype=int)
        for idx, val in df[config.mr_col].dropna().astype(str).items():
            for part in val.split(sep):
                p = part.strip()
                if p in dummies.columns:
                    dummies.at[idx, p] = 1
        return dummies, all_options
    if config.mr_cols:
        missing = [c for c in config.mr_cols if c not in df.columns]
        if missing:
            raise HTTPException(400, f"Missing columns: {missing}")
        truthy_set = {t.lower() for t in config.truthy}
        dummies = pd.DataFrame(index=df.index)
        for c in config.mr_cols:
            s = df[c]
            if pd.api.types.is_numeric_dtype(s):
                dummies[c] = (s.fillna(0) > 0).astype(int)
            else:
                dummies[c] = s.astype(str).str.strip().str.lower().isin(truthy_set).astype(int)
        return dummies, list(config.mr_cols)
    raise HTTPException(400, "Provide mr_col or mr_cols")


# ═══════════════════════════════════════════════════════════════════════════
# 1. Option frequencies (per respondent)
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/api/mr/frequencies")
async def mr_frequencies(config: MRConfig):
    try:
        df = _prepare(config.dataset_id, config.filters)
        dummies, options = _mr_to_dummies(df, config)
        n_respondents = int(((dummies.sum(axis=1)) > 0).sum())  # respondents with ≥1 choice
        if n_respondents == 0:
            raise HTTPException(400, "No respondents selected any option")

        headers = ["Option", "N respondents", "% of respondents", "% of responses", "Rank"]
        counts = dummies.sum(axis=0).sort_values(ascending=False)
        total_responses = int(counts.sum())
        rows = []
        for rank, (opt, count) in enumerate(counts.items(), start=1):
            pct_resp = count / n_respondents * 100 if n_respondents else 0
            pct_resps = count / total_responses * 100 if total_responses else 0
            rows.append([str(opt), int(count), iu.safe_round(pct_resp, 2),
                         iu.safe_round(pct_resps, 2), rank])
        rows.append([""] * len(headers))
        rows.append(["Total respondents", n_respondents, "", "", ""])
        rows.append(["Total responses", total_responses, "", "", ""])
        rows.append(["Avg options per respondent", iu.safe_round(total_responses / n_respondents, 2) if n_respondents else 0, "", "", ""])

        # Distribution of #choices-per-respondent
        per_resp = (dummies.sum(axis=1))
        per_resp = per_resp[per_resp > 0]
        dist_headers = ["# Options Chosen", "N respondents", "%"]
        dist_rows = []
        for k_val, count in per_resp.value_counts().sort_index().items():
            pct = count / len(per_resp) * 100
            dist_rows.append([int(k_val), int(count), iu.safe_round(pct, 2)])

        return {"headers": headers, "rows": sanitize_for_json(rows),
                "row_count": len(rows), "col_count": len(headers),
                "table_type": "mr_frequencies",
                "n_respondents": n_respondents, "total_responses": total_responses,
                "distribution_headers": dist_headers, "distribution_rows": sanitize_for_json(dist_rows),
                "interpretation": "% of respondents (denominator = respondents who chose ≥1). The set sums to >100% because respondents pick multiple options."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"MR frequencies error: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# 2. Co-occurrence matrix (Jaccard similarity)
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/api/mr/cooccurrence")
async def mr_cooccurrence(config: MRConfig):
    try:
        df = _prepare(config.dataset_id, config.filters)
        dummies, options = _mr_to_dummies(df, config)
        n = int(dummies.shape[0])
        if not options:
            raise HTTPException(400, "No options found")
        # Co-occurrence counts: D^T @ D (option × option)
        co = (dummies.T.values @ dummies.values).astype(int)
        # Jaccard: |A ∩ B| / |A ∪ B|
        a_or_b = co.diagonal()[:, None] + co.diagonal()[None, :] - co
        with np.errstate(divide="ignore", invalid="ignore"):
            jaccard = np.where(a_or_b > 0, co / a_or_b, 0.0)

        headers = [""] + options
        rows = []
        for i, opt in enumerate(options):
            row = [str(opt)]
            for j in range(len(options)):
                if i == j:
                    row.append(int(co[i, j]))
                else:
                    row.append(iu.safe_round(jaccard[i, j], 3))
            rows.append(row)

        # Top co-occurring pairs
        pair_rows = []
        for i in range(len(options)):
            for j in range(i + 1, len(options)):
                pair_rows.append([options[i], options[j], int(co[i, j]),
                                  iu.safe_round(jaccard[i, j], 3)])
        pair_rows.sort(key=lambda r: -(r[2] or 0))

        return {"headers": headers, "rows": sanitize_for_json(rows),
                "row_count": len(rows), "col_count": len(headers),
                "table_type": "mr_cooccurrence",
                "n": n,
                "pair_headers": ["Option A", "Option B", "Both chosen (N)", "Jaccard"],
                "pair_rows": sanitize_for_json(pair_rows[:30]),
                "interpretation": "Diagonal = how many chose each option. Off-diagonal = Jaccard similarity (0..1). Pairs with Jaccard ≥ 0.3 are commonly co-selected."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"MR co-occurrence error: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# 3. MR × Group (per-option χ² with multi-test correction)
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/api/mr/by_group")
async def mr_by_group(config: MRConfig):
    try:
        from scipy.stats import chi2_contingency
        df = _prepare(config.dataset_id, config.filters)
        if not config.group_col or config.group_col not in df.columns:
            raise HTTPException(400, "Provide a valid group_col")
        dummies, options = _mr_to_dummies(df, config)
        groups = df[config.group_col].dropna().unique()
        if len(groups) < 2:
            raise HTTPException(400, "Need ≥2 groups")

        headers = ["Option"] + [f"% {g}" for g in groups] + ["N chosen", "χ²", "Raw p", "Adj p", "Cramér's V", "Sig (adj)"]
        rows = []
        pvals = []
        details = []
        for opt in options:
            d = dummies[opt]
            ct = pd.crosstab(df[config.group_col], d)
            if ct.shape[1] < 2:
                continue
            try:
                chi2, p, dof, expected = chi2_contingency(ct)
            except Exception:
                continue
            n_total = int(ct.values.sum())
            v = iu.cramers_v(chi2, n_total, ct.shape[0], ct.shape[1])
            pcts = []
            for g in groups:
                if g not in ct.index:
                    pcts.append(0)
                    continue
                row = ct.loc[g]
                total_g = row.sum()
                chosen = row.get(1, 0) if 1 in row.index else row.iloc[-1]
                pcts.append(iu.safe_round(chosen / total_g * 100 if total_g else 0, 2))
            pvals.append(float(p))
            details.append((opt, pcts, int(d.sum()), iu.safe_round(chi2), iu.safe_round(p, 6), iu.safe_round(v)))

        adj = iu.correct_pvalues(pvals, config.correction) if pvals else []
        for (opt, pcts, n_ch, chi2, raw_p, v), adj_p in zip(details, adj):
            rows.append([str(opt), *pcts, n_ch, chi2, raw_p,
                         iu.safe_round(adj_p, 6), v, iu.sig_stars(adj_p)])

        return {"headers": headers, "rows": sanitize_for_json(rows),
                "row_count": len(rows), "col_count": len(headers),
                "table_type": "mr_by_group",
                "correction": config.correction,
                "interpretation": f"Per-option χ² across groups, {config.correction}-corrected over {len(pvals)} tests. Cramér's V ≥ 0.1 indicates a small effect."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"MR by_group error: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# 4. Exclusive selections (% who chose option X only)
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/api/mr/exclusive")
async def mr_exclusive(config: MRConfig):
    try:
        df = _prepare(config.dataset_id, config.filters)
        dummies, options = _mr_to_dummies(df, config)
        n_resp = int((dummies.sum(axis=1) > 0).sum())
        if n_resp == 0:
            raise HTTPException(400, "No respondents")
        per_resp_choices = dummies.sum(axis=1)
        headers = ["Option", "Total chose", "Chose only this", "% exclusive of choosers", "% exclusive of all"]
        rows = []
        for opt in options:
            chose = dummies[opt] == 1
            exclusive = chose & (per_resp_choices == 1)
            n_chose = int(chose.sum())
            n_exclusive = int(exclusive.sum())
            pct_of_choosers = n_exclusive / n_chose * 100 if n_chose else 0
            pct_of_all = n_exclusive / n_resp * 100
            rows.append([str(opt), n_chose, n_exclusive,
                         iu.safe_round(pct_of_choosers, 2), iu.safe_round(pct_of_all, 2)])
        rows.append([""] * len(headers))
        rows.append(["Total respondents", n_resp, "", "", ""])
        rows.append(["Single-option respondents", int((per_resp_choices == 1).sum()), "", "", ""])
        rows.append(["Multi-option respondents", int((per_resp_choices >= 2).sum()), "", "", ""])
        return {"headers": headers, "rows": sanitize_for_json(rows),
                "row_count": len(rows), "col_count": len(headers),
                "table_type": "mr_exclusive",
                "interpretation": "% exclusive of choosers = of those who chose this option, what fraction picked it as their sole answer."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"MR exclusive error: {e}")
