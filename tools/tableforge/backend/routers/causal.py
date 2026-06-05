"""Causal inference endpoints (Phase 6 — Survey Analysis Studio).

Two impact-evaluation primitives commonly requested by survey researchers:
  * Difference-in-Differences (DiD): pre/post × treatment/control 2×2 design
  * Propensity Score Matching (PSM): 1-NN matching on logit-based propensity

Both return the standard analysis-result shape used by Auto-Analyze + StatisticalTables.
"""

from __future__ import annotations

import math
import traceback
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from scipy import stats as sp_stats

from ..shared import datasets, apply_metrics_and_bins, sanitize_for_json, add_audit_log
from . import inferential_utils as iu

router = APIRouter()


class DiDConfig(BaseModel):
    dataset_id: str
    treatment_col: str           # binary 0/1 or Yes/No
    post_col: str                # binary 0/1 (post=1 after intervention)
    outcome_col: str             # continuous
    treatment_value: str | None = None   # value of treatment_col counted as treated; default = max
    post_value: str | None = None        # value of post_col counted as post; default = max
    filters: dict = {}


class PSMConfig(BaseModel):
    dataset_id: str
    treatment_col: str
    outcome_col: str
    covariates: list[str]
    treatment_value: str | None = None
    k: int = 1                   # k-nearest neighbours
    caliper: float | None = None # max distance (in propensity logit) to accept a match
    filters: dict = {}


def _load_df(dataset_id: str, filters: dict) -> pd.DataFrame:
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[dataset_id]["df"].copy()
    df = apply_metrics_and_bins(df, dataset_id)
    for col, vals in (filters or {}).items():
        if vals and col in df.columns:
            df = df[df[col].astype(str).isin([str(v) for v in vals])]
    return df


def _coerce_binary(series: pd.Series, target_value: str | None) -> pd.Series:
    """Return a 0/1 series. If target_value is given, that value → 1; else max unique → 1."""
    if target_value is not None:
        return (series.astype(str) == str(target_value)).astype(int)
    # Try numeric first
    num = pd.to_numeric(series, errors="coerce")
    if num.notna().sum() > 0:
        uniq = sorted(num.dropna().unique().tolist())
        if len(uniq) == 2:
            return (num == uniq[1]).astype(int)
    # Fall back to string: pick the lexicographically larger value as "1"
    uniq_s = sorted([str(x) for x in series.dropna().unique().tolist()])
    if len(uniq_s) >= 2:
        return (series.astype(str) == uniq_s[-1]).astype(int)
    return pd.Series([0] * len(series), index=series.index)


@router.post("/api/causal/did")
def difference_in_differences(config: DiDConfig):
    """Standard 2×2 DiD via OLS: outcome ~ treatment + post + treatment:post.

    The interaction coefficient is the average treatment effect on the treated (ATT)
    under the parallel-trends assumption.
    """
    try:
        df = _load_df(config.dataset_id, config.filters)
        for c in [config.treatment_col, config.post_col, config.outcome_col]:
            if c not in df.columns:
                raise HTTPException(400, f"Column not found: {c}")

        t = _coerce_binary(df[config.treatment_col], config.treatment_value)
        p = _coerce_binary(df[config.post_col], config.post_value)
        y = pd.to_numeric(df[config.outcome_col], errors="coerce")
        mask = y.notna() & t.notna() & p.notna()
        t, p, y = t[mask], p[mask], y[mask]
        if len(y) < 8:
            raise HTTPException(400, f"Not enough non-null rows ({len(y)}) for DiD")

        # Cell means
        cells = {}
        for (tv, pv), grp in y.groupby([t, p]):
            cells[(int(tv), int(pv))] = (float(grp.mean()), int(len(grp)))
        m_ct_pre  = cells.get((0, 0), (np.nan, 0))
        m_ct_post = cells.get((0, 1), (np.nan, 0))
        m_tr_pre  = cells.get((1, 0), (np.nan, 0))
        m_tr_post = cells.get((1, 1), (np.nan, 0))
        if any(c[1] == 0 for c in [m_ct_pre, m_ct_post, m_tr_pre, m_tr_post]):
            raise HTTPException(400, "DiD needs all four cells (treatment×post) to be non-empty")

        # OLS via statsmodels for SE/CI of the interaction
        import statsmodels.api as sm
        X = pd.DataFrame({
            "treat": t.astype(float),
            "post": p.astype(float),
            "treat_x_post": (t * p).astype(float),
        })
        X = sm.add_constant(X, has_constant="add")
        model = sm.OLS(y.astype(float).values, X.values).fit()
        # Index: const=0, treat=1, post=2, treat_x_post=3
        ate = float(model.params[3])
        se = float(model.bse[3])
        p_val = float(model.pvalues[3])
        ci_lo, ci_hi = (float(model.conf_int()[3][0]), float(model.conf_int()[3][1]))

        # Sanity: the interaction equals the DiD of cell means
        did_manual = (m_tr_post[0] - m_tr_pre[0]) - (m_ct_post[0] - m_ct_pre[0])

        headers = ["Group", "Pre (mean)", "Post (mean)", "Change", "N pre", "N post"]
        rows = [
            ["Control",   round(m_ct_pre[0], 4),  round(m_ct_post[0], 4),  round(m_ct_post[0] - m_ct_pre[0], 4),  m_ct_pre[1], m_ct_post[1]],
            ["Treatment", round(m_tr_pre[0], 4),  round(m_tr_post[0], 4),  round(m_tr_post[0] - m_tr_pre[0], 4),  m_tr_pre[1], m_tr_post[1]],
            ["DiD (ATT)", "—", "—", round(ate, 4), "—", "—"],
        ]

        stars = ""
        if p_val < 0.001: stars = "***"
        elif p_val < 0.01: stars = "**"
        elif p_val < 0.05: stars = "*"

        interp_lines = [
            f"DiD ATT = {ate:.4f} ({stars}), 95% CI [{ci_lo:.4f}, {ci_hi:.4f}], p = {iu.fmt_p(p_val)}.",
            f"Treatment changed by {(m_tr_post[0] - m_tr_pre[0]):.4f} vs control's {(m_ct_post[0] - m_ct_pre[0]):.4f}.",
            "Assumes parallel pre-trends; verify with at least one pre-intervention wave before drawing causal conclusions." if abs(ate) > 0 else "",
        ]
        warnings = []
        if abs(did_manual - ate) > 1e-6:
            warnings.append(f"Cell-mean DiD ({did_manual:.6f}) differs from regression ATE ({ate:.6f}); check for unbalanced cells.")
        if min(m_ct_pre[1], m_ct_post[1], m_tr_pre[1], m_tr_post[1]) < 30:
            warnings.append(f"Small cells (min N = {min(m_ct_pre[1], m_ct_post[1], m_tr_pre[1], m_tr_post[1])}); SE may be unstable.")

        add_audit_log(config.dataset_id, "causal_did",
                      f"DiD: outcome={config.outcome_col} treat={config.treatment_col} post={config.post_col} ATT={ate:.4f} p={p_val:.4f}")

        return sanitize_for_json({
            "headers": headers, "rows": rows,
            "row_count": len(rows), "col_count": len(headers),
            "table_type": "did",
            "test": {
                "stat": round(ate / se, 4) if se > 0 else None,
                "p": round(p_val, 6), "df": int(model.df_resid),
                "effect_size": {"name": "ATT (DiD)", "value": round(ate, 4)},
                "ci": [round(ci_lo, 4), round(ci_hi, 4)],
                "se": round(se, 4),
            },
            "interpretation": " ".join([s for s in interp_lines if s]),
            "warnings": warnings,
        })
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"DiD error: {e}")


@router.post("/api/causal/psm")
def propensity_score_matching(config: PSMConfig):
    """1-NN propensity-score matching on the logit of P(treat=1 | covariates).

    Returns the ATT estimate on the matched sample plus a balance table comparing
    standardized mean differences before vs after matching.
    """
    try:
        if not config.covariates:
            raise HTTPException(400, "PSM requires at least one covariate")
        df = _load_df(config.dataset_id, config.filters)
        needed = [config.treatment_col, config.outcome_col, *config.covariates]
        for c in needed:
            if c not in df.columns:
                raise HTTPException(400, f"Column not found: {c}")

        t = _coerce_binary(df[config.treatment_col], config.treatment_value)
        y = pd.to_numeric(df[config.outcome_col], errors="coerce")

        # Build covariate matrix: numeric cast for each, one-hot for non-numeric (top categories)
        cov_frame = pd.DataFrame(index=df.index)
        for cov in config.covariates:
            s = df[cov]
            num = pd.to_numeric(s, errors="coerce")
            if num.notna().sum() >= 0.6 * len(s):
                cov_frame[cov] = num
            else:
                dummies = pd.get_dummies(s.astype(str), prefix=cov, drop_first=True)
                cov_frame = pd.concat([cov_frame, dummies], axis=1)

        mask = t.notna() & y.notna() & cov_frame.notna().all(axis=1)
        t, y, X = t[mask], y[mask], cov_frame[mask].astype(float)
        if int(t.sum()) < 5 or int((1 - t).sum()) < 5:
            raise HTTPException(400, f"PSM needs ≥5 treated and ≥5 control rows (have {int(t.sum())}/{int((1-t).sum())})")

        import statsmodels.api as sm
        Xc = sm.add_constant(X, has_constant="add")
        logit = sm.Logit(t.astype(int).values, Xc.values).fit(disp=0, maxiter=200)
        ps = logit.predict(Xc.values)
        # Use logit of propensity for matching distance (standard practice)
        eps = 1e-6
        ps_clip = np.clip(ps, eps, 1 - eps)
        lp = np.log(ps_clip / (1 - ps_clip))

        treated_idx = np.where(t.values == 1)[0]
        control_idx = np.where(t.values == 0)[0]
        lp_control = lp[control_idx]

        # 1-NN match (with replacement) — simple, robust, fast
        matches = []
        for ti in treated_idx:
            d = np.abs(lp_control - lp[ti])
            j = int(np.argmin(d))
            dist = float(d[j])
            if config.caliper is not None and dist > config.caliper:
                continue
            matches.append((ti, int(control_idx[j]), dist))

        if not matches:
            raise HTTPException(400, "No matches found (caliper too tight?)")

        y_t = y.values[[m[0] for m in matches]]
        y_c = y.values[[m[1] for m in matches]]
        diff = y_t - y_c
        att = float(np.mean(diff))
        se = float(np.std(diff, ddof=1) / np.sqrt(len(diff))) if len(diff) > 1 else 0.0
        # Wald test
        if se > 0:
            z = att / se
            p_val = float(2 * (1 - sp_stats.norm.cdf(abs(z))))
            ci_lo, ci_hi = att - 1.96 * se, att + 1.96 * se
        else:
            z, p_val, ci_lo, ci_hi = float("nan"), float("nan"), float("nan"), float("nan")

        # Balance table: standardized mean difference (SMD) before vs after
        def smd(a: np.ndarray, b: np.ndarray) -> float:
            sa, sb = float(np.var(a, ddof=1)), float(np.var(b, ddof=1))
            pooled = math.sqrt((sa + sb) / 2) if (sa + sb) > 0 else 0
            return float((np.mean(a) - np.mean(b)) / pooled) if pooled > 0 else 0.0

        treat_mask = (t.values == 1)
        ctrl_mask = (t.values == 0)
        matched_treat_idx = np.array([m[0] for m in matches])
        matched_ctrl_idx = np.array([m[1] for m in matches])

        balance_rows = []
        for col in X.columns:
            vals = X[col].values
            pre = smd(vals[treat_mask], vals[ctrl_mask])
            post = smd(vals[matched_treat_idx], vals[matched_ctrl_idx])
            balance_rows.append([col, round(pre, 3), round(post, 3),
                                  "✓" if abs(post) < 0.1 else ("⚠" if abs(post) < 0.25 else "✗")])

        headers = ["Covariate", "SMD pre", "SMD post", "Balanced?"]
        balance_rows.append(["—", "—", "—", "—"])
        balance_rows.append(["ATT", "—", round(att, 4), f"p={iu.fmt_p(p_val)}"])

        warnings: list[str] = []
        skipped = int(t.sum()) - len(matches)
        if skipped > 0:
            warnings.append(f"{skipped} treated units had no match within caliper and were dropped.")
        worst = max((abs(r[2]) for r in balance_rows[:-2] if isinstance(r[2], (int, float))), default=0)
        if worst >= 0.25:
            warnings.append(f"Some covariates remain imbalanced after matching (max |SMD| = {worst:.2f}); consider a wider covariate set or different specification.")

        add_audit_log(config.dataset_id, "causal_psm",
                      f"PSM: outcome={config.outcome_col} treat={config.treatment_col} ATT={att:.4f} matches={len(matches)}")

        return sanitize_for_json({
            "headers": headers, "rows": balance_rows,
            "row_count": len(balance_rows), "col_count": len(headers),
            "table_type": "psm",
            "test": {
                "stat": round(z, 4) if not math.isnan(z) else None,
                "p": round(p_val, 6) if not math.isnan(p_val) else None,
                "df": None,
                "effect_size": {"name": "ATT (matched)", "value": round(att, 4)},
                "ci": [round(ci_lo, 4), round(ci_hi, 4)] if not math.isnan(ci_lo) else None,
                "se": round(se, 4),
            },
            "interpretation": (
                f"Matched ATT = {att:.4f}, 95% CI [{ci_lo:.4f}, {ci_hi:.4f}], p = {iu.fmt_p(p_val)}. "
                f"{len(matches)} treated units matched 1-NN on logit-propensity from {len(X.columns)} covariates."
            ),
            "warnings": warnings,
        })
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"PSM error: {e}")


# ───────────────────────── Mixed-effects (random intercept) ─────────────────────────


class MixedLMConfig(BaseModel):
    dataset_id: str
    outcome_col: str                              # continuous DV
    fixed_cols: list[str] = []                    # fixed-effect predictors
    group_col: str                                # cluster ID (e.g., village_id)
    random_slope_col: str | None = None           # optional random slope on this column
    use_weights: bool = True                      # use StudyDesign.weight_col if available
    filters: dict = {}                            # project-filter rows (column → allowed values)


def _split_terms(sub: pd.DataFrame, fixed_cols: list[str]) -> list[str]:
    """Build formula terms with C() for categorical predictors."""
    terms = []
    for c in fixed_cols:
        if pd.api.types.is_numeric_dtype(sub[c]):
            terms.append(f"Q('{c}')")
        else:
            terms.append(f"C(Q('{c}'))")
    return terms


@router.post("/api/causal/mixed_lm")
def causal_mixed_lm(cfg: MixedLMConfig):
    """Mixed-effects (random intercept) linear model for clustered surveys.

    Common case: respondents nested in villages — outcome ~ fixed + (1 | village).
    Optionally adds a random slope on a single column.
    """
    if cfg.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        import statsmodels.api as sm
        import statsmodels.formula.api as smf

        df = datasets[cfg.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, cfg.dataset_id)
        for col, vals in (cfg.filters or {}).items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        needed = [cfg.outcome_col, cfg.group_col] + list(cfg.fixed_cols)
        if cfg.random_slope_col:
            needed.append(cfg.random_slope_col)
        for c in needed:
            if c not in df.columns:
                raise HTTPException(400, f"Column not found: {c}")

        sub = df[needed].copy()
        sub[cfg.outcome_col] = pd.to_numeric(sub[cfg.outcome_col], errors="coerce")
        # Optional survey weights
        from ..shared import study_designs
        sd = study_designs.get(cfg.dataset_id) or {}
        w_col = sd.get("weight_col") if cfg.use_weights else None
        if w_col and w_col in df.columns:
            sub["__w__"] = pd.to_numeric(df[w_col].reindex(sub.index), errors="coerce")
            sub = sub.dropna()
            sub = sub[sub["__w__"] > 0]
        else:
            sub = sub.dropna()

        if len(sub) < max(20, len(cfg.fixed_cols) + 5):
            raise HTTPException(400, f"Not enough data ({len(sub)}) for mixed-effects model")

        n_groups = sub[cfg.group_col].nunique()
        if n_groups < 2:
            raise HTTPException(400, f"Need ≥2 cluster groups (found {n_groups})")

        terms = _split_terms(sub, cfg.fixed_cols)
        if not terms:
            formula = f"Q('{cfg.outcome_col}') ~ 1"
        else:
            formula = f"Q('{cfg.outcome_col}') ~ " + " + ".join(terms)

        # Build re_formula if random slope requested
        re_formula = None
        if cfg.random_slope_col:
            re_formula = f"~ Q('{cfg.random_slope_col}')"

        kwargs = dict(data=sub, groups=sub[cfg.group_col].astype(str))
        if re_formula:
            kwargs["re_formula"] = re_formula
        try:
            md = smf.mixedlm(formula, **kwargs)
            mdf = md.fit(method="lbfgs", reml=True)
        except Exception as e:
            raise HTTPException(400, f"MixedLM fit failed: {e}")

        # Fixed effects table
        headers = ["Variable", "β", "SE", "z", "p", "95% CI", "Sig"]
        rows = []
        for name in mdf.params.index:
            if name == "Group Var" or "Var" in str(name):
                continue
            try:
                conf = mdf.conf_int().loc[name]
                p_val = mdf.pvalues.get(name, float("nan"))
                rows.append([
                    str(name),
                    iu.safe_round(mdf.params[name]),
                    iu.safe_round(mdf.bse[name]),
                    iu.safe_round(mdf.tvalues[name]),
                    iu.safe_round(p_val, 6),
                    f"[{iu.safe_round(conf[0])}, {iu.safe_round(conf[1])}]",
                    iu.sig_stars(p_val),
                ])
            except Exception:
                continue

        # Variance components
        rows.append([""] * len(headers))
        rows.append(["── Random effects ──", "", "", "", "", "", ""])
        cov_re = mdf.cov_re
        try:
            for idx in cov_re.index:
                var_val = float(cov_re.loc[idx, idx])
                rows.append([f"Var({idx})", iu.safe_round(var_val), "", "", "", "", ""])
        except Exception:
            pass
        try:
            resid_var = float(mdf.scale)
            rows.append(["Residual Var", iu.safe_round(resid_var), "", "", "", "", ""])
            # ICC for random intercept model
            if cov_re.shape[0] == 1:
                grp_var = float(cov_re.iloc[0, 0])
                icc = grp_var / (grp_var + resid_var) if (grp_var + resid_var) > 0 else 0.0
                rows.append(["ICC", iu.safe_round(icc),
                             "(>0.05 noteworthy clustering; >0.10 strong)", "", "", "", ""])
        except Exception:
            pass

        rows.append([""] * len(headers))
        rows.append(["N obs", int(mdf.nobs), "", "", "", "", ""])
        rows.append(["N groups", int(n_groups), f"groups by {cfg.group_col}", "", "", "", ""])
        rows.append(["AIC", iu.safe_round(getattr(mdf, "aic", float("nan"))), "", "", "", "", ""])

        interp = (
            f"Random-intercept model: outcome '{cfg.outcome_col}' nested in {n_groups} "
            f"clusters of '{cfg.group_col}'. β coefficients are fixed-effect estimates "
            f"after accounting for cluster-level variation."
        )
        if w_col:
            interp += f" Weighted by '{w_col}'."

        return sanitize_for_json({
            "headers": headers,
            "rows": rows,
            "row_count": len(rows),
            "col_count": len(headers),
            "table_type": "mixed_lm",
            "interpretation": interp,
            "weighted": bool(w_col),
            "weight_col": w_col,
            "n_groups": int(n_groups),
            "n_obs": int(mdf.nobs),
        })
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"MixedLM error: {e}")
