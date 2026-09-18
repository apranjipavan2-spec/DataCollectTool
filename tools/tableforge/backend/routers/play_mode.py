"""Play Mode — deterministic per-column analysis recommender + optional AI cross-column suggestions.

Two phases:
  1. Deterministic profile: scan every column, compute a fingerprint
     (type, n_unique, missingness, basic stats, fingerprint tags), then map
     to eligible analyses via a rule table. NO AI in this step.
  2. Optional AI step: sends a compact profile JSON to the configured LLM
     (via _call_llm) to surface cross-column test recommendations.

The AI step reuses the same provider plumbing as the rest of TableForge — keys
are resolved by _load_ai_cfg (file → env → FieldGovern sidecar → DB).
"""

from __future__ import annotations

import json
import re
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..shared import datasets, sanitize_for_json, _is_multi_choice, column_roles
from .ai import _call_llm, _load_ai_cfg

router = APIRouter()


# ── Fingerprint detection ──────────────────────────────────────────────────

LIKERT_TOKENS = {
    "strongly", "agree", "disagree", "neutral", "satisfied", "dissatisfied",
    "never", "rarely", "sometimes", "often", "always",
    "poor", "fair", "good", "excellent",
}
ID_NAME_HINTS = ("id", "_id", "uuid", "code", "respondent", "sno", "serial")
GEO_NAME_HINTS = ("district", "state", "tehsil", "block", "village", "pincode", "ward", "city", "country")
DATE_NAME_HINTS = ("date", "_at", "_on", "timestamp", "month", "year")


def _safe_num(x):
    try:
        if x is None or pd.isna(x):
            return None
        return float(x)
    except Exception:
        return None


def _profile_column(name: str, series: pd.Series, role_override: str | None = None) -> dict:
    n_total = int(len(series))
    n_missing = int(series.isna().sum())
    non_null = series.dropna()
    n_unique = int(non_null.nunique())
    missingness = (n_missing / n_total) if n_total else 0.0

    top_values: list[dict] = []
    if n_unique > 0:
        vc = non_null.astype(str).value_counts().head(5)
        top_values = [{"v": str(idx), "count": int(c)} for idx, c in vc.items()]

    is_numeric = pd.api.types.is_numeric_dtype(series)
    is_datetime = pd.api.types.is_datetime64_any_dtype(series)

    fingerprint_tags: list[str] = []
    numeric_stats: dict | None = None
    text_stats: dict | None = None

    # ID-like
    if n_unique == n_total and n_total > 0:
        fingerprint_tags.append("id-like")
    elif n_unique > 0.95 * n_total and n_total > 50:
        fingerprint_tags.append("id-like")
    if any(h in name.lower() for h in ID_NAME_HINTS) and n_unique > 0.5 * n_total:
        if "id-like" not in fingerprint_tags:
            fingerprint_tags.append("id-like")

    # Missingness flags
    if missingness > 0.5:
        fingerprint_tags.append("high-missing")
    elif missingness > 0.3:
        fingerprint_tags.append("moderate-missing")

    # Numeric path
    if is_numeric:
        numeric_stats = {
            "min": _safe_num(non_null.min()),
            "max": _safe_num(non_null.max()),
            "mean": _safe_num(non_null.mean()),
            "median": _safe_num(non_null.median()),
            "std": _safe_num(non_null.std()),
        }
        # Skewness, integer-only
        try:
            numeric_stats["skew"] = _safe_num(non_null.skew())
        except Exception:
            numeric_stats["skew"] = None
        all_int = bool(non_null.dropna().apply(lambda v: float(v).is_integer()).all()) if len(non_null) else False
        numeric_stats["integer_only"] = all_int

        # Binary / Likert / continuous classification
        if n_unique == 2:
            fingerprint_tags.append("binary")
        elif all_int and 3 <= n_unique <= 7:
            fingerprint_tags.append("likert-like")
        elif all_int and 8 <= n_unique <= 20:
            fingerprint_tags.append("ordinal-int")
        elif n_unique > 20:
            fingerprint_tags.append("continuous")
        else:
            fingerprint_tags.append("low-cardinality-numeric")
    elif is_datetime:
        fingerprint_tags.append("datetime")
        try:
            numeric_stats = {
                "min": str(non_null.min()),
                "max": str(non_null.max()),
            }
        except Exception:
            pass
    else:
        # Text path
        s_str = non_null.astype(str)
        mean_len = float(s_str.str.len().mean()) if len(s_str) else 0.0
        text_stats = {"mean_len": round(mean_len, 1), "max_len": int(s_str.str.len().max()) if len(s_str) else 0}

        # Multi-response (comma-separated) — reuses existing detector
        if _is_multi_choice(series):
            fingerprint_tags.append("mr-comma")
        # Likert-token sniff
        elif any(tok in " ".join(top_values_t["v"].lower() for top_values_t in top_values) for tok in LIKERT_TOKENS):
            fingerprint_tags.append("likert-text")
        elif n_unique == 2:
            fingerprint_tags.append("binary-text")
        elif mean_len > 80 or n_unique > 0.7 * len(non_null):
            fingerprint_tags.append("free-text")
        elif n_unique <= 20:
            fingerprint_tags.append("nominal-low")
        elif n_unique <= 60:
            fingerprint_tags.append("nominal-medium")
        else:
            fingerprint_tags.append("nominal-high")

    # Date by name
    if not is_datetime and any(h in name.lower() for h in DATE_NAME_HINTS):
        fingerprint_tags.append("date-like-name")

    # Geographic by name
    if any(h in name.lower() for h in GEO_NAME_HINTS):
        fingerprint_tags.append("geographic")

    # Suggested scale
    if "binary" in fingerprint_tags or "binary-text" in fingerprint_tags:
        suggested_scale = "binary"
    elif "likert-like" in fingerprint_tags or "likert-text" in fingerprint_tags:
        suggested_scale = "likert"
    elif "continuous" in fingerprint_tags:
        suggested_scale = "continuous"
    elif "ordinal-int" in fingerprint_tags:
        suggested_scale = "ordinal"
    elif "mr-comma" in fingerprint_tags:
        suggested_scale = "multi_response"
    elif "datetime" in fingerprint_tags or "date-like-name" in fingerprint_tags:
        suggested_scale = "date"
    elif any(t.startswith("nominal") for t in fingerprint_tags):
        suggested_scale = "nominal"
    elif "free-text" in fingerprint_tags:
        suggested_scale = "free_text"
    elif "id-like" in fingerprint_tags:
        suggested_scale = "id"
    else:
        suggested_scale = "unknown"

    # Manual override wins
    effective_scale = role_override or suggested_scale

    return {
        "name": name,
        "inferred_type": "numeric" if is_numeric else "datetime" if is_datetime else "text",
        "suggested_scale": suggested_scale,
        "effective_scale": effective_scale,
        "n_total": n_total,
        "n_unique": n_unique,
        "n_missing": n_missing,
        "missingness": round(missingness, 3),
        "top_values": top_values,
        "fingerprint_tags": fingerprint_tags,
        "numeric_stats": sanitize_for_json(numeric_stats) if numeric_stats else None,
        "text_stats": text_stats,
    }


# ── Eligibility rule table ─────────────────────────────────────────────────

def _eligible_analyses(profile: dict) -> list[dict]:
    """Map a per-column profile to a ranked list of applicable analyses.

    Each analysis: {id, label, kind, priority, why, action}.
      priority: 1 (primary) → 3 (situational)
      action  : the frontend action name to dispatch (matches RibbonBar action ids)
    """
    scale = profile["effective_scale"]
    tags = set(profile["fingerprint_tags"])
    out: list[dict] = []

    # Universal — descriptive for any numeric, frequency for any low-cardinality
    if profile["inferred_type"] == "numeric" and "id-like" not in tags:
        out.append({"id": "stat_descriptive", "label": "Descriptives",
                    "kind": "univariate", "priority": 1,
                    "why": "Numeric column — basic mean/SD/median/range."})
        out.append({"id": "stat_normality", "label": "Normality (Shapiro)",
                    "kind": "univariate", "priority": 2,
                    "why": "Checks if values are normally distributed (gates t-test vs Mann-Whitney choice)."})
        out.append({"id": "stat_outlier", "label": "Outliers (Z / MAD)",
                    "kind": "univariate", "priority": 2,
                    "why": "Detects extreme values that may distort means/regressions."})

    if scale in {"nominal", "binary", "ordinal", "likert"} or "low-cardinality-numeric" in tags:
        out.append({"id": "stat_frequency", "label": "Frequency Distribution",
                    "kind": "univariate", "priority": 1,
                    "why": "Counts and %s per category."})

    if scale == "binary":
        out.append({"id": "stat_crosstab", "label": "χ² Cross-tab (pick another cat)",
                    "kind": "bivariate", "priority": 1,
                    "why": "Test association with any other categorical/binary column."})
        out.append({"id": "stat_ttest", "label": "t-test / Mann-Whitney (as group)",
                    "kind": "bivariate", "priority": 1,
                    "why": "Compare any continuous outcome between the two groups."})
        out.append({"id": "stat_logistic_regression", "label": "Logistic Regression (as outcome)",
                    "kind": "model", "priority": 2,
                    "why": "Predict this binary outcome from multiple predictors."})

    if scale == "continuous" or "continuous" in tags:
        out.append({"id": "stat_correlation", "label": "Correlation (pick another numeric)",
                    "kind": "bivariate", "priority": 1,
                    "why": "Pearson / Spearman / Kendall vs any numeric column."})
        out.append({"id": "stat_ttest", "label": "t-test / ANOVA (split by group)",
                    "kind": "bivariate", "priority": 1,
                    "why": "Compare means across a binary or categorical group."})
        out.append({"id": "stat_anova", "label": "One-way ANOVA",
                    "kind": "bivariate", "priority": 1,
                    "why": "Compare means across 3+ groups."})
        out.append({"id": "stat_regression", "label": "Linear Regression (as outcome)",
                    "kind": "model", "priority": 2,
                    "why": "Predict from one or more numeric/categorical predictors."})
        out.append({"id": "stat_multiple_regression", "label": "Multiple Regression",
                    "kind": "model", "priority": 2,
                    "why": "Multi-predictor model with VIF + diagnostics."})

    if scale == "likert":
        out.append({"id": "likert", "label": "Likert Analysis (with other items)",
                    "kind": "scale", "priority": 1,
                    "why": "Top-2/bottom-2 box, net agree, composite + Cronbach's α."})
        out.append({"id": "stat_kruskal", "label": "Kruskal-Wallis (vs group)",
                    "kind": "bivariate", "priority": 2,
                    "why": "Non-parametric ANOVA — preferred for ordinal Likert."})
        out.append({"id": "stat_reliability", "label": "Reliability (Cronbach's α)",
                    "kind": "scale", "priority": 2,
                    "why": "When pairing with other Likert items in a scale."})

    if scale == "ordinal":
        out.append({"id": "stat_spearman", "label": "Spearman ρ (with another ordinal/numeric)",
                    "kind": "bivariate", "priority": 1,
                    "why": "Rank-based correlation appropriate for ordinal."})
        out.append({"id": "stat_kruskal", "label": "Kruskal-Wallis (vs group)",
                    "kind": "bivariate", "priority": 2,
                    "why": "Non-parametric comparison across groups."})

    if scale == "nominal":
        out.append({"id": "stat_crosstab", "label": "χ² Cross-tab",
                    "kind": "bivariate", "priority": 1,
                    "why": "Test association with any other categorical column."})
        if profile["n_unique"] <= 20:
            out.append({"id": "stat_anova", "label": "ANOVA (as group on continuous)",
                        "kind": "bivariate", "priority": 2,
                        "why": "Compare a continuous outcome's mean across these categories."})

    if scale == "multi_response":
        out.append({"id": "multi_response", "label": "MR Frequencies + Co-occurrence",
                    "kind": "mr", "priority": 1,
                    "why": "% of cases, Jaccard pairs, by-group, exclusive."})

    if scale == "date":
        out.append({"id": "stat_descriptive", "label": "Date Range / Period Counts",
                    "kind": "univariate", "priority": 1,
                    "why": "Earliest/latest, frequencies by month/year."})

    if "geographic" in tags:
        out.append({"id": "geo_summary", "label": "Geo Summary",
                    "kind": "geo", "priority": 2,
                    "why": "Aggregate metrics by geographic level."})

    # Sort by priority
    out.sort(key=lambda x: (x["priority"], x["id"]))
    return out


# ── API ────────────────────────────────────────────────────────────────────

class ProfileConfig(BaseModel):
    dataset_id: str
    overrides: dict[str, str] = {}  # column → forced scale


class AIComboConfig(BaseModel):
    dataset_id: str
    overrides: dict[str, str] = {}
    max_suggestions: int = 12


def _build_profile(dataset_id: str, overrides: dict[str, str]) -> dict:
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df: pd.DataFrame = datasets[dataset_id]["df"]
    roles = column_roles.get(dataset_id, {}) if column_roles else {}

    cols_out: list[dict] = []
    for col in df.columns:
        override = overrides.get(col)
        # Also respect saved role.scale if no explicit override
        if not override and col in roles:
            r = roles[col]
            r_scale = getattr(r, "scale", None) if not isinstance(r, dict) else r.get("scale")
            if r_scale:
                override = r_scale
        prof = _profile_column(col, df[col], role_override=override)
        prof["eligible_analyses"] = _eligible_analyses(prof)
        cols_out.append(prof)

    # Summary tallies
    tally: dict[str, int] = {}
    for c in cols_out:
        tally[c["effective_scale"]] = tally.get(c["effective_scale"], 0) + 1

    return {
        "dataset_id": dataset_id,
        "n_rows": int(len(df)),
        "n_cols": int(len(df.columns)),
        "columns": cols_out,
        "scale_tally": tally,
    }


@router.post("/api/play/profile")
async def play_profile(config: ProfileConfig):
    return _build_profile(config.dataset_id, config.overrides)


@router.post("/api/play/recompute")
async def play_recompute(config: ProfileConfig):
    """Same as /profile — semantic alias for explicit override-driven re-runs."""
    return _build_profile(config.dataset_id, config.overrides)


@router.post("/api/play/ai-combinations")
async def play_ai_combinations(config: AIComboConfig):
    """Send the compact profile to the configured LLM for cross-column test ideas."""
    cfg = _load_ai_cfg()
    if not cfg.get("api_key"):
        raise HTTPException(400, "AI not configured. Set a key in Org Settings → AI (or via /api/ai/config).")

    profile = _build_profile(config.dataset_id, config.overrides)

    # Build compact column list — drop id-like and free-text, trim everything else
    compact: list[dict] = []
    for c in profile["columns"]:
        tags = set(c["fingerprint_tags"])
        if "id-like" in tags:
            continue
        compact.append({
            "i": len(compact) + 1,
            "name": c["name"],
            "scale": c["effective_scale"],
            "uniques": c["n_unique"],
            "miss_pct": int(c["missingness"] * 100),
            "tags": c["fingerprint_tags"][:3],
        })

    if not compact:
        return {"suggestions": [], "note": "No analyzable columns after filtering id-like / free-text."}

    # Hard cap to keep prompt size reasonable
    MAX_COLS = 80
    truncated = len(compact) > MAX_COLS
    compact = compact[:MAX_COLS]

    prompt = (
        "You are a survey-analysis assistant. Given a list of columns with their fingerprints, "
        f"recommend the {config.max_suggestions} most valuable CROSS-COLUMN statistical analyses to run. "
        "Prefer combinations that the analyst is likely to find decision-useful in a survey context.\n\n"
        "RULES:\n"
        "- Use ONLY the column NAMES exactly as listed. Refer to columns by their 'i' index and name.\n"
        "- For each suggestion, specify: outcome_col (or primary), predictor_col(s), test (one of: "
        "ttest, mann_whitney, anova, kruskal, chi2_crosstab, pearson, spearman, kendall, "
        "logistic_regression, multiple_regression, mcnemar, paired_ttest, wilcoxon, friedman, "
        "likert, multi_response_by_group, observer_concordance), and one-line rationale.\n"
        "- Skip pairs that include id-like / free-text. Don't pair a column with itself.\n"
        "- Respond ONLY with a JSON array. No prose. Each element: "
        '{"outcome": "...", "predictors": ["..."], "test": "...", "why": "..."}\n\n'
        f"Columns ({len(compact)}{' — truncated from larger set' if truncated else ''}):\n"
        f"{json.dumps(compact, ensure_ascii=False)}"
    )

    raw = await _call_llm(cfg, prompt)
    # Robust JSON extraction
    suggestions: list = []
    try:
        suggestions = json.loads(raw)
    except Exception:
        m = re.search(r"\[[\s\S]*\]", raw or "")
        if m:
            try:
                suggestions = json.loads(m.group(0))
            except Exception:
                suggestions = []

    # Validate & match column names
    actual_cols = {c["name"] for c in profile["columns"]}
    cleaned: list[dict] = []
    for s in suggestions if isinstance(suggestions, list) else []:
        if not isinstance(s, dict):
            continue
        outcome = s.get("outcome", "")
        preds = s.get("predictors", []) or []
        if not isinstance(preds, list):
            preds = [preds]
        # Drop suggestions where any referenced column doesn't exist
        ok = (not outcome or outcome in actual_cols) and all(p in actual_cols for p in preds)
        if not ok:
            continue
        cleaned.append({
            "outcome": outcome,
            "predictors": [p for p in preds if p in actual_cols],
            "test": s.get("test", "unknown"),
            "why": s.get("why", ""),
        })

    return {
        "suggestions": cleaned[: config.max_suggestions],
        "n_columns_sent": len(compact),
        "truncated": truncated,
        "provider": cfg.get("provider"),
        "model": cfg.get("model"),
    }
