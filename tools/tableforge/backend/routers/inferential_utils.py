"""Effect-size + CI helpers reused across inferential endpoints.

Pure functions only — no FastAPI imports. Each helper returns a plain dict
with rounded numbers so callers can splat into the response payload.
"""

from __future__ import annotations

import math
import numpy as np
import pandas as pd
from scipy import stats as sp_stats


def sig_stars(p: float) -> str:
    if p is None or (isinstance(p, float) and math.isnan(p)):
        return ""
    if p < 0.001:
        return "***"
    if p < 0.01:
        return "**"
    if p < 0.05:
        return "*"
    return "ns"


def safe_round(x, digits: int = 4):
    try:
        if x is None:
            return None
        if isinstance(x, (int, np.integer)):
            return int(x)
        if math.isnan(x) or math.isinf(x):
            return None
        return round(float(x), digits)
    except Exception:
        return None


# ── effect sizes ─────────────────────────────────────────────────────────────

def cohens_d(d1: np.ndarray, d2: np.ndarray) -> float:
    """Cohen's d for two independent samples (pooled SD)."""
    n1, n2 = len(d1), len(d2)
    if n1 < 2 or n2 < 2:
        return float("nan")
    s1, s2 = d1.std(ddof=1), d2.std(ddof=1)
    sp = math.sqrt(((n1 - 1) * s1**2 + (n2 - 1) * s2**2) / (n1 + n2 - 2))
    if sp == 0:
        return 0.0
    return (d1.mean() - d2.mean()) / sp


def hedges_g(d1: np.ndarray, d2: np.ndarray) -> float:
    """Hedges' g — Cohen's d with small-sample correction."""
    d = cohens_d(d1, d2)
    n = len(d1) + len(d2)
    if n <= 2:
        return d
    correction = 1 - (3 / (4 * (n - 2) - 1))
    return d * correction


def cohens_dz(diffs: np.ndarray) -> float:
    """Cohen's d_z for paired samples (difference mean / difference SD)."""
    d = np.asarray(diffs, dtype=float)
    d = d[~np.isnan(d)]
    if len(d) < 2 or d.std(ddof=1) == 0:
        return 0.0
    return d.mean() / d.std(ddof=1)


def cramers_v(chi2: float, n: int, r: int, c: int) -> float:
    """Cramér's V — chi-square effect size for contingency tables."""
    if n <= 0:
        return float("nan")
    k = min(r - 1, c - 1)
    if k <= 0:
        return float("nan")
    return math.sqrt(chi2 / (n * k))


def eta_squared(ss_between: float, ss_total: float) -> float:
    if ss_total <= 0:
        return float("nan")
    return ss_between / ss_total


def omega_squared(ss_between: float, df_between: int, ms_within: float, n_total: int) -> float:
    denom = (n_total * ms_within) + ss_between
    if denom <= 0:
        return float("nan")
    return (ss_between - df_between * ms_within) / denom


def rank_biserial(stat_w: float, n1: int, n2: int) -> float:
    """Rank-biserial r for Mann-Whitney U (stat_w = U statistic)."""
    if n1 <= 0 or n2 <= 0:
        return float("nan")
    return 1 - (2 * stat_w) / (n1 * n2)


def wilcoxon_rb(stat_w: float, n_pairs: int) -> float:
    """Rank-biserial r for Wilcoxon signed-rank (matched-pairs)."""
    if n_pairs <= 0:
        return float("nan")
    t_total = n_pairs * (n_pairs + 1) / 2
    if t_total <= 0:
        return float("nan")
    return (2 * stat_w / t_total) - 1


# ── confidence intervals ─────────────────────────────────────────────────────

def ci_mean_diff(d1: np.ndarray, d2: np.ndarray, alpha: float = 0.05, welch: bool = True) -> tuple[float, float]:
    """95% CI on the mean difference (d1 - d2)."""
    n1, n2 = len(d1), len(d2)
    if n1 < 2 or n2 < 2:
        return (float("nan"), float("nan"))
    m1, m2 = d1.mean(), d2.mean()
    s1, s2 = d1.var(ddof=1), d2.var(ddof=1)
    if welch:
        se = math.sqrt(s1 / n1 + s2 / n2)
        df = (s1 / n1 + s2 / n2) ** 2 / ((s1 / n1) ** 2 / (n1 - 1) + (s2 / n2) ** 2 / (n2 - 1))
    else:
        sp2 = ((n1 - 1) * s1 + (n2 - 1) * s2) / (n1 + n2 - 2)
        se = math.sqrt(sp2 * (1 / n1 + 1 / n2))
        df = n1 + n2 - 2
    t = sp_stats.t.ppf(1 - alpha / 2, df)
    margin = t * se
    return (m1 - m2 - margin, m1 - m2 + margin)


def ci_paired_diff(diffs: np.ndarray, alpha: float = 0.05) -> tuple[float, float]:
    d = np.asarray(diffs, dtype=float)
    d = d[~np.isnan(d)]
    if len(d) < 2:
        return (float("nan"), float("nan"))
    m = d.mean()
    se = d.std(ddof=1) / math.sqrt(len(d))
    t = sp_stats.t.ppf(1 - alpha / 2, len(d) - 1)
    return (m - t * se, m + t * se)


def ci_proportion(k: int, n: int, alpha: float = 0.05) -> tuple[float, float]:
    """Wilson score CI on a proportion."""
    if n <= 0:
        return (float("nan"), float("nan"))
    z = sp_stats.norm.ppf(1 - alpha / 2)
    p = k / n
    denom = 1 + z**2 / n
    centre = (p + z**2 / (2 * n)) / denom
    margin = z * math.sqrt((p * (1 - p) / n) + z**2 / (4 * n**2)) / denom
    return (centre - margin, centre + margin)


def ci_pearson_r(r: float, n: int, alpha: float = 0.05) -> tuple[float, float]:
    """Fisher z-transform CI for a correlation coefficient."""
    if n < 4 or abs(r) >= 1:
        return (float("nan"), float("nan"))
    z = 0.5 * math.log((1 + r) / (1 - r))
    se = 1 / math.sqrt(n - 3)
    crit = sp_stats.norm.ppf(1 - alpha / 2)
    lo, hi = z - crit * se, z + crit * se
    return (math.tanh(lo), math.tanh(hi))


# ── multi-testing correction ─────────────────────────────────────────────────

def bonferroni(pvals: list[float]) -> list[float]:
    m = len(pvals)
    return [min(p * m, 1.0) if p is not None and not math.isnan(p) else p for p in pvals]


def holm(pvals: list[float]) -> list[float]:
    m = len(pvals)
    idx = sorted(range(m), key=lambda i: pvals[i])
    adj = [0.0] * m
    prev = 0.0
    for rank, i in enumerate(idx):
        p = pvals[i]
        adj_p = min(max((m - rank) * p, prev), 1.0)
        adj[i] = adj_p
        prev = adj_p
    return adj


def benjamini_hochberg(pvals: list[float]) -> list[float]:
    m = len(pvals)
    idx = sorted(range(m), key=lambda i: pvals[i], reverse=True)
    adj = [0.0] * m
    prev = 1.0
    for rank_from_top, i in enumerate(idx):
        p = pvals[i]
        adj_p = min(p * m / (m - rank_from_top), prev, 1.0)
        adj[i] = adj_p
        prev = adj_p
    return adj


def correct_pvalues(pvals: list[float], method: str = "fdr_bh") -> list[float]:
    method = (method or "fdr_bh").lower()
    if method in ("bonferroni", "bonf"):
        return bonferroni(pvals)
    if method == "holm":
        return holm(pvals)
    return benjamini_hochberg(pvals)


# ── reliability ──────────────────────────────────────────────────────────────

def cronbach_alpha(items: pd.DataFrame) -> tuple[float, list[float]]:
    """Cronbach's α + item-rest (item-total) correlations.

    items: numeric DataFrame, one column per Likert item, rows = respondents.
    Returns (alpha, [item-rest r per column]).
    """
    arr = items.apply(pd.to_numeric, errors="coerce").dropna(how="any")
    if arr.shape[0] < 3 or arr.shape[1] < 2:
        return (float("nan"), [float("nan")] * arr.shape[1])
    k = arr.shape[1]
    item_vars = arr.var(axis=0, ddof=1)
    total = arr.sum(axis=1)
    tot_var = total.var(ddof=1)
    if tot_var == 0:
        return (float("nan"), [float("nan")] * k)
    alpha = (k / (k - 1)) * (1 - item_vars.sum() / tot_var)
    item_rest = []
    for col in arr.columns:
        rest = arr.drop(columns=[col]).sum(axis=1)
        if rest.std(ddof=1) == 0 or arr[col].std(ddof=1) == 0:
            item_rest.append(float("nan"))
        else:
            item_rest.append(float(arr[col].corr(rest)))
    return (float(alpha), item_rest)


# ── interpretations ──────────────────────────────────────────────────────────

def interpret_d(d: float) -> str:
    a = abs(d)
    if math.isnan(a):
        return ""
    if a < 0.2:
        return "negligible"
    if a < 0.5:
        return "small"
    if a < 0.8:
        return "medium"
    return "large"


def interpret_v(v: float) -> str:
    if math.isnan(v):
        return ""
    if v < 0.1:
        return "negligible"
    if v < 0.3:
        return "small"
    if v < 0.5:
        return "medium"
    return "large"


def interpret_eta(eta: float) -> str:
    if math.isnan(eta):
        return ""
    if eta < 0.01:
        return "negligible"
    if eta < 0.06:
        return "small"
    if eta < 0.14:
        return "medium"
    return "large"
