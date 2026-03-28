"""Export endpoints — CSV and Stata .dta for form submissions."""

import csv
import io
from datetime import datetime
from typing import Optional

try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_supervisor
from app.models.form import Form
from app.models.submission import Submission
from app.models.user import User

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _flatten(data: dict, parent_key: str = "", sep: str = "__") -> dict:
    """Recursively flatten nested dicts/lists into dot-separated keys."""
    items: dict = {}
    for k, v in data.items():
        key = f"{parent_key}{sep}{k}" if parent_key else k
        if isinstance(v, dict):
            items.update(_flatten(v, key, sep))
        elif isinstance(v, list):
            for i, elem in enumerate(v):
                if isinstance(elem, dict):
                    items.update(_flatten(elem, f"{key}__{i}", sep))
                else:
                    items[f"{key}__{i}"] = elem
        else:
            items[key] = v
    return items


def _query_submissions(
    db: Session,
    form_id: str,
    tenant_id: str,
    date_from: Optional[datetime],
    date_to: Optional[datetime],
    status: Optional[str],
):
    """Build a filtered query for submissions."""
    q = db.query(Submission).filter(
        Submission.form_id == form_id,
        Submission.tenant_id == tenant_id,
    )
    if date_from:
        q = q.filter(Submission.local_created_at >= date_from)
    if date_to:
        q = q.filter(Submission.local_created_at <= date_to)
    if status:
        q = q.filter(Submission.status == status)
    return q.all()


def _build_enumerator_map(db: Session, tenant_id: str) -> dict:
    """Return {user_id_uuid: name} for all users in the tenant."""
    users = db.query(User).filter(User.tenant_id == tenant_id).all()
    return {u.id: u.name or u.phone for u in users}


def _build_rows(subs: list, enumerator_map: dict) -> list[dict]:
    """Convert submission ORM objects into flat dicts for export."""
    rows = []
    for s in subs:
        flat = _flatten(s.data_json or {})
        row = {
            "submission_id": str(s.id),
            "enumerator_id": str(s.enumerator_id) if s.enumerator_id else "",
            "enumerator_name": enumerator_map.get(s.enumerator_id, ""),
            "form_version": s.form_version or "",
            "status": s.status or "",
            "gps_open_lat": (s.gps_open or {}).get("lat"),
            "gps_open_lng": (s.gps_open or {}).get("lng"),
            "gps_open_accuracy": (s.gps_open or {}).get("accuracy"),
            "gps_submit_lat": (s.gps_submit or {}).get("lat"),
            "gps_submit_lng": (s.gps_submit or {}).get("lng"),
            "gps_submit_accuracy": (s.gps_submit or {}).get("accuracy"),
            "local_created_at": str(s.local_created_at) if s.local_created_at else "",
            "server_received_at": str(s.server_received_at) if s.server_received_at else "",
            **flat,
        }
        rows.append(row)
    return rows


def _sanitize_stata_colname(name: str) -> str:
    """Stata variable names: max 32 chars, alphanumeric + underscore, start with letter/underscore."""
    clean = "".join(c if c.isalnum() or c == "_" else "_" for c in name)
    if clean and clean[0].isdigit():
        clean = "_" + clean
    return clean[:32]


# ---------------------------------------------------------------------------
# CSV export
# ---------------------------------------------------------------------------

@router.get("/submissions/{form_id}/csv")
def export_csv(
    form_id: str,
    date_from: Optional[datetime] = Query(None, description="Filter: local_created_at >="),
    date_to: Optional[datetime] = Query(None, description="Filter: local_created_at <="),
    status: Optional[str] = Query(None, description="Filter by submission status"),
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    """Export submissions for a form as CSV."""
    form = db.query(Form).filter(
        Form.id == form_id, Form.tenant_id == user["tenant_id"]
    ).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    subs = _query_submissions(db, form_id, user["tenant_id"], date_from, date_to, status)
    enum_map = _build_enumerator_map(db, user["tenant_id"])
    rows = _build_rows(subs, enum_map)

    if not rows:
        return StreamingResponse(
            iter([""]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{form.title}.csv"'},
        )

    # Union all keys across rows so every column appears
    all_keys: list[str] = []
    seen: set[str] = set()
    for row in rows:
        for k in row:
            if k not in seen:
                all_keys.append(k)
                seen.add(k)

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=all_keys, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    buf.seek(0)

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{form.title}.csv"'},
    )


# ---------------------------------------------------------------------------
# Stata .dta export
# ---------------------------------------------------------------------------

@router.get("/submissions/{form_id}/dta")
def export_dta(
    form_id: str,
    date_from: Optional[datetime] = Query(None, description="Filter: local_created_at >="),
    date_to: Optional[datetime] = Query(None, description="Filter: local_created_at <="),
    status: Optional[str] = Query(None, description="Filter by submission status"),
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    """Export submissions for a form as Stata .dta file."""
    if not HAS_PANDAS:
        raise HTTPException(status_code=501, detail="Stata export requires pandas. Install pandas to enable this feature.")

    form = db.query(Form).filter(
        Form.id == form_id, Form.tenant_id == user["tenant_id"]
    ).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    subs = _query_submissions(db, form_id, user["tenant_id"], date_from, date_to, status)
    enum_map = _build_enumerator_map(db, user["tenant_id"])
    rows = _build_rows(subs, enum_map)

    if not rows:
        # Return an empty .dta with no observations
        df = pd.DataFrame()
    else:
        df = pd.DataFrame(rows)

    # Sanitize column names for Stata compatibility
    col_renames = {}
    used_names: set[str] = set()
    for col in df.columns:
        clean = _sanitize_stata_colname(col)
        # Deduplicate
        base = clean
        counter = 2
        while clean in used_names:
            suffix = str(counter)
            clean = base[: 32 - len(suffix)] + suffix
            counter += 1
        used_names.add(clean)
        col_renames[col] = clean
    df.rename(columns=col_renames, inplace=True)

    # Convert object columns to string to avoid Stata type issues
    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].astype(str).replace("None", "")

    # Numeric coercion: try to convert string columns that look numeric
    for col in df.columns:
        if df[col].dtype == object:
            try:
                converted = pd.to_numeric(df[col], errors="coerce")
                # Only convert if most values parsed successfully
                if converted.notna().sum() > 0 and converted.isna().sum() <= df[col].eq("").sum():
                    df[col] = converted
            except (ValueError, TypeError):
                pass

    # Write .dta to bytes buffer
    buf = io.BytesIO()
    try:
        df.to_stata(
            buf,
            write_index=False,
            version=118,  # Stata 14+ format — wide compatibility
            convert_dates=None,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate .dta file: {e}")

    buf.seek(0)
    filename = f"{form.title}.dta"

    return StreamingResponse(
        buf,
        media_type="application/x-stata-dta",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
