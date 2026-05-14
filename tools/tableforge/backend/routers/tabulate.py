from fastapi import APIRouter, HTTPException
from typing import Optional
from pydantic import BaseModel
import pandas as pd
import numpy as np
import traceback

from ..shared import (
    datasets, custom_metrics, custom_bins, column_type_overrides,
    sanitize_for_json, _is_multi_choice, _col_is_text, apply_metrics_and_bins
)

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
    sort_by: Optional[str] = None
    sort_order: str = "asc"
    multi_sort: list[dict] = []     # [{field, order}] for multi-key sorting
    custom_sort_orders: dict = {}   # {field: [cat1, cat2, ...]} for manual category ordering
    missing_data: str = ""
    date_groupings: dict = {}       # {col_name: "year"|"quarter"|"month"|"week"|"day"}
    blank_suppress: bool = False    # hide rows where all value cols are 0/blank
    hide_subgroup: bool = False     # hide detail rows, show only subtotals/grand totals


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
        _type_overrides = column_type_overrides.get(config.dataset_id, {})
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

        # Explode multi-choice columns: split comma-separated values into separate rows
        _nan_strs = {'nan', 'NaN', 'None', 'NaT', '', '<NA>', 'null'}
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
        _bad_strs = {'nan', 'NaN', 'NaT', 'None', '<NA>'}
        for _gc in config.rows + config.columns:
            if _gc in df.columns:
                _nat_mask = df[_gc].apply(lambda v: pd.isna(v) or str(v).strip() in _bad_strs)
                if _nat_mask.any():
                    df.loc[_nat_mask, _gc] = "(blank)"

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

                if agg in AGG_MAP:
                    agg_dict[safe_field] = AGG_MAP[agg]
                else:
                    agg_dict[safe_field] = "sum"

                # Queue show_as post-calculation
                if show_as and show_as != "normal":
                    post_calcs.append({"field": safe_field, "agg": show_as, "label": vlabel, "decimals": decimals})
                # Queue combo post-calculation (value + % in parentheses)
                if combo_show_as and combo_show_as != "normal":
                    post_calcs.append({"field": safe_field, "agg": f"combo_{combo_show_as}", "label": vlabel, "decimals": decimals})

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
                    # Format as "value (pct%)" — handle NaN/Inf gracefully
                    missing_fill = config.missing_data if config.missing_data else ""
                    combo_col = []
                    for ov, pv in zip(orig_values, pct_values):
                        try:
                            ov_is_na = (isinstance(ov, float) and (pd.isna(ov) or np.isinf(ov))) if not isinstance(ov, str) else False
                            pv_is_na = (isinstance(pv, float) and (pd.isna(pv) or np.isinf(pv))) if not isinstance(pv, str) else ("nan" in str(pv).lower())
                            if ov_is_na:
                                combo_col.append(missing_fill)
                            elif pv_is_na:
                                ov_str = f"{ov:,.{dec}f}" if isinstance(ov, (int, float)) else str(ov)
                                combo_col.append(f"{ov_str}\n({missing_fill or '0'}%)")
                            else:
                                ov_str = f"{ov:,.{dec}f}" if isinstance(ov, (int, float)) else str(ov)
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
                    if agg in ("sum", "running_total", "cumulative_sum"):
                        raw_val = df[field].sum()
                    elif agg == "count":
                        raw_val = len(df)
                    elif agg in ("average", "mean"):
                        raw_val = df[field].mean()
                    elif agg == "min":
                        raw_val = df[field].min()
                    elif agg == "max":
                        raw_val = df[field].max()
                    elif agg == "median":
                        raw_val = df[field].median()
                    elif agg == "pct_grand":
                        raw_val = 100.0
                    else:
                        raw_val = df[field].sum()

                    # Apply combo formatting to grand total (always 100% for pct_grand)
                    if combo_sa and combo_sa != "normal":
                        try:
                            ov_str = f"{raw_val:,.{dec}f}" if isinstance(raw_val, (int, float)) and not pd.isna(raw_val) else str(raw_val)
                            total_row[label] = f"{ov_str}\n(100.00%)"
                        except (ValueError, TypeError):
                            total_row[label] = raw_val
                    else:
                        total_row[label] = raw_val
                # Add multi-response note if applicable
                if multi_choice_cols:
                    total_row["__note__"] = f"* Multiple responses: {', '.join(multi_choice_cols)}. Total responses may exceed {original_row_count} respondents."
                result = pd.concat([result, pd.DataFrame([total_row])], ignore_index=True)

            # Column total (last column) — sum across all value columns per row
            want_col_total = config.grand_total_columns if config.grand_total_columns is not None else config.grand_total
            if want_col_total and len(config.values) > 1:
                value_cols = [v.get("label", f"{v.get('agg','sum').title()} of {v['field']}") for v in config.values]
                existing_vcols = [c for c in value_cols if c in result.columns]
                if existing_vcols:
                    numeric_part = result[existing_vcols].apply(pd.to_numeric, errors="coerce").fillna(0)
                    result["Grand Total"] = numeric_part.sum(axis=1)

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

            headers = list(result.columns)
            rows = sanitize_for_json(result.fillna(config.missing_data).values.tolist())
            resp = {"headers": headers, "rows": rows, "row_count": len(rows), "col_count": len(headers)}
            if multi_choice_cols:
                resp["multi_response_note"] = note or f"* Multiple responses: {', '.join(multi_choice_cols)}. Total responses ({len(df)}) may exceed {original_row_count} respondents."
                resp["original_respondents"] = original_row_count
                resp["total_responses"] = len(df)
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
                    _nat_mask = df[_pc].apply(lambda v: pd.isna(v) or str(v).strip() in ('nan', 'NaN', 'NaT', 'None', '<NA>'))
                    if _nat_mask.any():
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
                _af = AGG_MAP.get(_va, "sum")
                _vl = _v.get("label", f"{_va.title()} of {_vf}")

                _tvf = _vf
                if _vf in config.rows or _vf in config.columns:
                    _tvf = f"__temp_{_vf}_{_vi}__"
                    df[_tvf] = df[_vf]
                    _pv_temp_cleanup.append(_tvf)

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
                    "decimals": _v.get("decimals", 2), "agg": _va,
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

            # Percentage of row/column total for pivot
            v0 = config.values[0]
            show_as = v0.get("show_as", "normal")
            combo_show_as = v0.get("combo_show_as", "normal")
            dec = v0.get("decimals", 2)
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
                    # Use only data columns to calculate the grand total (exclude margin column)
                    grand = pivot_df[data_cols].values.sum() if data_cols else pivot_df[numeric_cols].values.sum()
                    # If margins exist, the actual grand is half (margins double it)
                    if has_margin_col and config.grand_total:
                        grand = grand  # data_cols already excludes Grand Total column
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

            def _apply_combo(target_df, orig_df, sa, decimal_places, col_filter=None):
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
                                ov_s = f"{ov:,.{decimal_places}f}" if isinstance(ov, (int, float)) else str(ov)
                                combined.append(f"{ov_s}\n({missing_fill or '0'}%)")
                            else:
                                ov_s = f"{ov:,.{decimal_places}f}" if isinstance(ov, (int, float)) else str(ov)
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
                    _lbl = _vc["label"]
                    # Legacy compat
                    if _vc.get("agg", "sum") in PERCENT_AGGS:
                        _sa = _vc["agg"]
                    _cf = [_lbl]
                    if _csa and _csa != "normal":
                        orig_pivot = pivot.copy()
                        _apply_combo(pivot, orig_pivot, _csa, _dec, col_filter=_cf)
                    elif _sa and _sa != "normal":
                        apply_pivot_show_as(pivot, _sa, _dec, col_filter=_cf)
                    if _dec is not None:
                        val_cols = [c for c in pivot.select_dtypes(include=[np.number]).columns if str(c).endswith(_lbl)]
                        for c in val_cols:
                            pivot[c] = pivot[c].round(int(_dec))
            else:
                if combo_show_as and combo_show_as != "normal":
                    orig_pivot = pivot.copy()
                    _apply_combo(pivot, orig_pivot, combo_show_as, dec)
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

            headers = [str(c) for c in pivot.columns]
            rows = sanitize_for_json(pivot.fillna(config.missing_data).values.tolist())
            result_obj = {"headers": headers, "rows": rows, "row_count": len(rows), "col_count": len(headers)}
            if column_groups:
                result_obj["column_groups"] = column_groups
            if multi_choice_cols:
                result_obj["multi_response_note"] = f"* Multiple responses: {', '.join(multi_choice_cols)}. Total responses ({len(df)}) may exceed {original_row_count} respondents."
                result_obj["original_respondents"] = original_row_count
                result_obj["total_responses"] = len(df)
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
                if agg == "sum":
                    result[label] = df[field].sum()
                elif agg == "count":
                    result[label] = len(df)
                elif agg in ("average", "mean"):
                    result[label] = df[field].mean()
                elif agg == "min":
                    result[label] = df[field].min()
                elif agg == "max":
                    result[label] = df[field].max()
                elif agg == "median":
                    result[label] = df[field].median()
                elif agg == "std":
                    result[label] = df[field].std()
                elif agg == "var":
                    result[label] = df[field].var()
                else:
                    result[label] = df[field].sum()

            headers = list(result.keys())
            rows = [list(result.values())]
            return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": 1, "col_count": len(headers)}

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Tabulation error: {str(e)}")
