"""Data Quality — validation, cleaning, type info, audit trail."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import pandas as pd

from ..shared import datasets, audit_logs, sanitize_for_json, add_audit_log, _is_multi_choice, _detect_columns

router = APIRouter()


@router.get("/api/dataset/{dataset_id}/quality")
async def data_quality(dataset_id: str):
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[dataset_id]["df"]
    report = []
    for col in df.columns:
        nulls = int(df[col].isna().sum())
        total = len(df)
        null_pct = round(nulls / total * 100, 1) if total > 0 else 0
        unique = int(df[col].nunique())
        duplicates = int(total - unique) if unique < total else 0

        status = "green"
        issues = []
        outliers = 0
        type_mismatch = 0

        if null_pct > 10:
            status = "red"
            issues.append(f"{null_pct}% missing values")
        elif null_pct > 0:
            status = "yellow"
            issues.append(f"{null_pct}% missing values")

        if unique > 500:
            issues.append(f"High cardinality ({unique} unique)")
            if status == "green": status = "yellow"

        dtype = str(df[col].dtype)
        if "int" in dtype or "float" in dtype:
            col_clean = df[col].dropna()
            if len(col_clean) > 10:
                mean = col_clean.mean()
                std = col_clean.std()
                if std > 0:
                    outliers = int(((col_clean - mean).abs() > 3 * std).sum())
                    if outliers > 0:
                        issues.append(f"{outliers} statistical outliers (>3σ)")
                        if status == "green": status = "yellow"

        if "object" in dtype:
            sample = df[col].dropna().head(100)
            numeric_parseable = 0
            for v in sample:
                try:
                    float(str(v).replace(",", ""))
                    numeric_parseable += 1
                except (ValueError, TypeError):
                    pass
            if numeric_parseable > len(sample) * 0.8 and len(sample) > 0:
                type_mismatch = int(numeric_parseable)
                issues.append(f"Stored as text but ~{numeric_parseable} values look numeric")
                if status == "green": status = "yellow"

        report.append({
            "column": col, "status": status, "nulls": nulls, "null_pct": null_pct,
            "unique": unique, "duplicates": duplicates, "issues": issues,
            "outliers": outliers, "type_mismatch": type_mismatch,
        })

    dup_rows = int(df.duplicated().sum())

    for col_data in report:
        col = col_data["column"]
        if col_data["type_mismatch"] > 0:
            col_data["issues"].append("Consistency: mixed types detected in column")

    for col_data in report:
        col = col_data["column"]
        if col in df.columns and _is_multi_choice(df[col]):
            col_data["is_multi_choice"] = True
            col_data["issues"].append("Multi-choice column (comma-separated values)")

    return {"columns": report, "duplicate_rows": dup_rows, "total_rows": len(df)}


@router.get("/api/dataset/{dataset_id}/column/{column_name}/type_info")
async def column_type_info(dataset_id: str, column_name: str):
    """Analyze a column's data types and return mixed-type info."""
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[dataset_id]["df"]
    if column_name not in df.columns:
        raise HTTPException(400, f"Column '{column_name}' not found")

    col = df[column_name].dropna()
    total = len(col)
    if total == 0:
        return {"column": column_name, "detected_type": "empty", "mixed": False, "type_counts": {}}

    type_counts = {"numeric": 0, "date": 0, "text": 0}
    sample = col.head(500)
    for val in sample:
        sval = str(val).strip()
        try:
            float(sval.replace(",", ""))
            type_counts["numeric"] += 1
            continue
        except (ValueError, TypeError):
            pass
        try:
            pd.to_datetime(sval)
            type_counts["date"] += 1
            continue
        except (ValueError, TypeError):
            pass
        type_counts["text"] += 1

    scale = total / len(sample) if len(sample) > 0 else 1
    type_counts = {k: int(v * scale) for k, v in type_counts.items()}

    dominant = max(type_counts, key=type_counts.get)
    mixed = sum(1 for v in type_counts.values() if v > total * 0.05) > 1

    non_conforming = []
    if mixed:
        for val in col.head(200):
            sval = str(val).strip()
            if dominant == "numeric":
                try:
                    float(sval.replace(",", ""))
                except (ValueError, TypeError):
                    if len(non_conforming) < 10:
                        non_conforming.append(sval)
            elif dominant == "date":
                try:
                    pd.to_datetime(sval)
                except (ValueError, TypeError):
                    if len(non_conforming) < 10:
                        non_conforming.append(sval)

    return {
        "column": column_name,
        "detected_type": dominant,
        "mixed": mixed,
        "type_counts": type_counts,
        "total": total,
        "non_conforming_samples": non_conforming,
        "current_dtype": str(df[column_name].dtype),
    }


class CleanColumnRequest(BaseModel):
    dataset_id: str
    column: str
    target_type: str
    action: str = "coerce"


@router.post("/api/dataset/clean_column")
async def clean_column(req: CleanColumnRequest):
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[req.dataset_id]["df"]
    if req.column not in df.columns:
        raise HTTPException(400, f"Column '{req.column}' not found")

    original_nulls = int(df[req.column].isna().sum())

    if req.action == "keep":
        return {"message": "No changes applied", "rows_affected": 0}

    if req.target_type == "numeric":
        if req.action == "coerce":
            df[req.column] = pd.to_numeric(df[req.column], errors="coerce")
        elif req.action == "exclude":
            mask = pd.to_numeric(df[req.column], errors="coerce").notna() | df[req.column].isna()
            excluded = int((~mask).sum())
            datasets[req.dataset_id]["df"] = df[mask].reset_index(drop=True)
            add_audit_log(req.dataset_id, "clean_column", f"Excluded {excluded} non-numeric rows from '{req.column}'")
            return {"message": f"Excluded {excluded} non-numeric rows", "rows_affected": excluded}
    elif req.target_type == "date":
        if req.action == "coerce":
            df[req.column] = pd.to_datetime(df[req.column], errors="coerce")
        elif req.action == "exclude":
            mask = pd.to_datetime(df[req.column], errors="coerce").notna() | df[req.column].isna()
            excluded = int((~mask).sum())
            datasets[req.dataset_id]["df"] = df[mask].reset_index(drop=True)
            add_audit_log(req.dataset_id, "clean_column", f"Excluded {excluded} non-date rows from '{req.column}'")
            return {"message": f"Excluded {excluded} non-date rows", "rows_affected": excluded}
    elif req.target_type == "text":
        df[req.column] = df[req.column].astype(str)

    new_nulls = int(df[req.column].isna().sum())
    coerced = new_nulls - original_nulls
    add_audit_log(req.dataset_id, "clean_column", f"Converted '{req.column}' to {req.target_type}, {coerced} values coerced to NaN")

    columns = _detect_columns(datasets[req.dataset_id]["df"])
    return {
        "message": f"Converted '{req.column}' to {req.target_type}. {coerced} invalid values set to NaN.",
        "rows_affected": coerced,
        "columns": columns,
    }


class CleanBulkRequest(BaseModel):
    dataset_id: str
    actions: list[dict]


@router.post("/api/dataset/clean_bulk")
async def clean_bulk(req: CleanBulkRequest):
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[req.dataset_id]["df"]
    results = []

    for action in req.actions:
        act = action.get("action", "")
        col = action.get("column", "")

        if act == "remove_duplicates":
            before = len(df)
            df = df.drop_duplicates().reset_index(drop=True)
            removed = before - len(df)
            results.append(f"Removed {removed} duplicate rows")
            add_audit_log(req.dataset_id, "clean_bulk", f"Removed {removed} duplicate rows")

        elif act == "fill_nulls" and col in df.columns:
            method = action.get("method", "median")
            if method == "median":
                fill_val = pd.to_numeric(df[col], errors="coerce").median()
            elif method == "mean":
                fill_val = pd.to_numeric(df[col], errors="coerce").mean()
            elif method == "mode":
                modes = df[col].mode()
                fill_val = modes.iloc[0] if len(modes) > 0 else ""
            elif method == "zero":
                fill_val = 0
            elif method == "empty":
                fill_val = ""
            else:
                fill_val = action.get("value", "")
            filled = int(df[col].isna().sum())
            df[col] = df[col].fillna(fill_val)
            results.append(f"Filled {filled} nulls in '{col}' with {method}")
            add_audit_log(req.dataset_id, "clean_bulk", f"Filled {filled} nulls in '{col}' with {method}")

        elif act == "remove_outliers" and col in df.columns:
            num_col = pd.to_numeric(df[col], errors="coerce")
            mean = num_col.mean()
            std = num_col.std()
            if std and std > 0:
                mask = (num_col - mean).abs() <= 3 * std
                removed = int((~mask & num_col.notna()).sum())
                df = df[mask | num_col.isna()].reset_index(drop=True)
                results.append(f"Removed {removed} outliers from '{col}'")
                add_audit_log(req.dataset_id, "clean_bulk", f"Removed {removed} outliers from '{col}'")

        elif act == "trim_whitespace":
            cols = [col] if col else [c for c in df.columns if df[c].dtype == object]
            trimmed = 0
            for c in cols:
                if c in df.columns and df[c].dtype == object:
                    before = df[c].copy()
                    df[c] = df[c].where(df[c].isna(), df[c].astype(str).str.strip())
                    trimmed += int((before.fillna("__NA__") != df[c].fillna("__NA__")).sum())
            results.append(f"Trimmed whitespace in {len(cols)} column(s), {trimmed} cells changed")
            add_audit_log(req.dataset_id, "clean_bulk", f"Trimmed whitespace: {trimmed} cells")

        elif act == "text_case" and col in df.columns:
            case_type = action.get("case_type", "lower")
            if df[col].dtype == object:
                before = df[col].copy()
                if case_type == "upper":
                    df[col] = df[col].where(df[col].isna(), df[col].astype(str).str.upper())
                elif case_type == "lower":
                    df[col] = df[col].where(df[col].isna(), df[col].astype(str).str.lower())
                elif case_type == "proper":
                    df[col] = df[col].where(df[col].isna(), df[col].astype(str).str.title())
                changed = int((before.fillna("__NA__") != df[col].fillna("__NA__")).sum())
                results.append(f"Converted '{col}' to {case_type} case, {changed} cells changed")
                add_audit_log(req.dataset_id, "clean_bulk", f"Text case {case_type} on '{col}': {changed} cells")

    datasets[req.dataset_id]["df"] = df
    columns = _detect_columns(df)
    return {"messages": results, "row_count": len(df), "columns": columns}


@router.get("/api/quality/{dataset_id}/drilldown")
async def quality_drilldown(dataset_id: str, column: str, issue_type: str = "nulls"):
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[dataset_id]["df"]
    if column not in df.columns:
        raise HTTPException(400, f"Column '{column}' not found")

    if issue_type == "nulls":
        mask = df[column].isna()
    elif issue_type == "outliers":
        col_clean = pd.to_numeric(df[column], errors="coerce")
        mean = col_clean.mean()
        std = col_clean.std()
        mask = (col_clean - mean).abs() > 3 * std if std > 0 else pd.Series(False, index=df.index)
    elif issue_type == "duplicates":
        mask = df.duplicated(keep=False)
    else:
        mask = df[column].notna()

    detail_rows = df[mask].head(50)
    return {
        "column": column,
        "issue_type": issue_type,
        "row_count": int(mask.sum()),
        "headers": list(detail_rows.columns),
        "rows": sanitize_for_json(detail_rows.fillna("").values.tolist()[:50]),
    }


@router.get("/api/audit/{dataset_id}")
async def get_audit_log(dataset_id: str):
    return {"logs": audit_logs.get(dataset_id, [])}


class AuditEventBody(BaseModel):
    dataset_id: str
    action: str
    details: str = ""


@router.post("/api/audit/log")
async def log_audit_event(body: AuditEventBody):
    add_audit_log(body.dataset_id, body.action, body.details)
    return {"ok": True}
