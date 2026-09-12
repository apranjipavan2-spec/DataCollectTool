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

def _short_label(text: str, max_len: int = 42) -> str:
    """Question labels are often bilingual ("English | Hindi") and long —
    prefer the English half for a scannable test title, then truncate."""
    eng = text.split(" | ")[0].strip() if " | " in text else text
    return eng if len(eng) <= max_len else eng[: max_len - 1].rstrip() + "…"


def plan_battery(
    df: pd.DataFrame,
    outcome_cols: list[str],
    predictor_cols: list[str] | None,
    roles: dict[str, dict],
    design: dict | None,
    column_labels: dict[str, str] | None = None,
) -> dict:
    """Return the analysis specs to execute, plus which outcome/predictor
    pairs were considered but produced no test and why.

    {"specs": [{id, kind, outcome, predictors, params, label}, ...],
     "skipped": [{outcome, predictor, reason}, ...]}

    `outcome`/`predictors`/`params` always carry raw column ids (needed to
    re-run the exact spec later) — only the human-facing `label` string (and
    skip reasons) substitute in `column_labels` when available, so the UI
    never has to show a bare question id like "q2_1".
    """
    design = design or {}
    predictor_cols = [c for c in (predictor_cols or []) if c in df.columns]
    outcome_cols = [c for c in outcome_cols if c in df.columns]

    def L(col: str | None) -> str:
        if not col:
            return col or ""
        return _short_label((column_labels or {}).get(col, col))

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
        add("descriptive", o, None, {"cols": [o], "col_labels": {o: L(o)}}, f"Descriptive summary — {L(o)}")

    # 2) Pre/post pairs from study design — paired tests across all pairs
    pairs = design.get("pre_post_pairs", []) or []
    for pair in pairs:
        pre, post = pair.get("pre"), pair.get("post")
        if pre and post and pre in df.columns and post in df.columns:
            if _is_paired_continuous(df[pre], df[post]):
                add("paired_ttest", post, [pre],
                    {"pre_col": pre, "post_col": post},
                    f"Paired t-test — {L(pre)} vs {L(post)}")
                add("wilcoxon", post, [pre],
                    {"pre_col": pre, "post_col": post},
                    f"Wilcoxon signed-rank — {L(pre)} vs {L(post)}")
            if _is_paired_binary(df[pre], df[post]):
                add("mcnemar", post, [pre],
                    {"pre_col": pre, "post_col": post},
                    f"McNemar — {L(pre)} vs {L(post)}")

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
                    f"Multi-response by {L(group)} — {L(o)}")
            else:
                skip(o, None, "Multi-response column needs a treatment/group column to compare against (none set in Study Design and no predictor selected).")
            continue

        used_predictors = []
        for p in predictor_cols:
            if p == o or p not in df.columns:
                continue
            p_role = roles.get(p, {})
            p_scale = infer_scale(df[p], p_role)

            # Guard against degenerate/uninformative pairings before running
            # anything: a 1-category column has nothing to compare, and a
            # 50+ category column (village/GP names etc.) produces a huge,
            # unreadable crosstab instead of a real answer.
            if p_scale in ("categorical", "binary"):
                p_nunique = int(df[p].dropna().nunique())
                if p_nunique < 2:
                    skip(o, p, f"'{L(p)}' has only one category present — nothing to compare.")
                    continue
                if p_nunique > 12:
                    skip(o, p, f"'{L(p)}' has {p_nunique} categories — too many for a meaningful pairwise comparison (max 12).")
                    continue

            used_predictors.append((p, p_scale))
            specs_before = len(specs)

            # binary outcome
            if o_scale == "binary":
                if p_scale in ("binary", "categorical"):
                    add("chi2", o, [p],
                        {"row": o, "col": p},
                        f"Chi-square + Cramér's V — {L(o)} × {L(p)}")
                elif p_scale in ("continuous", "likert"):
                    # treat outcome as group, predictor as numeric
                    add("ttest", o, [p],
                        {"value_col": p, "group_col": o},
                        f"t-test (Mann-Whitney fallback) — {L(p)} by {L(o)}")

            # likert outcome (treat as ordinal for non-parametric)
            elif o_scale == "likert":
                if p_scale in ("binary", "categorical"):
                    n_groups = int(df[p].nunique(dropna=True))
                    if n_groups == 2:
                        add("mann_whitney", o, [p],
                            {"value_col": o, "group_col": p},
                            f"Mann-Whitney — {L(o)} by {L(p)}")
                    elif n_groups >= 3:
                        add("kruskal", o, [p],
                            {"value_col": o, "group_col": p},
                            f"Kruskal-Wallis — {L(o)} by {L(p)}")
                elif p_scale == "continuous":
                    add("spearman", o, [p],
                        {"x_col": p, "y_col": o},
                        f"Spearman — {L(p)} ~ {L(o)}")
                elif p_scale == "likert":
                    add("spearman", o, [p],
                        {"x_col": p, "y_col": o},
                        f"Spearman — {L(p)} ~ {L(o)}")

            # continuous outcome
            elif o_scale == "continuous":
                if p_scale == "binary":
                    add("ttest", o, [p],
                        {"value_col": o, "group_col": p},
                        f"t-test — {L(o)} by {L(p)}")
                elif p_scale == "categorical":
                    n_groups = int(df[p].nunique(dropna=True))
                    if n_groups == 2:
                        add("ttest", o, [p],
                            {"value_col": o, "group_col": p},
                            f"t-test — {L(o)} by {L(p)}")
                    elif n_groups >= 3:
                        add("anova", o, [p],
                            {"value_col": o, "group_col": p, "posthoc": "tukey"},
                            f"ANOVA + Tukey HSD — {L(o)} by {L(p)}")
                elif p_scale in ("continuous", "likert"):
                    add("pearson", o, [p],
                        {"x_col": p, "y_col": o},
                        f"Pearson — {L(p)} ~ {L(o)}")

            # categorical outcome
            elif o_scale == "categorical":
                if p_scale in ("binary", "categorical"):
                    add("chi2", o, [p],
                        {"row": o, "col": p},
                        f"Chi-square + Cramér's V — {L(o)} × {L(p)}")
                elif p_scale in ("continuous", "likert"):
                    n_groups = int(df[o].nunique(dropna=True))
                    if n_groups == 2:
                        add("ttest", o, [p],
                            {"value_col": p, "group_col": o},
                            f"t-test — {L(p)} by {L(o)}")
                    elif n_groups >= 3:
                        add("anova", o, [p],
                            {"value_col": p, "group_col": o, "posthoc": "tukey"},
                            f"ANOVA + Tukey HSD — {L(p)} by {L(o)}")

            # Every branch above only calls add() for scale combinations with a
            # valid test, or group counts of 2+ (needed to compare anything).
            # If nothing was added for this pair, record why rather than the
            # column silently vanishing from the results with no explanation.
            if len(specs) == specs_before:
                if o_scale == "multi_response" or p_scale == "multi_response":
                    skip(o, p, "Multi-response columns can't be paired directly with another column this way.")
                elif o_scale == "continuous" and p_scale in ("categorical", "binary") and int(df[p].nunique(dropna=True)) < 2:
                    skip(o, p, f"'{L(p)}' has fewer than 2 groups after removing missing values — nothing to compare.")
                elif o_scale == "categorical" and p_scale in ("continuous", "likert") and int(df[o].nunique(dropna=True)) < 2:
                    skip(o, p, f"'{L(o)}' has fewer than 2 groups after removing missing values — nothing to compare.")
                else:
                    skip(o, p, f"No applicable test for a {o_scale} outcome vs. a {p_scale} predictor.")

        # 4) Multivariate model for outcome with ≥2 numeric/binary predictors
        num_or_bin = [p for p, s in used_predictors if s in ("continuous", "likert", "binary")]
        if len(num_or_bin) >= 2:
            if o_scale == "binary":
                add("logistic_regression", o, num_or_bin,
                    {"outcome_col": o, "predictor_cols": num_or_bin, "col_labels": {p: L(p) for p in num_or_bin}},
                    f"Logistic regression — {L(o)} ~ {' + '.join(L(p) for p in num_or_bin)}")
            elif o_scale in ("continuous", "likert"):
                add("multiple_regression", o, num_or_bin,
                    {"outcome_col": o, "predictor_cols": num_or_bin, "weight_col": weight_col,
                     "col_labels": {p: L(p) for p in num_or_bin}},
                    f"Multiple regression — {L(o)} ~ {' + '.join(L(p) for p in num_or_bin)}")

        # 4b) Multinomial logistic — categorical outcome with 3+ classes gets only
        # pairwise chi2/anova above (one predictor at a time); a 3+-class outcome
        # also deserves a single multivariate model across all its predictors,
        # same way binary/continuous outcomes get logistic/multiple regression.
        if o_scale == "categorical" and used_predictors and int(df[o].dropna().nunique()) >= 3:
            covariate_cols = [p for p, _ in used_predictors]
            add("multinomial_logistic", o, covariate_cols,
                {"outcome_col": o, "predictor_cols": covariate_cols, "alpha": 0.05,
                 "col_labels": {p: L(p) for p in covariate_cols}},
                f"Multinomial logistic — {L(o)} ~ {' + '.join(L(p) for p in covariate_cols)}")

        # 4c) Causal add-ons — only fire when the researcher has explicitly tagged
        # a treatment column in Study Design; otherwise every outcome would get
        # a DiD/PSM test with no real treatment/control structure behind it.
        if treatment_col and treatment_col in df.columns and o_scale in ("continuous", "likert") and o != treatment_col:
            post_col = design.get("panel_wave_col")
            if post_col and post_col in df.columns and post_col not in (o, treatment_col) \
                    and int(df[post_col].dropna().nunique()) == 2:
                add("did", o, [treatment_col, post_col],
                    {"treatment_col": treatment_col, "post_col": post_col, "outcome_col": o},
                    f"Difference-in-Differences — {L(o)} ~ {L(treatment_col)} × {L(post_col)}")

            psm_covariates = [p for p in predictor_cols if p not in (treatment_col, post_col, o)][:8]
            if psm_covariates:
                add("psm", o, psm_covariates,
                    {"treatment_col": treatment_col, "outcome_col": o, "covariates": psm_covariates,
                     "col_labels": {p: L(p) for p in psm_covariates}},
                    f"Propensity Score Matching — {L(o)} ~ {L(treatment_col)}")

    # 5) If any outcome group is Likert items (≥3 items tagged), add reliability
    likert_items = [c for c, r in roles.items()
                    if (r or {}).get("scale") == "likert" and c in df.columns]
    if len(likert_items) >= 3:
        add("reliability", None, likert_items,
            {"item_cols": likert_items, "col_labels": {c: L(c) for c in likert_items}},
            f"Cronbach's α — {len(likert_items)} Likert items")

    # 6) Full matrices — one overview table each, not per-outcome, so they add
    # at most 2 extra tables to the whole battery regardless of how many
    # outcomes/predictors were picked.
    matrix_pool = list(dict.fromkeys([*outcome_cols, *predictor_cols]))
    numeric_pool = [c for c in matrix_pool if infer_scale(df[c], roles.get(c)) in ("continuous", "likert")]
    if len(numeric_pool) >= 2:
        add("correlation_matrix", None, numeric_pool,
            {"cols": numeric_pool, "col_labels": {c: L(c) for c in numeric_pool}},
            f"Correlation Matrix — {len(numeric_pool)} numeric variables")

    cat_pool = [c for c in matrix_pool
                if infer_scale(df[c], roles.get(c)) in ("categorical", "binary")
                and 2 <= int(df[c].dropna().nunique()) <= 12]
    if len(cat_pool) >= 2:
        add("cramers_matrix", None, cat_pool,
            {"cols": cat_pool, "col_labels": {c: L(c) for c in cat_pool}},
            f"Cramér's V Matrix — {len(cat_pool)} categorical variables")

    return {"specs": specs, "skipped": skipped}
