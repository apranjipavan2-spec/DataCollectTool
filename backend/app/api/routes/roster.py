"""Respondent roster endpoints."""
import io
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_role, require_supervisor, require_enumerator
from app.models.roster import RespondentRoster

router = APIRouter()

require_org_admin = require_role("org_admin")


class RosterCreate(BaseModel):
    form_id: str
    name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    target_enumerator_id: Optional[str] = None
    scheduled_date: Optional[str] = None
    notes: Optional[str] = None


class RosterUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None
    target_enumerator_id: Optional[str] = None
    scheduled_date: Optional[str] = None


class BulkImportBody(BaseModel):
    form_id: str
    respondents: list[RosterCreate]


def _roster_to_dict(r: RespondentRoster) -> dict:
    return {
        "id": str(r.id),
        "form_id": str(r.form_id),
        "tenant_id": str(r.tenant_id),
        "name": r.name,
        "phone": r.phone,
        "address": r.address,
        "target_enumerator_id": str(r.target_enumerator_id) if r.target_enumerator_id else None,
        "status": r.status,
        "scheduled_date": str(r.scheduled_date) if r.scheduled_date else None,
        "notes": r.notes,
        "created_at": str(r.created_at) if r.created_at else None,
    }


@router.get("/")
def list_roster(
    form_id: Optional[str] = None,
    status: Optional[str] = None,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    q = db.query(RespondentRoster).filter(RespondentRoster.tenant_id == user["tenant_id"])
    if form_id:
        q = q.filter(RespondentRoster.form_id == form_id)
    if status:
        q = q.filter(RespondentRoster.status == status)
    return [_roster_to_dict(r) for r in q.order_by(RespondentRoster.created_at.desc()).all()]


@router.post("/")
def create_roster(
    body: RosterCreate,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    from datetime import date as _date
    r = RespondentRoster(
        form_id=body.form_id,
        tenant_id=user["tenant_id"],
        name=body.name,
        phone=body.phone,
        address=body.address,
        target_enumerator_id=body.target_enumerator_id or None,
        scheduled_date=_date.fromisoformat(body.scheduled_date) if body.scheduled_date else None,
        notes=body.notes,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return _roster_to_dict(r)


@router.patch("/{roster_id}")
def update_roster(
    roster_id: str,
    body: RosterUpdate,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    r = db.query(RespondentRoster).filter(
        RespondentRoster.id == roster_id,
        RespondentRoster.tenant_id == user["tenant_id"],
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail="Roster entry not found")
    if body.status is not None:
        r.status = body.status
    if body.notes is not None:
        r.notes = body.notes
    if body.target_enumerator_id is not None:
        r.target_enumerator_id = body.target_enumerator_id or None
    if body.scheduled_date is not None:
        from datetime import date as _date
        r.scheduled_date = _date.fromisoformat(body.scheduled_date) if body.scheduled_date else None
    db.commit()
    db.refresh(r)
    return _roster_to_dict(r)


@router.delete("/{roster_id}")
def delete_roster(
    roster_id: str,
    user: dict = Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    r = db.query(RespondentRoster).filter(
        RespondentRoster.id == roster_id,
        RespondentRoster.tenant_id == user["tenant_id"],
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail="Roster entry not found")
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.post("/bulk-import")
def bulk_import_roster(
    body: BulkImportBody,
    user: dict = Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    from datetime import date as _date
    created = []
    for item in body.respondents:
        r = RespondentRoster(
            form_id=body.form_id,
            tenant_id=user["tenant_id"],
            name=item.name,
            phone=item.phone,
            address=item.address,
            target_enumerator_id=item.target_enumerator_id or None,
            scheduled_date=_date.fromisoformat(item.scheduled_date) if item.scheduled_date else None,
            notes=item.notes,
        )
        db.add(r)
        created.append(r)
    db.commit()
    return {"created": len(created)}


@router.post("/upload-csv")
async def upload_roster_csv(
    form_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    import pandas as pd
    from datetime import date as _date
    from app.models.user import User

    filename = (file.filename or "").lower()
    if not (filename.endswith(".csv") or filename.endswith(".xlsx")):
        raise HTTPException(status_code=400, detail="Only .csv or .xlsx files are supported")

    contents = await file.read()
    try:
        if filename.endswith(".xlsx"):
            df = pd.read_excel(io.BytesIO(contents))
        else:
            df = pd.read_csv(io.BytesIO(contents))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not parse file: {exc}")

    if "name" not in df.columns:
        raise HTTPException(status_code=422, detail="CSV must have a 'name' column")

    known_cols = {"name", "phone", "address", "enumerator_phone", "scheduled_date", "notes"}
    extra_cols = [c for c in df.columns if c not in known_cols]

    created = 0
    skipped = 0
    errors: list[str] = []

    for idx, row in df.iterrows():
        name = str(row.get("name", "")).strip() if row.get("name") is not None else ""
        if not name or name.lower() in ("nan", "none", ""):
            skipped += 1
            continue

        enumerator_id = None
        enumerator_phone = str(row.get("enumerator_phone", "")).strip() if row.get("enumerator_phone") is not None else ""
        if enumerator_phone and enumerator_phone.lower() not in ("nan", "none", ""):
            match = db.query(User).filter(
                User.phone == enumerator_phone,
                User.tenant_id == user["tenant_id"],
            ).first()
            if match:
                enumerator_id = match.id
            else:
                errors.append(f"Row {idx + 2}: enumerator phone '{enumerator_phone}' not found")

        sched_date = None
        raw_date = str(row.get("scheduled_date", "")).strip() if row.get("scheduled_date") is not None else ""
        if raw_date and raw_date.lower() not in ("nan", "none", ""):
            try:
                sched_date = _date.fromisoformat(raw_date[:10])
            except ValueError:
                errors.append(f"Row {idx + 2}: invalid scheduled_date '{raw_date}'")

        extra = {}
        for col in extra_cols:
            val = row.get(col)
            if val is not None and str(val).lower() not in ("nan", "none"):
                extra[col] = str(val)

        phone = str(row.get("phone", "")).strip() if row.get("phone") is not None else ""
        address = str(row.get("address", "")).strip() if row.get("address") is not None else ""
        notes = str(row.get("notes", "")).strip() if row.get("notes") is not None else ""

        r = RespondentRoster(
            form_id=form_id,
            tenant_id=user["tenant_id"],
            name=name,
            phone=phone or None,
            address=address or None,
            target_enumerator_id=enumerator_id,
            scheduled_date=sched_date,
            notes=notes or None,
            extra_data=extra if extra else {},
        )
        db.add(r)
        created += 1

    db.commit()
    return {"created": created, "skipped": skipped, "errors": errors}


@router.get("/with-status")
def roster_with_status(
    form_id: str,
    user: dict = Depends(require_enumerator),
    db: Session = Depends(get_db),
):
    from app.models.submission import Submission

    q = db.query(RespondentRoster).filter(
        RespondentRoster.form_id == form_id,
        RespondentRoster.tenant_id == user["tenant_id"],
    )
    if user.get("role") == "enumerator":
        q = q.filter(RespondentRoster.target_enumerator_id == user["sub"])

    entries = q.order_by(RespondentRoster.created_at).all()

    result = []
    for entry in entries:
        sub = db.query(Submission).filter(
            Submission.roster_id == entry.id,
        ).first()
        collected = sub is not None or entry.status == "completed"
        row = _roster_to_dict(entry)
        row["extra_data"] = entry.extra_data or {}
        row["collected"] = collected
        row["submission_id"] = str(sub.id) if sub else None
        result.append(row)

    return result
