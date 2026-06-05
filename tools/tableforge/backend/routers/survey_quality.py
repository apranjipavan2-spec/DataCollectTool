"""Survey Data Quality (SDQ) endpoints — Phase 4.

Respondent-level quality checks that should run *before* analysis:
straight-lining, response time outliers, duplicates, missingness patterns
(incl. Little's MCAR), attention-check pass rates, and a combined per-respondent
quality score.

Distinct from the existing `quality.py` router, which handles column-level
type cleanup and audit logs. This router treats each row as a respondent and
each column as a question.
"""

from __future__ import annotations

import math
import traceback
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from scipy import stats as sp_stats

from ..shared import datasets, sanitize_for_json, apply_metrics_and_bins

router = APIRouter()


class BaseConfig(BaseModel):
    dataset_id: str
    filters: dict = {}


class StraightLiningConfig(BaseConfig):
    item_cols: list[str]
    threshold: float = 0.95  # fraction of identical responses → flagged


class ResponseTimeConfig(BaseConfig):
    duration_col: str | None = None
    start_col: str | None = None
    end_col: str | None = None
    fast_seconds: float | None = None
    slow_seconds: float | None = None


class DuplicatesConfig(BaseConfig):
    key_cols: list[str] | None = None  # if None → full-row duplicate check


class MissingnessConfig(BaseConfig):
    columns: list[str] | None = None  # default: all columns
    little_mcar: bool = True


class AttentionCheckConfig(BaseConfig):
    checks: list[dict]  # [{column, expected_value}]


class OverviewConfig(BaseConfig):
    item_cols: list[str] | None = None
    duration_col: str | None = None
    fast_seconds: float | None = None
    slow_seconds: float | None = None
    attention_checks: list[dict] | None = None
    id_col: str | None = None
    key_cols: list[str] | None = None


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────

def _load_df(cfg: BaseConfig) -> pd.DataFrame:
    if cfg.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[cfg.dataset_id]["df"].copy()
    df = apply_metrics_and_bins(df, cfg.dataset_id)
    for col, vals in (cfg.filters or {}).items():
        if vals and col in df.columns:
            df = df[df[col].astype(str).isin([str(v) for v in vals])]
    return df


def _safe_float(x) -> float | None:
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


# ─────────────────────────────────────────────────────────────────────
# 1. Straight-lining detection (low variance / identical answers across items)
# ─────────────────────────────────────────────────────────────────────
@router.post("/api/sdq/straight_lining")
async def sdq_straight_lining(cfg: StraightLiningConfig):
    """Flag respondents whose answers across the picked items are mostly identical.

    Returns a per-respondent variance + identical-fraction summary and a list of
    flagged row indices (identical-fraction ≥ threshold).
    """
    try:
        df = _load_df(cfg)
        cols = [c for c in cfg.item_cols if c in df.columns]
        if not cols:
            raise HTTPException(400, "No valid item columns selected")

        sub = df[cols].apply(pd.to_numeric, errors='coerce')

        # Per-row identical fraction = (max-count-of-any-value) / (non-null count)
        def row_metrics(row):
            non_null = row.dropna()
            n = len(non_null)
            if n == 0:
                return pd.Series({'n': 0, 'variance': None, 'identical_fraction': None, 'modal_value': None})
            counts = non_null.value_counts()
            modal_v = counts.index[0]
            frac = counts.iloc[0] / n
            var = float(non_null.var(ddof=0)) if n > 1 else 0.0
            return pd.Series({
                'n': n,
                'variance': var,
                'identical_fraction': float(frac),
                'modal_value': _safe_float(modal_v),
            })

        metrics = sub.apply(row_metrics, axis=1)
        df_out = pd.DataFrame({
            'row': df.index.tolist(),
            'n_items': metrics['n'].fillna(0).astype(int),
            'variance': metrics['variance'].astype(float).round(4),
            'identical_fraction': metrics['identical_fraction'].astype(float).round(4),
            'modal_value': metrics['modal_value'],
        })
        df_out['flagged'] = (df_out['identical_fraction'] >= cfg.threshold) & (df_out['n_items'] >= 3)

        n_flagged = int(df_out['flagged'].sum())
        # Summary row
        headers = ['Metric', 'Value']
        rows = [
            ['Respondents checked', int(len(df_out))],
            ['Items per respondent', len(cols)],
            ['Flag threshold (identical fraction)', f"≥ {cfg.threshold:.2f}"],
            ['Flagged respondents', n_flagged],
            ['% flagged', round(100 * n_flagged / max(1, len(df_out)), 2)],
        ]

        # Top flagged rows
        flagged_top = df_out[df_out['flagged']].sort_values('identical_fraction', ascending=False).head(50)
        flagged_headers = ['Row', 'N items answered', 'Variance', 'Identical %', 'Modal value']
        flagged_rows = [
            [int(r.row), int(r.n_items), r.variance, round(r.identical_fraction * 100, 1), r.modal_value]
            for r in flagged_top.itertuples()
        ]

        return sanitize_for_json({
            'headers': headers, 'rows': rows,
            'flagged_headers': flagged_headers, 'flagged_rows': flagged_rows,
            'n_flagged': n_flagged, 'n_total': int(len(df_out)),
            'table_type': 'sdq_straight_lining',
            'interpretation': f"{n_flagged} of {len(df_out)} respondents gave the same answer to ≥{int(cfg.threshold*100)}% of items — review for low-effort responding.",
        })
    except HTTPException:
        raise
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(500, str(e))


# ─────────────────────────────────────────────────────────────────────
# 2. Response time outliers
# ─────────────────────────────────────────────────────────────────────
@router.post("/api/sdq/response_time")
async def sdq_response_time(cfg: ResponseTimeConfig):
    """Flag respondents who finished suspiciously fast or slow.

    Either supply a `duration_col` (numeric seconds), or `start_col` + `end_col`
    (parseable as datetimes — difference computed in seconds).
    """
    try:
        df = _load_df(cfg)

        if cfg.duration_col and cfg.duration_col in df.columns:
            durations = pd.to_numeric(df[cfg.duration_col], errors='coerce')
        elif cfg.start_col and cfg.end_col and cfg.start_col in df.columns and cfg.end_col in df.columns:
            start = pd.to_datetime(df[cfg.start_col], errors='coerce')
            end = pd.to_datetime(df[cfg.end_col], errors='coerce')
            durations = (end - start).dt.total_seconds()
        else:
            raise HTTPException(400, "Provide either duration_col or both start_col + end_col")

        valid = durations.dropna()
        if len(valid) < 5:
            raise HTTPException(400, "Need at least 5 valid duration values")

        median = float(valid.median())
        q1 = float(valid.quantile(0.25))
        q3 = float(valid.quantile(0.75))
        iqr = q3 - q1
        # Default thresholds: median / 3 (fast) and median × 3 (slow)
        fast_default = max(30.0, median / 3)
        slow_default = max(median * 3, q3 + 3 * iqr)
        fast_thr = cfg.fast_seconds if cfg.fast_seconds is not None else fast_default
        slow_thr = cfg.slow_seconds if cfg.slow_seconds is not None else slow_default

        fast_mask = durations < fast_thr
        slow_mask = durations > slow_thr
        any_flag = fast_mask | slow_mask

        headers = ['Metric', 'Value']
        rows = [
            ['N respondents (valid durations)', int(valid.shape[0])],
            ['Median duration (s)', round(median, 1)],
            ['Q1 (25%)', round(q1, 1)],
            ['Q3 (75%)', round(q3, 1)],
            ['Fast threshold (s)', round(fast_thr, 1)],
            ['Slow threshold (s)', round(slow_thr, 1)],
            ['Too fast (count)', int(fast_mask.sum())],
            ['Too slow (count)', int(slow_mask.sum())],
            ['Any flag (count)', int(any_flag.sum())],
            ['% any flag', round(100 * any_flag.sum() / max(1, valid.shape[0]), 2)],
        ]

        flagged_top_idx = durations[any_flag].sort_values().index.tolist()[:50]
        flagged_headers = ['Row', 'Duration (s)', 'Flag']
        flagged_rows = []
        for i in flagged_top_idx:
            d = durations.loc[i]
            tag = 'fast' if d < fast_thr else 'slow'
            flagged_rows.append([int(i), round(float(d), 1), tag])

        return sanitize_for_json({
            'headers': headers, 'rows': rows,
            'flagged_headers': flagged_headers, 'flagged_rows': flagged_rows,
            'n_flagged': int(any_flag.sum()), 'n_total': int(valid.shape[0]),
            'table_type': 'sdq_response_time',
            'interpretation': f"{int(any_flag.sum())} of {valid.shape[0]} respondents fell outside the [{round(fast_thr)} – {round(slow_thr)} s] window — inspect for low-effort or interrupted sessions.",
        })
    except HTTPException:
        raise
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(500, str(e))


# ─────────────────────────────────────────────────────────────────────
# 3. Duplicate respondents
# ─────────────────────────────────────────────────────────────────────
@router.post("/api/sdq/duplicates")
async def sdq_duplicates(cfg: DuplicatesConfig):
    """Find duplicate rows. If `key_cols` is set → duplicates by those keys;
    otherwise full-row duplicate check.
    """
    try:
        df = _load_df(cfg)
        if cfg.key_cols:
            cols = [c for c in cfg.key_cols if c in df.columns]
            if not cols:
                raise HTTPException(400, "None of the key columns are present")
            dup_mask = df.duplicated(subset=cols, keep=False)
        else:
            cols = df.columns.tolist()
            dup_mask = df.duplicated(keep=False)

        n_dup_rows = int(dup_mask.sum())
        # Group duplicates and pick representative groups (up to 50 groups, 20 rows shown each)
        if n_dup_rows == 0:
            groups_headers, groups_rows = [], []
            distinct_groups = 0
        else:
            dup_df = df.loc[dup_mask, cols].copy()
            dup_df['__row'] = dup_df.index
            grouped = dup_df.groupby(cols, dropna=False)
            distinct_groups = len(grouped)
            shown = []
            for i, (key, sub) in enumerate(grouped):
                if i >= 50:
                    break
                rows_in_group = sub['__row'].tolist()
                preview_key = " | ".join(str(k) for k in (key if isinstance(key, tuple) else (key,)))
                shown.append([preview_key, len(rows_in_group), ", ".join(str(r) for r in rows_in_group[:8])])
            groups_headers = ['Key', 'Group size', 'Row indices (first 8)']
            groups_rows = shown

        headers = ['Metric', 'Value']
        rows = [
            ['Mode', 'Key-based' if cfg.key_cols else 'Full-row'],
            ['Key columns', ", ".join(cols) if cfg.key_cols else "(all columns)"],
            ['Total duplicate rows', n_dup_rows],
            ['Distinct duplicate groups', int(distinct_groups)],
            ['% rows duplicated', round(100 * n_dup_rows / max(1, len(df)), 2)],
        ]

        return sanitize_for_json({
            'headers': headers, 'rows': rows,
            'groups_headers': groups_headers, 'groups_rows': groups_rows,
            'n_flagged': n_dup_rows, 'n_total': int(len(df)),
            'table_type': 'sdq_duplicates',
            'interpretation': f"{n_dup_rows} rows belong to {int(distinct_groups)} duplicate group(s). Review before analysis — duplicates inflate sample size and bias estimates.",
        })
    except HTTPException:
        raise
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(500, str(e))


# ─────────────────────────────────────────────────────────────────────
# 4. Missingness patterns + Little's MCAR
# ─────────────────────────────────────────────────────────────────────
def _littles_mcar(df: pd.DataFrame) -> dict:
    """Little's MCAR test (Little 1988). Returns chi², df, p-value.

    Tests H0: missing values are MCAR. Significant p → not MCAR.
    Implementation: per missingness pattern, compute mean difference of observed
    variables vs grand mean weighted by pattern size; aggregate as χ².
    """
    num = df.select_dtypes(include=[np.number])
    if num.shape[1] < 2 or num.shape[0] < 10:
        return {"chi2": None, "df": None, "p": None, "error": "Need ≥2 numeric columns and ≥10 rows"}

    missing_indicator = num.isna()
    patterns = missing_indicator.apply(lambda r: tuple(r.values), axis=1)
    grand_means = num.mean()
    chi2 = 0.0
    df_total = 0
    for pat, rows_in_pat in patterns.groupby(patterns).indices.items():
        sub = num.iloc[rows_in_pat]
        obs_cols = [c for c, miss in zip(num.columns, pat) if not miss]
        if not obs_cols or len(rows_in_pat) < 2:
            continue
        pat_means = sub[obs_cols].mean()
        diff = pat_means - grand_means[obs_cols]
        cov = sub[obs_cols].cov().values
        try:
            cov_inv = np.linalg.pinv(cov)
        except np.linalg.LinAlgError:
            continue
        delta = diff.values
        chi2 += len(rows_in_pat) * float(delta @ cov_inv @ delta)
        df_total += len(obs_cols)
    # Approximate df = sum(observed vars per pattern) − num.shape[1]
    df_approx = max(1, df_total - num.shape[1])
    p = 1 - sp_stats.chi2.cdf(chi2, df_approx) if chi2 > 0 else 1.0
    return {"chi2": round(chi2, 4), "df": df_approx, "p": round(float(p), 6)}


@router.post("/api/sdq/missingness")
async def sdq_missingness(cfg: MissingnessConfig):
    """Per-column missingness + per-row missingness + (optionally) Little's MCAR test."""
    try:
        df = _load_df(cfg)
        cols = cfg.columns if cfg.columns else df.columns.tolist()
        cols = [c for c in cols if c in df.columns]
        sub = df[cols]

        n_rows = len(sub)
        col_miss = sub.isna().sum()
        col_pct = (col_miss / max(1, n_rows) * 100).round(2)

        headers = ['Column', 'Missing N', 'Missing %', 'Present N']
        rows = []
        for c in cols:
            rows.append([str(c), int(col_miss[c]), float(col_pct[c]), int(n_rows - col_miss[c])])
        rows.sort(key=lambda r: -r[2])

        # Row-level missingness
        row_missing_count = sub.isna().sum(axis=1)
        row_bins = row_missing_count.value_counts().sort_index()
        row_dist_headers = ['# missing per row', '# rows']
        row_dist_rows = [[int(k), int(v)] for k, v in row_bins.items()]

        # Pattern table (top 10 patterns)
        patterns = sub.isna().apply(lambda r: ''.join('M' if x else '.' for x in r), axis=1)
        pattern_counts = patterns.value_counts().head(10)
        pattern_headers = ['Pattern (M=missing)', 'Count', '%']
        pattern_rows = [[p, int(c), round(100 * c / n_rows, 2)] for p, c in pattern_counts.items()]

        # Little's MCAR
        mcar = _littles_mcar(sub) if cfg.little_mcar else {"chi2": None, "df": None, "p": None}

        return sanitize_for_json({
            'headers': headers, 'rows': rows,
            'row_dist_headers': row_dist_headers, 'row_dist_rows': row_dist_rows,
            'pattern_headers': pattern_headers, 'pattern_rows': pattern_rows,
            'mcar_chi2': mcar.get('chi2'), 'mcar_df': mcar.get('df'), 'mcar_p': mcar.get('p'),
            'n_rows': int(n_rows), 'n_cols': int(len(cols)),
            'table_type': 'sdq_missingness',
            'interpretation': _missingness_interpret(rows, mcar.get('p')),
        })
    except HTTPException:
        raise
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(500, str(e))


def _missingness_interpret(col_rows, mcar_p):
    if not col_rows:
        return "No data."
    worst = col_rows[0]
    bits = [f"Worst column: {worst[0]} missing {worst[2]}%"]
    if mcar_p is not None:
        if mcar_p < 0.05:
            bits.append(f"Little's MCAR rejected (p={mcar_p}) — missingness is NOT random; consider MAR/MNAR adjustment.")
        else:
            bits.append(f"Little's MCAR not rejected (p={mcar_p}) — missingness plausibly random.")
    return ". ".join(bits) + "."


# ─────────────────────────────────────────────────────────────────────
# 5. Attention checks
# ─────────────────────────────────────────────────────────────────────
@router.post("/api/sdq/attention_checks")
async def sdq_attention_checks(cfg: AttentionCheckConfig):
    """Score each respondent on attention-check pass/fail.

    `checks` shape: [{"column": "ac1", "expected_value": "3"}, ...]
    """
    try:
        df = _load_df(cfg)
        if not cfg.checks:
            raise HTTPException(400, "Provide at least one attention check")

        per_check_headers = ['Check column', 'Expected', 'Pass N', 'Pass %', 'Fail N']
        per_check_rows = []
        passes = np.zeros(len(df), dtype=int)
        fails = np.zeros(len(df), dtype=int)
        valid = np.zeros(len(df), dtype=int)
        for ch in cfg.checks:
            col = ch.get('column')
            expected = ch.get('expected_value')
            if col not in df.columns:
                per_check_rows.append([str(col), str(expected), 'col missing', None, None])
                continue
            this_match = df[col].astype(str) == str(expected)
            this_not_null = df[col].notna()
            n_pass = int(this_match.sum())
            n_fail = int((~this_match & this_not_null).sum())
            pct = round(100 * n_pass / max(1, len(df)), 2)
            per_check_rows.append([str(col), str(expected), n_pass, pct, n_fail])
            passes += this_match.astype(int).values
            fails += (~this_match & this_not_null).astype(int).values
            valid += this_not_null.astype(int).values

        n_checks = len(cfg.checks)
        all_pass = passes == n_checks
        any_fail = fails >= 1
        flagged_idx = df.index[any_fail].tolist()[:50]
        flagged_headers = ['Row', 'Checks failed']
        flagged_rows = [[int(i), int(fails[df.index.get_loc(i)])] for i in flagged_idx]

        summary_headers = ['Metric', 'Value']
        summary_rows = [
            ['Attention checks defined', n_checks],
            ['Respondents passing all', int(all_pass.sum())],
            ['Respondents failing ≥1', int(any_fail.sum())],
            ['% failing ≥1', round(100 * any_fail.sum() / max(1, len(df)), 2)],
        ]

        return sanitize_for_json({
            'headers': summary_headers, 'rows': summary_rows,
            'per_check_headers': per_check_headers, 'per_check_rows': per_check_rows,
            'flagged_headers': flagged_headers, 'flagged_rows': flagged_rows,
            'n_flagged': int(any_fail.sum()), 'n_total': int(len(df)),
            'table_type': 'sdq_attention_checks',
            'interpretation': f"{int(any_fail.sum())} of {len(df)} respondents failed at least one of {n_checks} attention check(s).",
        })
    except HTTPException:
        raise
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(500, str(e))


# ─────────────────────────────────────────────────────────────────────
# 6. Combined overview (per-respondent quality score)
# ─────────────────────────────────────────────────────────────────────
@router.post("/api/sdq/overview")
async def sdq_overview(cfg: OverviewConfig):
    """Combined per-respondent quality score (0–100) using whichever checks were
    configured: straight-lining, fast/slow response times, missingness ratio,
    failed attention checks, and duplicate-row flag.

    Each respondent loses points for each triggered flag. Default penalties:
      straight-lining: −25
      fast response:   −20
      slow response:   −10
      attention check fails (each): −15
      missingness > 50%: −20
      duplicate row: −20
    """
    try:
        df = _load_df(cfg)
        n = len(df)
        if n == 0:
            return {'headers': ['Metric', 'Value'], 'rows': [], 'table_type': 'sdq_overview'}

        score = np.full(n, 100.0)
        flags = [[] for _ in range(n)]

        # Straight-lining
        if cfg.item_cols:
            sub = df[[c for c in cfg.item_cols if c in df.columns]].apply(pd.to_numeric, errors='coerce')
            for i, (_, row) in enumerate(sub.iterrows()):
                non_null = row.dropna()
                if len(non_null) >= 3:
                    frac = non_null.value_counts().iloc[0] / len(non_null)
                    if frac >= 0.95:
                        score[i] -= 25
                        flags[i].append('straight-lining')

        # Response time
        durations = None
        if cfg.duration_col and cfg.duration_col in df.columns:
            durations = pd.to_numeric(df[cfg.duration_col], errors='coerce').values
        if durations is not None:
            valid_mask = np.isfinite(durations)
            if valid_mask.sum() >= 5:
                med = np.nanmedian(durations[valid_mask])
                fast_thr = cfg.fast_seconds if cfg.fast_seconds is not None else max(30.0, med / 3)
                slow_thr = cfg.slow_seconds if cfg.slow_seconds is not None else med * 3
                for i, d in enumerate(durations):
                    if not np.isfinite(d):
                        continue
                    if d < fast_thr:
                        score[i] -= 20
                        flags[i].append('fast')
                    elif d > slow_thr:
                        score[i] -= 10
                        flags[i].append('slow')

        # Attention checks
        if cfg.attention_checks:
            for ch in cfg.attention_checks:
                col = ch.get('column')
                expected = ch.get('expected_value')
                if col not in df.columns:
                    continue
                mismatch = (df[col].astype(str) != str(expected)) & df[col].notna()
                for i, m in enumerate(mismatch.values):
                    if m:
                        score[i] -= 15
                        flags[i].append(f'ac:{col}')

        # Missingness > 50%
        row_miss = df.isna().sum(axis=1) / max(1, df.shape[1])
        for i, m in enumerate(row_miss.values):
            if m > 0.5:
                score[i] -= 20
                flags[i].append('high-missing')

        # Duplicates
        key_cols = cfg.key_cols if cfg.key_cols else None
        if key_cols:
            valid_keys = [c for c in key_cols if c in df.columns]
            if valid_keys:
                dup = df.duplicated(subset=valid_keys, keep=False)
                for i, d in enumerate(dup.values):
                    if d:
                        score[i] -= 20
                        flags[i].append('duplicate')

        score = np.clip(score, 0, 100)

        # Banding
        def band(s):
            if s >= 80: return 'good'
            if s >= 60: return 'borderline'
            if s >= 40: return 'poor'
            return 'reject'
        bands = [band(s) for s in score]
        band_counts = pd.Series(bands).value_counts().to_dict()

        headers = ['Band', 'N', '%']
        rows = []
        for b in ['good', 'borderline', 'poor', 'reject']:
            c = int(band_counts.get(b, 0))
            rows.append([b, c, round(100 * c / n, 2)])

        # Per-respondent details (top 100 lowest scores)
        order = np.argsort(score)
        worst_idx = order[:100]
        detail_headers = ['Row', 'Score', 'Band', 'Flags']
        detail_rows = []
        for i in worst_idx:
            detail_rows.append([
                int(df.index[i]),
                round(float(score[i]), 1),
                bands[i],
                ', '.join(flags[i]) if flags[i] else '—',
            ])

        return sanitize_for_json({
            'headers': headers, 'rows': rows,
            'detail_headers': detail_headers, 'detail_rows': detail_rows,
            'n_total': int(n),
            'mean_score': round(float(np.mean(score)), 1),
            'median_score': round(float(np.median(score)), 1),
            'table_type': 'sdq_overview',
            'interpretation': f"Mean quality score = {round(float(np.mean(score)), 1)} / 100. Bands: good {band_counts.get('good', 0)}, borderline {band_counts.get('borderline', 0)}, poor {band_counts.get('poor', 0)}, reject {band_counts.get('reject', 0)}.",
        })
    except HTTPException:
        raise
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(500, str(e))
