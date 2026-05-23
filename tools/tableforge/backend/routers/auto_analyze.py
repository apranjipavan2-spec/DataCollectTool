"""Auto-Analyze battery (Phase 3 — Survey Analysis Studio).

POST /api/analyze/auto-battery — SSE-streaming endpoint that:
  1. Plans the test battery via `test_chooser.plan_battery()`.
  2. Executes each test in-process (scipy/statsmodels — no recursive HTTP calls).
  3. Streams progress events `{step, idx, total, ...}` as the battery runs.
  4. Applies the requested multi-testing correction across all p-values at the end.
  5. Returns the full AnalysisPack on the final event.
"""

from __future__ import annotations

import json
import math
import traceback
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from scipy import stats as sp_stats

from ..shared import datasets, column_roles, study_designs, apply_metrics_and_bins, sanitize_for_json, add_audit_log
from . import inferential_utils as iu
from .test_chooser import plan_battery
from .ai import _call_llm, _load_ai_cfg


router = APIRouter()


class AutoAnalyzeConfig(BaseModel):
    dataset_id: str
    outcome_cols: list[str]
    predictor_cols: list[str] | None = None
    correction: str = "fdr_bh"           # fdr_bh | bonferroni | holm | none
    use_design: bool = True              # use saved StudyDesign if present
    filters: dict = {}


# ───────────────────────── Executors ─────────────────────────
# Each takes (df, params) and returns a partial result dict with at minimum
# {table: {headers, rows}, test: {...}, interpretation, warnings}.


def _safe_n(s: pd.Series) -> int:
    return int(s.notna().sum())


def _exec_descriptive(df: pd.DataFrame, params: dict) -> dict:
    cols = params["cols"]
    headers = ["Column", "N", "Mean", "SD", "Median", "Min", "Max", "Missing"]
    rows = []
    for c in cols:
        if c not in df.columns:
            continue
        s = df[c]
        s_num = pd.to_numeric(s, errors="coerce")
        rows.append([
            c, _safe_n(s),
            iu.safe_round(s_num.mean()), iu.safe_round(s_num.std(ddof=1)),
            iu.safe_round(s_num.median()),
            iu.safe_round(s_num.min()), iu.safe_round(s_num.max()),
            int(s.isna().sum()),
        ])
    return {"table": {"headers": headers, "rows": rows},
            "test": {}, "interpretation": f"Descriptive summary for {len(cols)} column(s).", "warnings": []}


def _exec_chi2(df: pd.DataFrame, params: dict) -> dict:
    from scipy.stats import chi2_contingency, fisher_exact
    r_col, c_col = params["row"], params["col"]
    sub = df[[r_col, c_col]].dropna()
    if sub.empty:
        return {"table": {"headers": [], "rows": []},
                "test": {}, "interpretation": "No data", "warnings": ["empty"]}
    ct = pd.crosstab(sub[r_col], sub[c_col])
    if ct.shape[0] < 2 or ct.shape[1] < 2:
        return {"table": {"headers": [], "rows": []},
                "test": {}, "interpretation": "Need ≥2 categories per axis", "warnings": ["degenerate"]}
    chi2, p, dof, expected = chi2_contingency(ct)
    n = int(ct.values.sum())
    v = iu.cramers_v(chi2, n, ct.shape[0], ct.shape[1])
    fisher_p = None
    if ct.shape == (2, 2):
        try:
            _, fisher_p = fisher_exact(ct.values)
        except Exception:
            pass
    headers = ["", *map(str, ct.columns)]
    rows = [[str(idx), *[int(x) for x in row]] for idx, row in ct.iterrows()]
    return {
        "table": {"headers": headers, "rows": rows},
        "test": {
            "stat": iu.safe_round(chi2), "df": int(dof), "p_raw": iu.safe_round(p, 6),
            "effect_size": {"cramers_v": iu.safe_round(v), "interpretation": iu.interpret_v(v)},
            "fisher_p": iu.safe_round(fisher_p, 6) if fisher_p is not None else None,
        },
        "interpretation": f"χ²({dof})={iu.safe_round(chi2)}, p={iu.safe_round(p, 4)}, Cramér's V={iu.safe_round(v)} ({iu.interpret_v(v)}).",
        "warnings": ["small expected counts"] if (expected < 5).any() else [],
    }


def _exec_ttest(df: pd.DataFrame, params: dict) -> dict:
    v_col, g_col = params["value_col"], params["group_col"]
    sub = df[[v_col, g_col]].dropna()
    groups = sub[g_col].unique()
    if len(groups) != 2:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "t-test needs exactly 2 groups", "warnings": ["wrong group count"]}
    a = pd.to_numeric(sub[sub[g_col] == groups[0]][v_col], errors="coerce").dropna().to_numpy()
    b = pd.to_numeric(sub[sub[g_col] == groups[1]][v_col], errors="coerce").dropna().to_numpy()
    if len(a) < 2 or len(b) < 2:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "Need N≥2 per group", "warnings": ["small N"]}
    levene_stat, levene_p = sp_stats.levene(a, b)
    welch = levene_p < 0.05
    t_stat, t_p = sp_stats.ttest_ind(a, b, equal_var=not welch)
    d = iu.cohens_d(a, b)
    ci = iu.ci_mean_diff(a, b, welch=welch)
    headers = ["Group", "N", "Mean", "SD"]
    rows = [
        [str(groups[0]), len(a), iu.safe_round(a.mean()), iu.safe_round(a.std(ddof=1))],
        [str(groups[1]), len(b), iu.safe_round(b.mean()), iu.safe_round(b.std(ddof=1))],
    ]
    return {
        "table": {"headers": headers, "rows": rows},
        "test": {
            "stat": iu.safe_round(t_stat), "p_raw": iu.safe_round(t_p, 6),
            "df": len(a) + len(b) - 2,
            "welch": welch,
            "effect_size": {"cohens_d": iu.safe_round(d), "interpretation": iu.interpret_d(d)},
            "ci": [iu.safe_round(ci[0]), iu.safe_round(ci[1])],
        },
        "interpretation": f"{'Welch' if welch else 'Student'}'s t={iu.safe_round(t_stat)}, p={iu.safe_round(t_p, 4)}, Cohen's d={iu.safe_round(d)} ({iu.interpret_d(d)}).",
        "warnings": ["unequal variances → Welch"] if welch else [],
    }


def _exec_mann_whitney(df: pd.DataFrame, params: dict) -> dict:
    v_col, g_col = params["value_col"], params["group_col"]
    sub = df[[v_col, g_col]].dropna()
    groups = sub[g_col].unique()
    if len(groups) != 2:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "Mann-Whitney needs 2 groups", "warnings": []}
    a = pd.to_numeric(sub[sub[g_col] == groups[0]][v_col], errors="coerce").dropna().to_numpy()
    b = pd.to_numeric(sub[sub[g_col] == groups[1]][v_col], errors="coerce").dropna().to_numpy()
    if len(a) < 3 or len(b) < 3:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "Need N≥3 per group", "warnings": ["small N"]}
    u, p = sp_stats.mannwhitneyu(a, b, alternative="two-sided")
    r = iu.rank_biserial(u, len(a), len(b))
    headers = ["Group", "N", "Median", "IQR"]
    rows = [
        [str(groups[0]), len(a), iu.safe_round(np.median(a)), iu.safe_round(np.percentile(a, 75) - np.percentile(a, 25))],
        [str(groups[1]), len(b), iu.safe_round(np.median(b)), iu.safe_round(np.percentile(b, 75) - np.percentile(b, 25))],
    ]
    return {
        "table": {"headers": headers, "rows": rows},
        "test": {"stat": iu.safe_round(u), "p_raw": iu.safe_round(p, 6),
                 "effect_size": {"rank_biserial_r": iu.safe_round(r)}},
        "interpretation": f"U={iu.safe_round(u)}, p={iu.safe_round(p, 4)}, rank-biserial r={iu.safe_round(r)}.",
        "warnings": [],
    }


def _exec_anova(df: pd.DataFrame, params: dict) -> dict:
    v_col, g_col = params["value_col"], params["group_col"]
    sub = df[[v_col, g_col]].dropna()
    grouped = [pd.to_numeric(sub[sub[g_col] == g][v_col], errors="coerce").dropna().to_numpy()
               for g in sub[g_col].unique()]
    grouped = [g for g in grouped if len(g) >= 2]
    if len(grouped) < 2:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "Need ≥2 groups with N≥2", "warnings": []}
    levene_stat, levene_p = sp_stats.levene(*grouped)
    f_stat, p = sp_stats.f_oneway(*grouped)
    n_total = sum(len(g) for g in grouped)
    grand_mean = float(np.concatenate(grouped).mean())
    ss_between = sum(len(g) * (g.mean() - grand_mean) ** 2 for g in grouped)
    ss_within = sum(((g - g.mean()) ** 2).sum() for g in grouped)
    ss_total = ss_between + ss_within
    eta2 = iu.eta_squared(ss_between, ss_total)
    df_b = len(grouped) - 1
    ms_w = ss_within / max(n_total - len(grouped), 1)
    omega2 = iu.omega_squared(ss_between, df_b, ms_w, n_total)
    headers = ["Group", "N", "Mean", "SD"]
    rows = []
    for g_name, g in zip(sub[g_col].unique(), grouped):
        rows.append([str(g_name), len(g), iu.safe_round(g.mean()), iu.safe_round(g.std(ddof=1))])
    return {
        "table": {"headers": headers, "rows": rows},
        "test": {"stat": iu.safe_round(f_stat), "df": [df_b, n_total - len(grouped)],
                 "p_raw": iu.safe_round(p, 6),
                 "effect_size": {"eta_squared": iu.safe_round(eta2),
                                 "omega_squared": iu.safe_round(omega2),
                                 "interpretation": iu.interpret_eta(eta2)},
                 "levene_p": iu.safe_round(levene_p, 4)},
        "interpretation": f"F({df_b},{n_total - len(grouped)})={iu.safe_round(f_stat)}, p={iu.safe_round(p, 4)}, η²={iu.safe_round(eta2)} ({iu.interpret_eta(eta2)}).",
        "warnings": ["unequal variances (Levene p<0.05)"] if levene_p < 0.05 else [],
    }


def _exec_kruskal(df: pd.DataFrame, params: dict) -> dict:
    v_col, g_col = params["value_col"], params["group_col"]
    sub = df[[v_col, g_col]].dropna()
    grouped = [pd.to_numeric(sub[sub[g_col] == g][v_col], errors="coerce").dropna().to_numpy()
               for g in sub[g_col].unique()]
    grouped = [g for g in grouped if len(g) >= 3]
    if len(grouped) < 2:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "Need ≥2 groups with N≥3", "warnings": []}
    h, p = sp_stats.kruskal(*grouped)
    n_total = sum(len(g) for g in grouped)
    eta_h = (h - len(grouped) + 1) / (n_total - len(grouped)) if (n_total - len(grouped)) > 0 else float("nan")
    headers = ["Group", "N", "Median"]
    rows = [[str(g_name), len(g), iu.safe_round(np.median(g))]
            for g_name, g in zip(sub[g_col].unique(), grouped)]
    return {
        "table": {"headers": headers, "rows": rows},
        "test": {"stat": iu.safe_round(h), "df": len(grouped) - 1, "p_raw": iu.safe_round(p, 6),
                 "effect_size": {"eta_squared_h": iu.safe_round(eta_h)}},
        "interpretation": f"H={iu.safe_round(h)}, p={iu.safe_round(p, 4)}, η²_H={iu.safe_round(eta_h)}.",
        "warnings": [],
    }


def _exec_pearson(df: pd.DataFrame, params: dict) -> dict:
    x, y = pd.to_numeric(df[params["x_col"]], errors="coerce"), pd.to_numeric(df[params["y_col"]], errors="coerce")
    mask = x.notna() & y.notna()
    x, y = x[mask].to_numpy(), y[mask].to_numpy()
    if len(x) < 3:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "Need N≥3", "warnings": []}
    r, p = sp_stats.pearsonr(x, y)
    ci = iu.ci_pearson_r(r, len(x))
    return {
        "table": {"headers": ["N", "r", "p", "CI low", "CI high"],
                  "rows": [[len(x), iu.safe_round(r), iu.safe_round(p, 6),
                            iu.safe_round(ci[0]), iu.safe_round(ci[1])]]},
        "test": {"stat": iu.safe_round(r), "p_raw": iu.safe_round(p, 6),
                 "effect_size": {"r": iu.safe_round(r)}, "ci": [iu.safe_round(ci[0]), iu.safe_round(ci[1])]},
        "interpretation": f"Pearson r={iu.safe_round(r)}, p={iu.safe_round(p, 4)}, 95% CI [{iu.safe_round(ci[0])}, {iu.safe_round(ci[1])}].",
        "warnings": [],
    }


def _exec_spearman(df: pd.DataFrame, params: dict) -> dict:
    x, y = pd.to_numeric(df[params["x_col"]], errors="coerce"), pd.to_numeric(df[params["y_col"]], errors="coerce")
    mask = x.notna() & y.notna()
    x, y = x[mask].to_numpy(), y[mask].to_numpy()
    if len(x) < 3:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "Need N≥3", "warnings": []}
    rho, p = sp_stats.spearmanr(x, y)
    return {
        "table": {"headers": ["N", "ρ", "p"],
                  "rows": [[len(x), iu.safe_round(rho), iu.safe_round(p, 6)]]},
        "test": {"stat": iu.safe_round(rho), "p_raw": iu.safe_round(p, 6),
                 "effect_size": {"rho": iu.safe_round(rho)}},
        "interpretation": f"Spearman ρ={iu.safe_round(rho)}, p={iu.safe_round(p, 4)}.",
        "warnings": [],
    }


def _exec_paired_ttest(df: pd.DataFrame, params: dict) -> dict:
    pre, post = params["pre_col"], params["post_col"]
    sub = df[[pre, post]].dropna()
    a = pd.to_numeric(sub[pre], errors="coerce").dropna().to_numpy()
    b = pd.to_numeric(sub[post], errors="coerce").dropna().to_numpy()
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    if n < 3:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "Need N≥3 pairs", "warnings": []}
    diff = b - a
    t_stat, p = sp_stats.ttest_rel(a, b)
    dz = iu.cohens_dz(diff)
    ci = iu.ci_paired_diff(diff)
    return {
        "table": {"headers": ["Stage", "N", "Mean", "SD"],
                  "rows": [["Pre", n, iu.safe_round(a.mean()), iu.safe_round(a.std(ddof=1))],
                           ["Post", n, iu.safe_round(b.mean()), iu.safe_round(b.std(ddof=1))],
                           ["Δ", n, iu.safe_round(diff.mean()), iu.safe_round(diff.std(ddof=1))]]},
        "test": {"stat": iu.safe_round(t_stat), "df": n - 1, "p_raw": iu.safe_round(p, 6),
                 "effect_size": {"cohens_dz": iu.safe_round(dz), "interpretation": iu.interpret_d(dz)},
                 "ci": [iu.safe_round(ci[0]), iu.safe_round(ci[1])]},
        "interpretation": f"Paired t({n-1})={iu.safe_round(t_stat)}, p={iu.safe_round(p, 4)}, d_z={iu.safe_round(dz)} ({iu.interpret_d(dz)}).",
        "warnings": [],
    }


def _exec_wilcoxon(df: pd.DataFrame, params: dict) -> dict:
    pre, post = params["pre_col"], params["post_col"]
    sub = df[[pre, post]].dropna()
    a = pd.to_numeric(sub[pre], errors="coerce").dropna().to_numpy()
    b = pd.to_numeric(sub[post], errors="coerce").dropna().to_numpy()
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    if n < 6:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "Wilcoxon needs N≥6", "warnings": []}
    try:
        w, p = sp_stats.wilcoxon(a, b)
    except Exception:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "Wilcoxon failed (all-zero differences?)", "warnings": ["scipy raised"]}
    r = iu.wilcoxon_rb(w, n)
    return {
        "table": {"headers": ["N", "W", "p", "rank-biserial r"],
                  "rows": [[n, iu.safe_round(w), iu.safe_round(p, 6), iu.safe_round(r)]]},
        "test": {"stat": iu.safe_round(w), "p_raw": iu.safe_round(p, 6),
                 "effect_size": {"rank_biserial_r": iu.safe_round(r)}},
        "interpretation": f"W={iu.safe_round(w)}, p={iu.safe_round(p, 4)}, r={iu.safe_round(r)}.",
        "warnings": [],
    }


def _exec_mcnemar(df: pd.DataFrame, params: dict) -> dict:
    from statsmodels.stats.contingency_tables import mcnemar
    pre, post = params["pre_col"], params["post_col"]
    sub = df[[pre, post]].dropna()
    if sub.empty:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "No paired data", "warnings": []}
    ct = pd.crosstab(sub[pre].astype(str), sub[post].astype(str))
    if ct.shape != (2, 2):
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "McNemar needs 2×2", "warnings": ["non 2×2"]}
    try:
        res = mcnemar(ct.values, exact=ct.values.sum() < 25, correction=True)
        stat = float(res.statistic)
        p = float(res.pvalue)
    except Exception as e:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": f"McNemar error: {e}", "warnings": [str(e)]}
    headers = ["", *map(str, ct.columns)]
    rows = [[str(idx), *[int(x) for x in row]] for idx, row in ct.iterrows()]
    return {
        "table": {"headers": headers, "rows": rows},
        "test": {"stat": iu.safe_round(stat), "p_raw": iu.safe_round(p, 6)},
        "interpretation": f"McNemar χ²={iu.safe_round(stat)}, p={iu.safe_round(p, 4)}.",
        "warnings": [],
    }


def _exec_logistic(df: pd.DataFrame, params: dict) -> dict:
    import statsmodels.api as sm
    outcome, preds = params["outcome_col"], params["predictor_cols"]
    sub = df[[outcome] + preds].dropna()
    if len(sub) < 10:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "Need N≥10", "warnings": []}
    y_raw = sub[outcome]
    y_uniq = sorted(y_raw.dropna().unique())
    if len(y_uniq) != 2:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "Logistic needs binary outcome", "warnings": []}
    y = (y_raw == y_uniq[1]).astype(int)
    X = pd.get_dummies(sub[preds], drop_first=True).astype(float)
    X = sm.add_constant(X)
    try:
        res = sm.Logit(y, X).fit(disp=0)
    except Exception as e:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": f"Logit error: {e}", "warnings": [str(e)]}
    params_v = res.params
    pvals = res.pvalues
    conf = res.conf_int()
    headers = ["Predictor", "Coef", "OR", "OR CI", "p"]
    rows = []
    for name in params_v.index:
        coef = params_v[name]
        or_val = math.exp(coef)
        lo, hi = math.exp(conf.loc[name, 0]), math.exp(conf.loc[name, 1])
        rows.append([str(name), iu.safe_round(coef), iu.safe_round(or_val),
                     f"[{iu.safe_round(lo)}, {iu.safe_round(hi)}]", iu.safe_round(pvals[name], 6)])
    return {
        "table": {"headers": headers, "rows": rows},
        "test": {"stat": iu.safe_round(res.llr), "p_raw": iu.safe_round(res.llr_pvalue, 6),
                 "effect_size": {"pseudo_r2": iu.safe_round(res.prsquared)},
                 "df": int(res.df_model)},
        "interpretation": f"Logistic model — LR χ²={iu.safe_round(res.llr)}, p={iu.safe_round(res.llr_pvalue, 4)}, pseudo-R²={iu.safe_round(res.prsquared)}. Outcome '1' = {y_uniq[1]}.",
        "warnings": [],
    }


def _exec_multiple_regression(df: pd.DataFrame, params: dict) -> dict:
    import statsmodels.api as sm
    outcome, preds = params["outcome_col"], params["predictor_cols"]
    cols = [outcome] + preds
    sub = df[cols].dropna()
    if len(sub) < 10:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "Need N≥10", "warnings": []}
    y = pd.to_numeric(sub[outcome], errors="coerce")
    X = pd.get_dummies(sub[preds], drop_first=True).astype(float)
    X = sm.add_constant(X)
    mask = y.notna() & X.notna().all(axis=1)
    y, X = y[mask], X[mask]
    if len(y) < 10:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "Insufficient data after dropping NaN", "warnings": []}
    try:
        res = sm.OLS(y, X).fit()
    except Exception as e:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": f"OLS error: {e}", "warnings": [str(e)]}
    headers = ["Predictor", "Coef", "SE", "t", "p", "CI low", "CI high"]
    conf = res.conf_int()
    rows = []
    for name in res.params.index:
        rows.append([str(name), iu.safe_round(res.params[name]),
                     iu.safe_round(res.bse[name]), iu.safe_round(res.tvalues[name]),
                     iu.safe_round(res.pvalues[name], 6),
                     iu.safe_round(conf.loc[name, 0]), iu.safe_round(conf.loc[name, 1])])
    return {
        "table": {"headers": headers, "rows": rows},
        "test": {"stat": iu.safe_round(res.fvalue), "p_raw": iu.safe_round(res.f_pvalue, 6),
                 "df": [int(res.df_model), int(res.df_resid)],
                 "effect_size": {"r_squared": iu.safe_round(res.rsquared),
                                 "adj_r_squared": iu.safe_round(res.rsquared_adj)}},
        "interpretation": f"OLS — F={iu.safe_round(res.fvalue)}, p={iu.safe_round(res.f_pvalue, 4)}, R²={iu.safe_round(res.rsquared)}, adj-R²={iu.safe_round(res.rsquared_adj)}.",
        "warnings": [],
    }


def _exec_reliability(df: pd.DataFrame, params: dict) -> dict:
    items = params["item_cols"]
    sub = df[[c for c in items if c in df.columns]].apply(pd.to_numeric, errors="coerce").dropna()
    if sub.shape[0] < 5 or sub.shape[1] < 2:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "Reliability needs ≥2 items and ≥5 complete cases", "warnings": []}
    alpha, item_rest = iu.cronbach_alpha(sub)
    headers = ["Item", "Item-rest r"]
    rows = [[c, iu.safe_round(r)] for c, r in zip(sub.columns, item_rest)]
    return {
        "table": {"headers": headers, "rows": rows},
        "test": {"stat": iu.safe_round(alpha), "effect_size": {"alpha": iu.safe_round(alpha)}},
        "interpretation": f"Cronbach's α = {iu.safe_round(alpha)} on {sub.shape[1]} items, N={sub.shape[0]}.",
        "warnings": [],
    }


def _exec_mr_by_group(df: pd.DataFrame, params: dict) -> dict:
    """Reuse the multi_response logic but inline (avoids HTTP recursion)."""
    from scipy.stats import chi2_contingency
    mr_col, g_col = params["mr_col"], params["group_col"]
    if mr_col not in df.columns or g_col not in df.columns:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "Columns missing", "warnings": []}
    series = df[mr_col].dropna().astype(str)
    options: list[str] = []
    seen = set()
    for val in series:
        for part in val.split(","):
            p = part.strip()
            if p and p.lower() not in ("nan", "none", "") and p not in seen:
                seen.add(p)
                options.append(p)
    dummies = pd.DataFrame(0, index=df.index, columns=options, dtype=int)
    for idx, val in df[mr_col].dropna().astype(str).items():
        for part in val.split(","):
            p = part.strip()
            if p in dummies.columns:
                dummies.at[idx, p] = 1
    groups = df[g_col].dropna().unique()
    if len(groups) < 2 or not options:
        return {"table": {"headers": [], "rows": []}, "test": {},
                "interpretation": "Need ≥2 groups and ≥1 option", "warnings": []}
    headers = ["Option", *[f"% {g}" for g in groups], "χ²", "Raw p", "Adj p", "Cramér's V"]
    pvals: list[float] = []
    details = []
    for opt in options:
        d = dummies[opt]
        ct = pd.crosstab(df[g_col], d)
        if ct.shape[1] < 2:
            continue
        try:
            chi2, p, dof, _ = chi2_contingency(ct)
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
        details.append((opt, pcts, iu.safe_round(chi2), iu.safe_round(p, 6), iu.safe_round(v)))
    adj = iu.correct_pvalues(pvals, "fdr_bh") if pvals else []
    rows = []
    for (opt, pcts, chi2, raw_p, v), adj_p in zip(details, adj):
        rows.append([str(opt), *pcts, chi2, raw_p, iu.safe_round(adj_p, 6), v])
    return {
        "table": {"headers": headers, "rows": rows},
        "test": {"effect_size": {"corrected": "fdr_bh"}},
        "interpretation": f"Per-option χ² across {len(groups)} groups for {len(rows)} options (FDR-corrected).",
        "warnings": [],
    }


EXECUTORS = {
    "descriptive": _exec_descriptive,
    "chi2": _exec_chi2,
    "ttest": _exec_ttest,
    "mann_whitney": _exec_mann_whitney,
    "anova": _exec_anova,
    "kruskal": _exec_kruskal,
    "pearson": _exec_pearson,
    "spearman": _exec_spearman,
    "paired_ttest": _exec_paired_ttest,
    "wilcoxon": _exec_wilcoxon,
    "mcnemar": _exec_mcnemar,
    "logistic_regression": _exec_logistic,
    "multiple_regression": _exec_multiple_regression,
    "reliability": _exec_reliability,
    "mr_by_group": _exec_mr_by_group,
}


# ───────────────────────── Endpoints ─────────────────────────

@router.post("/api/analyze/plan")
async def plan_only(config: AutoAnalyzeConfig):
    """Return the planned battery without executing — useful for previewing what will run."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[config.dataset_id]["df"].copy()
    df = apply_metrics_and_bins(df, config.dataset_id)
    for col, vals in (config.filters or {}).items():
        if vals and col in df.columns:
            df = df[df[col].astype(str).isin([str(v) for v in vals])]
    roles = column_roles.get(config.dataset_id, {})
    design = study_designs.get(config.dataset_id, {}) if config.use_design else {}
    plan = plan_battery(df, config.outcome_cols, config.predictor_cols, roles, design)
    return {"plan": plan, "total": len(plan), "design_used": bool(design)}


@router.post("/api/analyze/auto-battery")
async def auto_battery(config: AutoAnalyzeConfig):
    """SSE-stream execution of the auto-battery."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[config.dataset_id]["df"].copy()
    df = apply_metrics_and_bins(df, config.dataset_id)
    for col, vals in (config.filters or {}).items():
        if vals and col in df.columns:
            df = df[df[col].astype(str).isin([str(v) for v in vals])]
    roles = column_roles.get(config.dataset_id, {})
    design = study_designs.get(config.dataset_id, {}) if config.use_design else {}
    plan = plan_battery(df, config.outcome_cols, config.predictor_cols, roles, design)

    def stream():
        results: list[dict] = []
        pvals_index: list[tuple[int, float]] = []
        total = len(plan)
        yield f"data: {json.dumps({'step': 'start', 'total': total, 'design_used': bool(design)})}\n\n"

        for idx, spec in enumerate(plan, start=1):
            kind = spec["kind"]
            executor = EXECUTORS.get(kind)
            if executor is None:
                results.append({**spec, "table": {"headers": [], "rows": []}, "test": {},
                                "interpretation": f"No executor for {kind}",
                                "warnings": ["missing executor"]})
                yield f"data: {json.dumps({'step': 'progress', 'idx': idx, 'total': total, 'label': spec['label'], 'kind': kind, 'skipped': True})}\n\n"
                continue
            try:
                payload = executor(df, spec["params"])
                merged = {**spec, **payload}
                p_raw = (payload.get("test") or {}).get("p_raw")
                if isinstance(p_raw, (int, float)) and not (isinstance(p_raw, float) and math.isnan(p_raw)):
                    pvals_index.append((len(results), float(p_raw)))
                results.append(merged)
                yield f"data: {json.dumps({'step': 'progress', 'idx': idx, 'total': total, 'label': spec['label'], 'kind': kind, 'p_raw': p_raw})}\n\n"
            except Exception as e:
                traceback.print_exc()
                results.append({**spec, "table": {"headers": [], "rows": []}, "test": {},
                                "interpretation": f"Error: {e}", "warnings": [str(e)]})
                yield f"data: {json.dumps({'step': 'progress', 'idx': idx, 'total': total, 'label': spec['label'], 'kind': kind, 'error': str(e)})}\n\n"

        # Apply multi-test correction across all p-values
        if pvals_index and config.correction != "none":
            raw = [p for _, p in pvals_index]
            adj = iu.correct_pvalues(raw, config.correction)
            for (ri, _), adj_p in zip(pvals_index, adj):
                results[ri].setdefault("test", {})["p_adj"] = iu.safe_round(adj_p, 6)
                results[ri]["test"]["p_adj_method"] = config.correction
                results[ri]["test"]["sig"] = iu.sig_stars(adj_p)

        sanitized = sanitize_for_json(results)
        add_audit_log(config.dataset_id, "auto_battery",
                      f"Auto-battery executed: {total} tests, correction={config.correction}")
        yield f"data: {json.dumps({'step': 'done', 'total': total, 'results': sanitized, 'correction': config.correction})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


# ───────────────────────── AI Executive Summary ─────────────────────────


class ExecSummaryConfig(BaseModel):
    dataset_id: str
    results: list[dict]                         # AnalysisPack results
    audience: str = "general"                   # general | technical | executive
    correction: str | None = None
    title: str | None = None
    overrides: dict | None = None               # provider/api_key/model overrides


def _condense_result(r: dict) -> dict:
    """Strip an analysis result down to the fields the LLM needs."""
    t = (r.get("test") or {})
    return {
        "kind": r.get("kind"),
        "label": r.get("label"),
        "outcome": (r.get("params") or {}).get("outcome") or (r.get("params") or {}).get("cols"),
        "predictor": (r.get("params") or {}).get("predictor")
                     or (r.get("params") or {}).get("group_col"),
        "stat": t.get("stat"),
        "p_raw": t.get("p_raw"),
        "p_adj": t.get("p_adj"),
        "effect_size": t.get("effect_size"),
        "effect_label": t.get("effect_label"),
        "ci": t.get("ci"),
        "n": t.get("n"),
        "interpretation": r.get("interpretation"),
        "warnings": r.get("warnings") or [],
    }


@router.post("/api/analyze/exec-summary")
async def exec_summary(config: ExecSummaryConfig):
    """Generate a 1-page executive summary from an AnalysisPack."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    if not config.results:
        raise HTTPException(400, "results is empty")

    cfg = _load_ai_cfg()
    if config.overrides:
        cfg = {**cfg, **{k: v for k, v in config.overrides.items() if v}}

    condensed = [_condense_result(r) for r in config.results]
    sig = [r for r in condensed if isinstance(r.get("p_adj") or r.get("p_raw"), (int, float))
           and (r.get("p_adj") or r.get("p_raw")) < 0.05]
    n_total = len(condensed)
    n_sig = len(sig)

    audience_guide = {
        "executive": "Audience: senior decision-makers, non-technical. Lead with the so-what. "
                     "No jargon. Use bullets. 250 words max.",
        "general": "Audience: program managers + analysts. Plain English, but you may use terms "
                   "like 'significant' and 'effect size'. 400 words max.",
        "technical": "Audience: methodologists / researchers. Mention test names, effect sizes, "
                     "CIs, and any caveats (multiple-testing correction, small n). 600 words max.",
    }.get(config.audience, "")

    prompt = f"""You are writing a one-page executive summary of a survey analysis.

{audience_guide}

Context:
- Total tests run: {n_total}
- Statistically significant (p<0.05 on {'adjusted' if any(r.get('p_adj') is not None for r in condensed) else 'raw'} p): {n_sig}
- Multiple-testing correction: {config.correction or 'none'}
{f'- Study title: {config.title}' if config.title else ''}

Analysis pack (condensed JSON):
{json.dumps(condensed[:80], default=str)}

Produce the summary with these sections (use markdown headings):

## Headline
One sentence: the single most important finding.

## Key findings
3–6 bullets. Each bullet: the substantive finding in plain language, then the
numeric evidence in parentheses (effect size + CI when present, n).

## Caveats
2–4 bullets on limitations: any small-n warnings, marginal effects, multiple
testing, missing data, observational vs. causal.

## Recommended next steps
2–3 actionable bullets — what to investigate further, what to triangulate, what
decision this informs.

Rules:
- Do NOT invent results that aren't in the pack.
- Cite effect sizes and confidence intervals where present.
- Mark findings that are only significant on raw p (not adjusted) as exploratory.
- Match the audience tone.
"""

    try:
        text = await _call_llm(cfg, prompt)
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(502, f"AI exec summary failed: {e}")

    add_audit_log(config.dataset_id, "exec_summary",
                  f"Generated exec summary ({config.audience}) for {n_total} results")
    return {
        "summary_markdown": text,
        "n_total": n_total,
        "n_significant": n_sig,
        "audience": config.audience,
    }
