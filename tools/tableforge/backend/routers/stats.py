from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import pandas as pd
import numpy as np
import traceback

from ..shared import datasets, sanitize_for_json, apply_metrics_and_bins

router = APIRouter()


# ═══════════════════════════════════════════════════
# Statistical Table Generators
# ═══════════════════════════════════════════════════

class StatTableConfig(BaseModel):
    dataset_id: str
    columns: list[str] = []
    group_by: str = ""
    filters: dict = {}

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
        corr = df[num_cols].corr().round(4)
        headers = [""] + list(corr.columns)
        rows = []
        for idx, row in corr.iterrows():
            rows.append([str(idx)] + [round(v, 4) if not pd.isna(v) else None for v in row])
        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows), "col_count": len(headers), "table_type": "correlation"}
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

        stats = df[num_cols].describe().T
        stats["missing"] = df[num_cols].isnull().sum().values
        stats["missing_%"] = (df[num_cols].isnull().sum() / len(df) * 100).round(2).values

        headers = ["Variable", "N", "Mean", "Std Dev", "Min", "25%", "50%", "75%", "Max", "Missing", "Missing %"]
        rows = []
        for var_name in stats.index:
            s = stats.loc[var_name]
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
        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows), "col_count": len(headers), "table_type": "descriptive"}
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
        ct = pd.crosstab(df[row_col], df[col_col], margins=True, margins_name="Total")

        # Chi-square test
        from scipy.stats import chi2_contingency
        ct_no_margins = pd.crosstab(df[row_col], df[col_col])
        chi2, p_value, dof, expected = chi2_contingency(ct_no_margins)

        headers = [""] + [str(c) for c in ct.columns]
        rows = []
        for idx, row in ct.iterrows():
            rows.append([str(idx)] + [int(v) if not pd.isna(v) else 0 for v in row])

        # Add test results as footer rows
        rows.append(["", "", "", "", ""])  # spacer
        rows.append(["Chi-Square", round(chi2, 4)] + [""] * (len(headers) - 2))
        rows.append(["p-value", round(p_value, 6)] + [""] * (len(headers) - 2))
        rows.append(["df", int(dof)] + [""] * (len(headers) - 2))
        sig = "***" if p_value < 0.001 else ("**" if p_value < 0.01 else ("*" if p_value < 0.05 else "ns"))
        rows.append(["Significance", sig] + [""] * (len(headers) - 2))

        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows), "col_count": len(headers),
                "table_type": "crosstab", "chi2": round(chi2, 4), "p_value": round(p_value, 6), "dof": int(dof)}
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

        from scipy.stats import ttest_ind, mannwhitneyu, shapiro

        results_rows = []
        headers = ["Comparison", "Group 1 Mean", "Group 2 Mean", "Difference", "t-stat", "p-value", "Sig", "Test Used"]

        # Pairwise comparisons for first few groups
        group_pairs = [(groups[i], groups[j]) for i in range(min(len(groups), 5)) for j in range(i+1, min(len(groups), 5))]

        for g1, g2 in group_pairs:
            d1 = df[df[group_col] == g1][value_col].dropna()
            d2 = df[df[group_col] == g2][value_col].dropna()
            if len(d1) < 2 or len(d2) < 2:
                continue

            # Check normality
            try:
                _, p_norm1 = shapiro(d1[:5000])
                _, p_norm2 = shapiro(d2[:5000])
                is_normal = p_norm1 > 0.05 and p_norm2 > 0.05
            except:
                is_normal = len(d1) > 30 and len(d2) > 30

            if is_normal:
                stat, p_val = ttest_ind(d1, d2)
                test_name = "t-test"
            else:
                stat, p_val = mannwhitneyu(d1, d2, alternative='two-sided')
                test_name = "Mann-Whitney"

            sig = "***" if p_val < 0.001 else ("**" if p_val < 0.01 else ("*" if p_val < 0.05 else "ns"))
            results_rows.append([
                f"{g1} vs {g2}",
                round(d1.mean(), 4), round(d2.mean(), 4),
                round(d1.mean() - d2.mean(), 4),
                round(stat, 4), round(p_val, 6), sig, test_name
            ])

        return {"headers": headers, "rows": sanitize_for_json(results_rows), "row_count": len(results_rows),
                "col_count": len(headers), "table_type": "ttest"}
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
        from scipy.stats import f_oneway

        groups = df[group_col].dropna().unique()
        group_data = [df[df[group_col] == g][value_col].dropna() for g in groups]
        group_data = [g for g in group_data if len(g) > 0]

        if len(group_data) < 2:
            raise HTTPException(400, "Need at least 2 non-empty groups")

        f_stat, p_value = f_oneway(*group_data)
        sig = "***" if p_value < 0.001 else ("**" if p_value < 0.01 else ("*" if p_value < 0.05 else "ns"))

        # Build ANOVA summary table
        n_total = sum(len(g) for g in group_data)
        grand_mean = df[value_col].dropna().mean()
        ss_between = sum(len(g) * (g.mean() - grand_mean)**2 for g in group_data)
        ss_within = sum(((g - g.mean())**2).sum() for g in group_data)
        ss_total = ss_between + ss_within
        df_between = len(group_data) - 1
        df_within = n_total - len(group_data)
        ms_between = ss_between / max(df_between, 1)
        ms_within = ss_within / max(df_within, 1)

        headers = ["Source", "SS", "df", "MS", "F", "p-value", "Sig"]
        rows = [
            ["Between Groups", round(ss_between, 4), df_between, round(ms_between, 4), round(f_stat, 4), round(p_value, 6), sig],
            ["Within Groups", round(ss_within, 4), df_within, round(ms_within, 4), "", "", ""],
            ["Total", round(ss_total, 4), n_total - 1, "", "", "", ""],
        ]

        # Add group descriptives
        rows.append(["", "", "", "", "", "", ""])
        rows.append(["Group", "N", "Mean", "Std Dev", "Min", "Max", ""])
        for g_name, g_data in zip(groups, group_data):
            rows.append([
                str(g_name), len(g_data), round(g_data.mean(), 4),
                round(g_data.std(), 4), round(g_data.min(), 4), round(g_data.max(), 4), ""
            ])

        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "anova", "f_stat": round(f_stat, 4), "p_value": round(p_value, 6)}
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
        df_clean = df[[y_col] + x_cols].dropna()

        if len(df_clean) < len(x_cols) + 2:
            raise HTTPException(400, f"Not enough data points ({len(df_clean)}) for regression")

        from scipy import stats as sp_stats

        Y = df_clean[y_col].values
        X = np.column_stack([np.ones(len(Y))] + [df_clean[c].values for c in x_cols])

        # OLS: beta = (X'X)^-1 X'Y
        try:
            beta = np.linalg.lstsq(X, Y, rcond=None)[0]
        except np.linalg.LinAlgError:
            raise HTTPException(400, "Singular matrix — cannot compute regression")

        Y_pred = X @ beta
        residuals = Y - Y_pred
        n = len(Y)
        k = len(x_cols)
        ss_res = (residuals ** 2).sum()
        ss_tot = ((Y - Y.mean()) ** 2).sum()
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
            var_beta = mse * np.linalg.inv(X.T @ X).diagonal()
            se_beta = np.sqrt(np.abs(var_beta))
        except:
            se_beta = np.zeros(k + 1)

        headers = ["Variable", "Coefficient", "Std Error", "t-Stat", "p-value", "Sig"]
        rows = []
        var_names = ["(Intercept)"] + x_cols
        for i, name in enumerate(var_names):
            coef = beta[i]
            se = se_beta[i] if i < len(se_beta) else 0
            t_stat = coef / se if se > 1e-15 else 0
            p_val = 2 * (1 - sp_stats.t.cdf(abs(t_stat), max(n - k - 1, 1)))
            sig = "***" if p_val < 0.001 else ("**" if p_val < 0.01 else ("*" if p_val < 0.05 else "ns"))
            rows.append([name, round(coef, 6), round(se, 6), round(t_stat, 4), round(p_val, 6), sig])

        summary = {
            "R²": round(r_squared, 4),
            "Adj R²": round(adj_r_sq, 4),
            "RMSE": round(rmse, 4),
            "F-stat": round(f_stat, 4),
            "p (F)": round(p_f, 6),
            "N": n,
        }
        interp = f"The model explains {r_squared*100:.1f}% of variance in {y_col}. "
        if p_f < 0.05:
            interp += f"The overall model is statistically significant (F={f_stat:.2f}, p={p_f:.4f})."
        else:
            interp += f"The overall model is NOT statistically significant (p={p_f:.4f})."

        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "regression",
                "summary": summary, "interpretation": interp}
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

        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "normality", "interpretation": interp}
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

        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "outlier", "interpretation": interp}
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

        all_rows = []
        for col_name in config.columns:
            if col_name not in df.columns:
                continue

            vc = df[col_name].fillna("(Missing)").astype(str).value_counts()
            total = vc.sum()
            cum_count = 0

            # Add column header row
            all_rows.append([f"— {col_name} —", "", "", "", ""])

            for val, count in vc.items():
                cum_count += count
                pct = round(count / total * 100, 2) if total > 0 else 0
                cum_pct = round(cum_count / total * 100, 2) if total > 0 else 0
                all_rows.append([str(val), int(count), pct, int(cum_count), cum_pct])

            all_rows.append(["Total", int(total), 100.0, int(total), 100.0])
            if col_name != config.columns[-1]:
                all_rows.append(["", "", "", "", ""])  # spacer

        headers = ["Value", "Frequency", "Percent (%)", "Cumulative Freq", "Cumulative %"]
        return {"headers": headers, "rows": sanitize_for_json(all_rows), "row_count": len(all_rows),
                "col_count": len(headers), "table_type": "frequency"}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Frequency error: {str(e)}")
