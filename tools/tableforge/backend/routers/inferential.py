"""Inferential statistics endpoints (Phase 1 — Survey Analysis Studio).

Each endpoint returns the standard StatTableConfig response shape so the
existing StatisticalTables modal renders without forking:
{headers, rows, row_count, col_count, table_type, test:{stat,p,df,effect_size,ci},
 interpretation, warnings}
"""

from __future__ import annotations

import math
import traceback
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from scipy import stats as sp_stats

from ..shared import datasets, sanitize_for_json, apply_metrics_and_bins, column_roles, study_designs
from . import inferential_utils as iu

router = APIRouter()


def _resolve_weights(dataset_id: str, df: pd.DataFrame):
    """Return (weights_series, weight_col_name) from StudyDesign, or (None, None)."""
    sd = study_designs.get(dataset_id) or {}
    wc = sd.get("weight_col")
    if not (isinstance(wc, str) and wc and wc in df.columns):
        return None, None
    w = pd.to_numeric(df[wc], errors="coerce")
    if w.notna().sum() == 0:
        return None, None
    return w, wc


def _wmean_sd_neff(x, w):
    """Weighted mean, SD, and effective N from a Series x with aligned weights w."""
    x = pd.to_numeric(x, errors="coerce")
    if hasattr(w, "reindex"):
        w = w.reindex(x.index)
    w = pd.to_numeric(w, errors="coerce")
    m = x.notna() & w.notna() & (w > 0)
    if m.sum() < 1:
        return float("nan"), float("nan"), 0.0
    xv = x[m].astype(float).values
    wv = w[m].astype(float).values
    sum_w = wv.sum()
    sum_w2 = (wv * wv).sum()
    n_eff = (sum_w * sum_w) / sum_w2 if sum_w2 > 0 else 0.0
    mean = float(np.average(xv, weights=wv))
    var = float(np.average((xv - mean) ** 2, weights=wv))
    return mean, float(np.sqrt(var)), float(n_eff)


class InferConfig(BaseModel):
    dataset_id: str
    columns: list[str] = []
    group_by: str = ""
    filters: dict = {}
    # Per-test extras (all optional, used by some endpoints)
    pre_col: str | None = None
    post_col: str | None = None
    paired_pairs: list[dict] | None = None  # [{pre, post}]
    method: str | None = None  # 'pearson'|'spearman'|'kendall' or correction method
    posthoc: str | None = None  # 'tukey'|'bonferroni'|'games_howell'
    weight_col: str | None = None
    outcome_col: str | None = None
    predictor_cols: list[str] | None = None
    alpha: float = 0.05  # Significance level (0.10 / 0.05 / 0.01); drives CI level + star thresholds


def _prepare(config: InferConfig) -> pd.DataFrame:
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[config.dataset_id]["df"].copy()
    df = apply_metrics_and_bins(df, config.dataset_id)
    for col, vals in (config.filters or {}).items():
        if vals and col in df.columns:
            df = df[df[col].astype(str).isin([str(v) for v in vals])]
    return df


# ═══════════════════════════════════════════════════════════════════════════
# Paired tests
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/api/stat/paired_ttest")
async def stat_paired_ttest(config: InferConfig):
    """Paired t-test on one or more pre/post pairs."""
    try:
        df = _prepare(config)
        pairs = config.paired_pairs or []
        if not pairs:
            pre = config.pre_col or (config.columns[0] if len(config.columns) >= 2 else None)
            post = config.post_col or (config.columns[1] if len(config.columns) >= 2 else None)
            if not pre or not post:
                # Fallback: pull paired_with markers from column_roles
                roles = (column_roles.get(config.dataset_id) or {})
                for c, meta in roles.items():
                    pw = (meta or {}).get("paired_with")
                    if pw and pw in df.columns and c in df.columns:
                        pairs.append({"pre": c, "post": pw})
            else:
                pairs = [{"pre": pre, "post": post}]
        if not pairs:
            raise HTTPException(400, "Specify pre_col + post_col or paired_pairs")

        w_series, w_col = _resolve_weights(config.dataset_id, df)
        if w_series is not None:
            headers = ["Pair", "N raw", "N eff", "Mean Pre (w)", "Mean Post (w)", "Mean Diff (w)", "95% CI", "t", "df", "p", "Cohen's d_z (w)", "Effect", "Sig"]
        else:
            headers = ["Pair", "N", "Mean Pre", "Mean Post", "Mean Diff", "95% CI", "t", "df", "p", "Cohen's d_z", "Effect", "Sig"]
        rows: list[list] = []
        results: list[dict] = []

        for pair in pairs:
            pre, post = pair.get("pre"), pair.get("post")
            if pre not in df.columns or post not in df.columns:
                continue
            a_full = pd.to_numeric(df[pre], errors="coerce")
            b_full = pd.to_numeric(df[post], errors="coerce")
            mask = a_full.notna() & b_full.notna()
            a, b = a_full[mask].to_numpy(), b_full[mask].to_numpy()
            if len(a) < 2:
                continue
            diffs = b - a
            t_stat, p_val = sp_stats.ttest_rel(a, b)
            dz = iu.cohens_dz(diffs)
            _a = float(config.alpha or 0.05)
            lo, hi = iu.ci_paired_diff(diffs, alpha=_a)
            sig = iu.sig_stars(p_val, _a)

            if w_series is not None:
                # Weighted descriptives + weighted d_z on diffs
                idx = a_full.index[mask]
                w_aligned = pd.to_numeric(w_series.reindex(idx), errors="coerce")
                m2 = w_aligned.notna() & (w_aligned > 0)
                if m2.sum() >= 2:
                    a_w = pd.Series(a, index=idx)[m2.values]
                    b_w = pd.Series(b, index=idx)[m2.values]
                    d_w = pd.Series(diffs, index=idx)[m2.values]
                    wv = w_aligned[m2].astype(float).values
                    sum_w = wv.sum()
                    sum_w2 = (wv * wv).sum()
                    n_eff = (sum_w * sum_w) / sum_w2 if sum_w2 > 0 else 0.0
                    wmean_a = float(np.average(a_w.values, weights=wv))
                    wmean_b = float(np.average(b_w.values, weights=wv))
                    wmean_d = float(np.average(d_w.values, weights=wv))
                    var_d = float(np.average((d_w.values - wmean_d) ** 2, weights=wv))
                    sd_d = float(np.sqrt(var_d))
                    dz_w = wmean_d / sd_d if sd_d > 0 else float("nan")
                else:
                    wmean_a = float(a.mean()); wmean_b = float(b.mean()); wmean_d = float(diffs.mean())
                    n_eff = float(len(diffs)); dz_w = dz
                rows.append([
                    f"{pre} → {post}", len(diffs), round(n_eff, 1),
                    iu.safe_round(wmean_a), iu.safe_round(wmean_b), iu.safe_round(wmean_d),
                    f"[{iu.safe_round(lo)}, {iu.safe_round(hi)}]",
                    iu.safe_round(t_stat), len(diffs) - 1, iu.safe_round(p_val, 6),
                    iu.safe_round(dz_w), iu.interpret_d(dz_w if not (isinstance(dz_w, float) and math.isnan(dz_w)) else dz), sig,
                ])
            else:
                interp_d = iu.interpret_d(dz)
                rows.append([
                    f"{pre} → {post}", len(diffs),
                    iu.safe_round(a.mean()), iu.safe_round(b.mean()), iu.safe_round(diffs.mean()),
                    f"[{iu.safe_round(lo)}, {iu.safe_round(hi)}]",
                    iu.safe_round(t_stat), len(diffs) - 1, iu.safe_round(p_val, 6),
                    iu.safe_round(dz), interp_d, sig,
                ])
            results.append({
                "pair": f"{pre} → {post}", "n": int(len(diffs)),
                "t": iu.safe_round(t_stat), "p": iu.safe_round(p_val, 6),
                "d_z": iu.safe_round(dz), "ci_lo": iu.safe_round(lo), "ci_hi": iu.safe_round(hi),
            })

        interpretation = "Paired t-test compares pre/post means within the same respondents. Cohen's d_z gauges practical magnitude (≥0.5 medium, ≥0.8 large)."
        if w_series is not None:
            interpretation += f" Means/d_z use survey weight '{w_col}'; t/p remain unweighted."
        resp = {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "paired_ttest",
                "results": results, "interpretation": interpretation}
        if w_series is not None:
            resp["weighted"] = True
            resp["weight_col"] = w_col
        return resp
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Paired t-test error: {e}")


@router.post("/api/stat/wilcoxon")
async def stat_wilcoxon(config: InferConfig):
    """Wilcoxon signed-rank (paired, non-parametric)."""
    try:
        df = _prepare(config)
        pre = config.pre_col or (config.columns[0] if len(config.columns) >= 2 else None)
        post = config.post_col or (config.columns[1] if len(config.columns) >= 2 else None)
        if not pre or not post:
            raise HTTPException(400, "Specify pre_col + post_col")
        a = pd.to_numeric(df[pre], errors="coerce")
        b = pd.to_numeric(df[post], errors="coerce")
        mask = a.notna() & b.notna()
        a, b = a[mask].to_numpy(), b[mask].to_numpy()
        if len(a) < 3:
            raise HTTPException(400, "Need ≥3 paired observations")
        try:
            stat, p_val = sp_stats.wilcoxon(a, b, zero_method="wilcox", correction=False, alternative="two-sided")
        except ValueError as e:
            raise HTTPException(400, f"Wilcoxon failed: {e}")
        rb = iu.wilcoxon_rb(stat, len(a))
        sig = iu.sig_stars(p_val)
        headers = ["Pair", "N pairs", "Median Pre", "Median Post", "Median Diff", "W", "p", "Rank-biserial r", "Sig"]
        rows = [[f"{pre} → {post}", len(a), iu.safe_round(np.median(a)), iu.safe_round(np.median(b)),
                 iu.safe_round(np.median(b - a)), iu.safe_round(stat), iu.safe_round(p_val, 6),
                 iu.safe_round(rb), sig]]
        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": 1,
                "col_count": len(headers), "table_type": "wilcoxon",
                "interpretation": "Wilcoxon signed-rank: paired non-parametric. Rank-biserial r approximates effect size on -1..1."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Wilcoxon error: {e}")


@router.post("/api/stat/mcnemar")
async def stat_mcnemar(config: InferConfig):
    """McNemar's test for paired binary data (e.g., Before vs After Yes/No)."""
    try:
        from statsmodels.stats.contingency_tables import mcnemar
        df = _prepare(config)
        pre = config.pre_col or (config.columns[0] if len(config.columns) >= 2 else None)
        post = config.post_col or (config.columns[1] if len(config.columns) >= 2 else None)
        if not pre or not post:
            raise HTTPException(400, "Specify pre_col + post_col")
        a = df[pre].astype(str).where(df[pre].notna())
        b = df[post].astype(str).where(df[post].notna())
        mask = a.notna() & b.notna()
        a, b = a[mask], b[mask]
        if len(a) < 5:
            raise HTTPException(400, "Need ≥5 paired observations")
        levels = sorted(set(a.unique()) | set(b.unique()))
        if len(levels) != 2:
            raise HTTPException(400, f"McNemar needs binary outcomes — got {len(levels)} levels")
        ct = pd.crosstab(a, b, rownames=[pre], colnames=[post])
        # Ensure 2x2
        for lv in levels:
            if lv not in ct.index:
                ct.loc[lv] = 0
            if lv not in ct.columns:
                ct[lv] = 0
        ct = ct.loc[levels, levels]
        result = mcnemar(ct.values, exact=ct.values.sum() < 25, correction=True)
        chi2, p_val = float(result.statistic), float(result.pvalue)
        # 2x2 cells: 00=a 01=b 10=c 11=d → discordant pairs
        b_cell = int(ct.iloc[0, 1])
        c_cell = int(ct.iloc[1, 0])
        odds_ratio = (b_cell / c_cell) if c_cell > 0 else float("inf")
        sig = iu.sig_stars(p_val)
        headers = [f"{pre} \\ {post}", *[str(l) for l in levels], "Row Total"]
        rows = []
        for lv in levels:
            row = [str(lv)] + [int(ct.loc[lv, c]) for c in levels] + [int(ct.loc[lv].sum())]
            rows.append(row)
        rows.append(["Total"] + [int(ct[c].sum()) for c in levels] + [int(ct.values.sum())])
        rows.append([""] * len(headers))
        rows.append(["McNemar χ²", iu.safe_round(chi2)] + [""] * (len(headers) - 2))
        rows.append(["p-value", iu.safe_round(p_val, 6)] + [""] * (len(headers) - 2))
        rows.append(["Discordant pairs", f"b={b_cell}, c={c_cell}"] + [""] * (len(headers) - 2))
        rows.append(["OR (b/c)", iu.safe_round(odds_ratio)] + [""] * (len(headers) - 2))
        rows.append(["Significance", sig] + [""] * (len(headers) - 2))
        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "mcnemar",
                "chi2": iu.safe_round(chi2), "p_value": iu.safe_round(p_val, 6),
                "interpretation": "McNemar's test detects shifts in paired binary outcomes (e.g., No→Yes vs Yes→No)."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"McNemar error: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# Non-parametric ANOVA family
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/api/stat/kruskal")
async def stat_kruskal(config: InferConfig):
    """Kruskal-Wallis H test (non-parametric ANOVA)."""
    try:
        df = _prepare(config)
        if len(config.columns) < 2:
            raise HTTPException(400, "Need group column + value column")
        group_col, value_col = config.columns[0], config.columns[1]
        groups = df[group_col].dropna().unique()
        data = [pd.to_numeric(df[df[group_col] == g][value_col], errors="coerce").dropna() for g in groups]
        data = [(g, d) for g, d in zip(groups, data) if len(d) >= 2]
        if len(data) < 2:
            raise HTTPException(400, "Need ≥2 non-empty groups")
        H, p_val = sp_stats.kruskal(*[d for _, d in data])
        k, n = len(data), sum(len(d) for _, d in data)
        eta2_h = (H - k + 1) / (n - k) if n > k else float("nan")
        sig = iu.sig_stars(p_val)
        headers = ["Group", "N", "Median", "Mean Rank", "IQR"]
        rows = []
        all_data = pd.concat([d for _, d in data])
        ranks = all_data.rank()
        offset = 0
        for g, d in data:
            r = ranks.iloc[offset:offset + len(d)].mean()
            offset += len(d)
            rows.append([str(g), len(d), iu.safe_round(d.median()), iu.safe_round(r),
                         iu.safe_round(d.quantile(0.75) - d.quantile(0.25))])
        rows.append([""] * len(headers))
        rows.append(["Kruskal H", iu.safe_round(H)] + [""] * (len(headers) - 2))
        rows.append(["df", k - 1] + [""] * (len(headers) - 2))
        rows.append(["p", iu.safe_round(p_val, 6)] + [""] * (len(headers) - 2))
        rows.append(["η²_H", iu.safe_round(eta2_h)] + [""] * (len(headers) - 2))
        rows.append(["Significance", sig] + [""] * (len(headers) - 2))
        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "kruskal",
                "H": iu.safe_round(H), "p_value": iu.safe_round(p_val, 6), "eta_squared": iu.safe_round(eta2_h),
                "interpretation": "Kruskal-Wallis: non-parametric 3+ group comparison. η²_H estimates effect size."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Kruskal-Wallis error: {e}")


@router.post("/api/stat/friedman")
async def stat_friedman(config: InferConfig):
    """Friedman test (paired non-parametric, 3+ repeated measures)."""
    try:
        df = _prepare(config)
        if len(config.columns) < 3:
            raise HTTPException(400, "Friedman needs ≥3 repeated-measures columns")
        cols = config.columns
        sub = df[cols].apply(pd.to_numeric, errors="coerce").dropna()
        if len(sub) < 3:
            raise HTTPException(400, "Need ≥3 complete cases")
        chi2, p_val = sp_stats.friedmanchisquare(*[sub[c].values for c in cols])
        n, k = len(sub), len(cols)
        kendalls_w = chi2 / (n * (k - 1)) if n > 0 and k > 1 else float("nan")
        sig = iu.sig_stars(p_val)
        ranks = sub.rank(axis=1).mean()
        headers = ["Measure", "N", "Median", "Mean Rank"]
        rows = []
        for c in cols:
            rows.append([str(c), n, iu.safe_round(sub[c].median()), iu.safe_round(ranks[c])])
        rows.append([""] * len(headers))
        rows.append(["Friedman χ²", iu.safe_round(chi2)] + [""] * (len(headers) - 2))
        rows.append(["df", k - 1] + [""] * (len(headers) - 2))
        rows.append(["p", iu.safe_round(p_val, 6)] + [""] * (len(headers) - 2))
        rows.append(["Kendall's W", iu.safe_round(kendalls_w)] + [""] * (len(headers) - 2))
        rows.append(["Significance", sig] + [""] * (len(headers) - 2))
        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "friedman",
                "chi2": iu.safe_round(chi2), "p_value": iu.safe_round(p_val, 6),
                "kendalls_w": iu.safe_round(kendalls_w),
                "interpretation": "Friedman: paired non-parametric over 3+ measures. Kendall's W (0..1) is concordance/effect size."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Friedman error: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# Non-parametric / ordinal correlation
# ═══════════════════════════════════════════════════════════════════════════

def _correlation_matrix(df: pd.DataFrame, cols: list[str], method: str) -> dict:
    method = method.lower()
    use = [c for c in cols if c in df.columns]
    if len(use) < 2:
        raise HTTPException(400, "Need ≥2 numeric columns")
    sub = df[use].apply(pd.to_numeric, errors="coerce")
    if method == "spearman":
        m = sub.corr(method="spearman")
    elif method == "kendall":
        m = sub.corr(method="kendall")
    else:
        m = sub.corr(method="pearson")
    headers = [""] + list(m.columns)
    rows = []
    for idx, row in m.iterrows():
        rows.append([str(idx)] + [iu.safe_round(v) for v in row])
    # Pairwise p + CI (Pearson only)
    pvals_rows = []
    pvals_headers = ["Pair", f"{method} r", "p", "95% CI" if method == "pearson" else "n", "Sig"]
    pair_list = [(use[i], use[j]) for i in range(len(use)) for j in range(i + 1, len(use))]
    for a, b in pair_list:
        x = pd.to_numeric(df[a], errors="coerce")
        y = pd.to_numeric(df[b], errors="coerce")
        mask = x.notna() & y.notna()
        x, y = x[mask].to_numpy(), y[mask].to_numpy()
        n = len(x)
        if n < 4:
            continue
        if method == "spearman":
            r, p = sp_stats.spearmanr(x, y)
        elif method == "kendall":
            r, p = sp_stats.kendalltau(x, y)
        else:
            r, p = sp_stats.pearsonr(x, y)
        sig = iu.sig_stars(p)
        if method == "pearson":
            lo, hi = iu.ci_pearson_r(r, n)
            extra = f"[{iu.safe_round(lo)}, {iu.safe_round(hi)}]"
        else:
            extra = n
        pvals_rows.append([f"{a} ↔ {b}", iu.safe_round(r), iu.safe_round(p, 6), extra, sig])
    return {
        "headers": headers, "rows": sanitize_for_json(rows),
        "pair_headers": pvals_headers, "pair_rows": sanitize_for_json(pvals_rows),
        "method": method,
    }


@router.post("/api/stat/spearman")
async def stat_spearman(config: InferConfig):
    """Spearman rank correlation matrix + pairwise p-values."""
    try:
        df = _prepare(config)
        cols = config.columns or [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
        result = _correlation_matrix(df, cols, "spearman")
        return {**result, "row_count": len(result["rows"]), "col_count": len(result["headers"]),
                "table_type": "spearman",
                "interpretation": "Spearman ρ uses ranks — robust to outliers and works on ordinal/Likert data."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Spearman error: {e}")


@router.post("/api/stat/kendall")
async def stat_kendall(config: InferConfig):
    """Kendall's tau correlation (robust to ties, conservative)."""
    try:
        df = _prepare(config)
        cols = config.columns or [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
        result = _correlation_matrix(df, cols, "kendall")
        return {**result, "row_count": len(result["rows"]), "col_count": len(result["headers"]),
                "table_type": "kendall",
                "interpretation": "Kendall's τ is more conservative than Spearman, preferred for small N or many ties."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Kendall error: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# Logistic + multiple regression
# ═══════════════════════════════════════════════════════════════════════════

def _resolve_regression_cols(config: InferConfig) -> tuple[str, list[str]]:
    y = config.outcome_col or (config.columns[0] if config.columns else None)
    if not y:
        raise HTTPException(400, "Specify outcome_col or pass outcome as first column")
    xs = config.predictor_cols or (config.columns[1:] if len(config.columns) > 1 else [])
    if not xs:
        raise HTTPException(400, "Specify predictor_cols or pass predictors after outcome")
    return y, xs


@router.post("/api/stat/logistic_regression")
async def stat_logistic_regression(config: InferConfig):
    """Binary logistic regression with odds ratios + 95% CI."""
    try:
        import statsmodels.api as sm
        from statsmodels.formula.api import logit
        df = _prepare(config)
        y_col, x_cols = _resolve_regression_cols(config)
        sub = df[[y_col] + x_cols].copy()
        # Encode outcome: accept numeric 0/1 or two-level categorical
        if sub[y_col].dtype == bool:
            sub[y_col] = sub[y_col].astype(int)
        else:
            try:
                sub[y_col] = pd.to_numeric(sub[y_col], errors="raise")
            except Exception:
                uniq = sub[y_col].dropna().unique()
                if len(uniq) != 2:
                    raise HTTPException(400, f"Outcome must be binary — found {len(uniq)} levels")
                sub[y_col] = (sub[y_col] == sorted(uniq, key=str)[1]).astype(int)
        # Build formula with C() for categorical predictors
        terms = []
        for c in x_cols:
            if pd.api.types.is_numeric_dtype(sub[c]):
                terms.append(f"Q('{c}')")
            else:
                terms.append(f"C(Q('{c}'))")
        formula = f"Q('{y_col}') ~ " + " + ".join(terms)
        sub = sub.dropna()
        if len(sub) < len(x_cols) + 5:
            raise HTTPException(400, f"Not enough data ({len(sub)}) for logistic regression")
        try:
            model = logit(formula, data=sub).fit(disp=False, maxiter=200)
        except Exception as e:
            raise HTTPException(400, f"Logit fit failed: {e}")
        coefs = model.params
        conf = model.conf_int()
        pvals = model.pvalues
        ors = np.exp(coefs)
        or_lo = np.exp(conf[0])
        or_hi = np.exp(conf[1])
        headers = ["Variable", "β", "SE", "z", "p", "Odds Ratio", "95% CI", "Sig"]
        rows = []
        for name in coefs.index:
            sig = iu.sig_stars(pvals[name])
            rows.append([
                str(name), iu.safe_round(coefs[name]), iu.safe_round(model.bse[name]),
                iu.safe_round(coefs[name] / model.bse[name] if model.bse[name] else 0),
                iu.safe_round(pvals[name], 6),
                iu.safe_round(ors[name]),
                f"[{iu.safe_round(or_lo[name])}, {iu.safe_round(or_hi[name])}]",
                sig,
            ])
        # Goodness-of-fit
        ll, ll_null = model.llf, model.llnull
        pseudo_r2 = 1 - ll / ll_null if ll_null else float("nan")
        aic, bic = model.aic, model.bic
        rows.append([""] * len(headers))
        rows.append(["N", int(model.nobs)] + [""] * (len(headers) - 2))
        rows.append(["Log-likelihood", iu.safe_round(ll)] + [""] * (len(headers) - 2))
        rows.append(["LL-Null", iu.safe_round(ll_null)] + [""] * (len(headers) - 2))
        rows.append(["McFadden pseudo-R²", iu.safe_round(pseudo_r2)] + [""] * (len(headers) - 2))
        rows.append(["AIC", iu.safe_round(aic)] + [""] * (len(headers) - 2))
        rows.append(["BIC", iu.safe_round(bic)] + [""] * (len(headers) - 2))
        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "logistic_regression",
                "interpretation": "OR > 1 means higher odds of the outcome per unit increase. McFadden R² ≥ 0.2 typically indicates good fit."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Logistic regression error: {e}")


@router.post("/api/stat/multiple_regression")
async def stat_multiple_regression(config: InferConfig):
    """OLS regression with categorical encoding + VIF."""
    try:
        import statsmodels.api as sm
        from statsmodels.formula.api import ols
        from statsmodels.stats.outliers_influence import variance_inflation_factor
        df = _prepare(config)
        y_col, x_cols = _resolve_regression_cols(config)
        sub = df[[y_col] + x_cols].copy()
        sub[y_col] = pd.to_numeric(sub[y_col], errors="coerce")
        terms = []
        for c in x_cols:
            if pd.api.types.is_numeric_dtype(sub[c]):
                terms.append(f"Q('{c}')")
            else:
                terms.append(f"C(Q('{c}'))")
        formula = f"Q('{y_col}') ~ " + " + ".join(terms)
        sub = sub.dropna()
        if len(sub) < len(x_cols) + 3:
            raise HTTPException(400, f"Not enough data ({len(sub)}) for regression")
        model = ols(formula, data=sub).fit()
        coefs = model.params
        ses = model.bse
        pvals = model.pvalues
        conf = model.conf_int()
        headers = ["Variable", "β", "SE", "t", "p", "95% CI", "Sig"]
        rows = []
        for name in coefs.index:
            sig = iu.sig_stars(pvals[name])
            rows.append([
                str(name), iu.safe_round(coefs[name]), iu.safe_round(ses[name]),
                iu.safe_round(model.tvalues[name]), iu.safe_round(pvals[name], 6),
                f"[{iu.safe_round(conf.loc[name, 0])}, {iu.safe_round(conf.loc[name, 1])}]",
                sig,
            ])
        # VIF — only on numeric predictors (matrix from design)
        try:
            X = model.model.exog
            vifs = []
            for i, name in enumerate(model.model.exog_names):
                if name == "Intercept":
                    continue
                try:
                    v = variance_inflation_factor(X, i)
                    vifs.append((name, v))
                except Exception:
                    vifs.append((name, float("nan")))
            if vifs:
                rows.append([""] * len(headers))
                rows.append(["VIF (multicollinearity)", "", "", "", "", "", ""])
                for name, v in vifs:
                    rows.append([str(name), iu.safe_round(v), "", "", "", "VIF>5: caution; >10: serious", ""])
        except Exception:
            pass
        summary = {
            "R²": iu.safe_round(model.rsquared),
            "Adj R²": iu.safe_round(model.rsquared_adj),
            "F": iu.safe_round(model.fvalue),
            "p (F)": iu.safe_round(model.f_pvalue, 6),
            "N": int(model.nobs),
            "AIC": iu.safe_round(model.aic),
            "BIC": iu.safe_round(model.bic),
        }
        interp = f"Model explains {model.rsquared*100:.1f}% of variance in {y_col}. "
        interp += "Overall F " + ("is" if (model.f_pvalue or 1) < 0.05 else "is NOT") + f" significant (p={iu.safe_round(model.f_pvalue, 6)})."
        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "multiple_regression",
                "summary": summary, "interpretation": interp}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Multiple regression error: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# Post-hoc, reliability, multitest
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/api/stat/posthoc")
async def stat_posthoc(config: InferConfig):
    """Post-hoc pairwise comparisons after ANOVA: Tukey HSD / Bonferroni / Games-Howell."""
    try:
        df = _prepare(config)
        if len(config.columns) < 2:
            raise HTTPException(400, "Need group column + value column")
        group_col, value_col = config.columns[0], config.columns[1]
        method = (config.posthoc or "tukey").lower()
        sub = df[[group_col, value_col]].copy()
        sub[value_col] = pd.to_numeric(sub[value_col], errors="coerce")
        sub = sub.dropna()
        if sub[group_col].nunique() < 2:
            raise HTTPException(400, "Need ≥2 groups")
        groups_data = {g: sub.loc[sub[group_col] == g, value_col].to_numpy() for g in sub[group_col].unique()}
        names = list(groups_data.keys())

        headers = ["Group 1", "Group 2", "Mean Diff", "SE", "t/q", "p (adj)", "95% CI", "Sig"]
        rows = []

        if method == "tukey":
            from statsmodels.stats.multicomp import pairwise_tukeyhsd
            res = pairwise_tukeyhsd(endog=sub[value_col], groups=sub[group_col].astype(str), alpha=0.05)
            tbl = res.summary().data[1:]
            for r in tbl:
                g1, g2, meandiff, p_adj, lo, hi, reject = r
                rows.append([str(g1), str(g2), iu.safe_round(meandiff), "",
                             "", iu.safe_round(p_adj, 6),
                             f"[{iu.safe_round(lo)}, {iu.safe_round(hi)}]",
                             iu.sig_stars(p_adj)])
        elif method == "bonferroni":
            from scipy.stats import ttest_ind
            pairs = [(names[i], names[j]) for i in range(len(names)) for j in range(i + 1, len(names))]
            raw = []
            details = []
            for g1, g2 in pairs:
                a, b = groups_data[g1], groups_data[g2]
                if len(a) < 2 or len(b) < 2:
                    continue
                t, p = ttest_ind(a, b, equal_var=False)
                se = math.sqrt(a.var(ddof=1) / len(a) + b.var(ddof=1) / len(b))
                raw.append(p)
                details.append((g1, g2, a.mean() - b.mean(), se, t))
            adj = iu.bonferroni(raw)
            for (g1, g2, md, se, t), p in zip(details, adj):
                lo, hi = iu.ci_mean_diff(groups_data[g1], groups_data[g2])
                rows.append([str(g1), str(g2), iu.safe_round(md), iu.safe_round(se),
                             iu.safe_round(t), iu.safe_round(p, 6),
                             f"[{iu.safe_round(lo)}, {iu.safe_round(hi)}]",
                             iu.sig_stars(p)])
        else:  # games_howell
            pairs = [(names[i], names[j]) for i in range(len(names)) for j in range(i + 1, len(names))]
            for g1, g2 in pairs:
                a, b = groups_data[g1], groups_data[g2]
                if len(a) < 2 or len(b) < 2:
                    continue
                m1, m2 = a.mean(), b.mean()
                v1, v2 = a.var(ddof=1), b.var(ddof=1)
                n1, n2 = len(a), len(b)
                se = math.sqrt(v1 / n1 + v2 / n2)
                if se == 0:
                    continue
                t = (m1 - m2) / se
                df_gh = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1))
                # Studentized range distribution approximation via t * sqrt(2)
                q = t * math.sqrt(2)
                # 2-sided p via studentized range
                from scipy.stats import studentized_range
                p = 1 - studentized_range.cdf(abs(q), len(names), df_gh)
                p = min(max(p, 0), 1)
                lo, hi = iu.ci_mean_diff(a, b, welch=True)
                rows.append([str(g1), str(g2), iu.safe_round(m1 - m2), iu.safe_round(se),
                             iu.safe_round(q), iu.safe_round(p, 6),
                             f"[{iu.safe_round(lo)}, {iu.safe_round(hi)}]",
                             iu.sig_stars(p)])

        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "posthoc", "method": method,
                "interpretation": f"Post-hoc ({method}): pairwise comparisons with adjusted p-values."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Post-hoc error: {e}")


@router.post("/api/stat/reliability")
async def stat_reliability(config: InferConfig):
    """Cronbach's α + item-rest correlations for a Likert scale."""
    try:
        df = _prepare(config)
        cols = config.columns
        if len(cols) < 2:
            raise HTTPException(400, "Need ≥2 items to compute reliability")
        items = df[cols].apply(pd.to_numeric, errors="coerce")
        alpha, item_rest = iu.cronbach_alpha(items)
        # Alpha if item deleted
        if_deleted = []
        for c in cols:
            rest_cols = [x for x in cols if x != c]
            a, _ = iu.cronbach_alpha(items[rest_cols])
            if_deleted.append(a)
        headers = ["Item", "N", "Mean", "SD", "Item-Rest r", "α if deleted"]
        rows = []
        cleaned = items.dropna(how="any")
        for c, ir, ad in zip(cols, item_rest, if_deleted):
            rows.append([str(c), len(cleaned),
                         iu.safe_round(cleaned[c].mean()),
                         iu.safe_round(cleaned[c].std(ddof=1)),
                         iu.safe_round(ir), iu.safe_round(ad)])
        rows.append([""] * len(headers))
        quality = "excellent" if alpha >= 0.9 else "good" if alpha >= 0.8 else "acceptable" if alpha >= 0.7 else "questionable" if alpha >= 0.6 else "poor"
        rows.append(["Cronbach's α", iu.safe_round(alpha), f"({quality})", "", "", ""])
        rows.append(["Items", len(cols), "", "", "", ""])
        rows.append(["Cases (complete)", len(cleaned), "", "", "", ""])
        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "reliability",
                "alpha": iu.safe_round(alpha),
                "interpretation": f"Cronbach's α = {iu.safe_round(alpha)} ({quality}). Item-rest r < 0.3 suggests the item may not measure the same construct."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Reliability error: {e}")


class MultitestRequest(BaseModel):
    p_values: list[float]
    labels: list[str] | None = None
    method: str = "fdr_bh"  # 'bonferroni' | 'fdr_bh' | 'holm'


@router.post("/api/stat/multitest_correction")
async def stat_multitest_correction(req: MultitestRequest):
    """Multiple-testing correction utility."""
    try:
        if not req.p_values:
            raise HTTPException(400, "p_values is empty")
        adj = iu.correct_pvalues(list(req.p_values), req.method)
        headers = ["Label", "Raw p", "Adjusted p", "Sig (raw)", "Sig (adj)"]
        rows = []
        for i, p in enumerate(req.p_values):
            lbl = req.labels[i] if req.labels and i < len(req.labels) else f"Test {i+1}"
            rows.append([str(lbl), iu.safe_round(p, 6), iu.safe_round(adj[i], 6),
                         iu.sig_stars(p), iu.sig_stars(adj[i])])
        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "multitest_correction",
                "method": req.method,
                "interpretation": f"Method: {req.method}. Adjusted p < 0.05 survives multiple-testing correction."}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Multitest correction error: {e}")
