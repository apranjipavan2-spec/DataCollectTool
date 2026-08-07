"""Decision-logic for the Auto-Analyze battery (Phase 3).

Pure function: given column metadata + a study design + user-picked outcomes,
returns a list of `AnalysisSpec` dicts describing which tests to run.

The actual execution happens in `auto_analyze.py`; this module stays free of
scipy/statsmodels so it can be unit-tested in isolation.
"""

from __future__ import annotations

from typing import Any
import pandas as pd


# ───────────────────────── Scale inference ─────────────────────────

def infer_scale(series: pd.Series, role: dict | None = None) -> str:
    """Return one of: binary | continuous | categorical | likert | ordinal | multi_response.

    Honour an explicit role.scale if present; otherwise sniff from data.
    """
    if role:
        s = role.get("scale")
        if s in ("binary", "likert", "ordinal", "continuous", "multi_response", "nominal"):
            return "categorical" if s == "nominal" else s
        if s in ("interval", "ratio", "count"):
            return "continuous"

    s = series.dropna()
    if s.empty:
        return "categorical"

    # Numeric?
    is_num = pd.api.types.is_numeric_dtype(s)
    if is_num:
        uniq = s.nunique()
        if uniq <= 2:
            return "binary"
        try:
            all_int = (s.astype(float) % 1 == 0).all()
        except Exception:
            all_int = False
        if uniq <= 7 and all_int:
            return "likert"
        return "continuous"

    # String/categorical
    uniq = s.nunique()
    if uniq <= 2:
        return "binary"
    return "categorical"


def _is_paired_continuous(s1: pd.Series, s2: pd.Series) -> bool:
    return pd.api.types.is_numeric_dtype(s1) and pd.api.types.is_numeric_dtype(s2)


def _is_paired_binary(s1: pd.Series, s2: pd.Series) -> bool:
    return s1.nunique(dropna=True) <= 2 and s2.nunique(dropna=True) <= 2


# ───────────────────────── Battery planner ─────────────────────────

def plan_battery(
    df: pd.DataFrame,
    outcome_cols: list[str],
    predictor_cols: list[str] | None,
    roles: dict[str, dict],
    design: dict | None,
) -> dict:
    """Return the analysis specs to execute, plus which outcome/predictor
    pairs were considered but produced no test and why.

    {"specs": [{id, kind, outcome, predictors, params, label}, ...],
     "skipped": [{outcome, predictor, reason}, ...]}
    """
    design = design or {}
    predictor_cols = [c for c in (predictor_cols or []) if c in df.columns]
    outcome_cols = [c for c in outcome_cols if c in df.columns]

    specs: list[dict] = []
    skipped: list[dict] = []
    counter = [0]

    def add(kind: str, outcome: str | None, predictors: list[str] | None,
            params: dict, label: str) -> None:
        counter[0] += 1
        specs.append({
            "id": f"a{counter[0]:03d}",
            "kind": kind,
            "outcome": outcome,
            "predictors": predictors or [],
            "params": params,
            "label": label,
        })

    def skip(outcome: str | None, predictor: str | None, reason: str) -> None:
        skipped.append({"outcome": outcome, "predictor": predictor, "reason": reason})

    # 1) Descriptives for every outcome
    for o in outcome_cols:
        add("descriptive", o, None, {"cols": [o]}, f"Descriptive summary — {o}")

    # 2) Pre/post pairs from study design — paired tests across all pairs
    pairs = design.get("pre_post_pairs", []) or []
    for pair in pairs:
        pre, post = pair.get("pre"), pair.get("post")
        if pre and post and pre in df.columns and post in df.columns:
            if _is_paired_continuous(df[pre], df[post]):
                add("paired_ttest", post, [pre],
                    {"pre_col": pre, "post_col": post},
                    f"Paired t-test — {pre} vs {post}")
                add("wilcoxon", post, [pre],
                    {"pre_col": pre, "post_col": post},
                    f"Wilcoxon signed-rank — {pre} vs {post}")
            if _is_paired_binary(df[pre], df[post]):
                add("mcnemar", post, [pre],
                    {"pre_col": pre, "post_col": post},
                    f"McNemar — {pre} vs {post}")

    treatment_col = design.get("treatment_col")
    weight_col = design.get("weight_col")

    # 3) Per-outcome × per-predictor pairwise
    for o in outcome_cols:
        if o not in df.columns:
            continue
        o_role = roles.get(o, {})
        o_scale = infer_scale(df[o], o_role)

        # MR outcome: per-option chi² across the treatment / group
        if o_scale == "multi_response":
            group = treatment_col or (predictor_cols[0] if predictor_cols else None)
            if group and group in df.columns:
                add("mr_by_group", o, [group],
                    {"mr_col": o, "group_col": group, "correction": "fdr_bh"},
                    f"Multi-response by {group} — {o}")
            else:
                skip(o, None, "Multi-response column needs a treatment/group column to compare against (none set in Study Design and no predictor selected).")
            continue

        used_predictors = []
        for p in predictor_cols:
            if p == o or p not in df.columns:
                continue
            p_role = roles.get(p, {})
            p_scale = infer_scale(df[p], p_role)
            used_predictors.append((p, p_scale))
            specs_before = len(specs)

            # binary outcome
            if o_scale == "binary":
                if p_scale in ("binary", "categorical"):
                    add("chi2", o, [p],
                        {"row": o, "col": p},
                        f"Chi-square + Cramér's V — {o} × {p}")
                elif p_scale in ("continuous", "likert"):
                    # treat outcome as group, predictor as numeric
                    add("ttest", o, [p],
                        {"value_col": p, "group_col": o},
                        f"t-test (Mann-Whitney fallback) — {p} by {o}")

            # likert outcome (treat as ordinal for non-parametric)
            elif o_scale == "likert":
                if p_scale in ("binary", "categorical"):
                    n_groups = int(df[p].nunique(dropna=True))
                    if n_groups == 2:
                        add("mann_whitney", o, [p],
                            {"value_col": o, "group_col": p},
                            f"Mann-Whitney — {o} by {p}")
                    elif n_groups >= 3:
                        add("kruskal", o, [p],
                            {"value_col": o, "group_col": p},
                            f"Kruskal-Wallis — {o} by {p}")
                elif p_scale == "continuous":
                    add("spearman", o, [p],
                        {"x_col": p, "y_col": o},
                        f"Spearman — {p} ~ {o}")
                elif p_scale == "likert":
                    add("spearman", o, [p],
                        {"x_col": p, "y_col": o},
                        f"Spearman — {p} ~ {o}")

            # continuous outcome
            elif o_scale == "continuous":
                if p_scale == "binary":
                    add("ttest", o, [p],
                        {"value_col": o, "group_col": p},
                        f"t-test — {o} by {p}")
                elif p_scale == "categorical":
                    n_groups = int(df[p].nunique(dropna=True))
                    if n_groups == 2:
                        add("ttest", o, [p],
                            {"value_col": o, "group_col": p},
                            f"t-test — {o} by {p}")
                    elif n_groups >= 3:
                        add("anova", o, [p],
                            {"value_col": o, "group_col": p, "posthoc": "tukey"},
                            f"ANOVA + Tukey HSD — {o} by {p}")
                elif p_scale in ("continuous", "likert"):
                    add("pearson", o, [p],
                        {"x_col": p, "y_col": o},
                        f"Pearson — {p} ~ {o}")

            # categorical outcome
            elif o_scale == "categorical":
                if p_scale in ("binary", "categorical"):
                    add("chi2", o, [p],
                        {"row": o, "col": p},
                        f"Chi-square + Cramér's V — {o} × {p}")
                elif p_scale in ("continuous", "likert"):
                    n_groups = int(df[o].nunique(dropna=True))
                    if n_groups == 2:
                        add("ttest", o, [p],
                            {"value_col": p, "group_col": o},
                            f"t-test — {p} by {o}")
                    elif n_groups >= 3:
                        add("anova", o, [p],
                            {"value_col": p, "group_col": o, "posthoc": "tukey"},
                            f"ANOVA + Tukey HSD — {p} by {o}")

            # Every branch above only calls add() for scale combinations with a
            # valid test, or group counts of 2+ (needed to compare anything).
            # If nothing was added for this pair, record why rather than the
            # column silently vanishing from the results with no explanation.
            if len(specs) == specs_before:
                if o_scale == "multi_response" or p_scale == "multi_response":
                    skip(o, p, "Multi-response columns can't be paired directly with another column this way.")
                elif o_scale == "continuous" and p_scale in ("categorical", "binary") and int(df[p].nunique(dropna=True)) < 2:
                    skip(o, p, f"'{p}' has fewer than 2 groups after removing missing values — nothing to compare.")
                elif o_scale == "categorical" and p_scale in ("continuous", "likert") and int(df[o].nunique(dropna=True)) < 2:
                    skip(o, p, f"'{o}' has fewer than 2 groups after removing missing values — nothing to compare.")
                else:
                    skip(o, p, f"No applicable test for a {o_scale} outcome vs. a {p_scale} predictor.")

        # 4) Multivariate model for outcome with ≥2 numeric/binary predictors
        num_or_bin = [p for p, s in used_predictors if s in ("continuous", "likert", "binary")]
        if len(num_or_bin) >= 2:
            if o_scale == "binary":
                add("logistic_regression", o, num_or_bin,
                    {"outcome_col": o, "predictor_cols": num_or_bin},
                    f"Logistic regression — {o} ~ {' + '.join(num_or_bin)}")
            elif o_scale in ("continuous", "likert"):
                add("multiple_regression", o, num_or_bin,
                    {"outcome_col": o, "predictor_cols": num_or_bin, "weight_col": weight_col},
                    f"Multiple regression — {o} ~ {' + '.join(num_or_bin)}")

    # 5) If any outcome group is Likert items (≥3 items tagged), add reliability
    likert_items = [c for c, r in roles.items()
                    if (r or {}).get("scale") == "likert" and c in df.columns]
    if len(likert_items) >= 3:
        add("reliability", None, likert_items,
            {"item_cols": likert_items},
            f"Cronbach's α — {len(likert_items)} Likert items")

    return {"specs": specs, "skipped": skipped}
