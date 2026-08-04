from fastapi import APIRouter, HTTPException
from typing import Optional
from pydantic import BaseModel
import pandas as pd
import numpy as np
import traceback

from ..shared import (
    datasets, custom_metrics, custom_bins, column_type_overrides, study_designs,
    sanitize_for_json, _is_multi_choice, _col_is_text, apply_metrics_and_bins
)


def _get_weight_col(dataset_id: str) -> Optional[str]:
    sd = study_designs.get(dataset_id) or {}
    wc = sd.get("weight_col")
    return wc if isinstance(wc, str) and wc else None


def _make_weighted_aggs(w_series: pd.Series) -> dict:
    """Closure-based weighted agg callables compatible with pivot_table/groupby.

    The Series passed to each callable preserves its original index, so we can
    look up the corresponding weights even after groupby slicing.
    """
    w = w_series

    def _slice(x):
        if len(x) == 0:
            return None, None
        wi = w.reindex(x.index)
        m = x.notna() & wi.notna() & (wi > 0)
        if not m.any():
            return None, None
        return x[m], wi[m]

    def wmean(x):
        xv, wv = _slice(x)
        if xv is None:
            return np.nan
        try:
            return float(np.average(xv.astype(float), weights=wv.astype(float)))
        except (ValueError, TypeError):
            return np.nan

    def wcount(x):
        xv, wv = _slice(x)
        if xv is None:
            return 0.0
        return float(wv.astype(float).sum())

    def wsum(x):
        xv, wv = _slice(x)
        if xv is None:
            return np.nan
        try:
            return float((xv.astype(float) * wv.astype(float)).sum())
        except (ValueError, TypeError):
            return np.nan

    def wmedian(x):
        xv, wv = _slice(x)
        if xv is None:
            return np.nan
        try:
            vals = xv.astype(float).values
            ws = wv.astype(float).values
            order = np.argsort(vals)
            vals_s = vals[order]
            ws_s = ws[order]
            c = np.cumsum(ws_s)
            cutoff = c[-1] / 2.0
            idx = int(np.searchsorted(c, cutoff))
            return float(vals_s[min(idx, len(vals_s) - 1)])
        except (ValueError, TypeError):
            return np.nan

    def wstd(x):
        xv, wv = _slice(x)
        if xv is None or len(xv) < 2:
            return np.nan
        try:
            vals = xv.astype(float).values
            ws = wv.astype(float).values
            wmean_v = float(np.average(vals, weights=ws))
            var = float(np.average((vals - wmean_v) ** 2, weights=ws))
            return float(np.sqrt(var))
        except (ValueError, TypeError):
            return np.nan

    def wvar(x):
        s = wstd(x)
        return s * s if not (s is None or np.isnan(s)) else np.nan

    return {
        "mean": wmean,
        "count": wcount,
        "sum": wsum,
        "median": wmedian,
        "std": wstd,
        "var": wvar,
    }


def _compute_net_row(df: pd.DataFrame, row_col: str, members: list, values: list[dict],
                     value_labels: list[str], w_aggs: dict | None) -> dict:
    """Aggregate a subset of df (where row_col ∈ members) using the same aggs as the table's values.
    Returns a dict mapping value labels → aggregated value.
    """
    if not members or row_col not in df.columns:
        return {}
    members_s = [str(m) for m in members]
    sub = df[df[row_col].astype(str).isin(members_s)]
    if sub.empty:
        return {lbl: 0 for lbl in value_labels}
    out: dict = {}
    for v, lbl in zip(values, value_labels):
        field = v.get("field", "")
        agg = v.get("agg", "sum")
        if field == "*":
            field = row_col
            agg = "count"
        if field not in sub.columns:
            out[lbl] = None
            continue
        if w_aggs and agg in w_aggs:
            try:
                out[lbl] = w_aggs[agg](sub[field])
            except Exception:
                out[lbl] = None
            continue
        try:
            col = pd.to_numeric(sub[field], errors="coerce")
            if agg in ("sum", "running_total", "cumulative_sum"):
                out[lbl] = float(col.sum())
            elif agg == "count":
                out[lbl] = int(sub[field].notna().sum())
            elif agg == "count_distinct":
                out[lbl] = int(sub[field].nunique(dropna=True))
            elif agg in ("average", "mean"):
                out[lbl] = float(col.mean()) if col.notna().any() else None
            elif agg == "median":
                out[lbl] = float(col.median()) if col.notna().any() else None
            elif agg == "min":
                out[lbl] = float(col.min()) if col.notna().any() else None
            elif agg == "max":
                out[lbl] = float(col.max()) if col.notna().any() else None
            elif agg == "std":
                out[lbl] = float(col.std(ddof=1)) if col.notna().sum() > 1 else None
            elif agg == "var":
                out[lbl] = float(col.var(ddof=1)) if col.notna().sum() > 1 else None
            else:
                out[lbl] = float(col.sum())
        except Exception:
            out[lbl] = None
    return out


router = APIRouter()


class TableConfig(BaseModel):
    dataset_id: str
    rows: list[str] = []
    columns: list[str] = []
    values: list[dict] = []
    filters: dict = {}
    subtotals: bool = False
    subtotals_position: str = "bottom"
    subtotal_pct_base: str = "grand_total"  # "grand_total" | "subtotal"
    grand_total: bool = True
    grand_total_rows: Optional[bool] = None    # None = follow grand_total
    grand_total_columns: Optional[bool] = None # None = follow grand_total
    grand_total_combined: bool = False         # Club all values into single Grand Total column
    grand_total_agg: str = "auto"              # "auto" | "sum" | "average" — how the row Grand Total combines value columns
    column_type_overrides: dict = {}           # {col: "multi_choice"|"text"|...} carried per-request so reloads don't race
    sort_by: Optional[str] = None
    sort_order: str = "asc"
    multi_sort: list[dict] = []     # [{field, order}] for multi-key sorting
    custom_sort_orders: dict = {}   # {field: [cat1, cat2, ...]} for manual category ordering
    missing_data: str = ""
    date_groupings: dict = {}       # {col_name: "year"|"quarter"|"month"|"week"|"day"}
    blank_suppress: bool = False    # hide rows where all value cols are 0/blank
    hide_subgroup: bool = False     # hide detail rows, show only subtotals/grand totals
    # NET rows: e.g., NET Agree = sum of {"Strongly Agree","Agree"} for a Likert row variable
    # [{label, members, position?}] position ∈ {"end","after_last_member","before_first_member"}
    net_rows: list[dict] = []
    # Table chains: optional upstream table whose tabulated result feeds this table
    source_table_id: Optional[str] = None
    upstream_chain: Optional[list[dict]] = None  # [{rows, columns, values, filters, ...}] of the source table


AGG_MAP = {
    "sum": "sum", "count": "count", "average": "mean", "mean": "mean",
    "min": "min", "max": "max", "median": "median",
    "std": "std", "var": "var",
    "count_distinct": "nunique", "first": "first", "last": "last",
}

PERCENT_AGGS = {"pct_grand", "pct_row", "pct_col", "pct_parent_row", "pct_parent_col", "pct_subgroup"}
SPECIAL_AGGS = {"running_total", "cumulative_sum", "rank_asc", "rank_desc", "index"}
# Aggregations that require numeric values — auto-downgrade to 'count' for text/multi-choice columns
NUMERIC_ONLY_AGGS = {"sum", "average", "mean", "min", "max", "median", "std", "var"}


@router.post("/api/tabulate")
async def tabulate(config: TableConfig):
    """Generate a tabulated result based on the provided configuration."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    try:
        df = datasets[config.dataset_id]["df"].copy()
        original_row_count = len(df)

        # Apply custom metrics and bins
        df = apply_metrics_and_bins(df, config.dataset_id)

        # Detect and explode multi-choice columns used in rows/columns/values
        # Check user-set type overrides first, then auto-detect
        multi_choice_cols = []
        all_used_cols = list(set(config.rows + config.columns + list(config.filters.keys())))
        from ..shared import get_overrides as _get_overrides
        # Merge server-side overrides with any carried in the request. The request
        # copy wins so a freshly-reloaded project keeps its multi_choice columns
        # even before the async changeColumnType calls land server-side.
        _type_overrides = {**_get_overrides(config.dataset_id), **(config.column_type_overrides or {})}
        for col_name in all_used_cols:
            override = _type_overrides.get(col_name)
            if override == "multi_choice":
                multi_choice_cols.append(col_name)
            elif override in ("text", "numeric", "date"):
                pass  # User explicitly set this type — respect it, not multi_choice
            elif col_name in df.columns and _is_multi_choice(df[col_name]):
                multi_choice_cols.append(col_name)

        # Also check VALUE columns that are NOT already covered by rows/columns
        # These are exploded so that count = individual responses (not just respondent count)
        # Only applies when the value column is multi_choice type (by override or auto-detection)
        for v in config.values:
            vc = v.get("field", "")
            if vc and vc not in multi_choice_cols and vc not in all_used_cols:
                override = _type_overrides.get(vc)
                if override == "multi_choice":
                    multi_choice_cols.append(vc)
                elif override is None and vc in df.columns and _is_multi_choice(df[vc]):
                    multi_choice_cols.append(vc)

        # Explode multi-choice columns: split comma-separated values into separate rows.
        # NOTE: "None"/"null" are NOT treated as missing here — in a survey multi-choice
        # question "None" (e.g. "None of the above") is a legitimate answer the user wants
        # counted. Only true serialization artifacts / actual NaN count as missing.
        _nan_strs = {'nan', 'NaN', 'NaT', '', '<NA>'}
        for mc_col in multi_choice_cols:
            def _split_multi(x, _ns=_nan_strs):
                if pd.isna(x):
                    return [np.nan]
                s = str(x).strip()
                if s in _ns:
                    return [np.nan]
                if ',' in s:
                    parts = [p.strip() for p in s.split(',') if p.strip() and p.strip() not in _ns]
                    return parts if parts else [np.nan]
                return [s]
            df[mc_col] = df[mc_col].apply(_split_multi)
            df = df.explode(mc_col, ignore_index=True)
            # Drop rows where the exploded value is NaN/NaT (original nulls)
            mask = df[mc_col].apply(lambda x: pd.notna(x) and str(x).strip() not in _nan_strs)
            df = df[mask].reset_index(drop=True)

        # Apply date groupings (create derived grouping columns)
        for col, freq in (config.date_groupings or {}).items():
            if col in df.columns:
                derived_name = f"{col} ({freq})"
                freq_map = {"year": "YE", "quarter": "QE", "month": "ME", "week": "W", "day": "D"}
                try:
                    col_dt = pd.to_datetime(df[col], errors="coerce")
                    df[derived_name] = col_dt.dt.to_period(freq_map.get(freq, "ME")).astype(str)
                    # Replace original col reference with derived col in rows/columns
                    config.rows = [derived_name if r == col else r for r in config.rows]
                    config.columns = [derived_name if c == col else c for c in config.columns]
                except Exception:
                    pass

        # Apply filters
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        if df.empty:
            return {"headers": [], "rows": [], "row_count": 0, "col_count": 0}

        if not config.values:
            return {"headers": [], "rows": [], "row_count": 0, "col_count": 0}

        # Clean NaT/NaN from groupby/pivot fields to prevent index errors
        # "None" is intentionally NOT here: it's a legitimate categorical/survey answer
        # ("None of the above"). Only true NaN (via pd.isna) and serialization artifacts
        # count as blank.
        _bad_strs = {'nan', 'NaN', 'NaT', '<NA>'}
        for _gc in config.rows + config.columns:
            if _gc in df.columns:
                _nat_mask = df[_gc].apply(lambda v: pd.isna(v) or str(v).strip() in _bad_strs)
                if _nat_mask.any():
                    # A column that's entirely (or mostly) NaN keeps a numeric dtype
                    # (float64) since pandas has no way to infer it's text-typed.
                    # Assigning the "(blank)" string into a numeric column raises
                    # (or, on older pandas, silently warns before a future break) —
                    # cast to object first so the fill always succeeds.
                    if df[_gc].dtype != object:
                        df[_gc] = df[_gc].astype(object)
                    df.loc[_nat_mask, _gc] = "(blank)"

        # Resolve survey weights once (used in both groupby and pivot paths)
        _weight_col = _get_weight_col(config.dataset_id)
        _w_aggs = None
        _is_weighted_run = False
        if _weight_col and _weight_col in df.columns:
            _w_numeric = pd.to_numeric(df[_weight_col], errors="coerce")
            if _w_numeric.notna().sum() > 0:
                _w_aggs = _make_weighted_aggs(_w_numeric)
                _is_weighted_run = True

        # Simple case: rows only (no column pivoting)
        if config.rows and not config.columns:
            agg_dict = {}
            post_calcs = []  # For percentage calculations after groupby
            safe_fields = []

            for v in config.values:
                field = v["field"]
                agg = v.get("agg", "sum")
                # Handle '*' (row count) — use first row field as proxy with count agg
                if field == "*":
                    field = config.rows[0]
                    agg = "count"
                safe_field = field
                if field in config.rows:
                    safe_field = f"__temp_{field}__"
                    df[safe_field] = df[field]
                safe_fields.append(safe_field)
                show_as = v.get("show_as", "normal")
                combo_show_as = v.get("combo_show_as", "normal")
                decimals = v.get("decimals", 2)
                vlabel = v.get("label", "")

                # Legacy compat: if agg is a show_as type (from old frontend), map it
                if agg in PERCENT_AGGS or agg in SPECIAL_AGGS:
                    show_as = agg
                    agg = "sum"

                # Auto-downgrade numeric agg to 'count' for text/multi-choice columns
                # (e.g. occupation codes "1","2","1,2","3,4,5" are categorical, not summable)
                if agg in NUMERIC_ONLY_AGGS and _col_is_text(df, safe_field):
                    agg = "count"

                # _col_is_text only samples the first 50 non-null rows, so a column
                # that's clean there but has a stray non-numeric cell later (blank
                # marker, "N/A", typo) still reaches sum/mean as raw object dtype and
                # crashes pandas with a str/int TypeError. Coerce a private copy for
                # numeric aggs — bad cells become NaN and are skipped; other value
                # entries on the same field (e.g. a Count alongside this Sum) keep
                # seeing the original column.
                if agg in NUMERIC_ONLY_AGGS and str(df[safe_field].dtype) == "object":
                    numsafe_field = f"__temp_numsafe_{len(safe_fields)}__"
                    df[numsafe_field] = pd.to_numeric(df[safe_field], errors="coerce")
                    safe_field = numsafe_field
                    safe_fields.append(safe_field)

                if agg in AGG_MAP:
                    if _w_aggs and agg in _w_aggs:
                        agg_dict[safe_field] = _w_aggs[agg]
                    else:
                        agg_dict[safe_field] = AGG_MAP[agg]
                else:
                    agg_dict[safe_field] = _w_aggs["sum"] if _w_aggs else "sum"

                # Queue show_as post-calculation
                if show_as and show_as != "normal":
                    post_calcs.append({"field": safe_field, "agg": show_as, "label": vlabel, "decimals": decimals})
                # Queue combo post-calculation (value + % in parentheses). The combo's
                # own decimal places (for the parenthetical %) can differ from the
                # main value's decimal places (for the number before it).
                if combo_show_as and combo_show_as != "normal":
                    combo_decimals = v.get("combo_decimals", decimals)
                    post_calcs.append({"field": safe_field, "agg": f"combo_{combo_show_as}", "label": vlabel, "decimals": combo_decimals, "value_decimals": decimals})

            result = df.groupby(config.rows, dropna=False).agg(agg_dict).reset_index()

            for sf in safe_fields:
                if sf != sf.replace("__temp_", "") and sf in df.columns:
                    df.drop(columns=[sf], inplace=True, errors="ignore")

            # Build column labels and fix post_calcs labels to match
            value_labels = []
            for v in config.values:
                label = v.get("label", f"{v.get('agg', 'sum').title()} of {v['field']}")
                value_labels.append(label)

            col_names = list(config.rows) + value_labels
            result.columns = col_names

            # Fix post_calcs: replace empty/missing labels with the actual column name
            label_by_field = {}
            for v, lbl in zip(config.values, value_labels):
                sf = v["field"]
                if sf in config.rows:
                    sf = f"__temp_{sf}__"
                label_by_field[sf] = lbl
            for pc in post_calcs:
                if not pc["label"] or pc["label"] not in result.columns:
                    pc["label"] = label_by_field.get(pc["field"], pc["label"])

            # Post-calculations (show_as transforms, combo display)
            for pc in post_calcs:
                label = pc["label"]
                agg = pc["agg"]
                dec = pc.get("decimals") if pc.get("decimals") is not None else 2
                if label not in result.columns:
                    continue

                is_combo = agg.startswith("combo_")
                actual_agg = agg.replace("combo_", "") if is_combo else agg

                if is_combo:
                    # Store original values for combo display
                    orig_values = result[label].copy()

                # Apply the show_as transformation
                def apply_show_as(series, show_as, rows, result_df, dec_places):
                    if show_as == "pct_grand":
                        total = series.sum()
                        if total != 0:
                            return (series / total * 100).round(dec_places)
                    elif show_as == "running_total":
                        return series.cumsum().round(dec_places)
                    elif show_as == "rank_asc":
                        return series.rank(ascending=True).astype(int)
                    elif show_as == "rank_desc":
                        return series.rank(ascending=False).astype(int)
                    elif show_as == "index":
                        base = series.mean()
                        if base and base != 0:
                            return (series / base * 100).round(dec_places)
                    elif show_as == "pct_parent_row" and len(rows) > 1:
                        parent_col = rows[0]
                        if parent_col in result_df.columns:
                            parent_sums = result_df.groupby(parent_col)[series.name].transform("sum")
                            return (series / parent_sums.replace(0, np.nan) * 100).round(dec_places)
                    elif show_as == "pct_parent_col" and len(rows) > 1:
                        parent_col = rows[0]
                        if parent_col in result_df.columns:
                            parent_sums = result_df.groupby(parent_col)[series.name].transform("sum")
                            return (series / parent_sums.replace(0, np.nan) * 100).round(dec_places)
                    elif show_as == "pct_subgroup" and len(rows) > 1:
                        parent_col = rows[0]
                        if parent_col in result_df.columns:
                            parent_sums = result_df.groupby(parent_col)[series.name].transform("sum")
                            return (series / parent_sums.replace(0, np.nan) * 100).round(dec_places)
                    elif show_as == "pct_subgroup" and len(rows) == 1:
                        total = series.sum()
                        if total != 0:
                            return (series / total * 100).round(dec_places)
                    elif show_as == "pct_row":
                        return series  # handled later in pivot path
                    elif show_as == "pct_col":
                        return series  # handled later in pivot path
                    elif show_as == "pct_point_change":
                        return series.diff().round(dec_places)
                    elif show_as == "change_vs_prev":
                        shifted = series.shift(1)
                        return ((series - shifted) / shifted.replace(0, np.nan) * 100).round(dec_places)
                    elif show_as == "z_score":
                        mean = series.mean()
                        std = series.std()
                        if std and std != 0:
                            return ((series - mean) / std).round(dec_places)
                    elif show_as == "percentile_rank":
                        return series.rank(pct=True).mul(100).round(dec_places)
                    elif show_as == "cagr":
                        # CAGR relative to first value over position
                        first_val = series.iloc[0] if len(series) > 0 else None
                        if first_val and first_val != 0:
                            periods = pd.Series(range(len(series)), index=series.index)
                            cagr_vals = ((series / first_val) ** (1 / periods.replace(0, 1)) - 1) * 100
                            cagr_vals.iloc[0] = 0  # First period has no growth
                            return cagr_vals.round(dec_places)
                    return series.round(dec_places) if dec_places is not None else series

                if is_combo:
                    # Compute the percentage values
                    pct_values = apply_show_as(result[label].copy(), actual_agg, config.rows, result, dec)
                    # Format as "value (pct%)" — handle NaN/Inf gracefully. The main
                    # value uses its own decimal setting (value_decimals); the
                    # parenthetical % uses the combo's decimal setting (dec).
                    val_dec = pc.get("value_decimals") if pc.get("value_decimals") is not None else dec
                    missing_fill = config.missing_data if config.missing_data else ""
                    combo_col = []
                    for ov, pv in zip(orig_values, pct_values):
                        try:
                            ov_is_na = (isinstance(ov, float) and (pd.isna(ov) or np.isinf(ov))) if not isinstance(ov, str) else False
                            pv_is_na = (isinstance(pv, float) and (pd.isna(pv) or np.isinf(pv))) if not isinstance(pv, str) else ("nan" in str(pv).lower())
                            if ov_is_na:
                                combo_col.append(missing_fill)
                            elif pv_is_na:
                                ov_str = f"{ov:,.{val_dec}f}" if isinstance(ov, (int, float)) else str(ov)
                                combo_col.append(f"{ov_str}\n({missing_fill or '0'}%)")
                            else:
                                ov_str = f"{ov:,.{val_dec}f}" if isinstance(ov, (int, float)) else str(ov)
                                pv_str = f"{pv:.{dec}f}%" if isinstance(pv, (int, float)) else str(pv)
                                combo_col.append(f"{ov_str}\n({pv_str})")
                        except (ValueError, TypeError):
                            combo_col.append(missing_fill if ov_is_na else str(ov))
                    result[label] = combo_col
                else:
                    result[label] = apply_show_as(result[label], actual_agg, config.rows, result, dec)

            # Apply decimal rounding for ALL value fields (regardless of show_as)
            # Skip columns that are already combo-formatted strings
            combo_labels = {pc["label"] for pc in post_calcs if pc["agg"].startswith("combo_")}
            for v, lbl in zip(config.values, value_labels):
                dec = v.get("decimals") if v.get("decimals") is not None else 2
                if dec is not None and lbl in result.columns and lbl not in combo_labels:
                    try:
                        numeric_vals = pd.to_numeric(result[lbl], errors="coerce")
                        result[lbl] = numeric_vals.round(int(dec))
                    except Exception:
                        pass

            # Statistical display formatting (Mean±SD, SE, CI, stars, N, arrows, missing indicator)
            for v, lbl in zip(config.values, value_labels):
                if lbl not in result.columns:
                    continue
                dec = v.get("decimals") if v.get("decimals") is not None else 2
                missing_ind = v.get("missing_indicator", "")
                change_arrows = v.get("change_arrows", False)
                show_mean_sd = v.get("show_mean_sd", False)
                show_se = v.get("show_se", False)
                show_ci = v.get("show_ci", False)
                ci_level = v.get("ci_level", 0.95)
                show_stars = v.get("show_stars", False)
                show_n = v.get("show_n", False)

                col = result[lbl]
                numeric_col = pd.to_numeric(col, errors="coerce")

                # Missing data indicator
                if missing_ind:
                    result[lbl] = col.apply(lambda x: missing_ind if pd.isna(x) else x)

                # Change direction arrows
                if change_arrows:
                    def add_arrow(x):
                        if pd.isna(x) or not isinstance(x, (int, float)):
                            return x
                        if x > 0: return f"▲ {x}"
                        if x < 0: return f"▼ {x}"
                        return f"▶ {x}"
                    result[lbl] = result[lbl].apply(add_arrow)

                # Mean ± SD format (replace each group's values with "mean ± SD")
                if show_mean_sd and numeric_col.notna().any():
                    mean_val = numeric_col.mean()
                    sd_val = numeric_col.std()
                    result[lbl] = result[lbl].apply(
                        lambda x: f"{float(x):,.{dec}f} ± {sd_val:,.{dec}f}" if isinstance(x, (int, float)) and not pd.isna(x) else x
                    )

                # Standard error in parentheses
                if show_se and numeric_col.notna().any():
                    n = numeric_col.count()
                    se = numeric_col.std() / (n ** 0.5) if n > 0 else 0
                    result[lbl] = result[lbl].apply(
                        lambda x: f"{float(x):,.{dec}f} ({se:,.{dec}f})" if isinstance(x, (int, float)) and not pd.isna(x) else x
                    )

                # Confidence interval
                if show_ci and numeric_col.notna().any():
                    import scipy.stats as sp_stats
                    n = numeric_col.count()
                    mean = numeric_col.mean()
                    se = numeric_col.std() / (n ** 0.5) if n > 0 else 0
                    z_val = sp_stats.norm.ppf(1 - (1 - ci_level) / 2) if n > 30 else sp_stats.t.ppf(1 - (1 - ci_level) / 2, max(n-1, 1))
                    margin = z_val * se
                    lo, hi = mean - margin, mean + margin
                    result[lbl] = result[lbl].apply(
                        lambda x: f"{float(x):,.{dec}f} [{lo:,.{dec}f}, {hi:,.{dec}f}]" if isinstance(x, (int, float)) and not pd.isna(x) else x
                    )

                # Significance stars (based on z-score magnitude)
                if show_stars and numeric_col.notna().any():
                    thresholds = v.get("star_thresholds", [0.05, 0.01, 0.001])
                    mean = numeric_col.mean()
                    std = numeric_col.std()
                    def add_stars(x):
                        if not isinstance(x, (int, float)) or pd.isna(x):
                            return x
                        if std == 0 or pd.isna(std):
                            return f"{x:,.{dec}f}"
                        z = abs((x - mean) / std)
                        # Convert z to approximate p-value
                        try:
                            p = 2 * (1 - sp_stats.norm.cdf(z))
                        except:
                            return f"{x:,.{dec}f}"
                        stars = ""
                        if p < thresholds[-1]: stars = "***"
                        elif len(thresholds) > 1 and p < thresholds[-2]: stars = "**"
                        elif p < thresholds[0]: stars = "*"
                        return f"{x:,.{dec}f}{stars}" if not isinstance(x, str) else f"{x}{stars}"
                    result[lbl] = result[lbl].apply(add_stars)

                # Show N (sample size) - add as a column suffix in the label
                if show_n:
                    n = numeric_col.count()
                    new_lbl = f"{lbl} (N={n})"
                    result = result.rename(columns={lbl: new_lbl})
                    # Update value_labels reference
                    idx = value_labels.index(lbl)
                    value_labels[idx] = new_lbl

            # Custom sort orders (convert to categorical for ordering)
            if config.custom_sort_orders:
                for field, order_list in config.custom_sort_orders.items():
                    if field in result.columns and order_list:
                        cat_type = pd.CategoricalDtype(categories=order_list, ordered=True)
                        result[field] = result[field].astype(str).astype(cat_type)

            # Sorting
            if config.multi_sort:
                # Multi-key sort: apply sort keys in order, skip invalid fields
                valid_keys = [(sk["field"], sk["order"] == "asc") for sk in config.multi_sort if sk.get("field") and sk["field"] in result.columns]
                if valid_keys:
                    sort_cols = [k[0] for k in valid_keys]
                    sort_asc = [k[1] for k in valid_keys]
                    result = result.sort_values(sort_cols, ascending=sort_asc)
            elif config.custom_sort_orders and any(f in result.columns for f in config.custom_sort_orders):
                # Sort by first custom-ordered field
                first_custom = next(f for f in config.custom_sort_orders if f in result.columns)
                result = result.sort_values(first_custom)
            elif config.sort_by and config.sort_by in result.columns:
                result = result.sort_values(config.sort_by, ascending=(config.sort_order == "asc"))

            # Subtotals for hierarchical rows
            if config.subtotals and len(config.rows) >= 1:
                if len(config.rows) > 1:
                    # Multi-level rows: subtotal at each hierarchy level
                    subtotal_frames = [result]
                    for level in range(len(config.rows) - 1):
                        group_cols = config.rows[:level + 1]
                        sub = df.groupby(group_cols, dropna=False).agg(agg_dict).reset_index()
                        sub_labels = list(group_cols)
                        for r in config.rows[level + 1:]:
                            sub[r] = f"Subtotal"
                        sub_value_labels = value_labels.copy()
                        sub.columns = sub_labels + list(config.rows[level + 1:]) + sub_value_labels
                        sub = sub[col_names]
                        sub["__subtotal_level__"] = level + 1
                        subtotal_frames.append(sub)
                    result["__subtotal_level__"] = 0  # detail rows
                    result = pd.concat(subtotal_frames, ignore_index=True)
                    if config.subtotals_position == "top":
                        result["__sort_key__"] = result["__subtotal_level__"].apply(lambda x: 0 if x > 0 else 1)
                    else:
                        result["__sort_key__"] = result["__subtotal_level__"].apply(lambda x: 1 if x > 0 else 0)
                    result = result.sort_values(list(config.rows) + ["__sort_key__"]).reset_index(drop=True)
                    result.drop(columns=["__subtotal_level__", "__sort_key__"], inplace=True)
                else:
                    # Single row field: add subtotal per unique value of that row field
                    row_field = config.rows[0]
                    subtotal_frames = []
                    for group_val, group_df in result.groupby(row_field, dropna=False):
                        subtotal_frames.append(group_df)
                        sub_row = {}
                        sub_row[row_field] = f"{group_val} Subtotal"
                        for col in value_labels:
                            numeric_vals = pd.to_numeric(group_df[col], errors="coerce")
                            sub_row[col] = numeric_vals.sum()
                        subtotal_frames.append(pd.DataFrame([sub_row]))
                    if subtotal_frames:
                        result = pd.concat(subtotal_frames, ignore_index=True)

            # Grand total
            want_row_total = config.grand_total_rows if config.grand_total_rows is not None else config.grand_total
            if want_row_total:
                total_row = {}
                for i, r in enumerate(config.rows):
                    total_row[r] = "Grand Total" if i == 0 else ""
                for v, label in zip(config.values, value_labels):
                    field = v["field"]
                    agg = v.get("agg", "sum")
                    if field == "*":
                        agg = "count"
                    combo_sa = v.get("combo_show_as", "normal")
                    dec = v.get("decimals") if v.get("decimals") is not None else 2
                    combo_dec = v.get("combo_decimals", dec)
                    # Coerce to numeric for numeric aggs: a column can pass the
                    # (row-sampled) text check upstream yet still carry a stray
                    # non-numeric cell, which crashes raw sum/mean with a str/int
                    # TypeError. Coercion drops those cells to NaN instead.
                    if agg in ("sum", "running_total", "cumulative_sum"):
                        raw_val = pd.to_numeric(df[field], errors="coerce").sum()
                    elif agg == "count":
                        raw_val = len(df)
                    elif agg in ("average", "mean"):
                        raw_val = pd.to_numeric(df[field], errors="coerce").mean()
                    elif agg == "min":
                        raw_val = pd.to_numeric(df[field], errors="coerce").min()
                    elif agg == "max":
                        raw_val = pd.to_numeric(df[field], errors="coerce").max()
                    elif agg == "median":
                        raw_val = pd.to_numeric(df[field], errors="coerce").median()
                    elif agg == "pct_grand":
                        raw_val = 100.0
                    else:
                        raw_val = pd.to_numeric(df[field], errors="coerce").sum()

                    # Apply combo formatting to grand total (always 100% for pct_grand)
                    if combo_sa and combo_sa != "normal":
                        try:
                            ov_str = f"{raw_val:,.{dec}f}" if isinstance(raw_val, (int, float)) and not pd.isna(raw_val) else str(raw_val)
                            total_row[label] = f"{ov_str}\n({100:.{combo_dec}f}%)"
                        except (ValueError, TypeError):
                            total_row[label] = raw_val
                    else:
                        total_row[label] = raw_val
                # Add multi-response note if applicable
                if multi_choice_cols:
                    total_row["__note__"] = f"* Multiple responses: {', '.join(multi_choice_cols)}. Total responses may exceed {original_row_count} respondents."
                result = pd.concat([result, pd.DataFrame([total_row])], ignore_index=True)

            # Column total (last column) — combine all value columns per row.
            # Normally a sum, but when every value field is an average/mean the row
            # "Grand Total" must also be an average (mean across the value columns),
            # not a sum — otherwise averaging columns produce a meaningless total
            # (e.g. four per-year averages summed instead of averaged).
            want_col_total = config.grand_total_columns if config.grand_total_columns is not None else config.grand_total
            if want_col_total and len(config.values) > 1:
                value_cols = [v.get("label", f"{v.get('agg','sum').title()} of {v['field']}") for v in config.values]
                existing_vcols = [c for c in value_cols if c in result.columns]
                if existing_vcols:
                    numeric_part = result[existing_vcols].apply(pd.to_numeric, errors="coerce").fillna(0)
                    gta = (config.grand_total_agg or "auto").lower()
                    if gta == "average":
                        use_mean = True
                    elif gta == "sum":
                        use_mean = False
                    else:  # auto: average only when every value field is an average/mean
                        use_mean = all(v.get("agg", "sum") in ("average", "mean") for v in config.values)
                    result["Grand Total"] = numeric_part.mean(axis=1) if use_mean else numeric_part.sum(axis=1)

            # Blank suppression
            if config.blank_suppress:
                value_cols = [v.get("label", f"{v.get('agg','sum').title()} of {v['field']}") for v in config.values]
                numeric_mask = result[value_cols].apply(pd.to_numeric, errors="coerce").fillna(0)
                keep = (numeric_mask != 0).any(axis=1)
                grand_total_mask = result[config.rows[0]].astype(str) == "Grand Total" if config.rows else pd.Series(True, index=result.index)
                result = result[keep | grand_total_mask].reset_index(drop=True)

            # Hide subtotal rows — remove rows labelled "Subtotal" but keep detail and grand total rows
            if config.hide_subgroup and config.subtotals and len(config.rows) >= 1:
                def _is_subtotal_row(row):
                    for rc in config.rows:
                        val = str(row.get(rc, ""))
                        if "Subtotal" in val and "Grand Total" not in val:
                            return True
                    return False
                mask = result.apply(_is_subtotal_row, axis=1)
                result = result[~mask].reset_index(drop=True)

            # Remove internal __note__ column, preserve it for response
            note = None
            if "__note__" in result.columns:
                notes = result["__note__"].dropna().tolist()
                note = notes[0] if notes else None
                result = result.drop(columns=["__note__"])

            # NET rows: insert aggregated rows for user-defined member groups
            if config.net_rows and config.rows:
                row_col = config.rows[0]
                non_value_cols = [c for c in result.columns if c not in value_labels]
                for net in config.net_rows:
                    label = (net.get("label") or "").strip()
                    members = net.get("members") or []
                    pos = net.get("position", "after_last_member")
                    if not label or not members:
                        continue
                    net_values = _compute_net_row(df, row_col, members, config.values, value_labels, _w_aggs)
                    new_row = {c: "" for c in result.columns}
                    new_row[row_col] = f"NET {label}"
                    for lbl, val in net_values.items():
                        if lbl in result.columns:
                            new_row[lbl] = val
                    members_s = [str(m) for m in members]
                    matches = result[result[row_col].astype(str).isin(members_s)].index.tolist()
                    if pos == "before_first_member" and matches:
                        insert_at = matches[0]
                    elif pos == "end":
                        gt_mask = result[row_col].astype(str) == "Grand Total"
                        insert_at = (gt_mask.idxmax() if gt_mask.any() else len(result))
                    else:  # after_last_member
                        insert_at = (matches[-1] + 1) if matches else len(result)
                    upper = result.iloc[:insert_at]
                    lower = result.iloc[insert_at:]
                    result = pd.concat([upper, pd.DataFrame([new_row]), lower], ignore_index=True)

            # Effective-N suppression: per-value field, replace cells with "*" when N < threshold
            _suppress_count = 0
            _any_suppress = any((v.get("suppress_below_n") or 0) > 0 for v in config.values)
            if _any_suppress and config.rows:
                try:
                    if _is_weighted_run:
                        _w_num = pd.to_numeric(df[_weight_col], errors="coerce").fillna(0)
                        _df_w = df.assign(__w__=_w_num)
                        _grp = _df_w.groupby(config.rows, dropna=False)
                        _sum_w = _grp["__w__"].sum()
                        _sum_w2 = _grp["__w__"].apply(lambda s: (s ** 2).sum())
                        _n_series = ((_sum_w * _sum_w) / _sum_w2.replace(0, np.nan)).fillna(0)
                    else:
                        _n_series = df.groupby(config.rows, dropna=False).size()
                    _n_df = _n_series.reset_index(name="__N__")
                    _result_keyed = result.merge(_n_df, on=list(config.rows), how="left")
                    _n_col = _result_keyed["__N__"].fillna(0)
                    for v, lbl in zip(config.values, value_labels):
                        thr = int(v.get("suppress_below_n") or 0)
                        if thr <= 0 or lbl not in result.columns:
                            continue
                        row_label_str = result[config.rows[0]].astype(str)
                        mask = (
                            (_n_col < thr)
                            & (row_label_str != "Grand Total")
                            & (~row_label_str.str.startswith("NET "))
                        )
                        if mask.any():
                            _suppress_count += int(mask.sum())
                            result[lbl] = result[lbl].astype(object)
                            result.loc[mask, lbl] = "*"
                except Exception:
                    pass

            headers = list(result.columns)
            rows = sanitize_for_json(result.fillna(config.missing_data).values.tolist())
            resp = {"headers": headers, "rows": rows, "row_count": len(rows), "col_count": len(headers)}
            if multi_choice_cols:
                resp["multi_response_note"] = note or f"* Multiple responses: {', '.join(multi_choice_cols)}. Total responses ({len(df)}) may exceed {original_row_count} respondents."
                resp["original_respondents"] = original_row_count
                resp["total_responses"] = len(df)
            if _is_weighted_run:
                resp["weighted"] = True
                resp["weight_col"] = _weight_col
            if _suppress_count > 0:
                resp["suppress_count"] = _suppress_count
                resp["suppress_basis"] = "effective" if _is_weighted_run else "raw"
            return resp

        # Pivot table case
        elif config.rows and config.columns:
            # Handle same field in both rows and columns — create temp copy for columns
            temp_cols = list(config.columns)
            temp_col_renames = {}
            for i, col in enumerate(temp_cols):
                if col in config.rows:
                    temp_name = f"__col_{col}__"
                    df[temp_name] = df[col]
                    temp_cols[i] = temp_name
                    temp_col_renames[temp_name] = col

            want_row_total_pivot = config.grand_total_rows if config.grand_total_rows is not None else config.grand_total
            want_col_total_pivot = config.grand_total_columns if config.grand_total_columns is not None else config.grand_total
            need_margins = want_row_total_pivot or want_col_total_pivot

            # Clean NaT/NaN from pivot index and column fields to prevent margins errors
            for _pc in config.rows + temp_cols:
                if _pc in df.columns:
                    _nat_mask = df[_pc].apply(lambda v: pd.isna(v) or str(v).strip() in ('nan', 'NaN', 'NaT', '<NA>'))
                    if _nat_mask.any():
                        # See comment above: a fully/mostly-NaN column stays numeric
                        # dtype, so cast to object before writing the "(blank)" string.
                        if df[_pc].dtype != object:
                            df[_pc] = df[_pc].astype(object)
                        df.loc[_nat_mask, _pc] = "(blank)"

            # Build per-value pivots (supports multiple value fields with independent aggs)
            _pv_pivots = []
            _pv_cfgs = []
            _pv_temp_cleanup = []

            for _vi, _v in enumerate(config.values):
                _vf = _v["field"]
                _va = _v.get("agg", "sum")
                if _vf == "*":
                    _vf = config.rows[0]
                    _va = "count"
                if _va in NUMERIC_ONLY_AGGS and _col_is_text(df, _vf):
                    _va = "count"
                if _w_aggs and _va in _w_aggs:
                    _af = _w_aggs[_va]
                else:
                    _af = AGG_MAP.get(_va, "sum")
                _vl = _v.get("label", f"{_va.title()} of {_vf}")

                _tvf = _vf
                if _vf in config.rows or _vf in config.columns:
                    _tvf = f"__temp_{_vf}_{_vi}__"
                    df[_tvf] = df[_vf]
                    _pv_temp_cleanup.append(_tvf)

                # Same stray-non-numeric-cell guard as the groupby path above —
                # _col_is_text's 50-row sample can miss a bad cell further down,
                # which would otherwise crash pivot_table's sum/mean with a
                # str/int TypeError.
                if _va in NUMERIC_ONLY_AGGS and str(df[_tvf].dtype) == "object":
                    _tvf_safe = f"__temp_numsafe_{_vi}__"
                    df[_tvf_safe] = pd.to_numeric(df[_tvf], errors="coerce")
                    _pv_temp_cleanup.append(_tvf_safe)
                    _tvf = _tvf_safe

                _p = pd.pivot_table(
                    df, values=_tvf, index=config.rows, columns=temp_cols,
                    aggfunc=_af,
                    fill_value=0 if config.missing_data == "0" else None,
                    margins=need_margins, margins_name="Grand Total", dropna=False,
                )

                # Selectively remove row or column grand totals
                if need_margins:
                    if not want_row_total_pivot:
                        if "Grand Total" in _p.index.get_level_values(-1).astype(str).tolist():
                            _p = _p.drop("Grand Total", axis=0, errors="ignore")
                    if not want_col_total_pivot:
                        if isinstance(_p.columns, pd.MultiIndex):
                            _cd = [c for c in _p.columns if "Grand Total" in [str(x) for x in c]]
                            if _cd:
                                _p = _p.drop(columns=_cd, errors="ignore")
                        else:
                            if "Grand Total" in _p.columns.astype(str).tolist():
                                _p = _p.drop(columns=["Grand Total"], errors="ignore")

                _pv_pivots.append(_p)
                _pv_cfgs.append({
                    "label": _vl, "show_as": _v.get("show_as", "normal"),
                    "combo_show_as": _v.get("combo_show_as", "normal"),
                    "decimals": _v.get("decimals", 2),
                    "combo_decimals": _v.get("combo_decimals", _v.get("decimals", 2)),
                    "agg": _va,
                })

            for _tf in _pv_temp_cleanup:
                df.drop(columns=[_tf], inplace=True, errors="ignore")
            for temp_name in temp_col_renames:
                df.drop(columns=[temp_name], inplace=True, errors="ignore")

            # Merge per-value pivots into combined pivot
            _is_multi_val = len(_pv_pivots) > 1
            if not _is_multi_val:
                pivot = _pv_pivots[0]
            else:
                _ref = _pv_pivots[0]
                _ref_cols = _ref.columns
                _data = {}
                _col_tuples = []
                if isinstance(_ref_cols, pd.MultiIndex):
                    for _ct in _ref_cols:
                        for _p, _vc in zip(_pv_pivots, _pv_cfgs):
                            _nk = tuple(str(c) for c in _ct) + (_vc["label"],)
                            _fk = " | ".join(_nk)
                            _data[_fk] = _p[_ct].values if _ct in _p.columns else np.zeros(len(_ref))
                            _col_tuples.append(_nk)
                else:
                    for _cv in _ref_cols:
                        for _p, _vc in zip(_pv_pivots, _pv_cfgs):
                            _nk = (str(_cv), _vc["label"])
                            _fk = f"{_cv} | {_vc['label']}"
                            _data[_fk] = _p[_cv].values if _cv in _p.columns else np.zeros(len(_ref))
                            _col_tuples.append(_nk)
                pivot = pd.DataFrame(_data, index=_ref.index)
                pivot.columns = pd.MultiIndex.from_tuples(_col_tuples)

                # Combined Grand Total: replace per-value GT sub-columns with single summed column
                if config.grand_total_combined and want_col_total_pivot:
                    gt_cols = [c for c in pivot.columns if str(c[0]) == "Grand Total"]
                    if gt_cols:
                        pivot[("Grand Total", "Total")] = pivot[gt_cols].sum(axis=1)
                        pivot = pivot.drop(columns=gt_cols)
                        # Re-sort columns: non-GT first, then the combined GT at the end
                        non_gt = [c for c in pivot.columns if str(c[0]) != "Grand Total"]
                        gt_new = [c for c in pivot.columns if str(c[0]) == "Grand Total"]
                        pivot = pivot[non_gt + gt_new]

            column_groups = None
            if isinstance(pivot.columns, pd.MultiIndex):
                # Insert column-group subtotals before flattening (skip for multi-value — summing across measures is meaningless)
                if config.subtotals and not _is_multi_val:
                    from collections import OrderedDict
                    top_level_values = list(OrderedDict.fromkeys(
                        str(col[0]) for col in pivot.columns if str(col[0]) != "Grand Total"
                    ))
                    if len(top_level_values) > 1:
                        new_cols_order = []
                        for top_val in top_level_values:
                            group_cols = [c for c in pivot.columns if str(c[0]) == top_val]
                            new_cols_order.extend(group_cols)
                            if len(group_cols) > 1:
                                subtotal_col_name = (top_val, "Subtotal")
                                pivot[subtotal_col_name] = pivot[group_cols].sum(axis=1)
                                new_cols_order.append(subtotal_col_name)
                        # Add Grand Total columns at the end if they exist
                        gt_cols = [c for c in pivot.columns if str(c[0]) == "Grand Total"]
                        new_cols_order.extend(gt_cols)
                        pivot = pivot[new_cols_order]

                # Build column groups for multi-level header merging
                raw_levels = list(pivot.columns)
                n_row_cols = len(config.rows)
                top_labels = [col[0] if len(col) > 0 else "" for col in raw_levels]
                bot_labels = [col[1] if len(col) > 1 else str(col[0]) for col in raw_levels]
                # Build groups: consecutive same top_labels get merged
                groups = []
                i = 0
                while i < len(top_labels):
                    label = str(top_labels[i])
                    span = 1
                    while i + span < len(top_labels) and str(top_labels[i + span]) == label:
                        span += 1
                    groups.append({"label": label, "colspan": span, "colstart": i})
                    i += span
                column_groups = {
                    "top": groups,
                    "bottom": [str(b) for b in bot_labels],
                    "has_multi_level": len(set(str(t) for t in top_labels)) > 1,
                }
                pivot.columns = [" | ".join(str(c) for c in col if str(c) != "").strip() for col in pivot.columns]

            pivot = pivot.reset_index()

            # Subtotals for pivot table with hierarchical rows
            if config.subtotals and len(config.rows) > 1:
                numeric_cols = pivot.select_dtypes(include=[np.number]).columns.tolist()
                subtotal_frames = []
                for level in range(len(config.rows) - 1):
                    group_cols = config.rows[:level + 1]
                    sub = pivot.groupby(group_cols, dropna=False)[numeric_cols].sum().reset_index()
                    for r in config.rows[level + 1:]:
                        sub[r] = "Subtotal"
                    for c in pivot.columns:
                        if c not in sub.columns:
                            sub[c] = ""
                    sub = sub[pivot.columns]
                    sub["__subtotal_level__"] = level + 1
                    subtotal_frames.append(sub)
                pivot["__subtotal_level__"] = 0
                pivot = pd.concat([pivot] + subtotal_frames, ignore_index=True)
                if config.subtotals_position == "top":
                    pivot["__sort_key__"] = pivot["__subtotal_level__"].apply(lambda x: 0 if x > 0 else 1)
                else:
                    pivot["__sort_key__"] = pivot["__subtotal_level__"].apply(lambda x: 1 if x > 0 else 0)
                pivot = pivot.sort_values(list(config.rows) + ["__sort_key__"]).reset_index(drop=True)
                pivot.drop(columns=["__subtotal_level__", "__sort_key__"], inplace=True)

            # General sort by a user-selected column — mirrors the rows-only sort
            # logic further up, but against the flattened pivot columns so pivoted
            # output columns ("Grand Total", "X | Subtotal", etc.) are valid sort
            # keys too, not just the raw row/value field names. The Grand Total row
            # (if present) is pinned to the end rather than reordered with the data.
            # Limited to single-row-field crosstabs — multi-level row hierarchies
            # already get their own group-preserving sort from the subtotals block
            # above, and reconciling the two would require tracking which hierarchy
            # level a sort key belongs to.
            if len(config.rows) == 1:
                row_label_col = config.rows[0]
                if row_label_col in pivot.columns:
                    is_gt_row = pivot[row_label_col].astype(str) == "Grand Total"
                else:
                    is_gt_row = pd.Series([False] * len(pivot), index=pivot.index)
                gt_rows = pivot[is_gt_row]
                data_rows = pivot[~is_gt_row]

                if config.multi_sort:
                    valid_keys = [(sk["field"], sk["order"] == "asc") for sk in config.multi_sort if sk.get("field") and sk["field"] in data_rows.columns]
                    if valid_keys:
                        sort_cols = [k[0] for k in valid_keys]
                        sort_asc = [k[1] for k in valid_keys]
                        data_rows = data_rows.sort_values(sort_cols, ascending=sort_asc)
                elif config.custom_sort_orders and any(f in data_rows.columns for f in config.custom_sort_orders):
                    first_custom = next(f for f in config.custom_sort_orders if f in data_rows.columns)
                    data_rows = data_rows.sort_values(first_custom)
                elif config.sort_by and config.sort_by in data_rows.columns:
                    data_rows = data_rows.sort_values(config.sort_by, ascending=(config.sort_order == "asc"))

                pivot = pd.concat([data_rows, gt_rows], ignore_index=True) if len(gt_rows) > 0 else data_rows.reset_index(drop=True)

            # Percentage of row/column total for pivot
            v0 = config.values[0]
            show_as = v0.get("show_as", "normal")
            combo_show_as = v0.get("combo_show_as", "normal")
            dec = v0.get("decimals", 2)
            combo_dec = v0.get("combo_decimals", dec)
            # Legacy compat: old frontend sends pct_row/pct_col as agg
            if v0.get("agg", "sum") in PERCENT_AGGS:
                show_as = v0["agg"]

            def apply_pivot_show_as(pivot_df, sa, decimal_places, col_filter=None):
                numeric_cols = pivot_df.select_dtypes(include=[np.number]).columns
                if col_filter:
                    numeric_cols = pd.Index([c for c in numeric_cols if any(str(c).endswith(lbl) for lbl in col_filter)])
                # Exclude Grand Total and Subtotal columns from percentage calculations
                data_cols = [c for c in numeric_cols if not str(c).startswith("Grand Total") and "| Subtotal" not in str(c)]
                has_margin_col = any(str(c).startswith("Grand Total") for c in numeric_cols)

                def _is_gt_col(col_name):
                    return str(col_name).startswith("Grand Total")

                def _is_subtotal_col(col_name):
                    return "| Subtotal" in str(col_name)

                if sa == "pct_row":
                    if config.subtotal_pct_base == "subtotal":
                        subtotal_cols = [c for c in numeric_cols if _is_subtotal_col(c)]
                        if subtotal_cols:
                            col_to_subtotal = {}
                            for sc in subtotal_cols:
                                prefix = str(sc).split(" | Subtotal")[0].strip()
                                for dc in data_cols:
                                    if str(dc).startswith(prefix + " |") or str(dc) == prefix:
                                        col_to_subtotal[dc] = sc
                            # Save raw subtotal values before any conversion
                            raw_subtotals = {sc: pivot_df[sc].copy() for sc in subtotal_cols}
                            for c in numeric_cols:
                                if _is_gt_col(c):
                                    # GT = sum of all subtotals' percentages (each is 100), not meaningful — show raw/row
                                    row_sums = sum(raw_subtotals[sc] for sc in subtotal_cols)
                                    pivot_df[c] = (pivot_df[c] / row_sums.replace(0, np.nan) * 100).round(decimal_places)
                                elif _is_subtotal_col(c):
                                    pivot_df[c] = 100.0
                                elif c in col_to_subtotal:
                                    group_sum = raw_subtotals[col_to_subtotal[c]]
                                    pivot_df[c] = (pivot_df[c] / group_sum.replace(0, np.nan) * 100).round(decimal_places)
                                else:
                                    row_sums = pivot_df[data_cols].sum(axis=1)
                                    pivot_df[c] = (pivot_df[c] / row_sums.replace(0, np.nan) * 100).round(decimal_places)
                        else:
                            row_sums = pivot_df[data_cols].sum(axis=1) if data_cols else pivot_df[numeric_cols].sum(axis=1)
                            for c in numeric_cols:
                                pivot_df[c] = (pivot_df[c] / row_sums.replace(0, np.nan) * 100).round(decimal_places)
                    else:
                        row_sums = pivot_df[data_cols].sum(axis=1) if data_cols else pivot_df[numeric_cols].sum(axis=1)
                        for c in numeric_cols:
                            pivot_df[c] = (pivot_df[c] / row_sums.replace(0, np.nan) * 100).round(decimal_places)
                elif sa == "pct_col":
                    for c in numeric_cols:
                        if _is_gt_col(c) or _is_subtotal_col(c):
                            continue
                        col_data = pivot_df[c]
                        # Use the Grand Total row value as the denominator if margins exist
                        if config.grand_total and len(pivot_df) > 0:
                            gt_mask = pivot_df.index.get_level_values(0).astype(str) == "Grand Total" if isinstance(pivot_df.index, pd.MultiIndex) else pivot_df.iloc[:, 0].astype(str) == "Grand Total"
                            if gt_mask.any():
                                col_sum = pivot_df.loc[gt_mask, c].iloc[0]
                            else:
                                col_sum = col_data.sum()
                        else:
                            col_sum = col_data.sum()
                        if col_sum != 0:
                            pivot_df[c] = (pivot_df[c] / col_sum * 100).round(decimal_places)
                    # Grand Total column should show 100% for each row
                    gt_col = next((c for c in pivot_df.columns if _is_gt_col(c)), None)
                    if has_margin_col and gt_col:
                        pivot_df[gt_col] = 100.0
                elif sa == "pct_grand":
                    # Denominator = sum of body cells only. data_cols already drops the
                    # Grand Total *column*; we must also drop the Grand Total/Subtotal
                    # *rows*, otherwise the margin row double-counts the total (e.g. a
                    # real total of 205 becomes 410, so every cell reads half its true %).
                    if isinstance(pivot_df.index, pd.MultiIndex):
                        _lbl = pd.Series([" ".join(str(x) for x in tup) for tup in pivot_df.index])
                    else:
                        _lbl = pivot_df.iloc[:, 0].astype(str).reset_index(drop=True)
                    _body_mask = ~_lbl.str.contains("Grand Total|Subtotal", na=False)
                    _body = pivot_df.loc[_body_mask.values]
                    grand = np.nansum(_body[data_cols].values) if data_cols else np.nansum(_body[numeric_cols].values)
                    if grand != 0:
                        for c in numeric_cols:
                            pivot_df[c] = (pivot_df[c] / grand * 100).round(decimal_places)
                elif sa == "pct_parent_row":
                    # Each cell as % of its column-group subtotal (row-wise)
                    subtotal_cols = [c for c in numeric_cols if _is_subtotal_col(c)]
                    if subtotal_cols:
                        col_to_subtotal = {}
                        for sc in subtotal_cols:
                            prefix = str(sc).split(" | Subtotal")[0].strip()
                            for dc in data_cols:
                                if str(dc).startswith(prefix + " |") or str(dc) == prefix:
                                    col_to_subtotal[dc] = sc
                        for c in data_cols:
                            if c in col_to_subtotal:
                                pivot_df[c] = (pivot_df[c] / pivot_df[col_to_subtotal[c]].replace(0, np.nan) * 100).round(decimal_places)
                        for sc in subtotal_cols:
                            pivot_df[sc] = 100.0
                    else:
                        # Fallback: same as pct_row
                        row_sums = pivot_df[data_cols].sum(axis=1) if data_cols else pivot_df[numeric_cols].sum(axis=1)
                        for c in numeric_cols:
                            pivot_df[c] = (pivot_df[c] / row_sums.replace(0, np.nan) * 100).round(decimal_places)
                elif sa == "pct_parent_col":
                    # Each cell as % of its row-group parent total (column-wise)
                    if len(rows) > 1 and rows[0] in pivot_df.columns:
                        parent_col = rows[0]
                        for c in data_cols:
                            parent_sums = pivot_df.groupby(parent_col)[c].transform("sum")
                            pivot_df[c] = (pivot_df[c] / parent_sums.replace(0, np.nan) * 100).round(decimal_places)
                    else:
                        # Fallback: same as pct_col
                        for c in data_cols:
                            col_sum = pivot_df[c].sum()
                            if col_sum != 0:
                                pivot_df[c] = (pivot_df[c] / col_sum * 100).round(decimal_places)
                elif sa == "pct_subgroup":
                    # Each cell as % of its row-group (subgroup) total
                    if len(config.rows) > 1 and config.rows[0] in pivot_df.columns:
                        parent_col = config.rows[0]
                        for c in data_cols:
                            parent_sums = pivot_df.groupby(parent_col)[c].transform("sum")
                            pivot_df[c] = (pivot_df[c] / parent_sums.replace(0, np.nan) * 100).round(decimal_places)
                    else:
                        # Single row: same as pct_grand
                        grand = pivot_df[data_cols].values.sum() if data_cols else pivot_df[numeric_cols].values.sum()
                        if grand != 0:
                            for c in numeric_cols:
                                pivot_df[c] = (pivot_df[c] / grand * 100).round(decimal_places)
                return pivot_df

            def _apply_combo(target_df, orig_df, sa, decimal_places, col_filter=None, value_decimal_places=None):
                # decimal_places formats the parenthetical % (and its underlying calc);
                # value_decimal_places formats the main number in front of it — these
                # can be set independently, defaulting to the same value.
                vdec = decimal_places if value_decimal_places is None else value_decimal_places
                apply_pivot_show_as(target_df, sa, decimal_places, col_filter=col_filter)
                missing_fill = config.missing_data if config.missing_data else ""
                ncols = orig_df.select_dtypes(include=[np.number]).columns
                if col_filter:
                    ncols = pd.Index([c for c in ncols if any(str(c).endswith(lbl) for lbl in col_filter)])
                for c in ncols:
                    combined = []
                    for ov, pv in zip(orig_df[c], target_df[c]):
                        try:
                            ov_na = (isinstance(ov, float) and (pd.isna(ov) or np.isinf(ov))) if not isinstance(ov, str) else False
                            pv_na = (isinstance(pv, float) and (pd.isna(pv) or np.isinf(pv))) if not isinstance(pv, str) else ("nan" in str(pv).lower())
                            if ov_na:
                                combined.append(missing_fill)
                            elif pv_na:
                                ov_s = f"{ov:,.{vdec}f}" if isinstance(ov, (int, float)) else str(ov)
                                combined.append(f"{ov_s}\n({missing_fill or '0'}%)")
                            else:
                                ov_s = f"{ov:,.{vdec}f}" if isinstance(ov, (int, float)) else str(ov)
                                pv_s = f"{pv:.{decimal_places}f}%" if isinstance(pv, (int, float)) else str(pv)
                                combined.append(f"{ov_s}\n({pv_s})")
                        except (ValueError, TypeError):
                            combined.append(missing_fill if ov_na else str(ov))
                    target_df[c] = combined

            if _is_multi_val:
                # Per-value show_as / combo / rounding
                for _vc in _pv_cfgs:
                    _sa = _vc.get("show_as", "normal")
                    _csa = _vc.get("combo_show_as", "normal")
                    _dec = _vc.get("decimals", 2)
                    _combo_dec = _vc.get("combo_decimals", _dec)
                    _lbl = _vc["label"]
                    # Legacy compat
                    if _vc.get("agg", "sum") in PERCENT_AGGS:
                        _sa = _vc["agg"]
                    _cf = [_lbl]
                    if _csa and _csa != "normal":
                        orig_pivot = pivot.copy()
                        _apply_combo(pivot, orig_pivot, _csa, _combo_dec, col_filter=_cf, value_decimal_places=_dec)
                    elif _sa and _sa != "normal":
                        apply_pivot_show_as(pivot, _sa, _dec, col_filter=_cf)
                    if _dec is not None:
                        val_cols = [c for c in pivot.select_dtypes(include=[np.number]).columns if str(c).endswith(_lbl)]
                        for c in val_cols:
                            pivot[c] = pivot[c].round(int(_dec))
            else:
                if combo_show_as and combo_show_as != "normal":
                    orig_pivot = pivot.copy()
                    _apply_combo(pivot, orig_pivot, combo_show_as, combo_dec, value_decimal_places=dec)
                elif show_as and show_as != "normal":
                    apply_pivot_show_as(pivot, show_as, dec)
                # Apply decimal rounding to all numeric columns
                if dec is not None:
                    for c in pivot.select_dtypes(include=[np.number]).columns:
                        pivot[c] = pivot[c].round(int(dec))

            # Hide subtotal rows in pivot — remove "Subtotal" rows but keep detail and grand total
            if config.hide_subgroup and config.subtotals and len(config.rows) >= 1:
                def _is_subtotal_pivot(row):
                    for rc in config.rows:
                        if rc in row.index:
                            val = str(row[rc])
                            if "Subtotal" in val and "Grand Total" not in val:
                                return True
                    return False
                mask = pivot.apply(_is_subtotal_pivot, axis=1)
                pivot = pivot[~mask].reset_index(drop=True)
                # Also remove "| Subtotal" columns if present
                subtotal_cols = [c for c in pivot.columns if "| Subtotal" in str(c)]
                if subtotal_cols:
                    pivot = pivot.drop(columns=subtotal_cols)
                    if column_groups:
                        # Rebuild column_groups from remaining non-row columns
                        non_row_headers = [str(c) for c in pivot.columns if c not in config.rows]
                        # Parse "TopGroup | SubLabel" back into top/bottom
                        top_labels = []
                        bot_labels = []
                        for h in non_row_headers:
                            if " | " in h:
                                parts = h.split(" | ", 1)
                                top_labels.append(parts[0])
                                bot_labels.append(parts[1])
                            else:
                                top_labels.append(h)
                                bot_labels.append(h)
                        groups = []
                        i = 0
                        while i < len(top_labels):
                            label = top_labels[i]
                            span = 1
                            while i + span < len(top_labels) and top_labels[i + span] == label:
                                span += 1
                            groups.append({"label": label, "colspan": span, "colstart": i})
                            i += span
                        column_groups = {
                            "top": groups,
                            "bottom": bot_labels,
                            "has_multi_level": len(set(top_labels)) > 1,
                        }

            # NET rows for pivot: insert aggregated rows for member groups
            if config.net_rows and config.rows:
                row_col = config.rows[0]
                # Compute net cells per pivot column: for each non-row column, aggregate matching df rows
                non_row_pivot_cols = [c for c in pivot.columns if c not in config.rows]
                for net in config.net_rows:
                    label = (net.get("label") or "").strip()
                    members = net.get("members") or []
                    pos = net.get("position", "after_last_member")
                    if not label or not members:
                        continue
                    members_s = [str(m) for m in members]
                    sub = df[df[row_col].astype(str).isin(members_s)]
                    new_row: dict = {c: "" for c in pivot.columns}
                    new_row[row_col] = f"NET {label}"
                    if not sub.empty:
                        # For each non-row pivot column, find the value field + column key
                        for v, vl in zip(config.values, value_labels):
                            field = v.get("field", row_col if v.get("field") == "*" else v["field"])
                            agg = v.get("agg", "sum") if v.get("field") != "*" else "count"
                            for c in non_row_pivot_cols:
                                if str(c).startswith("Grand Total"):
                                    continue
                                # Column name patterns:  "<colvalue>" or "<vl> | <colvalue>" (multi-value)
                                col_key = str(c)
                                if " | " in col_key:
                                    if not col_key.startswith(f"{vl} | "):
                                        continue
                                    col_key = col_key.split(" | ", 1)[1]
                                # Match df rows where the temp_col == col_key (using temp_cols for renamed cols)
                                if not temp_cols:
                                    continue
                                tc = temp_cols[0]
                                if tc not in sub.columns:
                                    continue
                                sub2 = sub[sub[tc].astype(str) == col_key]
                                if sub2.empty:
                                    new_row[c] = 0
                                    continue
                                try:
                                    if _w_aggs and agg in _w_aggs:
                                        new_row[c] = _w_aggs[agg](sub2[field])
                                    else:
                                        col_n = pd.to_numeric(sub2[field], errors="coerce")
                                        if agg in ("sum", "running_total", "cumulative_sum"):
                                            new_row[c] = float(col_n.sum())
                                        elif agg == "count":
                                            new_row[c] = int(sub2[field].notna().sum())
                                        elif agg in ("average", "mean"):
                                            new_row[c] = float(col_n.mean()) if col_n.notna().any() else None
                                        elif agg == "median":
                                            new_row[c] = float(col_n.median()) if col_n.notna().any() else None
                                        elif agg == "min":
                                            new_row[c] = float(col_n.min()) if col_n.notna().any() else None
                                        elif agg == "max":
                                            new_row[c] = float(col_n.max()) if col_n.notna().any() else None
                                        else:
                                            new_row[c] = float(col_n.sum())
                                except Exception:
                                    new_row[c] = None
                    matches = pivot[pivot[row_col].astype(str).isin(members_s)].index.tolist()
                    if pos == "before_first_member" and matches:
                        insert_at = matches[0]
                    elif pos == "end":
                        gt_mask = pivot[row_col].astype(str) == "Grand Total"
                        insert_at = int(gt_mask.idxmax()) if gt_mask.any() else len(pivot)
                    else:
                        insert_at = (matches[-1] + 1) if matches else len(pivot)
                    upper = pivot.iloc[:insert_at]
                    lower = pivot.iloc[insert_at:]
                    pivot = pd.concat([upper, pd.DataFrame([new_row]), lower], ignore_index=True)

            # Effective-N suppression for pivot: per-cell N
            _suppress_count_pv = 0
            _any_suppress_pv = any((v.get("suppress_below_n") or 0) > 0 for v in config.values)
            if _any_suppress_pv and config.rows and config.columns:
                try:
                    if _is_weighted_run:
                        _w_num = pd.to_numeric(df[_weight_col], errors="coerce").fillna(0)
                        _df_w = df.assign(__w__=_w_num)
                        _sum_w_p = _df_w.pivot_table(index=config.rows, columns=temp_cols, values="__w__", aggfunc="sum", fill_value=0)
                        _sum_w2_p = _df_w.assign(__w2__=lambda d: d["__w__"] ** 2).pivot_table(
                            index=config.rows, columns=temp_cols, values="__w2__", aggfunc="sum", fill_value=0)
                        _n_p = (_sum_w_p * _sum_w_p) / _sum_w2_p.replace(0, np.nan)
                        _n_p = _n_p.fillna(0)
                    else:
                        _n_p = df.pivot_table(index=config.rows, columns=temp_cols, values=config.rows[0],
                                              aggfunc="size", fill_value=0)
                    # Find max threshold across value fields (apply most restrictive uniformly)
                    thresholds = [int(v.get("suppress_below_n") or 0) for v in config.values]
                    thr = max(thresholds) if thresholds else 0
                    if thr > 0:
                        # Flatten n-pivot column labels to match pivot's columns
                        _n_flat = _n_p.reset_index()
                        # Identify which result columns to mask (everything not in row keys / not Grand Total)
                        for col in pivot.columns:
                            if col in config.rows:
                                continue
                            if str(col).startswith("Grand Total"):
                                continue
                            # Try to find matching n column
                            n_col = None
                            if col in _n_flat.columns:
                                n_col = _n_flat[col]
                            else:
                                # Strip prefixes like "label | " for multi-value pivots
                                stripped = str(col).split(" | ")[-1]
                                if stripped in _n_flat.columns:
                                    n_col = _n_flat[stripped]
                            if n_col is None or len(n_col) != len(pivot):
                                continue
                            row_lbl_str = pivot[config.rows[0]].astype(str)
                            mask = (
                                (n_col.values < thr)
                                & (row_lbl_str != "Grand Total")
                                & (~row_lbl_str.str.startswith("NET "))
                            )
                            if mask.any():
                                _suppress_count_pv += int(mask.sum())
                                pivot[col] = pivot[col].astype(object)
                                pivot.loc[mask, col] = "*"
                except Exception:
                    pass

            headers = [str(c) for c in pivot.columns]
            rows = sanitize_for_json(pivot.fillna(config.missing_data).values.tolist())
            result_obj = {"headers": headers, "rows": rows, "row_count": len(rows), "col_count": len(headers)}
            if column_groups:
                result_obj["column_groups"] = column_groups
            if multi_choice_cols:
                result_obj["multi_response_note"] = f"* Multiple responses: {', '.join(multi_choice_cols)}. Total responses ({len(df)}) may exceed {original_row_count} respondents."
                result_obj["original_respondents"] = original_row_count
                result_obj["total_responses"] = len(df)
            if _is_weighted_run:
                result_obj["weighted"] = True
                result_obj["weight_col"] = _weight_col
            if _suppress_count_pv > 0:
                result_obj["suppress_count"] = _suppress_count_pv
                result_obj["suppress_basis"] = "effective" if _is_weighted_run else "raw"
            return result_obj

        # Only values, no grouping
        else:
            result = {}
            for v in config.values:
                field = v["field"]
                agg = v.get("agg", "sum")
                if field == "*":
                    agg = "count"
                label = v.get("label", f"{agg.title()} of {field}")
                # Coerce to numeric for numeric aggs — a stray non-numeric cell
                # (blank marker, "N/A", typo) in an otherwise-numeric column
                # would otherwise crash raw sum/mean with a str/int TypeError.
                if agg == "sum":
                    result[label] = pd.to_numeric(df[field], errors="coerce").sum()
                elif agg == "count":
                    result[label] = len(df)
                elif agg in ("average", "mean"):
                    result[label] = pd.to_numeric(df[field], errors="coerce").mean()
                elif agg == "min":
                    result[label] = pd.to_numeric(df[field], errors="coerce").min()
                elif agg == "max":
                    result[label] = pd.to_numeric(df[field], errors="coerce").max()
                elif agg == "median":
                    result[label] = pd.to_numeric(df[field], errors="coerce").median()
                elif agg == "std":
                    result[label] = pd.to_numeric(df[field], errors="coerce").std()
                elif agg == "var":
                    result[label] = pd.to_numeric(df[field], errors="coerce").var()
                else:
                    result[label] = pd.to_numeric(df[field], errors="coerce").sum()

            headers = list(result.keys())
            rows = [list(result.values())]
            return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": 1, "col_count": len(headers)}

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Tabulation error: {str(e)}")
