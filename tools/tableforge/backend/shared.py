"""Shared state, constants, and utility functions used across all routers."""

import os
import json
import uuid
import numpy as np
import pandas as pd
from pathlib import Path
from typing import Optional
from datetime import datetime
from pydantic import BaseModel
from fastapi import Header, HTTPException

# In-memory stores
datasets: dict = {}
custom_metrics: dict = {}  # dataset_id -> [metric_defs]
custom_bins: dict = {}     # dataset_id -> [bin_defs]
audit_logs: dict = {}      # dataset_id -> [log_entries]
annotations: dict = {}     # dataset_id -> {table_id -> [{row, col, text, color}]}
upload_progress: dict = {}  # dataset_id -> {percent, rows_read, total_estimated, status}
column_type_overrides: dict = {}  # dataset_id -> {sheet_name: {col_name: "text"|"numeric"|"multi_choice"|"date"|"boolean"}}
# Survey-analysis metadata layer (Phase 0)
column_roles: dict = {}    # dataset_id -> {col_name: ColumnRole dict}
study_designs: dict = {}   # dataset_id -> StudyDesign dict

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECTS_DIR = BASE_DIR / "projects"
EXPORTS_DIR = BASE_DIR / "exports"
CACHE_DIR = BASE_DIR / "cache"
METRICS_DIR = BASE_DIR / "metrics"
LIBRARY_DIR = BASE_DIR / "library"
PARQUET_DIR = BASE_DIR / "parquet_cache"

for d in [PROJECTS_DIR, EXPORTS_DIR, CACHE_DIR, METRICS_DIR, LIBRARY_DIR, PARQUET_DIR]:
    d.mkdir(exist_ok=True)

LARGE_FILE_THRESHOLD = 50 * 1024 * 1024  # 50 MB
MEMORY_LIMIT = 500 * 1024 * 1024  # 500 MB
SUPER_ADMIN_ROLE = "master_admin"


def get_user_projects_dir(user_id: Optional[str]) -> Path:
    if user_id:
        user_dir = PROJECTS_DIR / user_id
        user_dir.mkdir(exist_ok=True)
        return user_dir
    return PROJECTS_DIR


def is_super_admin(role: Optional[str]) -> bool:
    return role == SUPER_ADMIN_ROLE


# ── Authenticated identity ────────────────────────────────────────────────────
# Identity (user id + role) must come from a verified FieldGovern JWT — NEVER from
# client-supplied X-User-Id / X-User-Role headers, which are trivially spoofable
# and leak across users via stale browser storage. We resolve the token against
# FieldGovern's own /users/me, so FG remains the single source of truth.
_identity_cache: dict = {}   # token -> (expires_at, {"id", "role"})
_IDENTITY_TTL = 60           # seconds — short, so role/account changes propagate


def _resolve_fg_base(fg_base_url: Optional[str]) -> str:
    """Pick the host we trust to answer 'who is this token?'.

    The identity authority MUST be server-configured (FG_INTERNAL_URL /
    FG_PUBLIC_URL). We never fall back to a client-supplied base: the client
    also supplies the token, so trusting its base would let an attacker point
    verification at a server that returns any identity/role it likes — a full
    authz bypass. If no trusted base is configured we fail closed (return ""),
    and the caller treats the request as unauthenticated.

    FG_ALLOWED_VERIFY_HOSTS (comma-separated) may additionally allow specific
    client-supplied bases for multi-tenant/dev setups that can't use an env URL.
    """
    for env in ("FG_INTERNAL_URL", "FG_PUBLIC_URL"):
        val = os.environ.get(env, "").rstrip("/")
        if val:
            return val
    # Optional allowlist for client-supplied bases — empty by default (fail closed).
    candidate = (fg_base_url or "").rstrip("/")
    if candidate:
        allowed = [h.strip().rstrip("/") for h in
                   os.environ.get("FG_ALLOWED_VERIFY_HOSTS", "").split(",") if h.strip()]
        if candidate in allowed:
            return candidate
    return ""


async def verify_fg_identity(token: Optional[str], fg_base_url: Optional[str] = None) -> Optional[dict]:
    """Return {"id", "role"} for a valid FG token, or None if unauthenticated."""
    import time
    import httpx

    if not token:
        return None
    now = time.time()
    cached = _identity_cache.get(token)
    if cached and cached[0] > now:
        return cached[1]

    base = _resolve_fg_base(fg_base_url)
    if not base:
        return None
    internal = bool(os.environ.get("FG_INTERNAL_URL", "").strip())
    try:
        async with httpx.AsyncClient(timeout=15.0, verify=bool(not internal)) as client:
            resp = await client.get(f"{base}/api/v1/users/me",
                                    headers={"Authorization": f"Bearer {token}"})
    except Exception:
        return None
    if resp.status_code != 200:
        return None
    try:
        data = resp.json()
    except Exception:
        return None
    identity = {"id": str(data.get("id") or ""), "role": data.get("role") or ""}
    if not identity["id"]:
        return None
    _identity_cache[token] = (now + _IDENTITY_TTL, identity)
    return identity


async def require_identity(
    authorization: Optional[str] = Header(None),
    x_fg_base_url: Optional[str] = Header(None),
) -> dict:
    """Global auth gate for data/compute endpoints. Rejects the request with 401
    unless the caller presents a FieldGovern JWT that FG itself confirms is valid.
    Identity is never taken from client-supplied id/role headers — only from the
    verified token — so the analyzer cannot be used anonymously."""
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    identity = await verify_fg_identity(token, x_fg_base_url)
    if not identity or not identity.get("id"):
        raise HTTPException(status_code=401, detail="Authentication required")
    return identity


def sanitize_for_json(obj):
    """Recursively convert any value to a JSON-safe primitive.

    The final fallback explicitly converts unknown types (openpyxl CellErrorValue,
    datetime, custom objects, etc.) to string so React never receives an object
    as a JSX child — which would throw React error #310.
    """
    import datetime as _dt
    if isinstance(obj, dict):
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_for_json(v) for v in obj]
    if isinstance(obj, bool):          # must come before int — bool is a subclass of int
        return obj
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, (int,)):
        return obj
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, float):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return obj
    if isinstance(obj, (np.floating,)):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return float(obj)
    if isinstance(obj, pd.Timestamp):
        if pd.isna(obj):
            return None
        return obj.isoformat()
    if isinstance(obj, _dt.datetime):
        return obj.isoformat()
    if isinstance(obj, _dt.date):
        return obj.isoformat()
    if isinstance(obj, pd.Period):
        return str(obj)
    if isinstance(obj, np.ndarray):
        return sanitize_for_json(obj.tolist())
    if isinstance(obj, str):
        if obj.strip().lower() in ('nan', 'inf', '-inf'):
            return None
        obj = obj.replace('(nan%)', '(0%)').replace('(nan)', '(0)')
        obj = obj.replace('(inf%)', '(0%)').replace('(-inf%)', '(0%)')
        return obj
    if obj is None:
        return None
    # Handle numpy/pandas NA sentinels
    try:
        if pd.isna(obj):
            return None
    except (TypeError, ValueError):
        pass
    # Unknown type (openpyxl CellErrorValue, custom object, etc.) — stringify
    # rather than letting the raw object reach the React frontend.
    return str(obj)


def get_active_sheet(dataset_id: str) -> str:
    """Return the currently loaded sheet name for a dataset.

    Falls back to the first sheet, or '__default__' for CSV/TSV datasets
    that have no real sheets. Always safe to call.
    """
    ds = datasets.get(dataset_id)
    if not ds:
        return "__default__"
    name = ds.get("active_sheet")
    if name:
        return str(name)
    sheets = ds.get("sheets") or []
    return str(sheets[0]) if sheets else "__default__"


def get_overrides(dataset_id: str, sheet: Optional[str] = None) -> dict:
    """Get the override dict for a given (or current) sheet. Always returns a dict."""
    if dataset_id not in column_type_overrides:
        column_type_overrides[dataset_id] = {}
    sheet_name = sheet or get_active_sheet(dataset_id)
    bucket = column_type_overrides[dataset_id]
    # Self-heal: legacy flat layout {col: type} -> migrate to {sheet: {col: type}}.
    if bucket and not any(isinstance(v, dict) for v in bucket.values()):
        column_type_overrides[dataset_id] = {sheet_name: dict(bucket)}
        bucket = column_type_overrides[dataset_id]
    return bucket.setdefault(sheet_name, {})


def set_override(dataset_id: str, column: str, new_type: str, sheet: Optional[str] = None) -> None:
    overrides = get_overrides(dataset_id, sheet)
    overrides[column] = new_type


def add_audit_log(dataset_id: str, action: str, details: str = ""):
    if dataset_id not in audit_logs:
        audit_logs[dataset_id] = []
    audit_logs[dataset_id].append({
        "timestamp": datetime.now().isoformat(),
        "action": action,
        "details": details,
    })


def _is_multi_choice(series: pd.Series) -> bool:
    """Detect if a column contains multi-choice comma-separated values.

    A value qualifies as multi-choice only when:
    - It has ≥2 comma-separated parts, each ≤20 chars (excludes "Smith, John")
    - At least 10% of the sample rows match (avoids false positives from a
      single address or sentence that happens to contain a comma).
    """
    non_null = series.dropna().astype(str)
    non_null = non_null[~non_null.isin(['nan', 'NaN', 'None', ''])]
    if len(non_null) == 0:
        return False
    if len(non_null) > 500:
        sample = non_null.sample(500, random_state=42)
    else:
        sample = non_null
    multi_count = 0
    for val in sample:
        val = val.strip()
        if ',' in val:
            parts = [p.strip() for p in val.split(',')]
            # Require ≥2 parts, each short enough to be a code/label not a sentence.
            if len(parts) >= 2 and all(0 < len(p) <= 20 for p in parts):
                multi_count += 1
    # Require at least 10% of sample to be multi-choice style.
    return multi_count >= 2 and multi_count >= len(sample) * 0.10


def _strip_formula_cells(df: pd.DataFrame) -> None:
    """Replace Excel formula strings (cells starting with '=') with NaN in-place.
    Happens when openpyxl reads a workbook whose formula cache is empty."""
    for col in df.columns:
        if df[col].dtype == object:
            mask = df[col].astype(str).str.match(r'^\s*=')
            if mask.any():
                df.loc[mask, col] = np.nan


def _detect_columns(df: pd.DataFrame) -> list:
    """Detect column types and return metadata.

    Mixed-type columns (e.g. mostly numbers but some text labels) are treated
    as numeric when ≥50 % of non-null values parse as numbers; the rest become NaN.
    """
    columns = []
    for col in df.columns:
        dtype = str(df[col].dtype)
        is_multi = False
        if "int" in dtype or "float" in dtype:
            col_type = "numeric"
        elif "datetime" in dtype:
            col_type = "date"
        elif "bool" in dtype:
            col_type = "boolean"
        else:
            non_null = df[col].dropna()
            if len(non_null) > 0:
                # Boolean-string detection runs FIRST: a column of "Yes"/"No" or "0"/"1"
                # would otherwise be coerced to numeric (1.0/0.0) or stay as opaque text.
                _bool_vocab = {'true', 'false', 'yes', 'no', 'y', 'n', '0', '1', 't', 'f'}
                _normalized = non_null.astype(str).str.strip().str.lower()
                _unique = set(_normalized.unique())
                if 1 <= len(_unique) <= 2 and _unique.issubset(_bool_vocab):
                    col_type = "boolean"
                    columns.append({"name": col, "type": col_type,
                                    "sample_values": [str(v) for v in non_null.head(10).tolist()],
                                    "stats": {"nulls": int(df[col].isna().sum()),
                                              "unique": int(df[col].nunique())}})
                    continue
                is_multi = _is_multi_choice(df[col])
                if is_multi:
                    col_type = "multi_choice"
                else:
                    # Coerce to numeric and measure coverage — tolerates mixed cols.
                    num_coerced = pd.to_numeric(non_null, errors="coerce")
                    numeric_ratio = num_coerced.notna().sum() / len(num_coerced)
                    if numeric_ratio >= 0.5:
                        # Guard: don't coerce columns whose values have leading zeros
                        # (ID codes like "001", "002" must stay as text).
                        has_leading_zeros = non_null.astype(str).str.match(r'^0\d').any()
                        if has_leading_zeros:
                            col_type = "text"
                        else:
                            col_type = "numeric"
                            df[col] = pd.to_numeric(df[col], errors="coerce")
                    else:
                        # Date check — require values that look like real date patterns,
                        # not phone numbers (555-1234) or IPs (192.168.1.1).
                        # Pattern: digit(s) separator digit(s) separator digit(s).
                        _samp = non_null.head(20).astype(str)
                        _date_re = r'^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}'
                        if _samp.str.match(_date_re).any():
                            try:
                                pd.to_datetime(_samp[_samp.str.match(_date_re)])
                                col_type = "date"
                                df[col] = pd.to_datetime(df[col], errors="coerce")
                            except (ValueError, TypeError):
                                col_type = "text"
                        else:
                            col_type = "text"
            else:
                col_type = "text"
        sample_values = df[col].dropna().head(10).tolist()
        stats = {}
        if col_type == "numeric":
            # Recompute after coercion so nulls count reflects coerced NaNs.
            try:
                num_series = df[col] if "float" in str(df[col].dtype) or "int" in str(df[col].dtype) \
                    else pd.to_numeric(df[col], errors="coerce")
                stats = {"min": float(num_series.min()) if not pd.isna(num_series.min()) else None,
                         "max": float(num_series.max()) if not pd.isna(num_series.max()) else None,
                         "mean": float(num_series.mean()) if not pd.isna(num_series.mean()) else None}
            except Exception:
                stats = {"min": None, "max": None, "mean": None}
        stats["nulls"] = int(df[col].isna().sum())  # post-coercion count
        stats["unique"] = int(df[col].nunique())
        if is_multi:
            all_vals = []
            for v in df[col].dropna().astype(str):
                all_vals.extend([p.strip() for p in v.split(',') if p.strip()])
            stats["unique_responses"] = len(set(all_vals))
            stats["total_responses"] = len(all_vals)
            stats["is_multi_choice"] = True
        columns.append({"name": col, "type": col_type, "sample_values": [str(v) for v in sample_values],
                        "stats": sanitize_for_json(stats)})
    return columns


def _col_is_text(df: pd.DataFrame, col_name: str) -> bool:
    """Return True if the column is textual/categorical (not truly numeric)."""
    if col_name not in df.columns:
        return False
    dtype = str(df[col_name].dtype)
    if dtype != 'object':
        return False
    sample = df[col_name].dropna().head(50)
    if len(sample) == 0:
        return False
    try:
        pd.to_numeric(sample, errors='raise')
        return False
    except (ValueError, TypeError):
        return True


def apply_metrics_and_bins(df: pd.DataFrame, dataset_id: str) -> pd.DataFrame:
    """Apply custom metrics and bins to the dataframe."""
    # Apply bins first
    for bdef in custom_bins.get(dataset_id, []):
        src = bdef["source_column"]
        name = bdef["name"]
        if src not in df.columns:
            continue
        btype = bdef["bin_type"]

        if btype == "numeric":
            qt = bdef.get("quantile_type", "equal_width")
            if qt in ("equal_freq", "quartile", "decile"):
                n = bdef.get("num_bins", 4 if qt == "quartile" else 10)
                try:
                    df[name] = pd.qcut(df[src], q=n, duplicates="drop").astype(str)
                except Exception:
                    df[name] = df[src].astype(str)
            else:
                ranges = bdef.get("ranges", [])
                if ranges:
                    lower_inclusive = bdef.get("lower_inclusive", True)
                    upper_inclusive = bdef.get("upper_inclusive", False)
                    remainder_label = bdef.get("remainder_label")
                    edges = [r["lower"] for r in ranges] + [ranges[-1]["upper"]]
                    labels = [r["label"] for r in ranges]
                    right = upper_inclusive and not lower_inclusive
                    try:
                        cut_result = pd.cut(df[src], bins=edges, labels=labels, right=right, include_lowest=lower_inclusive)
                        if remainder_label:
                            df[name] = cut_result.astype(str).replace("nan", remainder_label)
                        else:
                            df[name] = cut_result.astype(str)
                    except Exception:
                        df[name] = df[src].astype(str)
        elif btype == "date":
            freq = bdef.get("frequency", "month")
            if freq == "fiscal_year":
                fy_start = bdef.get("fiscal_start_month", 4)
                try:
                    col_dt = pd.to_datetime(df[src], errors="coerce")
                    df[name] = col_dt.apply(lambda d: f"FY{d.year if d.month >= fy_start else d.year - 1}" if pd.notna(d) else None)
                except Exception:
                    df[name] = df[src].astype(str)
            else:
                freq_map = {"year": "YE", "quarter": "QE", "month": "ME", "week": "W", "day": "D"}
                try:
                    col_dt = pd.to_datetime(df[src], errors="coerce")
                    df[name] = col_dt.dt.to_period(freq_map.get(freq, "ME")).astype(str)
                except Exception:
                    df[name] = df[src].astype(str)
        elif btype == "date_range":
            date_ranges = bdef.get("date_ranges", [])
            remainder_label = bdef.get("remainder_label")
            try:
                col_dt = pd.to_datetime(df[src], errors="coerce")
                def classify_date(d):
                    if pd.isna(d):
                        return remainder_label or "Unknown"
                    for dr in date_ranges:
                        label = dr.get("label", "")
                        start_s = dr.get("start", "")
                        end_s = dr.get("end", "")
                        start = pd.to_datetime(start_s) if start_s else pd.Timestamp.min
                        end = pd.to_datetime(end_s) if end_s else pd.Timestamp.max
                        if start <= d <= end:
                            return label
                    return remainder_label or "Other"
                df[name] = col_dt.apply(classify_date)
            except Exception:
                df[name] = df[src].astype(str)
        elif btype == "text":
            case_norm = bdef.get("case_normalize", "none")
            mapping = bdef.get("mapping", {})
            src_series = df[src].astype(str)
            if case_norm == "lower":
                src_series = src_series.str.lower()
                mapping = {k.lower(): v for k, v in mapping.items()}
            elif case_norm == "upper":
                src_series = src_series.str.upper()
                mapping = {k.upper(): v for k, v in mapping.items()}
            elif case_norm == "title":
                src_series = src_series.str.title()
                mapping = {k.title(): v for k, v in mapping.items()}
            df[name] = src_series.map(mapping).fillna(src_series)
        elif btype == "regex":
            import re
            patterns = bdef.get("regex_patterns", [])
            def apply_regex(val):
                s = str(val) if pd.notna(val) else ""
                for p in patterns:
                    try:
                        if re.match(p["pattern"], s):
                            return p["label"]
                    except re.error:
                        pass
                return s
            df[name] = df[src].apply(apply_regex)
        elif btype == "group":
            group_map = bdef.get("group_map", {})
            case_norm = bdef.get("case_normalize", "none")
            remainder_label = bdef.get("remainder_label")
            inv = {}
            for label, values in group_map.items():
                for v in values:
                    inv[str(v).strip()] = label
            src_series = df[src].astype(str)
            if case_norm == "lower": src_series = src_series.str.lower(); inv = {k.lower(): v for k, v in inv.items()}
            elif case_norm == "upper": src_series = src_series.str.upper(); inv = {k.upper(): v for k, v in inv.items()}
            elif case_norm == "title": src_series = src_series.str.title(); inv = {k.title(): v for k, v in inv.items()}
            if remainder_label:
                df[name] = src_series.map(inv).fillna(remainder_label)
            else:
                df[name] = src_series.map(inv).fillna(src_series)
        elif btype == "relative_date":
            freq = bdef.get("frequency", "last_30d")
            try:
                today = pd.Timestamp.now().normalize()
                col_dt = pd.to_datetime(df[src], errors="coerce")
                if freq == "last_7d":
                    cutoff = today - pd.Timedelta(days=7)
                    df[name] = col_dt.apply(lambda d: "In Period" if pd.notna(d) and d >= cutoff else "Prior Period")
                elif freq == "last_30d":
                    cutoff = today - pd.Timedelta(days=30)
                    df[name] = col_dt.apply(lambda d: "In Period" if pd.notna(d) and d >= cutoff else "Prior Period")
                elif freq == "last_90d":
                    cutoff = today - pd.Timedelta(days=90)
                    df[name] = col_dt.apply(lambda d: "In Period" if pd.notna(d) and d >= cutoff else "Prior Period")
                elif freq == "last_12m":
                    cutoff = today - pd.DateOffset(months=12)
                    df[name] = col_dt.apply(lambda d: "In Period" if pd.notna(d) and d >= cutoff else "Prior Period")
                elif freq == "ytd":
                    start = pd.Timestamp(today.year, 1, 1)
                    df[name] = col_dt.apply(lambda d: "YTD" if pd.notna(d) and d >= start else "Prior")
                elif freq == "last_year":
                    start = pd.Timestamp(today.year - 1, 1, 1)
                    end = pd.Timestamp(today.year - 1, 12, 31)
                    df[name] = col_dt.apply(lambda d: "Last Year" if pd.notna(d) and start <= d <= end else "Other")
                elif freq == "qtd":
                    qstart = pd.Timestamp(today.year, ((today.month - 1) // 3) * 3 + 1, 1)
                    df[name] = col_dt.apply(lambda d: "QTD" if pd.notna(d) and d >= qstart else "Prior")
                elif freq == "mtd":
                    mstart = pd.Timestamp(today.year, today.month, 1)
                    df[name] = col_dt.apply(lambda d: "MTD" if pd.notna(d) and d >= mstart else "Prior")
                else:
                    df[name] = "In Period"
            except Exception:
                df[name] = df[src].astype(str)

    # Apply metrics
    for mdef in custom_metrics.get(dataset_id, []):
        name = mdef["name"]
        mtype = mdef.get("metric_type")
        if name in df.columns:
            continue
        try:
            if mtype == "formula":
                col_a = mdef["column_a"]
                col_b = mdef["column_b"]
                op = mdef["operator"]
                a = pd.to_numeric(df[col_a], errors="coerce")
                b = pd.to_numeric(df[col_b], errors="coerce")
                if op == "+": df[name] = a + b
                elif op == "-": df[name] = a - b
                elif op == "*": df[name] = a * b
                elif op == "/": df[name] = a / b.replace(0, np.nan)
            elif mtype == "ratio":
                num = pd.to_numeric(df[mdef["numerator"]], errors="coerce")
                den = pd.to_numeric(df[mdef["denominator"]], errors="coerce")
                df[name] = num / den.replace(0, np.nan)
            elif mtype == "percentage":
                part = mdef["part"]
                whole = mdef["whole"]
                df[name] = (df[part] / df[whole].replace(0, np.nan)) * 100
            elif mtype == "growth":
                curr = mdef["current"]
                prev = mdef["previous"]
                if mdef.get("growth_type") == "absolute":
                    df[name] = df[curr] - df[prev]
                else:
                    df[name] = ((df[curr] - df[prev]) / df[prev].replace(0, np.nan)) * 100
            elif mtype == "weighted_average":
                val = mdef["value_column"]
                wt = mdef["weight_column"]
                df[name] = df[val] * df[wt]
            elif mtype == "conditional":
                cond_col = mdef.get("cond_column", mdef.get("condition_column", ""))
                cond_op = mdef.get("cond_operator", mdef.get("condition_operator", "gt"))
                cond_val_str = mdef.get("cond_value", mdef.get("condition_value", "0"))
                try:
                    cond_val = float(cond_val_str)
                except (ValueError, TypeError):
                    cond_val = cond_val_str

                op_map = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<=", "eq": "==", "neq": "!="}
                op_str = op_map.get(str(cond_op), ">")

                if cond_col and cond_col in df.columns:
                    if cond_op in ("contains", "not_contains", "starts_with", "ends_with", "is_null", "not_null"):
                        str_series = df[cond_col].astype(str).str.strip()
                        if cond_op == "contains": mask = str_series.str.contains(str(cond_val), case=False, na=False)
                        elif cond_op == "not_contains": mask = ~str_series.str.contains(str(cond_val), case=False, na=False)
                        elif cond_op == "starts_with": mask = str_series.str.startswith(str(cond_val), na=False)
                        elif cond_op == "ends_with": mask = str_series.str.endswith(str(cond_val), na=False)
                        elif cond_op == "is_null": mask = df[cond_col].isna() | (str_series == "")
                        else: mask = df[cond_col].notna() & (str_series != "")
                    elif cond_op in ("eq", "neq") and isinstance(cond_val, str):
                        str_series = df[cond_col].astype(str).str.strip()
                        mask = str_series == str(cond_val).strip() if cond_op == "eq" else str_series != str(cond_val).strip()
                    else:
                        col_series = pd.to_numeric(df[cond_col], errors="coerce")
                        if op_str == ">": mask = col_series > cond_val
                        elif op_str == ">=": mask = col_series >= cond_val
                        elif op_str == "<": mask = col_series < cond_val
                        elif op_str == "<=": mask = col_series <= cond_val
                        elif op_str == "==": mask = col_series == cond_val
                        else: mask = col_series != cond_val

                    then_type = mdef.get("cond_then_type", "column")
                    else_type = mdef.get("cond_else_type", "value")
                    then_col = mdef.get("cond_then_col", "")
                    else_col = mdef.get("cond_else_col", "")
                    then_val_str = mdef.get("cond_then_val", "0")
                    else_val_str = mdef.get("cond_else_val", "0")

                    try:
                        then_val = float(then_val_str) if then_val_str else 0
                    except (ValueError, TypeError):
                        then_val = then_val_str
                    try:
                        else_val = float(else_val_str) if else_val_str else 0
                    except (ValueError, TypeError):
                        else_val = else_val_str

                    then_series = df[then_col] if then_type == "column" and then_col in df.columns else then_val
                    else_series = df[else_col] if else_type == "column" and else_col in df.columns else else_val

                    df[name] = np.where(mask, then_series, else_series)
            elif mtype == "index":
                base_col = mdef.get("base_column")
                base_val = mdef.get("base_value", 100)
                if base_col and base_col in df.columns:
                    base = df[base_col].mean()
                    if base != 0:
                        df[name] = (df[base_col] / base) * float(base_val)
                    else:
                        df[name] = np.nan
            elif mtype == "rank":
                rank_col = mdef.get("rank_column")
                rank_ord = mdef.get("rank_order", "desc")
                if rank_col and rank_col in df.columns:
                    df[name] = df[rank_col].rank(ascending=(rank_ord == "asc"), method="min")
            elif mtype == "cumulative":
                val_col = mdef.get("value_column")
                if val_col and val_col in df.columns:
                    df[name] = df[val_col].cumsum()
            elif mtype == "composite":
                col_a = mdef.get("column_a")
                col_b = mdef.get("column_b")
                op = mdef.get("operator", "+")
                if col_a and col_b and col_a in df.columns and col_b in df.columns:
                    if op == "+": df[name] = df[col_a] + df[col_b]
                    elif op == "-": df[name] = df[col_a] - df[col_b]
                    elif op == "*": df[name] = df[col_a] * df[col_b]
                    elif op == "/": df[name] = df[col_a] / df[col_b].replace(0, np.nan)
        except Exception:
            df[name] = np.nan

    return df
