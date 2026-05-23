from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import pandas as pd
import numpy as np
import traceback

from ..shared import datasets, sanitize_for_json, apply_metrics_and_bins, study_designs
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


def _wstats(x, w):
    """Return (n_eff, mean, sd) for weighted series. NaN-safe."""
    x = pd.to_numeric(x, errors="coerce")
    if hasattr(w, "reindex"):
        w = w.reindex(x.index)
    w = pd.to_numeric(w, errors="coerce")
    m = x.notna() & w.notna() & (w > 0)
    if m.sum() < 1:
        return 0.0, np.nan, np.nan
    xv = x[m].astype(float).values
    wv = w[m].astype(float).values
    sum_w = wv.sum()
    n_eff = (sum_w * sum_w) / (wv * wv).sum() if (wv * wv).sum() > 0 else 0.0
    mean = float(np.average(xv, weights=wv))
    var = float(np.average((xv - mean) ** 2, weights=wv))
    return float(n_eff), mean, float(np.sqrt(var))


# ═══════════════════════════════════════════════════
# Statistical Table Generators
# ═══════════════════════════════════════════════════

class StatTableConfig(BaseModel):
    dataset_id: str
    columns: list[str] = []
    group_by: str = ""
    filters: dict = {}
    method: str | None = None  # 'pearson' | 'spearman' | 'kendall' (correlation only)
    alpha: float = 0.05         # Significance level (0.10 / 0.05 / 0.01); drives CI level + star thresholds

@router.post("/api/stat/correlation")
async def stat_correlation(config: StatTableConfig):
    """Generate correlation matrix for selected numeric columns."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        df = datasets[config.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, config.dataset_id)
        # Filter
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]
        # Select numeric columns
        num_cols = config.columns if config.columns else [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
        if len(num_cols) < 2:
            raise HTTPException(400, "Need at least 2 numeric columns for correlation")
        method = (config.method or "pearson").lower()
        if method not in ("pearson", "spearman", "kendall"):
            method = "pearson"

        w_series, w_col = _resolve_weights(config.dataset_id, df)
        weighted_note = None
        if w_series is not None and method == "pearson":
            # Weighted Pearson correlation matrix
            w = pd.to_numeric(w_series.reindex(df.index), errors="coerce")
            mat = np.full((len(num_cols), len(num_cols)), np.nan)
            for i, ci in enumerate(num_cols):
                for j, cj in enumerate(num_cols):
                    if i == j:
                        mat[i, j] = 1.0
                        continue
                    xi = pd.to_numeric(df[ci], errors="coerce")
                    xj = pd.to_numeric(df[cj], errors="coerce")
                    m = xi.notna() & xj.notna() & w.notna() & (w > 0)
                    if m.sum() < 2:
                        continue
                    xv = xi[m].astype(float).values
                    yv = xj[m].astype(float).values
                    wv = w[m].astype(float).values
                    mx = np.average(xv, weights=wv)
                    my = np.average(yv, weights=wv)
                    cov = np.average((xv - mx) * (yv - my), weights=wv)
                    vx = np.average((xv - mx) ** 2, weights=wv)
                    vy = np.average((yv - my) ** 2, weights=wv)
                    den = float(np.sqrt(vx * vy))
                    mat[i, j] = cov / den if den > 0 else np.nan
            corr = pd.DataFrame(mat, index=num_cols, columns=num_cols).round(4)
        else:
            if w_series is not None and method in ("spearman", "kendall"):
                weighted_note = f"Spearman/Kendall use unweighted ranks; weight '{w_col}' not applied."
            corr = df[num_cols].corr(method=method).round(4)
        headers = [""] + list(corr.columns)
        rows = []
        for idx, row in corr.iterrows():
            rows.append([str(idx)] + [round(v, 4) if not pd.isna(v) else None for v in row])
        resp = {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "correlation", "method": method}
        if w_series is not None and method == "pearson":
            resp["weighted"] = True
            resp["weight_col"] = w_col
        if weighted_note:
            resp["interpretation"] = weighted_note
        return resp
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Correlation error: {str(e)}")


@router.post("/api/stat/descriptive")
async def stat_descriptive(config: StatTableConfig):
    """Generate descriptive statistics table (Table 1 style)."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        df = datasets[config.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, config.dataset_id)
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        num_cols = config.columns if config.columns else [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
        if not num_cols:
            raise HTTPException(400, "No numeric columns found")

        w_series, w_col = _resolve_weights(config.dataset_id, df)
        stats = df[num_cols].describe().T
        stats["missing"] = df[num_cols].isnull().sum().values
        stats["missing_%"] = (df[num_cols].isnull().sum() / len(df) * 100).round(2).values

        headers = ["Variable", "N", "Mean", "Std Dev", "Min", "25%", "50%", "75%", "Max", "Missing", "Missing %"]
        if w_series is not None:
            headers = ["Variable", "N (raw)", "N (eff)", "Mean", "Std Dev", "Min", "25%", "50%", "75%", "Max", "Missing", "Missing %"]
        rows = []
        for var_name in stats.index:
            s = stats.loc[var_name]
            if w_series is not None:
                n_eff, wmean, wsd = _wstats(df[var_name], w_series)
                rows.append([
                    str(var_name),
                    int(s["count"]) if not pd.isna(s["count"]) else 0,
                    round(n_eff, 1) if not np.isnan(n_eff) else 0,
                    round(wmean, 4) if not np.isnan(wmean) else None,
                    round(wsd, 4) if not np.isnan(wsd) else None,
                    round(s["min"], 4) if not pd.isna(s["min"]) else None,
                    round(s["25%"], 4) if not pd.isna(s["25%"]) else None,
                    round(s["50%"], 4) if not pd.isna(s["50%"]) else None,
                    round(s["75%"], 4) if not pd.isna(s["75%"]) else None,
                    round(s["max"], 4) if not pd.isna(s["max"]) else None,
                    int(s["missing"]) if not pd.isna(s["missing"]) else 0,
                    round(s["missing_%"], 2) if not pd.isna(s["missing_%"]) else 0,
                ])
            else:
                rows.append([
                    str(var_name),
                    int(s["count"]) if not pd.isna(s["count"]) else 0,
                    round(s["mean"], 4) if not pd.isna(s["mean"]) else None,
                    round(s["std"], 4) if not pd.isna(s["std"]) else None,
                    round(s["min"], 4) if not pd.isna(s["min"]) else None,
                    round(s["25%"], 4) if not pd.isna(s["25%"]) else None,
                    round(s["50%"], 4) if not pd.isna(s["50%"]) else None,
                    round(s["75%"], 4) if not pd.isna(s["75%"]) else None,
                    round(s["max"], 4) if not pd.isna(s["max"]) else None,
                    int(s["missing"]) if not pd.isna(s["missing"]) else 0,
                    round(s["missing_%"], 2) if not pd.isna(s["missing_%"]) else 0,
                ])
        resp = {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows), "col_count": len(headers), "table_type": "descriptive"}
        if w_series is not None:
            resp["weighted"] = True
            resp["weight_col"] = w_col
        return resp
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Descriptive stats error: {str(e)}")


@router.post("/api/stat/crosstab")
async def stat_crosstab(config: StatTableConfig):
    """Generate cross-tabulation with chi-square test."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        df = datasets[config.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, config.dataset_id)
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        if len(config.columns) < 2:
            raise HTTPException(400, "Need exactly 2 categorical columns for cross-tab")

        row_col, col_col = config.columns[0], config.columns[1]
        w_series, w_col = _resolve_weights(config.dataset_id, df)

        # Chi-square test
        from scipy.stats import chi2_contingency, fisher_exact
        if w_series is not None:
            # Weighted contingency: cells are sum of weights
            sub = df[[row_col, col_col]].copy()
            sub["__w__"] = pd.to_numeric(w_series.reindex(df.index), errors="coerce")
            sub = sub.dropna(subset=[row_col, col_col, "__w__"])
            sub = sub[sub["__w__"] > 0]
            ct_w = sub.pivot_table(index=row_col, columns=col_col, values="__w__", aggfunc="sum", fill_value=0)
            sum_w = float(sub["__w__"].sum())
            sum_w2 = float((sub["__w__"] ** 2).sum())
            n_raw = int(len(sub))
            n_eff = (sum_w * sum_w) / sum_w2 if sum_w2 > 0 else float(n_raw)
            # Rescale weighted contingency to effective N for honest chi-square
            scale = (n_eff / sum_w) if sum_w > 0 else 1.0
            ct_no_margins = ct_w * scale
            chi2, p_value, dof, expected = chi2_contingency(ct_no_margins.values)
            ct = ct_w.copy()
            ct["Total"] = ct.sum(axis=1)
            ct.loc["Total"] = ct.sum(axis=0)
            n_total = int(round(n_eff))
        else:
            ct = pd.crosstab(df[row_col], df[col_col], margins=True, margins_name="Total")
            ct_no_margins = pd.crosstab(df[row_col], df[col_col])
            chi2, p_value, dof, expected = chi2_contingency(ct_no_margins)
            n_total = int(ct_no_margins.values.sum())
        r_dim, c_dim = ct_no_margins.shape
        v = iu.cramers_v(chi2, n_total, r_dim, c_dim)
        # Fisher's exact (only valid for 2×2). Also flag small expected counts.
        fisher_p = None
        if r_dim == 2 and c_dim == 2:
            try:
                _, fisher_p = fisher_exact(ct_no_margins.values)
            except Exception:
                fisher_p = None
        small_expected = int((expected < 5).sum())
        _a = float(config.alpha or 0.05)

        headers = [""] + [str(c) for c in ct.columns]
        rows = []
        for idx, row in ct.iterrows():
            if w_series is not None:
                rows.append([str(idx)] + [round(float(v_cell), 2) if not pd.isna(v_cell) else 0 for v_cell in row])
            else:
                rows.append([str(idx)] + [int(v_cell) if not pd.isna(v_cell) else 0 for v_cell in row])

        # Add test results as footer rows
        rows.append([""] * len(headers))
        rows.append(["Chi-Square", round(chi2, 4)] + [""] * (len(headers) - 2))
        rows.append(["p-value", round(p_value, 6)] + [""] * (len(headers) - 2))
        rows.append(["df", int(dof)] + [""] * (len(headers) - 2))
        rows.append(["Cramér's V", iu.safe_round(v), f"({iu.interpret_v(v)})"] + [""] * (len(headers) - 3))
        rows.append(["N", n_total] + [""] * (len(headers) - 2))
        if fisher_p is not None:
            rows.append(["Fisher's exact p", round(fisher_p, 6)] + [""] * (len(headers) - 2))
        if small_expected > 0:
            rows.append([f"⚠ {small_expected} cell(s) with expected < 5", "use Fisher for 2×2"] + [""] * (len(headers) - 2))
        sig = iu.sig_stars(p_value, _a)
        rows.append([f"Significance (α={_a})", sig] + [""] * (len(headers) - 2))

        resp = {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows), "col_count": len(headers),
                "table_type": "crosstab", "chi2": round(chi2, 4), "p_value": round(p_value, 6), "dof": int(dof),
                "cramers_v": iu.safe_round(v), "fisher_p": iu.safe_round(fisher_p, 6) if fisher_p is not None else None,
                "n": n_total}
        if w_series is not None:
            resp["weighted"] = True
            resp["weight_col"] = w_col
            resp["n_raw"] = n_raw
            resp["n_eff"] = round(float(n_eff), 1)
            rows.append(["Weighted: " + str(w_col), f"N raw={n_raw}, N eff={round(n_eff,1)}"] + [""] * (len(headers) - 2))
        return resp
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Cross-tab error: {str(e)}")


@router.post("/api/stat/ttest")
async def stat_ttest(config: StatTableConfig):
    """Perform t-test or Mann-Whitney U test between two groups."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        df = datasets[config.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, config.dataset_id)
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        if len(config.columns) < 2:
            raise HTTPException(400, "Need group column and value column")

        group_col, value_col = config.columns[0], config.columns[1]
        groups = df[group_col].dropna().unique()
        if len(groups) < 2:
            raise HTTPException(400, "Need at least 2 groups for comparison")

        from scipy.stats import ttest_ind, mannwhitneyu, shapiro, levene
        import numpy as _np

        w_series, w_col = _resolve_weights(config.dataset_id, df)
        results_rows = []
        if w_series is not None:
            headers = ["Comparison", "N1 raw", "N1 eff", "N2 raw", "N2 eff", "Mean 1", "Mean 2", "Diff", "95% CI",
                       "stat", "p", "Cohen's d", "Hedges' g", "Effect", "Test"]
        else:
            headers = ["Comparison", "N1", "N2", "Mean 1", "Mean 2", "Diff", "95% CI",
                       "stat", "p", "Cohen's d", "Hedges' g", "Effect", "Test"]

        # Pairwise comparisons for first few groups
        group_pairs = [(groups[i], groups[j]) for i in range(min(len(groups), 5)) for j in range(i+1, min(len(groups), 5))]

        for g1, g2 in group_pairs:
            mask1 = df[group_col] == g1
            mask2 = df[group_col] == g2
            d1 = pd.to_numeric(df[mask1][value_col], errors="coerce").dropna().to_numpy()
            d2 = pd.to_numeric(df[mask2][value_col], errors="coerce").dropna().to_numpy()
            if len(d1) < 2 or len(d2) < 2:
                continue

            # Check normality
            try:
                _, p_norm1 = shapiro(d1[:5000])
                _, p_norm2 = shapiro(d2[:5000])
                is_normal = p_norm1 > 0.05 and p_norm2 > 0.05
            except Exception:
                is_normal = len(d1) > 30 and len(d2) > 30

            # Variance equality (decides Student vs Welch)
            try:
                _, p_lev = levene(d1, d2, center="median")
                equal_var = p_lev > 0.05
            except Exception:
                equal_var = False

            if is_normal:
                stat, p_val = ttest_ind(d1, d2, equal_var=equal_var)
                test_name = "Student t" if equal_var else "Welch's t"
            else:
                stat, p_val = mannwhitneyu(d1, d2, alternative="two-sided")
                test_name = "Mann-Whitney"

            d = iu.cohens_d(d1, d2)
            g = iu.hedges_g(d1, d2)
            _a = float(config.alpha or 0.05)
            lo, hi = iu.ci_mean_diff(d1, d2, alpha=_a, welch=not equal_var)
            sig = iu.sig_stars(p_val, _a)
            if w_series is not None:
                n1_eff, m1_w, sd1_w = _wstats(df.loc[mask1, value_col], w_series)
                n2_eff, m2_w, sd2_w = _wstats(df.loc[mask2, value_col], w_series)
                # Weighted Cohen's d (pooled SD)
                if not (np.isnan(sd1_w) or np.isnan(sd2_w)):
                    pooled = np.sqrt(((n1_eff - 1) * sd1_w ** 2 + (n2_eff - 1) * sd2_w ** 2) / max(n1_eff + n2_eff - 2, 1))
                    d_w = (m1_w - m2_w) / pooled if pooled > 0 else float("nan")
                else:
                    d_w = float("nan")
                results_rows.append([
                    f"{g1} vs {g2}", len(d1), round(n1_eff, 1), len(d2), round(n2_eff, 1),
                    iu.safe_round(m1_w), iu.safe_round(m2_w),
                    iu.safe_round(m1_w - m2_w),
                    f"[{iu.safe_round(lo)}, {iu.safe_round(hi)}]",
                    iu.safe_round(stat), iu.safe_round(p_val, 6),
                    iu.safe_round(d_w), iu.safe_round(g),
                    iu.interpret_d(d_w if not np.isnan(d_w) else d), test_name,
                ])
            else:
                results_rows.append([
                    f"{g1} vs {g2}", len(d1), len(d2),
                    iu.safe_round(d1.mean()), iu.safe_round(d2.mean()),
                    iu.safe_round(d1.mean() - d2.mean()),
                    f"[{iu.safe_round(lo)}, {iu.safe_round(hi)}]",
                    iu.safe_round(stat), iu.safe_round(p_val, 6),
                    iu.safe_round(d), iu.safe_round(g),
                    iu.interpret_d(d), test_name,
                ])

        interp = "Welch's t-test runs by default unless Levene's test indicates equal variance. Cohen's d ≥0.2 small, ≥0.5 medium, ≥0.8 large."
        if w_series is not None:
            interp += f" Means/SDs/Cohen's d use survey weight '{w_col}'; p-values are unweighted (use Stata svy: ttest for design-based SE)."
        resp = {"headers": headers, "rows": sanitize_for_json(results_rows), "row_count": len(results_rows),
                "col_count": len(headers), "table_type": "ttest", "interpretation": interp}
        if w_series is not None:
            resp["weighted"] = True
            resp["weight_col"] = w_col
        return resp
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"t-test error: {str(e)}")


@router.post("/api/stat/anova")
async def stat_anova(config: StatTableConfig):
    """Perform one-way ANOVA."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        df = datasets[config.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, config.dataset_id)
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        if len(config.columns) < 2:
            raise HTTPException(400, "Need group column and value column")

        group_col, value_col = config.columns[0], config.columns[1]
        from scipy.stats import f_oneway, levene

        w_series, w_col = _resolve_weights(config.dataset_id, df)
        groups = df[group_col].dropna().unique()
        group_data = [(g, pd.to_numeric(df[df[group_col] == g][value_col], errors="coerce").dropna()) for g in groups]
        group_data = [(g, d) for g, d in group_data if len(d) > 0]

        if len(group_data) < 2:
            raise HTTPException(400, "Need at least 2 non-empty groups")

        # Levene's homogeneity test
        try:
            _, p_lev = levene(*[d.to_numpy() for _, d in group_data], center="median")
            equal_var = p_lev > 0.05
        except Exception:
            p_lev = None
            equal_var = True

        f_stat, p_value = f_oneway(*[d for _, d in group_data])
        _a = float(config.alpha or 0.05)
        sig = iu.sig_stars(p_value, _a)

        # Welch's ANOVA (separate-variances) when Levene fails
        welch_f = welch_p = welch_df = None
        if not equal_var:
            try:
                # Welch via manual formula
                ks = [len(d) for _, d in group_data]
                ms = [d.mean() for _, d in group_data]
                vs = [d.var(ddof=1) for _, d in group_data]
                ws = [n / v if v > 0 else 0 for n, v in zip(ks, vs)]
                W = sum(ws)
                grand = sum(w * m for w, m in zip(ws, ms)) / W if W else 0
                k = len(group_data)
                num = sum(w * (m - grand) ** 2 for w, m in zip(ws, ms)) / (k - 1)
                den = 1 + (2 * (k - 2) / (k ** 2 - 1)) * sum((1 - w / W) ** 2 / (n - 1) for w, n in zip(ws, ks))
                welch_f = num / den if den else float("nan")
                welch_df = (k ** 2 - 1) / (3 * sum((1 - w / W) ** 2 / (n - 1) for w, n in zip(ws, ks)))
                from scipy.stats import f as f_dist
                welch_p = 1 - f_dist.cdf(welch_f, k - 1, welch_df) if welch_df and welch_f else None
            except Exception:
                welch_f = welch_p = welch_df = None

        # Build ANOVA summary table
        n_total = sum(len(d) for _, d in group_data)
        grand_mean = df[value_col].dropna().mean()
        ss_between = sum(len(d) * (d.mean() - grand_mean) ** 2 for _, d in group_data)
        ss_within = sum(((d - d.mean()) ** 2).sum() for _, d in group_data)
        ss_total = ss_between + ss_within
        df_between = len(group_data) - 1
        df_within = n_total - len(group_data)
        ms_between = ss_between / max(df_between, 1)
        ms_within = ss_within / max(df_within, 1)
        eta2 = iu.eta_squared(ss_between, ss_total)
        omega2 = iu.omega_squared(ss_between, df_between, ms_within, n_total)

        headers = ["Source", "SS", "df", "MS", "F", "p-value", "Sig"]
        rows = [
            ["Between Groups", round(ss_between, 4), df_between, round(ms_between, 4), round(f_stat, 4), round(p_value, 6), sig],
            ["Within Groups", round(ss_within, 4), df_within, round(ms_within, 4), "", "", ""],
            ["Total", round(ss_total, 4), n_total - 1, "", "", "", ""],
        ]
        if welch_f is not None and welch_p is not None:
            rows.append(["Welch's F (unequal var)", "", iu.safe_round(welch_df), "", iu.safe_round(welch_f), iu.safe_round(welch_p, 6), iu.sig_stars(welch_p, _a)])
        rows.append([""] * len(headers))
        rows.append(["η² (eta-squared)", iu.safe_round(eta2), f"({iu.interpret_eta(eta2)})", "", "", "", ""])
        rows.append(["ω² (omega-squared)", iu.safe_round(omega2), "", "", "", "", ""])
        if p_lev is not None:
            rows.append(["Levene p", iu.safe_round(p_lev, 6), "(equal var)" if equal_var else "(unequal — use Welch)", "", "", "", ""])

        # Group descriptives (weighted when survey weight set)
        rows.append([""] * len(headers))
        if w_series is not None:
            rows.append(["Group", "N raw", "N eff", "Mean (w)", "SD (w)", "Min", "Max"])
            for g_name, g_data in group_data:
                mask = df[group_col] == g_name
                n_eff, wmean, wsd = _wstats(df.loc[mask, value_col], w_series)
                rows.append([
                    str(g_name), len(g_data), round(n_eff, 1),
                    iu.safe_round(wmean), iu.safe_round(wsd),
                    round(g_data.min(), 4), round(g_data.max(), 4),
                ])
        else:
            rows.append(["Group", "N", "Mean", "Std Dev", "Min", "Max", ""])
            for g_name, g_data in group_data:
                rows.append([
                    str(g_name), len(g_data), round(g_data.mean(), 4),
                    round(g_data.std(), 4), round(g_data.min(), 4), round(g_data.max(), 4), ""
                ])

        interp = "η² ≥0.01 small, ≥0.06 medium, ≥0.14 large. If Levene's p<.05, use Welch's F (separate-variances)."
        if w_series is not None:
            interp += f" Group means/SDs use survey weight '{w_col}'; F/p are unweighted."
        resp = {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "anova",
                "f_stat": round(f_stat, 4), "p_value": round(p_value, 6),
                "eta_squared": iu.safe_round(eta2), "omega_squared": iu.safe_round(omega2),
                "welch_f": iu.safe_round(welch_f), "welch_p": iu.safe_round(welch_p, 6) if welch_p else None,
                "interpretation": interp}
        if w_series is not None:
            resp["weighted"] = True
            resp["weight_col"] = w_col
        return resp
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"ANOVA error: {str(e)}")


@router.post("/api/stat/regression")
async def stat_regression(config: StatTableConfig):
    """Perform OLS linear regression. First column = dependent (Y), rest = independent (X)."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        df = datasets[config.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, config.dataset_id)
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        if len(config.columns) < 2:
            raise HTTPException(400, "Need at least 1 dependent + 1 independent variable")

        y_col = config.columns[0]
        x_cols = config.columns[1:]

        # Ensure numeric
        for c in [y_col] + x_cols:
            df[c] = pd.to_numeric(df[c], errors="coerce")
        w_series, w_col = _resolve_weights(config.dataset_id, df)
        keep_cols = [y_col] + x_cols
        if w_series is not None:
            df_clean = df[keep_cols].copy()
            df_clean["__w__"] = pd.to_numeric(w_series.reindex(df.index), errors="coerce")
            df_clean = df_clean.dropna()
            df_clean = df_clean[df_clean["__w__"] > 0]
            w_arr = df_clean["__w__"].values
            df_clean = df_clean[keep_cols]
        else:
            df_clean = df[keep_cols].dropna()
            w_arr = None

        if len(df_clean) < len(x_cols) + 2:
            raise HTTPException(400, f"Not enough data points ({len(df_clean)}) for regression")

        from scipy import stats as sp_stats

        Y = df_clean[y_col].values
        X = np.column_stack([np.ones(len(Y))] + [df_clean[c].values for c in x_cols])
        n = len(Y)
        k = len(x_cols)

        # OLS or WLS
        try:
            if w_arr is not None:
                sw = np.sqrt(w_arr)
                Xw = X * sw[:, None]
                Yw = Y * sw
                beta = np.linalg.lstsq(Xw, Yw, rcond=None)[0]
            else:
                beta = np.linalg.lstsq(X, Y, rcond=None)[0]
        except np.linalg.LinAlgError:
            raise HTTPException(400, "Singular matrix — cannot compute regression")

        Y_pred = X @ beta
        residuals = Y - Y_pred
        if w_arr is not None:
            ss_res = float((w_arr * residuals ** 2).sum())
            wmean = float(np.average(Y, weights=w_arr))
            ss_tot = float((w_arr * (Y - wmean) ** 2).sum())
        else:
            ss_res = float((residuals ** 2).sum())
            ss_tot = float(((Y - Y.mean()) ** 2).sum())
        r_squared = 1 - ss_res / ss_tot if ss_tot != 0 else 0
        adj_r_sq = 1 - (1 - r_squared) * (n - 1) / max(n - k - 1, 1)
        mse = ss_res / max(n - k - 1, 1)
        rmse = np.sqrt(mse)

        # F-statistic
        ss_reg = ss_tot - ss_res
        f_stat = (ss_reg / max(k, 1)) / max(mse, 1e-15)
        from scipy.stats import f as f_dist
        p_f = 1 - f_dist.cdf(f_stat, k, max(n - k - 1, 1))

        # Standard errors and t-stats for coefficients
        try:
            if w_arr is not None:
                XtWX_inv = np.linalg.inv(X.T @ np.diag(w_arr) @ X)
                var_beta = mse * XtWX_inv.diagonal()
            else:
                var_beta = mse * np.linalg.inv(X.T @ X).diagonal()
            se_beta = np.sqrt(np.abs(var_beta))
        except:
            se_beta = np.zeros(k + 1)

        _a = float(config.alpha or 0.05)
        headers = ["Variable", "Coefficient", "Std Error", "t-Stat", "p-value", "Sig"]
        rows = []
        var_names = ["(Intercept)"] + x_cols
        for i, name in enumerate(var_names):
            coef = beta[i]
            se = se_beta[i] if i < len(se_beta) else 0
            t_stat = coef / se if se > 1e-15 else 0
            p_val = 2 * (1 - sp_stats.t.cdf(abs(t_stat), max(n - k - 1, 1)))
            sig = iu.sig_stars(p_val, _a)
            rows.append([name, round(coef, 6), round(se, 6), round(t_stat, 4), round(p_val, 6), sig])

        summary = {
            "R²": round(r_squared, 4),
            "Adj R²": round(adj_r_sq, 4),
            "RMSE": round(rmse, 4),
            "F-stat": round(f_stat, 4),
            "p (F)": round(p_f, 6),
            "N": n,
        }
        if w_arr is not None:
            sum_w = float(w_arr.sum())
            sum_w2 = float((w_arr ** 2).sum())
            n_eff = (sum_w * sum_w) / sum_w2 if sum_w2 > 0 else float(n)
            summary["N (eff)"] = round(n_eff, 1)
        interp = f"The model explains {r_squared*100:.1f}% of variance in {y_col}. "
        if p_f < 0.05:
            interp += f"The overall model is statistically significant (F={f_stat:.2f}, p={p_f:.4f})."
        else:
            interp += f"The overall model is NOT statistically significant (p={p_f:.4f})."
        if w_arr is not None:
            interp += f" Weighted (WLS) using '{w_col}'; SEs are model-based (not design-based linearized)."

        resp = {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "regression",
                "summary": summary, "interpretation": interp}
        if w_arr is not None:
            resp["weighted"] = True
            resp["weight_col"] = w_col
        return resp
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Regression error: {str(e)}")


@router.post("/api/stat/normality")
async def stat_normality(config: StatTableConfig):
    """Test normality of selected numeric columns (Shapiro-Wilk + K-S tests)."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        df = datasets[config.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, config.dataset_id)
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        num_cols = config.columns if config.columns else [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
        if not num_cols:
            raise HTTPException(400, "No numeric columns selected")

        from scipy.stats import shapiro, kstest, skew, kurtosis

        headers = ["Variable", "N", "Mean", "Std Dev", "Skewness", "Kurtosis",
                    "Shapiro W", "Shapiro p", "K-S Stat", "K-S p", "Normal?"]
        rows = []
        for col in num_cols:
            data = pd.to_numeric(df[col], errors="coerce").dropna()
            if len(data) < 3:
                rows.append([str(col), len(data)] + [None]*9)
                continue

            n = len(data)
            mean_val = data.mean()
            std_val = data.std()
            skew_val = float(skew(data))
            kurt_val = float(kurtosis(data))

            # Shapiro-Wilk (max 5000 samples)
            sample = data.values[:5000]
            try:
                sw_stat, sw_p = shapiro(sample)
            except:
                sw_stat, sw_p = None, None

            # Kolmogorov-Smirnov
            try:
                ks_stat, ks_p = kstest(data, 'norm', args=(mean_val, std_val))
            except:
                ks_stat, ks_p = None, None

            is_normal = "Yes" if (sw_p and sw_p > 0.05) else "No"

            rows.append([
                str(col), n,
                round(mean_val, 4), round(std_val, 4),
                round(skew_val, 4), round(kurt_val, 4),
                round(sw_stat, 4) if sw_stat else None,
                round(sw_p, 6) if sw_p else None,
                round(ks_stat, 4) if ks_stat else None,
                round(ks_p, 6) if ks_p else None,
                is_normal,
            ])

        normal_count = sum(1 for r in rows if r[-1] == "Yes")
        interp = f"{normal_count}/{len(rows)} variables appear normally distributed (Shapiro-Wilk p>0.05). "
        interp += "Non-normal variables may need transformation or non-parametric tests."
        w_series, w_col = _resolve_weights(config.dataset_id, df)
        resp = {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "normality", "interpretation": interp}
        if w_series is not None:
            resp["weighted"] = False
            resp["weight_col"] = w_col
            resp["weights_note"] = f"Normality tests use unweighted data; weight '{w_col}' not applied (no standard weighted Shapiro/K-S)."
        return resp
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Normality test error: {str(e)}")


@router.post("/api/stat/outlier")
async def stat_outlier(config: StatTableConfig):
    """Detect outliers using IQR and Z-score methods."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        df = datasets[config.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, config.dataset_id)
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        num_cols = config.columns if config.columns else [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
        if not num_cols:
            raise HTTPException(400, "No numeric columns selected")

        headers = ["Variable", "N", "Mean", "Std Dev", "Q1", "Q3", "IQR",
                    "Lower Fence", "Upper Fence", "IQR Outliers", "Z>3 Outliers", "% Outliers"]
        rows = []
        total_outliers = 0
        total_n = 0

        for col in num_cols:
            data = pd.to_numeric(df[col], errors="coerce").dropna()
            if len(data) < 4:
                rows.append([str(col), len(data)] + [None]*10)
                continue

            n = len(data)
            mean_val = data.mean()
            std_val = data.std()
            q1 = data.quantile(0.25)
            q3 = data.quantile(0.75)
            iqr = q3 - q1
            lower = q1 - 1.5 * iqr
            upper = q3 + 1.5 * iqr
            iqr_outliers = int(((data < lower) | (data > upper)).sum())
            z_outliers = int((((data - mean_val).abs() / max(std_val, 1e-15)) > 3).sum())
            pct = round(max(iqr_outliers, z_outliers) / n * 100, 2)
            total_outliers += max(iqr_outliers, z_outliers)
            total_n += n

            rows.append([
                str(col), n,
                round(mean_val, 4), round(std_val, 4),
                round(q1, 4), round(q3, 4), round(iqr, 4),
                round(lower, 4), round(upper, 4),
                iqr_outliers, z_outliers, pct,
            ])

        pct_total = round(total_outliers / max(total_n, 1) * 100, 2)
        interp = f"Found {total_outliers} potential outliers across {len(rows)} variables ({pct_total}% of data). "
        interp += "Consider investigating outliers before statistical analysis."
        w_series, w_col = _resolve_weights(config.dataset_id, df)
        resp = {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "outlier", "interpretation": interp}
        if w_series is not None:
            resp["weighted"] = False
            resp["weight_col"] = w_col
            resp["weights_note"] = f"Outlier detection runs on unweighted values; weight '{w_col}' not applied to IQR/Z-score."
        return resp
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Outlier detection error: {str(e)}")


@router.post("/api/stat/frequency")
async def stat_frequency(config: StatTableConfig):
    """Generate frequency distribution table for selected columns."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        df = datasets[config.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, config.dataset_id)
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        if not config.columns:
            raise HTTPException(400, "Select at least one column")

        w_series, w_col = _resolve_weights(config.dataset_id, df)
        all_rows = []
        for col_name in config.columns:
            if col_name not in df.columns:
                continue

            if w_series is not None:
                w = pd.to_numeric(w_series.reindex(df.index), errors="coerce").fillna(0)
                vals = df[col_name].fillna("(Missing)").astype(str)
                # Weighted count (sum of weights per value), raw count for n_eff
                wc = pd.DataFrame({"val": vals, "w": w})
                wc = wc[wc["w"] > 0]
                grp = wc.groupby("val")
                weighted = grp["w"].sum()
                raw = grp.size()
                sum_w2 = grp["w"].apply(lambda s: (s ** 2).sum())
                total_w = float(weighted.sum())
                total_raw = int(raw.sum())
                # Sort by weighted count desc
                weighted = weighted.sort_values(ascending=False)
                cum_w = 0.0
                all_rows.append([f"— {col_name} (weighted) —", "", "", "", "", "", ""])
                for val_name, w_val in weighted.items():
                    n_raw = int(raw[val_name])
                    sw2 = float(sum_w2[val_name])
                    n_eff = (w_val * w_val) / sw2 if sw2 > 0 else 0
                    cum_w += w_val
                    pct = round(w_val / total_w * 100, 2) if total_w > 0 else 0
                    cum_pct = round(cum_w / total_w * 100, 2) if total_w > 0 else 0
                    all_rows.append([str(val_name), n_raw, round(n_eff, 1), round(w_val, 2), pct, round(cum_w, 2), cum_pct])
                all_rows.append(["Total", total_raw, round(total_raw, 1), round(total_w, 2), 100.0, round(total_w, 2), 100.0])
                if col_name != config.columns[-1]:
                    all_rows.append(["", "", "", "", "", "", ""])
            else:
                vc = df[col_name].fillna("(Missing)").astype(str).value_counts()
                total = vc.sum()
                cum_count = 0

                all_rows.append([f"— {col_name} —", "", "", "", ""])

                for val, count in vc.items():
                    cum_count += count
                    pct = round(count / total * 100, 2) if total > 0 else 0
                    cum_pct = round(cum_count / total * 100, 2) if total > 0 else 0
                    all_rows.append([str(val), int(count), pct, int(cum_count), cum_pct])

                all_rows.append(["Total", int(total), 100.0, int(total), 100.0])
                if col_name != config.columns[-1]:
                    all_rows.append(["", "", "", "", ""])

        if w_series is not None:
            headers = ["Value", "Freq (raw)", "N eff", "Freq (w)", "Percent (%)", "Cum Freq (w)", "Cumulative %"]
        else:
            headers = ["Value", "Frequency", "Percent (%)", "Cumulative Freq", "Cumulative %"]
        resp = {"headers": headers, "rows": sanitize_for_json(all_rows), "row_count": len(all_rows),
                "col_count": len(headers), "table_type": "frequency"}
        if w_series is not None:
            resp["weighted"] = True
            resp["weight_col"] = w_col
        return resp
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Frequency error: {str(e)}")
